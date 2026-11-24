<?php

namespace App\DTOs;

class SearchResultDTO
{
    /**
     * @param FlightOfferDTO[] $offers
     */
    public function __construct(
        public readonly string $requestId,
        public readonly string $tripType,
        public readonly string $cabinClass,
        public readonly array $passengerCounts,
        public readonly int $offersCount,
        public readonly array $offers,
        public readonly string $expiresAt
    ) {}

    public function toArray(): array
    {
        return [
            'request_id'       => $this->requestId,
            'trip_type'        => $this->tripType,
            'cabin_class'      => $this->cabinClass,
            'passenger_counts' => $this->passengerCounts,
            'offers_count'     => $this->offersCount,
            'offers'           => array_map(fn (FlightOfferDTO $o) => $o->toArray(), $this->offers),
            'expires_at'       => $this->expiresAt,
        ];
    }
}
