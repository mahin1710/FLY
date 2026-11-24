<?php

namespace App\Services;

use App\Models\Airline;
use App\Models\Airport;
use App\Models\Booking;
use App\Models\BookingEvent;
use App\Models\BookingPriceSnapshot;
use App\Models\BookingSegment;
use App\Models\FlightOffer;
use App\Models\IdempotencyRecord;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

class BookingDraftService
{
    /**
     * Create a booking draft holding inventory for 15 minutes.
     * Price is resolved strictly from the server-side FlightOffer record, NEVER from the client.
     */
    public function createDraft(array $data, ?User $user = null, ?string $idempotencyKey = null): Booking
    {
        // 1. Idempotency Check
        if (!empty($idempotencyKey)) {
            $existing = IdempotencyRecord::where('idempotency_key', $idempotencyKey)
                ->whereIn('scope', ['flight_hold', 'booking_draft'])
                ->first();
            if ($existing) {
                $savedBooking = Booking::where('ulid', $existing->response_body['ulid'] ?? '')->first();
                if ($savedBooking) {
                    return $savedBooking->load(['segments', 'priceSnapshot', 'passengers.document']);
                }
            }
        }

        // 2. Resolve FlightOffer strictly from internal UUID
        $offerUuid = (string) ($data['offer_uuid'] ?? '');
        $offer = FlightOffer::where('uuid', $offerUuid)->first();
        if (!$offer) {
            throw new RuntimeException('The selected flight offer does not exist.', 404);
        }

        if ($offer->expires_at->isPast()) {
            throw new RuntimeException('The selected flight offer has expired. Please select a fresh offer.', 410);
        }

        // 3. Fallback user resolution (assign to authenticated user or default guest customer)
        $userId = $user?->id;
        if (!$userId) {
            $defaultCustomer = User::where('role', 'customer')->first() ?? User::first();
            $userId = $defaultCustomer?->id ?? 1;
        }

        return DB::transaction(function () use ($data, $offer, $userId, $user, $idempotencyKey) {
            // 4. Create or link Price Snapshot
            $snapshotUlid = (string) Str::ulid();
            $priceSnapshot = BookingPriceSnapshot::create([
                'ulid'              => $snapshotUlid,
                'flight_offer_id'   => $offer->id,
                'currency'          => $offer->currency,
                'base_fare'         => $offer->base_amount,
                'taxes'             => $offer->tax_amount,
                'airline_fees'      => $offer->fee_amount,
                'service_fees'      => 0,
                'ancillaries_total' => 0,
                'discounts_total'   => 0,
                'grand_total'       => $offer->total_amount, // Strictly resolved from server
                'breakdown_payload' => [
                    'currency'     => $offer->currency,
                    'base_fare'    => $offer->base_amount,
                    'taxes'        => $offer->tax_amount,
                    'airline_fees' => $offer->fee_amount,
                    'grand_total'  => $offer->total_amount,
                ],
                'created_at'        => now(),
            ]);

            // 5. Create Booking in 'held' state with a 15-minute expiration hold
            $bookingUlid = (string) Str::ulid();
            $reference = 'FLY-' . date('Y') . '-' . strtoupper(Str::random(6));

            $booking = Booking::create([
                'ulid'                      => $bookingUlid,
                'reference'                 => $reference,
                'user_id'                   => $userId,
                'booking_price_snapshot_id' => $priceSnapshot->id,
                'booking_status'            => 'held',
                'payment_status'            => 'unpaid',
                'ticket_status'             => 'unissued',
                'servicing_status'          => 'none',
                'hold_expires_at'           => now()->addMinutes(15), // 15-minute hold guarantee
                'currency'                  => $offer->currency,
                'total_amount'              => $offer->total_amount, // Unalterable server price
                'contact_email'             => $data['contact_email'],
                'contact_phone'             => $data['contact_phone'],
                'contact_country_code'      => $data['contact_country_code'] ?? '+880',
                'remarks'                   => $data['remarks'] ?? 'Draft booking created from flight search.',
            ]);

            // 6. Create Booking Segments
            $segmentsData = $offer->raw_payload['segments'] ?? [];
            foreach ($segmentsData as $index => $s) {
                // Find or resolve airport records
                $originAirport = Airport::where('iata_code', $s['origin']['code'] ?? '')->first() ?? Airport::first();
                $destAirport = Airport::where('iata_code', $s['destination']['code'] ?? '')->first() ?? Airport::skip(1)->first() ?? Airport::first();

                // Find or resolve airline records
                $carrierCode = $s['carrier_code'] ?? 'BG';
                $airline = Airline::where('iata_code', $carrierCode)->first() ?? Airline::first();

                $depUtc = Carbon::parse($s['departure_time_utc'] ?? now()->addDays(7)->toIso8601String());
                $arrUtc = Carbon::parse($s['arrival_time_utc'] ?? now()->addDays(7)->addHours(1)->toIso8601String());

                BookingSegment::create([
                    'ulid'                   => (string) Str::ulid(),
                    'booking_id'             => $booking->id,
                    'segment_order'          => $index + 1,
                    'marketing_airline_id'   => $airline->id,
                    'operating_airline_id'   => $airline->id,
                    'flight_number'          => $s['flight_number'] ?? 'BG-433',
                    'aircraft_type'          => $s['aircraft'] ?? 'Boeing 737-800',
                    'origin_airport_id'      => $originAirport->id,
                    'destination_airport_id' => $destAirport->id,
                    'departure_time_utc'     => $depUtc,
                    'departure_local_time'   => $s['departure_local_time'] ?? $depUtc->format('Y-m-d H:i:s'),
                    'departure_timezone'     => $s['departure_timezone'] ?? 'Asia/Dhaka',
                    'arrival_time_utc'       => $arrUtc,
                    'arrival_local_time'     => $s['arrival_local_time'] ?? $arrUtc->format('Y-m-d H:i:s'),
                    'arrival_timezone'       => $s['arrival_timezone'] ?? 'Asia/Dhaka',
                    'duration_minutes'       => (int) ($s['duration_minutes'] ?? 60),
                    'layover_minutes'        => (int) ($s['layover_minutes'] ?? 0),
                    'cabin_class'            => $s['cabin_class'] ?? 'Economy',
                    'booking_class'          => $s['booking_class'] ?? 'Y',
                    'status'                 => 'held',
                ]);
            }

            // 7. Audit log the state transition event
            BookingEvent::create([
                'booking_id'  => $booking->id,
                'event_name'  => 'hold_created',
                'status_from' => null,
                'status_to'   => 'held',
                'actor_type'  => $user ? 'customer' : 'guest',
                'actor_id'    => $user ? (string) $user->id : null,
                'payload'     => [
                    'hold_expires_at' => $booking->hold_expires_at->toIso8601String(),
                    'total_amount'    => $booking->total_amount,
                    'currency'        => $booking->currency,
                ],
                'ip_address'  => request()->ip(),
            ]);

            // 8. Record Idempotency Record if header was present
            if (!empty($idempotencyKey)) {
                IdempotencyRecord::create([
                    'idempotency_key'      => $idempotencyKey,
                    'scope'                => 'flight_hold',
                    'user_id'              => $user?->id,
                    'request_hash'         => hash('sha256', json_encode($data)),
                    'response_status_code' => 201,
                    'response_body'        => [
                        'ulid'            => $booking->ulid,
                        'reference'       => $booking->reference,
                        'booking_status'  => $booking->booking_status,
                        'total_amount'    => $booking->total_amount,
                        'hold_expires_at' => $booking->hold_expires_at->toIso8601String(),
                    ],
                    'locked_until'         => now()->addMinutes(15),
                ]);
            }

            return $booking->load(['segments', 'priceSnapshot']);
        });
    }
}
