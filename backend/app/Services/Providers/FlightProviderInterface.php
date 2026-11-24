<?php

namespace App\Services\Providers;

use App\DTOs\FlightOfferDTO;
use App\DTOs\RepriceResultDTO;

interface FlightProviderInterface
{
    /**
     * Search available flight offers matching search criteria.
     *
     * @param array $criteria Validated search params: origin, destination, departure_date, return_date, passengers, cabin_class
     * @return FlightOfferDTO[]
     */
    public function search(array $criteria): array;

    /**
     * Retrieve or revalidate an offer directly with the provider.
     */
    public function getOffer(string $providerOfferRef): ?FlightOfferDTO;

    /**
     * Check fare bucket availability and recalculate current pricing.
     */
    public function reprice(string $providerOfferRef, ?FlightOfferDTO $currentOffer = null): RepriceResultDTO;
}
