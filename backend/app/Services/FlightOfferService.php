<?php

namespace App\Services;

use App\DTOs\FlightOfferDTO;
use App\Models\FlightOffer;
use App\Models\User;
use App\Services\Providers\FlightProviderInterface;
use RuntimeException;

class FlightOfferService
{
    public function __construct(
        protected FlightProviderInterface $provider
    ) {}

    /**
     * Retrieve a flight offer by public UUID with expiry and ownership validation.
     */
    public function getOfferByUuid(string $uuid, ?User $user = null): FlightOfferDTO
    {
        $offer = FlightOffer::where('uuid', $uuid)->first();
        if (!$offer) {
            throw new RuntimeException('Flight offer not found.', 404);
        }

        if ($offer->expires_at->isPast()) {
            throw new RuntimeException('The selected flight offer has expired. Please perform a new search.', 410);
        }

        if (!empty($offer->raw_payload)) {
            return FlightOfferDTO::fromArray($offer->raw_payload);
        }

        $dto = $this->provider->getOffer($offer->provider_offer_ref);
        if (!$dto) {
            throw new RuntimeException('Flight offer details could not be retrieved from provider.', 404);
        }

        return $dto;
    }
}
