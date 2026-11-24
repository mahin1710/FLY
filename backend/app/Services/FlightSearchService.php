<?php

namespace App\Services;

use App\DTOs\SearchResultDTO;
use App\Models\FlightOffer;
use App\Models\FlightSearch;
use App\Models\User;
use App\Services\Providers\FlightProviderInterface;
use Illuminate\Support\Str;

class FlightSearchService
{
    public function __construct(
        protected FlightProviderInterface $provider
    ) {}

    /**
     * Search flight offers, persist query metadata and candidate offers.
     */
    public function search(array $criteria, ?User $user = null, ?string $ipAddress = null): SearchResultDTO
    {
        $searchUuid = (string) Str::uuid();

        // 1. Create audit search record
        $flightSearch = FlightSearch::create([
            'uuid'           => $searchUuid,
            'user_id'        => $user?->id,
            'trip_type'      => $criteria['trip_type'] ?? 'one_way',
            'cabin_class'    => $criteria['cabin_class'] ?? 'economy',
            'adults_count'   => (int) ($criteria['adults'] ?? 1),
            'children_count' => (int) ($criteria['children'] ?? 0),
            'infants_count'  => (int) ($criteria['infants'] ?? 0),
            'search_params'  => $criteria,
            'ip_address'     => $ipAddress,
        ]);

        // 2. Query flight provider (MockFlightProvider in non-production)
        $offers = $this->provider->search($criteria);

        // 3. Persist offers to database for immutable offer retrieval & repricing boundaries
        foreach ($offers as $offerDTO) {
            $stops = count($offerDTO->segments) - 1;
            $duration = 0;
            foreach ($offerDTO->segments as $seg) {
                $duration += $seg->durationMinutes + $seg->layoverMinutes;
            }

            FlightOffer::create([
                'uuid'               => $offerDTO->uuid,
                'flight_search_id'   => $flightSearch->id,
                'provider_code'      => $offerDTO->providerCode,
                'provider_offer_ref' => $offerDTO->providerOfferRef,
                'fare_family'        => $offerDTO->fareConditions->fareFamily,
                'is_refundable'      => $offerDTO->isRefundable,
                'is_bookable'        => $offerDTO->isBookable,
                'currency'           => $offerDTO->priceBreakdown->currency,
                'base_amount'        => $offerDTO->priceBreakdown->baseAmount,
                'tax_amount'         => $offerDTO->priceBreakdown->taxAmount,
                'fee_amount'         => $offerDTO->priceBreakdown->feeAmount,
                'total_amount'       => $offerDTO->priceBreakdown->totalAmount,
                'stops_count'        => max(0, $stops),
                'duration_minutes'   => $duration > 0 ? $duration : 60,
                'expires_at'         => $offerDTO->expiresAt,
                'raw_payload'        => $offerDTO->toArray(),
            ]);
        }

        $expiresAt = now()->addMinutes(30)->toIso8601String();

        return new SearchResultDTO(
            requestId: $searchUuid,
            tripType: $flightSearch->trip_type,
            cabinClass: $flightSearch->cabin_class,
            passengerCounts: [
                'adults'   => $flightSearch->adults_count,
                'children' => $flightSearch->children_count,
                'infants'  => $flightSearch->infants_count,
            ],
            offersCount: count($offers),
            offers: $offers,
            expiresAt: $expiresAt
        );
    }
}
