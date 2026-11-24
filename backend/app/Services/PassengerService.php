<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\Passenger;
use App\Models\PassengerDocument;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

class PassengerService
{
    /**
     * Validate age/type rules, check international passport requirements,
     * and persist passengers with encrypted travel documents.
     */
    public function addPassengers(string $bookingUlid, array $passengersData, ?User $user = null): Collection
    {
        $booking = Booking::with('segments.originAirport', 'segments.destinationAirport')->where('ulid', $bookingUlid)->first();
        if (!$booking) {
            throw new RuntimeException('Booking not found.', 404);
        }

        // IDOR ownership guard: if booking belongs to an authenticated user, only that user (or admin) can modify
        if ($user && $booking->user_id !== $user->id && !$user->hasRole(['admin', 'super_admin'])) {
            throw new RuntimeException('Forbidden. You do not have permission to modify this booking.', 403);
        }

        // Check booking state & hold expiration
        if (!in_array($booking->booking_status, ['draft', 'held'], true)) {
            throw new RuntimeException("Cannot add passengers to a booking with status '{$booking->booking_status}'.", 422);
        }

        if ($booking->hold_expires_at && $booking->hold_expires_at->isPast()) {
            throw new RuntimeException('The reservation hold has expired. Please select a flight offer again.', 410);
        }

        // Determine if route is international
        $isInternational = false;
        foreach ($booking->segments as $segment) {
            $originCountry = $segment->originAirport?->country_code ?? 'BD';
            $destCountry = $segment->destinationAirport?->country_code ?? 'BD';
            if ($originCountry !== $destCountry) {
                $isInternational = true;
                break;
            }
        }

        return DB::transaction(function () use ($booking, $passengersData, $isInternational) {
            // Delete existing passengers if updating draft
            $booking->passengers()->delete();

            $created = collect();
            $adultCount = 0;
            $infantCount = 0;

            foreach ($passengersData as $index => $paxData) {
                $dob = Carbon::parse($paxData['date_of_birth']);
                $age = $dob->diffInYears(now());
                $type = strtolower((string) ($paxData['type'] ?? 'adult'));

                // Age validation rules
                if ($type === 'adult') {
                    if ($age < 12) {
                        throw new RuntimeException("Passenger {$paxData['first_name']} {$paxData['last_name']} is categorized as Adult but is under 12 years old ({$age} years).", 422);
                    }
                    $adultCount++;
                } elseif ($type === 'child') {
                    if ($age < 2 || $age >= 12) {
                        throw new RuntimeException("Child passenger must be between 2 and 11 years old. Given age: {$age}.", 422);
                    }
                } elseif ($type === 'infant') {
                    if ($age >= 2) {
                        throw new RuntimeException("Infant passenger must be under 2 years old (< 24 months). Given age: {$age}.", 422);
                    }
                    $infantCount++;
                }

                // International route travel document requirement
                $docData = $paxData['document'] ?? null;
                if ($isInternational) {
                    if (empty($docData) || empty($docData['document_number'])) {
                        throw new RuntimeException("Passport number is mandatory for international flights ({$paxData['first_name']} {$paxData['last_name']}).", 422);
                    }
                    $expiry = !empty($docData['expiry_date']) ? Carbon::parse($docData['expiry_date']) : null;
                    if (!$expiry || $expiry->isPast()) {
                        throw new RuntimeException("Passport for {$paxData['first_name']} {$paxData['last_name']} must have a valid future expiration date.", 422);
                    }
                }

                $passenger = Passenger::create([
                    'ulid'                => (string) Str::ulid(),
                    'booking_id'          => $booking->id,
                    'type'                => $type,
                    'title'               => $paxData['title'] ?? 'Mr',
                    'first_name'          => $paxData['first_name'],
                    'last_name'           => $paxData['last_name'],
                    'date_of_birth'       => $dob->toDateString(),
                    'gender'              => $paxData['gender'] ?? null,
                    'nationality'         => strtoupper((string) ($paxData['nationality'] ?? 'BD')),
                    'wheelchair_required' => (bool) ($paxData['wheelchair_required'] ?? false),
                ]);

                if (!empty($docData) && !empty($docData['document_number'])) {
                    $cleanNumber = preg_replace('/\s+/', '', (string) $docData['document_number']);
                    $masked = strlen($cleanNumber) > 4
                        ? substr($cleanNumber, 0, 2) . '****' . substr($cleanNumber, -2)
                        : '****';

                    PassengerDocument::create([
                        'ulid'                   => (string) Str::ulid(),
                        'passenger_id'           => $passenger->id,
                        'document_type'          => $docData['document_type'] ?? 'passport',
                        'document_number'        => $cleanNumber, // Encrypted at rest via model cast!
                        'document_number_masked' => $masked,
                        'issuing_country'        => strtoupper((string) ($docData['issuing_country'] ?? $passenger->nationality)),
                        'expiry_date'            => !empty($docData['expiry_date']) ? Carbon::parse($docData['expiry_date'])->toDateString() : null,
                        'date_of_birth'          => $dob->toDateString(),
                    ]);
                }

                $created->push($passenger->load('document'));
            }

            // Ratio rule: Infants cannot exceed number of accompanying adults
            if ($infantCount > $adultCount) {
                throw new RuntimeException("The number of infants ({$infantCount}) cannot exceed the number of accompanying adults ({$adultCount}).", 422);
            }

            return $created;
        });
    }
}
