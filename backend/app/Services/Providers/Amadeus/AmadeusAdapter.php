<?php

namespace App\Services\Providers\Amadeus;

use App\DTOs\FlightOfferDTO;
use App\DTOs\ProviderCancellationDTO;
use App\DTOs\ProviderRefundQuoteDTO;
use App\DTOs\ProviderReservationDTO;
use App\DTOs\ProviderTicketDTO;
use App\DTOs\RepriceResultDTO;
use App\Services\Providers\FlightProviderInterface;
use App\Services\Providers\Support\Exceptions\ProviderApiException;
use App\Services\Providers\Support\Exceptions\ProviderAuthenticationException;
use App\Services\Providers\Support\Exceptions\ProviderConfigurationException;
use App\Services\Providers\Support\ProviderCircuitBreaker;
use App\Services\Providers\Support\ProviderHttpClient;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class AmadeusAdapter implements FlightProviderInterface
{
    public const PROVIDER_CODE = 'AMADEUS_GDS';

    protected ProviderHttpClient $httpClient;
    protected ProviderCircuitBreaker $circuitBreaker;

    public function __construct(
        protected ?string $clientId = null,
        protected ?string $clientSecret = null,
        protected string $environment = 'test',
        protected string $baseUrl = 'https://test.api.amadeus.com',
        ?ProviderHttpClient $httpClient = null,
        ?ProviderCircuitBreaker $circuitBreaker = null
    ) {
        $this->circuitBreaker = $circuitBreaker ?? new ProviderCircuitBreaker(self::PROVIDER_CODE);
        $this->httpClient = $httpClient ?? new ProviderHttpClient(self::PROVIDER_CODE, $this->circuitBreaker);
    }

    public function getProviderCode(): string
    {
        return self::PROVIDER_CODE;
    }

    /**
     * Search available flight offers using Amadeus v2 Flight Offers Search.
     */
    public function search(array $criteria): array
    {
        $this->ensureConfigured();

        $token = $this->getAccessToken();

        $payload = [
            'currencyCode' => 'BDT',
            'originDestinations' => [
                [
                    'id'                     => '1',
                    'originLocationCode'     => strtoupper($criteria['origin'] ?? 'DAC'),
                    'destinationLocationCode'=> strtoupper($criteria['destination'] ?? 'CXB'),
                    'departureDateTimeRange' => [
                        'date' => $criteria['departure_date'] ?? now()->addDays(7)->toDateString(),
                    ],
                ],
            ],
            'travelers' => $this->buildTravelersPayload($criteria),
            'sources'   => ['GDS'],
            'searchCriteria' => [
                'maxFlightOffers' => 20,
                'flightFilters'   => [
                    'cabinRestrictions' => [
                        [
                            'cabin'                  => strtoupper($criteria['cabin_class'] ?? 'ECONOMY'),
                            'originDestinationIds'   => ['1'],
                        ],
                    ],
                ],
            ],
        ];

        if (!empty($criteria['return_date']) && ($criteria['trip_type'] ?? '') === 'round_trip') {
            $payload['originDestinations'][] = [
                'id'                     => '2',
                'originLocationCode'     => strtoupper($criteria['destination']),
                'destinationLocationCode'=> strtoupper($criteria['origin']),
                'departureDateTimeRange' => [
                    'date' => $criteria['return_date'],
                ],
            ];
        }

        $response = $this->httpClient->send('POST', "{$this->baseUrl}/v2/shopping/flight-offers", [
            'headers' => [
                'Authorization' => "Bearer {$token}",
                'Content-Type'  => 'application/json',
            ],
            'json' => $payload,
        ]);

        if ($response->failed()) {
            $this->handleProviderError($response, 'Amadeus Flight Offers Search failed');
        }

        $data = $response->json();
        $offers = [];
        $dictionaries = $data['dictionaries'] ?? [];

        foreach ($data['data'] ?? [] as $rawOffer) {
            $offers[] = AmadeusMapper::mapOffer($rawOffer, $dictionaries);
        }

        return $offers;
    }

    /**
     * Retrieve or revalidate an individual offer.
     */
    public function getOffer(string $providerOfferRef): ?FlightOfferDTO
    {
        $this->ensureConfigured();
        // Amadeus does not provide a direct GET for unreserved offers; re-quote or return null
        return null;
    }

    /**
     * Reprice offer using Amadeus v1 Flight Offers Price.
     */
    public function reprice(string $providerOfferRef, ?FlightOfferDTO $currentOffer = null): RepriceResultDTO
    {
        $this->ensureConfigured();

        $token = $this->getAccessToken();

        $response = $this->httpClient->send('POST', "{$this->baseUrl}/v1/shopping/flight-offers/pricing", [
            'headers' => [
                'Authorization' => "Bearer {$token}",
                'Content-Type'  => 'application/json',
            ],
            'json' => [
                'data' => [
                    'type'         => 'flight-offers-pricing',
                    'flightOffers' => [
                        ['id' => $providerOfferRef],
                    ],
                ],
            ],
        ]);

        if ($response->failed()) {
            $this->handleProviderError($response, 'Amadeus Flight Offers Pricing failed');
        }

        $data = $response->json();
        $pricedOffer = $data['data']['flightOffers'][0] ?? null;
        if (!$pricedOffer) {
            throw new ProviderApiException('No priced offer returned by Amadeus.', 502, self::PROVIDER_CODE);
        }

        $oldAmount = $currentOffer ? $currentOffer->priceBreakdown->totalAmount : (float) ($pricedOffer['price']['total'] ?? 0.0);
        $newAmount = (float) ($pricedOffer['price']['grandTotal'] ?? $pricedOffer['price']['total'] ?? $oldAmount);
        $currency = $pricedOffer['price']['currency'] ?? 'BDT';
        $hasChanged = abs($newAmount - $oldAmount) > 0.01;

        return new RepriceResultDTO(
            offerUuid: $currentOffer ? $currentOffer->uuid : (string) Str::uuid(),
            hasPriceChanged: $hasChanged,
            oldAmount: $oldAmount,
            newAmount: $newAmount,
            difference: round($newAmount - $oldAmount, 2),
            currency: $currency,
            reason: $hasChanged ? 'Fare bucket adjustment by airline GDS inventory.' : null,
            isGuaranteed: false, // Sandbox does not guarantee live seats
            disclaimer: 'Amadeus Sandbox repricing quote – subject to live GDS validation',
            snapshotUlid: null,
            recalculatedAt: now()->toIso8601String()
        );
    }

    /**
     * Create an airline reservation using Amadeus v1 Flight Create Orders.
     */
    public function createReservation(
        FlightOfferDTO $offer,
        array $passengers,
        array $contactInfo
    ): ProviderReservationDTO {
        $this->ensureConfigured();

        $token = $this->getAccessToken();

        $travelers = [];
        foreach ($passengers as $idx => $p) {
            $travelerId = (string) ($idx + 1);
            $travelers[] = [
                'id'          => $travelerId,
                'dateOfBirth' => $p['date_of_birth'] ?? '1990-01-01',
                'name'        => [
                    'firstName' => strtoupper($p['first_name'] ?? 'JOHN'),
                    'lastName'  => strtoupper($p['last_name'] ?? 'DOE'),
                ],
                'gender'      => strtoupper($p['gender'] ?? 'MALE') === 'FEMALE' ? 'FEMALE' : 'MALE',
                'contact'     => [
                    'emailAddress' => $contactInfo['email'] ?? 'customer@fly.com',
                    'phones'       => [
                        [
                            'deviceType'         => 'MOBILE',
                            'countryCallingCode' => str_replace('+', '', $contactInfo['country_code'] ?? '880'),
                            'number'             => $contactInfo['phone'] ?? '1700000000',
                        ],
                    ],
                ],
            ];
        }

        $payload = [
            'data' => [
                'type'         => 'flight-order',
                'flightOffers' => [
                    ['id' => $offer->providerOfferRef],
                ],
                'travelers'    => $travelers,
            ],
        ];

        $response = $this->httpClient->send('POST', "{$this->baseUrl}/v1/booking/flight-orders", [
            'headers' => [
                'Authorization' => "Bearer {$token}",
                'Content-Type'  => 'application/json',
            ],
            'json' => $payload,
        ]);

        if ($response->failed()) {
            $this->handleProviderError($response, 'Amadeus Order Creation failed');
        }

        return AmadeusMapper::mapOrder($response->json());
    }

    /**
     * Retrieve an existing order from Amadeus.
     */
    public function getReservation(string $providerBookingRef): ProviderReservationDTO
    {
        $this->ensureConfigured();

        $token = $this->getAccessToken();

        $response = $this->httpClient->send('GET', "{$this->baseUrl}/v1/booking/flight-orders/{$providerBookingRef}", [
            'headers' => [
                'Authorization' => "Bearer {$token}",
            ],
        ]);

        if ($response->failed()) {
            $this->handleProviderError($response, "Failed to retrieve Amadeus order {$providerBookingRef}");
        }

        return AmadeusMapper::mapOrder($response->json());
    }

    /**
     * Issue e-ticket for confirmed reservation.
     * Note: Amadeus Self-Service Sandbox creates orders in TICKETING_PENDING.
     * Direct live e-ticketing requires BSP / IATA ticketing accreditation or manual back-office queue.
     */
    public function issueTicket(
        string $providerBookingRef,
        array $paymentDetails
    ): ProviderTicketDTO {
        $this->ensureConfigured();

        // Enforce the requirement: represent consolidator/manual back-office ticketing as TICKETING_PENDING
        return new ProviderTicketDTO(
            providerCode: self::PROVIDER_CODE,
            ticketNumber: null, // No fake ticket number generated
            passengerName: $paymentDetails['cardholder_name'] ?? 'PASSENGER',
            status: 'TICKETING_PENDING',
            issuedAt: null,
            coupons: [],
            documentType: 'ELECTRONIC_TICKET',
            disclaimer: 'Amadeus Self-Service sandbox creates reservations with TICKETING_PENDING. Live e-ticket issuance requires IATA accreditation or consolidator fulfillment.'
        );
    }

    /**
     * Cancel an active order using Amadeus v1 Flight Order Management.
     */
    public function cancelReservation(string $providerBookingRef): ProviderCancellationDTO
    {
        $this->ensureConfigured();

        $token = $this->getAccessToken();

        $response = $this->httpClient->send('DELETE', "{$this->baseUrl}/v1/booking/flight-orders/{$providerBookingRef}", [
            'headers' => [
                'Authorization' => "Bearer {$token}",
            ],
        ]);

        if ($response->failed()) {
            $this->handleProviderError($response, "Failed to cancel Amadeus order {$providerBookingRef}");
        }

        return new ProviderCancellationDTO(
            providerCode: self::PROVIDER_CODE,
            providerBookingRef: $providerBookingRef,
            isCancelled: true,
            cancellationRef: "CANC-{$providerBookingRef}",
            status: 'CANCELLED',
            cancelledAt: now()->toIso8601String(),
            penalties: [],
            disclaimer: 'Amadeus Sandbox cancellation'
        );
    }

    /**
     * Calculate voluntary refund quote.
     */
    public function getRefundQuote(string $providerBookingRef): ProviderRefundQuoteDTO
    {
        $this->ensureConfigured();

        return new ProviderRefundQuoteDTO(
            providerCode: self::PROVIDER_CODE,
            providerBookingRef: $providerBookingRef,
            refundable: false,
            originalAmount: 0.0,
            cancellationFee: 0.0,
            estimatedRefundAmount: 0.0,
            currency: 'BDT',
            quoteRef: null,
            quotedAt: now()->toIso8601String(),
            disclaimer: 'Amadeus Self-Service does not support automated refund calculation; requires back-office agency audit.'
        );
    }

    /**
     * Check gateway health & connectivity.
     */
    public function checkHealth(): array
    {
        $isConfigured = !empty($this->clientId) && !empty($this->clientSecret);

        return [
            'provider'        => self::PROVIDER_CODE,
            'configured'      => $isConfigured,
            'environment'     => $this->environment,
            'base_url'        => $this->baseUrl,
            'circuit_breaker' => $this->circuitBreaker->getState(),
        ];
    }

    /**
     * Ensure credentials are present in secret configuration.
     *
     * @throws ProviderConfigurationException
     */
    protected function ensureConfigured(): void
    {
        if (empty($this->clientId) || empty($this->clientSecret)) {
            throw new ProviderConfigurationException(
                'Amadeus API credentials (AMADEUS_CLIENT_ID, AMADEUS_CLIENT_SECRET) are missing. Please supply valid sandbox credentials in backend secret configuration.',
                self::PROVIDER_CODE
            );
        }
    }

    /**
     * Retrieve or cache OAuth2 Client Credentials token.
     */
    protected function getAccessToken(): string
    {
        $cacheKey = "amadeus:token:{$this->clientId}";
        $cached = Cache::get($cacheKey);
        if ($cached) {
            return (string) $cached;
        }

        $response = $this->httpClient->send('POST', "{$this->baseUrl}/v1/security/oauth2/token", [
            'headers' => [
                'Content-Type' => 'application/x-www-form-urlencoded',
            ],
            'form_params' => [
                'grant_type'    => 'client_credentials',
                'client_id'     => $this->clientId,
                'client_secret' => $this->clientSecret,
            ],
        ]);

        if ($response->failed()) {
            throw new ProviderAuthenticationException(
                "Amadeus OAuth2 token authentication failed: {$response->body()}",
                self::PROVIDER_CODE
            );
        }

        $data = $response->json();
        $token = $data['access_token'] ?? null;
        $expiresIn = (int) ($data['expires_in'] ?? 1799);

        if (!$token) {
            throw new ProviderAuthenticationException(
                'Invalid OAuth2 token payload returned by Amadeus.',
                self::PROVIDER_CODE
            );
        }

        Cache::put($cacheKey, $token, max(60, $expiresIn - 60));
        return $token;
    }

    protected function buildTravelersPayload(array $criteria): array
    {
        $travelers = [];
        $id = 1;
        $adults = max(1, (int) ($criteria['adults'] ?? 1));
        $children = max(0, (int) ($criteria['children'] ?? 0));
        $infants = max(0, (int) ($criteria['infants'] ?? 0));

        for ($i = 0; $i < $adults; $i++) {
            $travelers[] = ['id' => (string) $id++, 'travelerType' => 'ADULT'];
        }
        for ($i = 0; $i < $children; $i++) {
            $travelers[] = ['id' => (string) $id++, 'travelerType' => 'CHILD'];
        }
        for ($i = 0; $i < $infants; $i++) {
            $travelers[] = ['id' => (string) $id++, 'travelerType' => 'HELD_INFANT'];
        }

        return $travelers;
    }

    protected function handleProviderError($response, string $prefix): void
    {
        $data = $response->json();
        $firstError = $data['errors'][0] ?? null;
        $errorCode = $firstError['code'] ?? 'UNKNOWN_PROVIDER_ERROR';
        $detail = $firstError['detail'] ?? $firstError['title'] ?? $response->body();

        throw new ProviderApiException(
            "{$prefix}: [{$errorCode}] {$detail}",
            $response->status(),
            self::PROVIDER_CODE,
            (string) $errorCode,
            $data
        );
    }
}
