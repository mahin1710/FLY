<?php

namespace App\Services\Providers;

use App\DTOs\BaggageAllowanceDTO;
use App\DTOs\FareConditionsDTO;
use App\DTOs\FlightOfferDTO;
use App\DTOs\FlightSegmentDTO;
use App\DTOs\PriceBreakdownDTO;
use App\DTOs\ProviderCancellationDTO;
use App\DTOs\ProviderRefundQuoteDTO;
use App\DTOs\ProviderReservationDTO;
use App\DTOs\ProviderTicketDTO;
use App\DTOs\RepriceResultDTO;
use Carbon\Carbon;
use Illuminate\Support\Str;
use RuntimeException;

class MockFlightProvider implements FlightProviderInterface
{
    public const PROVIDER_CODE = 'MOCK_GDS';

    public function __construct()
    {
        // STRICT SAFETY GUARD: The mock provider must NEVER run in a production environment
        if (app()->environment('production')) {
            throw new RuntimeException('MockFlightProvider must never run in production.');
        }
    }

    public function getProviderCode(): string
    {
        return self::PROVIDER_CODE;
    }

    /**
     * Search flight offers using deterministic fixtures.
     *
     * @param array $criteria
     * @return FlightOfferDTO[]
     */
    public function search(array $criteria): array
    {
        $origin = strtoupper((string) ($criteria['origin'] ?? 'DAC'));
        $destination = strtoupper((string) ($criteria['destination'] ?? 'CXB'));
        $deptDate = (string) ($criteria['departure_date'] ?? now()->addDays(7)->toDateString());
        $cabinClass = ucfirst(strtolower((string) ($criteria['cabin_class'] ?? 'Economy')));
        $adults = max(1, (int) ($criteria['adults'] ?? 1));
        $children = max(0, (int) ($criteria['children'] ?? 0));
        $infants = max(0, (int) ($criteria['infants'] ?? 0));
        $passengerMultiplier = $adults + ($children * 0.75) + ($infants * 0.10);

        $templates = $this->getFixturesForRoute($origin, $destination);

        $offers = [];
        foreach ($templates as $index => $t) {
            $offerUuid = (string) Str::uuid();
            $providerOfferRef = sprintf('MOCK-%s-%s-%s-%d', $origin, $destination, str_replace('-', '', $deptDate), $index + 1);

            $segments = [];
            foreach ($t['segments'] as $sIndex => $sDef) {
                $depLocal = Carbon::parse($deptDate . ' ' . $sDef['dep_time'], $sDef['origin']['tz'] ?? 'Asia/Dhaka');
                $arrLocal = (clone $depLocal)->addMinutes($sDef['duration_minutes']);

                $segments[] = new FlightSegmentDTO(
                    carrierCode: $sDef['carrier_code'],
                    carrierName: $sDef['carrier_name'],
                    carrierLogo: $sDef['carrier_logo'] ?? null,
                    flightNumber: $sDef['flight_number'],
                    marketingCarrier: $sDef['marketing_carrier'] ?? $sDef['carrier_code'],
                    operatingCarrier: $sDef['operating_carrier'] ?? $sDef['carrier_code'],
                    aircraft: $sDef['aircraft'] ?? 'Boeing 737-800',
                    cabinClass: $cabinClass,
                    bookingClass: $sDef['booking_class'] ?? 'Y',
                    origin: [
                        'code'     => $sDef['origin']['code'],
                        'name'     => $sDef['origin']['name'],
                        'city'     => $sDef['origin']['city'],
                        'terminal' => $sDef['origin']['terminal'] ?? null,
                    ],
                    destination: [
                        'code'     => $sDef['destination']['code'],
                        'name'     => $sDef['destination']['name'],
                        'city'     => $sDef['destination']['city'],
                        'terminal' => $sDef['destination']['terminal'] ?? null,
                    ],
                    departureTimeUtc: $depLocal->copy()->utc()->toIso8601String(),
                    departureLocalTime: $depLocal->format('Y-m-d H:i:s'),
                    departureTimezone: $sDef['origin']['tz'] ?? 'Asia/Dhaka',
                    arrivalTimeUtc: $arrLocal->copy()->utc()->toIso8601String(),
                    arrivalLocalTime: $arrLocal->format('Y-m-d H:i:s'),
                    arrivalTimezone: $sDef['destination']['tz'] ?? 'Asia/Dhaka',
                    durationMinutes: (int) $sDef['duration_minutes'],
                    layoverMinutes: (int) ($sDef['layover_minutes'] ?? 0)
                );
            }

            $rawBase = $t['base_price'] * $passengerMultiplier;
            $rawTax = $t['tax_price'] * $passengerMultiplier;
            $rawFee = ($t['fee_price'] ?? 150.00) * ($adults + $children);
            $totalAmount = round($rawBase + $rawTax + $rawFee, 2);

            $baggage = new BaggageAllowanceDTO(
                cabinPieces: $t['baggage']['cabin_pieces'] ?? 1,
                cabinWeightKg: $t['baggage']['cabin_weight_kg'] ?? 7,
                checkedPieces: $t['baggage']['checked_pieces'] ?? 1,
                checkedWeightKg: $t['baggage']['checked_weight_kg'] ?? 20
            );

            $fareConditions = new FareConditionsDTO(
                refundable: $t['conditions']['refundable'] ?? false,
                refundableWithFee: $t['conditions']['refundable_with_fee'] ?? false,
                changeable: $t['conditions']['changeable'] ?? true,
                cancellationFee: $t['conditions']['cancellation_fee'] ?? 1500.0,
                changeFee: $t['conditions']['change_fee'] ?? 800.0,
                fareFamily: $t['fare_family'] ?? 'Standard Economy',
                policyText: $t['conditions']['policy_text'] ?? 'Demo ticket conditions for testing.'
            );

            $priceBreakdown = new PriceBreakdownDTO(
                currency: $t['currency'] ?? 'BDT',
                baseAmount: round($rawBase, 2),
                taxAmount: round($rawTax, 2),
                feeAmount: round($rawFee, 2),
                totalAmount: $totalAmount
            );

            $offers[] = new FlightOfferDTO(
                uuid: $offerUuid,
                providerCode: self::PROVIDER_CODE,
                providerOfferRef: $providerOfferRef,
                segments: $segments,
                baggage: $baggage,
                fareConditions: $fareConditions,
                priceBreakdown: $priceBreakdown,
                supportedExtras: [
                    'seats'   => (bool) ($t['supported_extras']['seats'] ?? true),
                    'baggage' => (bool) ($t['supported_extras']['baggage'] ?? true),
                    'meals'   => (bool) ($t['supported_extras']['meals'] ?? false),
                ],
                isRefundable: (bool) ($t['conditions']['refundable'] ?? false),
                isBookable: false, // Explicit typed constraint
                expiresAt: now()->addMinutes(30)->toIso8601String(),
                disclaimer: 'Demo data – not bookable'
            );
        }

        return $offers;
    }

    /**
     * Retrieve offer details by provider reference.
     */
    public function getOffer(string $providerOfferRef): ?FlightOfferDTO
    {
        // Reconstruct or resolve from search criteria encoded in ref
        $parts = explode('-', $providerOfferRef);
        if (count($parts) >= 4) {
            $origin = $parts[1] ?? 'DAC';
            $destination = $parts[2] ?? 'CXB';
            $dateStr = $parts[3] ?? now()->format('Ymd');
            $deptDate = strlen($dateStr) === 8
                ? substr($dateStr, 0, 4) . '-' . substr($dateStr, 4, 2) . '-' . substr($dateStr, 6, 2)
                : now()->addDays(7)->toDateString();

            $offers = $this->search([
                'origin' => $origin,
                'destination' => $destination,
                'departure_date' => $deptDate,
            ]);

            foreach ($offers as $offer) {
                if ($offer->providerOfferRef === $providerOfferRef) {
                    return $offer;
                }
            }
            return $offers[0] ?? null;
        }

        return null;
    }

    /**
     * Check fare bucket availability and simulate repricing.
     */
    public function reprice(string $providerOfferRef, ?FlightOfferDTO $currentOffer = null): RepriceResultDTO
    {
        $offer = $currentOffer ?? $this->getOffer($providerOfferRef);
        $oldAmount = $offer ? $offer->priceBreakdown->totalAmount : 4850.00;
        $currency = $offer ? $offer->priceBreakdown->currency : 'BDT';

        // Deterministic simulation: if offer ref ends with 'change', adjust fare slightly
        $hasChanged = str_contains($providerOfferRef, 'PRICE_CHANGE') || str_contains($providerOfferRef, 'change');
        $newAmount = $hasChanged ? round($oldAmount + 250.00, 2) : $oldAmount;
        $diff = round($newAmount - $oldAmount, 2);

        return new RepriceResultDTO(
            offerUuid: $offer ? $offer->uuid : (string) Str::uuid(),
            hasPriceChanged: $hasChanged,
            oldAmount: $oldAmount,
            newAmount: $newAmount,
            difference: $diff,
            currency: $currency,
            reason: $hasChanged ? 'Fare bucket adjustment: Promo inventory exhausted. Re-quoted in Standard class.' : null,
            isGuaranteed: false, // Typed guarantee: demo reprice cannot guarantee live airline inventory
            disclaimer: 'Demo fare quote – pricing subject to live airline provider verification',
            snapshotUlid: null,
            recalculatedAt: now()->toIso8601String()
        );
    }

    /**
     * Route fixtures definitions.
     */
    protected function getFixturesForRoute(string $origin, string $destination): array
    {
        // 1. Domestic Dhaka (DAC) <-> Cox's Bazar (CXB)
        if (($origin === 'DAC' && $destination === 'CXB') || ($origin === 'CXB' && $destination === 'DAC')) {
            $isReturn = $origin === 'CXB';
            $oCode = $isReturn ? 'CXB' : 'DAC';
            $oName = $isReturn ? "Cox's Bazar Airport" : 'Hazrat Shahjalal International Airport';
            $oCity = $isReturn ? "Cox's Bazar" : 'Dhaka';
            $dCode = $isReturn ? 'DAC' : 'CXB';
            $dName = $isReturn ? 'Hazrat Shahjalal International Airport' : "Cox's Bazar Airport";
            $dCity = $isReturn ? 'Dhaka' : "Cox's Bazar";

            return [
                [
                    'fare_family' => 'Economy Saver',
                    'base_price'  => 3800.00,
                    'tax_price'   => 550.00,
                    'fee_price'   => 150.00,
                    'currency'    => 'BDT',
                    'baggage'     => ['cabin_pieces' => 1, 'cabin_weight_kg' => 7, 'checked_pieces' => 1, 'checked_weight_kg' => 20],
                    'conditions'  => ['refundable' => false, 'refundable_with_fee' => false, 'changeable' => true, 'cancellation_fee' => 0.0, 'change_fee' => 500.0, 'policy_text' => 'Non-refundable saver fare. Date changes permitted with 500 BDT fee.'],
                    'supported_extras' => ['seats' => true, 'baggage' => true, 'meals' => false],
                    'segments'    => [
                        [
                            'carrier_code'     => 'BG',
                            'carrier_name'     => 'Biman Bangladesh Airlines',
                            'carrier_logo'     => '/static/images/airlines/biman.png',
                            'flight_number'    => 'BG-433',
                            'aircraft'         => 'Boeing 737-800',
                            'booking_class'    => 'E',
                            'duration_minutes' => 55,
                            'dep_time'         => '07:30:00',
                            'origin'           => ['code' => $oCode, 'name' => $oName, 'city' => $oCity, 'tz' => 'Asia/Dhaka'],
                            'destination'      => ['code' => $dCode, 'name' => $dName, 'city' => $dCity, 'tz' => 'Asia/Dhaka'],
                        ],
                    ],
                ],
                [
                    'fare_family' => 'Economy Classic',
                    'base_price'  => 4400.00,
                    'tax_price'   => 650.00,
                    'fee_price'   => 150.00,
                    'currency'    => 'BDT',
                    'baggage'     => ['cabin_pieces' => 1, 'cabin_weight_kg' => 7, 'checked_pieces' => 1, 'checked_weight_kg' => 20],
                    'conditions'  => ['refundable' => true, 'refundable_with_fee' => true, 'changeable' => true, 'cancellation_fee' => 1000.0, 'change_fee' => 400.0, 'policy_text' => 'Partially refundable with 1,000 BDT fee. Changes permitted.'],
                    'supported_extras' => ['seats' => true, 'baggage' => true, 'meals' => true],
                    'segments'    => [
                        [
                            'carrier_code'     => 'BS',
                            'carrier_name'     => 'US-Bangla Airlines',
                            'carrier_logo'     => '/static/images/airlines/usbangla.png',
                            'flight_number'    => 'BS-141',
                            'aircraft'         => 'ATR 72-600',
                            'booking_class'    => 'M',
                            'duration_minutes' => 60,
                            'dep_time'         => '10:15:00',
                            'origin'           => ['code' => $oCode, 'name' => $oName, 'city' => $oCity, 'tz' => 'Asia/Dhaka'],
                            'destination'      => ['code' => $dCode, 'name' => $dName, 'city' => $dCity, 'tz' => 'Asia/Dhaka'],
                        ],
                    ],
                ],
                [
                    'fare_family' => 'Economy Standard',
                    'base_price'  => 4100.00,
                    'tax_price'   => 550.00,
                    'fee_price'   => 150.00,
                    'currency'    => 'BDT',
                    'baggage'     => ['cabin_pieces' => 1, 'cabin_weight_kg' => 7, 'checked_pieces' => 1, 'checked_weight_kg' => 20],
                    'conditions'  => ['refundable' => true, 'refundable_with_fee' => true, 'changeable' => true, 'cancellation_fee' => 1200.0, 'change_fee' => 500.0, 'policy_text' => 'Standard flexible fare.'],
                    'supported_extras' => ['seats' => true, 'baggage' => false, 'meals' => false],
                    'segments'    => [
                        [
                            'carrier_code'     => '2A',
                            'carrier_name'     => 'Air Astra',
                            'carrier_logo'     => '/static/images/airlines/airastra.png',
                            'flight_number'    => '2A-441',
                            'aircraft'         => 'ATR 72-600',
                            'booking_class'    => 'K',
                            'duration_minutes' => 60,
                            'dep_time'         => '13:00:00',
                            'origin'           => ['code' => $oCode, 'name' => $oName, 'city' => $oCity, 'tz' => 'Asia/Dhaka'],
                            'destination'      => ['code' => $dCode, 'name' => $dName, 'city' => $dCity, 'tz' => 'Asia/Dhaka'],
                        ],
                    ],
                ],
                [
                    'fare_family' => 'Economy Light (Hand Baggage Only)',
                    'base_price'  => 3250.00,
                    'tax_price'   => 500.00,
                    'fee_price'   => 150.00,
                    'currency'    => 'BDT',
                    'baggage'     => ['cabin_pieces' => 1, 'cabin_weight_kg' => 7, 'checked_pieces' => 0, 'checked_weight_kg' => 0],
                    'conditions'  => ['refundable' => false, 'refundable_with_fee' => false, 'changeable' => false, 'cancellation_fee' => 0.0, 'change_fee' => 0.0, 'policy_text' => 'Strictly non-refundable and non-changeable.'],
                    'supported_extras' => ['seats' => false, 'baggage' => true, 'meals' => false],
                    'segments'    => [
                        [
                            'carrier_code'     => 'BS',
                            'carrier_name'     => 'US-Bangla Airlines',
                            'carrier_logo'     => '/static/images/airlines/usbangla.png',
                            'flight_number'    => 'BS-149',
                            'aircraft'         => 'Boeing 737-800',
                            'booking_class'    => 'O',
                            'duration_minutes' => 55,
                            'dep_time'         => '16:45:00',
                            'origin'           => ['code' => $oCode, 'name' => $oName, 'city' => $oCity, 'tz' => 'Asia/Dhaka'],
                            'destination'      => ['code' => $dCode, 'name' => $dName, 'city' => $dCity, 'tz' => 'Asia/Dhaka'],
                        ],
                    ],
                ],
                // 1-Stop Connecting Itinerary via CGP
                [
                    'fare_family' => 'Economy Flex (1 Stop)',
                    'base_price'  => 5200.00,
                    'tax_price'   => 850.00,
                    'fee_price'   => 150.00,
                    'currency'    => 'BDT',
                    'baggage'     => ['cabin_pieces' => 1, 'cabin_weight_kg' => 7, 'checked_pieces' => 2, 'checked_weight_kg' => 30],
                    'conditions'  => ['refundable' => true, 'refundable_with_fee' => false, 'changeable' => true, 'cancellation_fee' => 0.0, 'change_fee' => 0.0, 'policy_text' => 'Fully refundable and free changes up to 24h before departure.'],
                    'supported_extras' => ['seats' => true, 'baggage' => true, 'meals' => true],
                    'segments'    => [
                        [
                            'carrier_code'     => 'BG',
                            'carrier_name'     => 'Biman Bangladesh Airlines',
                            'carrier_logo'     => '/static/images/airlines/biman.png',
                            'flight_number'    => 'BG-409',
                            'aircraft'         => 'Boeing 737-800',
                            'booking_class'    => 'Y',
                            'duration_minutes' => 45,
                            'dep_time'         => '08:00:00',
                            'origin'           => ['code' => $oCode, 'name' => $oName, 'city' => $oCity, 'tz' => 'Asia/Dhaka'],
                            'destination'      => ['code' => 'CGP', 'name' => 'Shah Amanat International Airport', 'city' => 'Chattogram', 'tz' => 'Asia/Dhaka'],
                            'layover_minutes'  => 65,
                        ],
                        [
                            'carrier_code'     => 'BG',
                            'carrier_name'     => 'Biman Bangladesh Airlines',
                            'carrier_logo'     => '/static/images/airlines/biman.png',
                            'flight_number'    => 'BG-411',
                            'aircraft'         => 'Dash-8 Q400',
                            'booking_class'    => 'Y',
                            'duration_minutes' => 35,
                            'dep_time'         => '09:50:00',
                            'origin'           => ['code' => 'CGP', 'name' => 'Shah Amanat International Airport', 'city' => 'Chattogram', 'tz' => 'Asia/Dhaka'],
                            'destination'      => ['code' => $dCode, 'name' => $dName, 'city' => $dCity, 'tz' => 'Asia/Dhaka'],
                            'layover_minutes'  => 0,
                        ],
                    ],
                ],
            ];
        }

        // 2. International Dhaka (DAC) <-> Dubai (DXB)
        if (($origin === 'DAC' && $destination === 'DXB') || ($origin === 'DXB' && $destination === 'DAC')) {
            $isReturn = $origin === 'DXB';
            $oCode = $isReturn ? 'DXB' : 'DAC';
            $oName = $isReturn ? 'Dubai International Airport' : 'Hazrat Shahjalal International Airport';
            $oCity = $isReturn ? 'Dubai' : 'Dhaka';
            $oTz   = $isReturn ? 'Asia/Dubai' : 'Asia/Dhaka';
            $dCode = $isReturn ? 'DAC' : 'DXB';
            $dName = $isReturn ? 'Hazrat Shahjalal International Airport' : 'Dubai International Airport';
            $dCity = $isReturn ? 'Dhaka' : 'Dubai';
            $dTz   = $isReturn ? 'Asia/Dhaka' : 'Asia/Dubai';

            return [
                [
                    'fare_family' => 'Economy Value',
                    'base_price'  => 39500.00,
                    'tax_price'   => 8200.00,
                    'fee_price'   => 300.00,
                    'currency'    => 'BDT',
                    'baggage'     => ['cabin_pieces' => 1, 'cabin_weight_kg' => 7, 'checked_pieces' => 2, 'checked_weight_kg' => 30],
                    'conditions'  => ['refundable' => true, 'refundable_with_fee' => true, 'changeable' => true, 'cancellation_fee' => 4500.0, 'change_fee' => 2500.0, 'policy_text' => 'International saver ticket. Changes permitted.'],
                    'supported_extras' => ['seats' => true, 'baggage' => true, 'meals' => true],
                    'segments'    => [
                        [
                            'carrier_code'     => 'BG',
                            'carrier_name'     => 'Biman Bangladesh Airlines',
                            'carrier_logo'     => '/static/images/airlines/biman.png',
                            'flight_number'    => 'BG-051',
                            'aircraft'         => 'Boeing 787-8 Dreamliner',
                            'booking_class'    => 'V',
                            'duration_minutes' => 315, // 5h 15m
                            'dep_time'         => '20:45:00',
                            'origin'           => ['code' => $oCode, 'name' => $oName, 'city' => $oCity, 'tz' => $oTz, 'terminal' => '1'],
                            'destination'      => ['code' => $dCode, 'name' => $dName, 'city' => $dCity, 'tz' => $dTz, 'terminal' => '1'],
                        ],
                    ],
                ],
                [
                    'fare_family' => 'Economy Flex Codeshare',
                    'base_price'  => 46000.00,
                    'tax_price'   => 8500.00,
                    'fee_price'   => 300.00,
                    'currency'    => 'BDT',
                    'baggage'     => ['cabin_pieces' => 1, 'cabin_weight_kg' => 7, 'checked_pieces' => 2, 'checked_weight_kg' => 35],
                    'conditions'  => ['refundable' => true, 'refundable_with_fee' => true, 'changeable' => true, 'cancellation_fee' => 3000.0, 'change_fee' => 1500.0, 'policy_text' => 'Emirates / flydubai partner policy.'],
                    'supported_extras' => ['seats' => true, 'baggage' => true, 'meals' => true],
                    'segments'    => [
                        [
                            'carrier_code'     => 'FZ',
                            'carrier_name'     => 'flydubai',
                            'carrier_logo'     => '/static/images/airlines/flydubai.png',
                            'flight_number'    => 'FZ-584',
                            'marketing_carrier'=> 'EK',
                            'operating_carrier'=> 'FZ',
                            'aircraft'         => 'Boeing 737 MAX 8',
                            'booking_class'    => 'L',
                            'duration_minutes' => 310,
                            'dep_time'         => '01:50:00',
                            'origin'           => ['code' => $oCode, 'name' => $oName, 'city' => $oCity, 'tz' => $oTz, 'terminal' => '1'],
                            'destination'      => ['code' => $dCode, 'name' => $dName, 'city' => $dCity, 'tz' => $dTz, 'terminal' => '3'],
                        ],
                    ],
                ],
            ];
        }

        // 3. Generic fallback for any other valid route pair
        return [
            [
                'fare_family' => 'Economy Standard',
                'base_price'  => 5500.00,
                'tax_price'   => 750.00,
                'fee_price'   => 150.00,
                'currency'    => 'BDT',
                'baggage'     => ['cabin_pieces' => 1, 'cabin_weight_kg' => 7, 'checked_pieces' => 1, 'checked_weight_kg' => 20],
                'conditions'  => ['refundable' => true, 'refundable_with_fee' => true, 'changeable' => true, 'cancellation_fee' => 1000.0, 'change_fee' => 500.0, 'policy_text' => 'Standard economy fare.'],
                'supported_extras' => ['seats' => true, 'baggage' => true, 'meals' => false],
                'segments'    => [
                    [
                        'carrier_code'     => 'BG',
                        'carrier_name'     => 'Biman Bangladesh Airlines',
                        'carrier_logo'     => '/static/images/airlines/biman.png',
                        'flight_number'    => 'BG-101',
                        'aircraft'         => 'Boeing 737-800',
                        'booking_class'    => 'Y',
                        'duration_minutes' => 60,
                        'dep_time'         => '11:00:00',
                        'origin'           => ['code' => $origin, 'name' => "Airport {$origin}", 'city' => $origin, 'tz' => 'UTC'],
                        'destination'      => ['code' => $destination, 'name' => "Airport {$destination}", 'city' => $destination, 'tz' => 'UTC'],
                    ],
                ],
            ],
        ];
    }

    /**
     * Create simulated airline reservation / order (PNR hold).
     */
    public function createReservation(
        FlightOfferDTO $offer,
        array $passengers,
        array $contactInfo
    ): ProviderReservationDTO {
        $pnr = 'MCK' . strtoupper(Str::random(3));
        $bookingRef = 'MOCK-ORDER-' . strtoupper(Str::random(8));

        return new ProviderReservationDTO(
            providerCode: self::PROVIDER_CODE,
            providerBookingRef: $bookingRef,
            pnr: $pnr,
            status: 'CONFIRMED',
            ticketingRequiredBy: now()->addHours(24)->toIso8601String(),
            isTicketed: false,
            rawProviderStatus: 'CONFIRMED_HOLD',
            currency: $offer->priceBreakdown->currency,
            totalPrice: $offer->priceBreakdown->totalAmount,
            passengers: $passengers,
            segments: array_map(fn ($s) => $s->toArray(), $offer->segments),
            warnings: [],
            disclaimer: 'Sandbox reservation – not a valid live airline PNR'
        );
    }

    /**
     * Retrieve simulated reservation.
     */
    public function getReservation(string $providerBookingRef): ProviderReservationDTO
    {
        return new ProviderReservationDTO(
            providerCode: self::PROVIDER_CODE,
            providerBookingRef: $providerBookingRef,
            pnr: 'MCK778',
            status: 'CONFIRMED',
            ticketingRequiredBy: now()->addHours(12)->toIso8601String(),
            isTicketed: false,
            rawProviderStatus: 'CONFIRMED_HOLD',
            currency: 'BDT',
            totalPrice: 4850.00,
            passengers: [],
            segments: [],
            warnings: [],
            disclaimer: 'Sandbox reservation – not a valid live airline PNR'
        );
    }

    /**
     * Issue simulated ticket. Supports multiple passengers, segments, and simulation modes.
     */
    public function issueTicket(
        string $providerBookingRef,
        array $paymentDetails
    ): ProviderTicketDTO {
        $simMode = $paymentDetails['simulation_mode'] ?? null;

        if ($simMode === 'TIMEOUT') {
            throw new \RuntimeException('Mock provider gateway timed out waiting for ticketing server response (504).');
        }

        if ($simMode === 'TICKETING_PENDING' || $simMode === 'MISSING_TICKET') {
            return new ProviderTicketDTO(
                providerCode: self::PROVIDER_CODE,
                ticketNumber: null,
                passengerName: 'CONSOLIDATOR/PENDING',
                status: 'TICKETING_PENDING',
                issuedAt: null,
                coupons: [],
                documentType: 'ELECTRONIC_TICKET',
                disclaimer: 'Sandbox ticket – not valid for live passenger boarding',
                tickets: []
            );
        }

        $passengers = $paymentDetails['passengers'] ?? [
            ['id' => 1, 'name' => 'DEMO/PASSENGER'],
        ];

        $tickets = [];
        $overallStatus = 'ISSUED';
        $mainTicketNum = null;

        foreach ($passengers as $idx => $p) {
            $pId = is_array($p) ? ($p['id'] ?? ($idx + 1)) : $p->id;
            $pName = is_array($p) ? ($p['name'] ?? "PASSENGER/{$pId}") : "{$p->last_name}/{$p->first_name}";

            if ($simMode === 'PARTIAL' && $idx > 0) {
                // Partial failure simulation: subsequent passengers remain pending
                $tickets[] = [
                    'passenger_id'       => $pId,
                    'passenger_name'     => $pName,
                    'booking_segment_id' => null,
                    'ticket_number'      => null,
                    'status'             => 'TICKETING_PENDING',
                    'fare_amount'        => 2425.00,
                    'currency'           => 'BDT',
                    'coupons'            => [],
                ];
                $overallStatus = 'PARTIAL';
            } else {
                $tNum = '098-' . rand(1000000000, 9999999999);
                if ($mainTicketNum === null) {
                    $mainTicketNum = $tNum;
                }
                $tickets[] = [
                    'passenger_id'       => $pId,
                    'passenger_name'     => $pName,
                    'booking_segment_id' => null,
                    'ticket_number'      => $tNum,
                    'status'             => 'ISSUED',
                    'fare_amount'        => 2425.00,
                    'currency'           => 'BDT',
                    'coupons'            => [
                        ['segment_order' => 1, 'status' => 'OPEN_FOR_USE'],
                    ],
                ];
            }
        }

        return new ProviderTicketDTO(
            providerCode: self::PROVIDER_CODE,
            ticketNumber: $mainTicketNum,
            passengerName: $passengers[0]['name'] ?? 'DEMO/PASSENGER',
            status: $overallStatus,
            issuedAt: now()->toIso8601String(),
            coupons: [
                ['segment_order' => 1, 'status' => 'OPEN_FOR_USE'],
            ],
            documentType: 'ELECTRONIC_TICKET',
            disclaimer: 'Sandbox ticket – not valid for live passenger boarding',
            tickets: $tickets
        );
    }

    /**
     * Cancel simulated reservation.
     */
    public function cancelReservation(string $providerBookingRef): ProviderCancellationDTO
    {
        return new ProviderCancellationDTO(
            providerCode: self::PROVIDER_CODE,
            providerBookingRef: $providerBookingRef,
            isCancelled: true,
            cancellationRef: 'MOCK-CANC-' . strtoupper(Str::random(6)),
            status: 'CANCELLED',
            cancelledAt: now()->toIso8601String(),
            penalties: ['cancellation_fee' => 1000.00, 'currency' => 'BDT'],
            disclaimer: 'Sandbox cancellation'
        );
    }

    /**
     * Calculate simulated refund quote.
     */
    public function getRefundQuote(string $providerBookingRef): ProviderRefundQuoteDTO
    {
        return new ProviderRefundQuoteDTO(
            providerCode: self::PROVIDER_CODE,
            providerBookingRef: $providerBookingRef,
            refundable: true,
            originalAmount: 4850.00,
            cancellationFee: 1000.00,
            estimatedRefundAmount: 3850.00,
            currency: 'BDT',
            quoteRef: 'REFUND-QUOTE-' . strtoupper(Str::random(6)),
            quotedAt: now()->toIso8601String(),
            disclaimer: 'Estimated sandbox refund calculation – subject to airline tariff validation'
        );
    }

    /**
     * Check provider gateway health.
     */
    public function checkHealth(): array
    {
        return [
            'status'     => 'healthy',
            'provider'   => self::PROVIDER_CODE,
            'latency_ms' => 5,
            'timestamp'  => now()->toIso8601String(),
        ];
    }
}
