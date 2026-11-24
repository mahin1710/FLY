<?php

namespace App\Services\Providers;

use App\DTOs\FlightOfferDTO;
use App\DTOs\ProviderCancellationDTO;
use App\DTOs\ProviderRefundQuoteDTO;
use App\DTOs\ProviderReservationDTO;
use App\DTOs\ProviderTicketDTO;
use App\DTOs\RepriceResultDTO;

interface FlightProviderInterface
{
    /**
     * Unique identifying provider code (e.g. MOCK_GDS, AMADEUS_GDS, SABRE_GDS).
     */
    public function getProviderCode(): string;

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

    /**
     * Create an airline reservation / Order (PNR booking hold).
     *
     * @param FlightOfferDTO $offer Validated offer to reserve
     * @param array $passengers Array of passenger traveler details
     * @param array $contactInfo Contact information (email, phone, country code)
     */
    public function createReservation(
        FlightOfferDTO $offer,
        array $passengers,
        array $contactInfo
    ): ProviderReservationDTO;

    /**
     * Retrieve an existing provider reservation by provider reference / PNR.
     */
    public function getReservation(string $providerBookingRef): ProviderReservationDTO;

    /**
     * Request e-ticket issuance for a confirmed reservation / order.
     * If provider does not support direct live ticketing (e.g. Self-Service sandbox),
     * returns a ProviderTicketDTO with status 'TICKETING_PENDING' for operations queue fulfillment.
     */
    public function issueTicket(
        string $providerBookingRef,
        array $paymentDetails
    ): ProviderTicketDTO;

    /**
     * Cancel an active reservation / PNR before travel or void ticket if within void window.
     */
    public function cancelReservation(string $providerBookingRef): ProviderCancellationDTO;

    /**
     * Calculate voluntary refund quote and cancellation penalties according to fare rules.
     */
    public function getRefundQuote(string $providerBookingRef): ProviderRefundQuoteDTO;

    /**
     * Check operational status, latency, and circuit breaker health of the provider gateway.
     */
    public function checkHealth(): array;
}
