<?php

namespace App\Services\Providers\Amadeus;

use App\DTOs\BaggageAllowanceDTO;
use App\DTOs\FareConditionsDTO;
use App\DTOs\FlightOfferDTO;
use App\DTOs\FlightSegmentDTO;
use App\DTOs\PriceBreakdownDTO;
use App\DTOs\ProviderReservationDTO;
use Carbon\Carbon;
use DateInterval;
use Exception;
use Illuminate\Support\Str;

class AmadeusMapper
{
    /**
     * Map Amadeus v2 Flight Offers Search response item to normalized FlightOfferDTO.
     */
    public static function mapOffer(array $rawOffer, array $dictionaries = []): FlightOfferDTO
    {
        $offerUuid = (string) Str::uuid();
        $providerOfferRef = (string) ($rawOffer['id'] ?? $offerUuid);

        $segments = [];
        $itineraries = $rawOffer['itineraries'] ?? [];

        foreach ($itineraries as $itinerary) {
            $rawSegments = $itinerary['segments'] ?? [];
            $segmentCount = count($rawSegments);

            foreach ($rawSegments as $idx => $s) {
                $carrierCode = $s['carrierCode'] ?? 'XX';
                $carrierName = $dictionaries['carriers'][$carrierCode] ?? $carrierCode;
                $aircraftCode = $s['aircraft']['code'] ?? '738';
                $aircraftName = $dictionaries['aircraft'][$aircraftCode] ?? "Aircraft {$aircraftCode}";

                $depTime = $s['departure']['at'] ?? '';
                $arrTime = $s['arrival']['at'] ?? '';
                $depLocal = Carbon::parse($depTime);
                $arrLocal = Carbon::parse($arrTime);

                $durationMinutes = self::parseIsoDuration($s['duration'] ?? 'PT1H');

                // Layover calculation
                $layoverMinutes = 0;
                if ($idx < $segmentCount - 1 && isset($rawSegments[$idx + 1])) {
                    $nextDep = Carbon::parse($rawSegments[$idx + 1]['departure']['at'] ?? '');
                    $layoverMinutes = max(0, $arrLocal->diffInMinutes($nextDep));
                }

                $segments[] = new FlightSegmentDTO(
                    carrierCode: $carrierCode,
                    carrierName: $carrierName,
                    carrierLogo: "/static/images/airlines/" . strtolower($carrierCode) . ".png",
                    flightNumber: "{$carrierCode}-{$s['number']}",
                    marketingCarrier: $carrierCode,
                    operatingCarrier: $s['operating']['carrierCode'] ?? $carrierCode,
                    aircraft: $aircraftName,
                    cabinClass: self::normalizeCabinClass($rawOffer['travelerPricings'][0]['fareDetailsBySegment'][$idx]['cabin'] ?? 'ECONOMY'),
                    bookingClass: $rawOffer['travelerPricings'][0]['fareDetailsBySegment'][$idx]['class'] ?? 'Y',
                    origin: [
                        'code'     => $s['departure']['iataCode'] ?? '',
                        'name'     => "Airport {$s['departure']['iataCode']}",
                        'city'     => $s['departure']['iataCode'] ?? '',
                        'terminal' => $s['departure']['terminal'] ?? null,
                    ],
                    destination: [
                        'code'     => $s['arrival']['iataCode'] ?? '',
                        'name'     => "Airport {$s['arrival']['iataCode']}",
                        'city'     => $s['arrival']['iataCode'] ?? '',
                        'terminal' => $s['arrival']['terminal'] ?? null,
                    ],
                    departureTimeUtc: $depLocal->copy()->utc()->toIso8601String(),
                    departureLocalTime: $depLocal->format('Y-m-d H:i:s'),
                    departureTimezone: 'UTC',
                    arrivalTimeUtc: $arrLocal->copy()->utc()->toIso8601String(),
                    arrivalLocalTime: $arrLocal->format('Y-m-d H:i:s'),
                    arrivalTimezone: 'UTC',
                    durationMinutes: $durationMinutes,
                    layoverMinutes: $layoverMinutes
                );
            }
        }

        // Price breakdown
        $price = $rawOffer['price'] ?? [];
        $currency = $price['currency'] ?? 'EUR';
        $totalAmount = (float) ($price['grandTotal'] ?? $price['total'] ?? 0.0);
        $baseAmount = (float) ($price['base'] ?? $totalAmount * 0.85);
        $taxAmount = round(max(0, $totalAmount - $baseAmount), 2);

        $priceBreakdown = new PriceBreakdownDTO(
            currency: $currency,
            baseAmount: $baseAmount,
            taxAmount: $taxAmount,
            feeAmount: 0.0,
            totalAmount: $totalAmount
        );

        // Baggage allowance from first traveler segment
        $firstSegmentFare = $rawOffer['travelerPricings'][0]['fareDetailsBySegment'][0] ?? [];
        $includedCheckedBags = $firstSegmentFare['includedCheckedBags']['quantity'] ?? 1;
        $baggage = new BaggageAllowanceDTO(
            cabinPieces: 1,
            cabinWeightKg: 7,
            checkedPieces: (int) $includedCheckedBags,
            checkedWeightKg: $includedCheckedBags > 0 ? 23 : 0
        );

        // Fare conditions
        $fareConditions = new FareConditionsDTO(
            refundable: false,
            refundableWithFee: true,
            changeable: true,
            cancellationFee: 50.0,
            changeFee: 30.0,
            fareFamily: $rawOffer['pricingOptions']['fareType'][0] ?? 'PUBLISHED',
            policyText: 'Amadeus sandbox published fare conditions.'
        );

        return new FlightOfferDTO(
            uuid: $offerUuid,
            providerCode: 'AMADEUS_GDS',
            providerOfferRef: $providerOfferRef,
            segments: $segments,
            baggage: $baggage,
            fareConditions: $fareConditions,
            priceBreakdown: $priceBreakdown,
            supportedExtras: [
                'seats'   => true,
                'baggage' => true,
                'meals'   => false,
            ],
            isRefundable: false,
            isBookable: false, // Sandbox safety guard
            expiresAt: Carbon::parse($rawOffer['lastTicketingDate'] ?? now()->addDay()->toDateString())->toIso8601String(),
            disclaimer: 'Amadeus Sandbox offer – non-production simulation'
        );
    }

    /**
     * Map Amadeus v1 Flight Order response to normalized ProviderReservationDTO.
     */
    public static function mapOrder(array $rawOrder): ProviderReservationDTO
    {
        $orderData = $rawOrder['data'] ?? $rawOrder;
        $orderId = $orderData['id'] ?? (string) Str::uuid();

        // Extract PNR from associatedRecords or reference
        $pnr = 'PENDING';
        if (!empty($orderData['associatedRecords'])) {
            foreach ($orderData['associatedRecords'] as $rec) {
                if (($rec['originSystemCode'] ?? '') === 'GDS') {
                    $pnr = $rec['reference'];
                    break;
                }
            }
        }
        if ($pnr === 'PENDING' && !empty($orderData['queuingOfficeId'])) {
            $pnr = strtoupper(Str::random(6));
        }

        $price = $orderData['flightOffers'][0]['price'] ?? [];
        $currency = $price['currency'] ?? 'EUR';
        $totalPrice = (float) ($price['grandTotal'] ?? $price['total'] ?? 0.0);

        return new ProviderReservationDTO(
            providerCode: 'AMADEUS_GDS',
            providerBookingRef: $orderId,
            pnr: $pnr,
            status: 'TICKETING_PENDING', // Amadeus Self-Service creates orders in TICKETING_PENDING
            ticketingRequiredBy: $orderData['flightOffers'][0]['lastTicketingDate'] ?? null,
            isTicketed: false,
            rawProviderStatus: 'CONFIRMED_RESERVATION',
            currency: $currency,
            totalPrice: $totalPrice,
            passengers: $orderData['travelers'] ?? [],
            segments: $orderData['flightOffers'][0]['itineraries'] ?? [],
            warnings: $orderData['warnings'] ?? [],
            disclaimer: 'Amadeus Sandbox order – requires consolidator / operations queue for e-ticket issuance'
        );
    }

    /**
     * Parse ISO 8601 duration (e.g. PT2H30M, PT45M) into integer minutes.
     */
    public static function parseIsoDuration(string $iso): int
    {
        try {
            $interval = new DateInterval($iso);
            return ($interval->d * 24 * 60) + ($interval->h * 60) + $interval->i;
        } catch (Exception) {
            return 60; // Safe default
        }
    }

    protected static function normalizeCabinClass(string $cabin): string
    {
        return match (strtoupper($cabin)) {
            'PREMIUM_ECONOMY' => 'Premium Economy',
            'BUSINESS'        => 'Business',
            'FIRST'           => 'First',
            default           => 'Economy',
        };
    }
}
