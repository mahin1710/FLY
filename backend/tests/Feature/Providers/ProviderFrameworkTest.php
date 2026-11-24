<?php

namespace Tests\Feature\Providers;

use App\DTOs\FlightOfferDTO;
use App\Models\ProviderCall;
use App\Services\Providers\Amadeus\AmadeusAdapter;
use App\Services\Providers\MockFlightProvider;
use App\Services\Providers\Support\DataSanitizer;
use App\Services\Providers\Support\Exceptions\ProviderCircuitOpenException;
use App\Services\Providers\Support\Exceptions\ProviderConfigurationException;
use App\Services\Providers\Support\ProviderCircuitBreaker;
use App\Services\Providers\Support\ProviderHttpClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ProviderFrameworkTest extends TestCase
{
    use RefreshDatabase;

    public function test_amadeus_adapter_throws_configuration_exception_when_credentials_are_absent(): void
    {
        $adapter = new AmadeusAdapter(
            clientId: null,
            clientSecret: null
        );

        $this->expectException(ProviderConfigurationException::class);
        $this->expectExceptionMessage('Amadeus API credentials (AMADEUS_CLIENT_ID, AMADEUS_CLIENT_SECRET) are missing.');

        $adapter->search([
            'origin'         => 'DAC',
            'destination'    => 'CXB',
            'departure_date' => now()->addDays(7)->toDateString(),
        ]);
    }

    public function test_data_sanitizer_redacts_credentials_tokens_and_passenger_sensitive_data(): void
    {
        $payload = [
            'client_id'       => 'live_client_12345',
            'client_secret'   => 'super_secret_token_99999',
            'access_token'    => 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
            'document_number' => 'BD99887766',
            'card_number'     => '4111111111111111',
            'cvv'             => '123',
            'flight_number'   => 'BG-433', // Safe field
            'origin'          => 'DAC',    // Safe field
        ];

        $sanitized = DataSanitizer::sanitize($payload);

        $this->assertSame('BD******66', $sanitized['document_number']);
        $this->assertSame('41************11', $sanitized['card_number']);
        $this->assertSame('****', $sanitized['cvv']);
        $this->assertSame('BG-433', $sanitized['flight_number']);
        $this->assertSame('DAC', $sanitized['origin']);
    }

    public function test_circuit_breaker_trips_to_open_after_failure_threshold_reached(): void
    {
        Cache::flush();
        $cb = new ProviderCircuitBreaker('TEST_GDS', failureThreshold: 3, recoveryTimeSeconds: 60);

        $this->assertSame(ProviderCircuitBreaker::STATE_CLOSED, $cb->getState());

        $cb->recordFailure();
        $cb->recordFailure();
        $this->assertSame(ProviderCircuitBreaker::STATE_CLOSED, $cb->getState());

        // Third failure hits threshold -> trips circuit to OPEN
        $cb->recordFailure();
        $this->assertSame(ProviderCircuitBreaker::STATE_OPEN, $cb->getState());

        // Next call should be blocked immediately
        $this->expectException(ProviderCircuitOpenException::class);
        $cb->guard();
    }

    public function test_circuit_breaker_resets_on_success(): void
    {
        Cache::flush();
        $cb = new ProviderCircuitBreaker('TEST_GDS', failureThreshold: 2);
        $cb->recordFailure();
        $this->assertSame(1, (int) Cache::get('circuit_breaker:TEST_GDS:failures'));

        $cb->recordSuccess();
        $this->assertSame(ProviderCircuitBreaker::STATE_CLOSED, $cb->getState());
        $this->assertNull(Cache::get('circuit_breaker:TEST_GDS:failures'));
    }

    public function test_provider_http_client_records_sanitized_audit_call_in_database(): void
    {
        Http::fake([
            'https://test.api.amadeus.com/v2/shopping/flight-offers' => Http::response([
                'data' => [],
                'meta' => ['count' => 0],
            ], 200),
        ]);

        $cb = new ProviderCircuitBreaker('AMADEUS_GDS');
        $client = new ProviderHttpClient('AMADEUS_GDS', $cb);

        $response = $client->send('POST', 'https://test.api.amadeus.com/v2/shopping/flight-offers', [
            'headers' => ['Authorization' => 'Bearer fake-secret-token'],
            'json'    => [
                'origin'          => 'DAC',
                'document_number' => 'BD12345678',
            ],
        ]);

        $this->assertTrue($response->successful());

        $logged = ProviderCall::where('provider_name', 'AMADEUS_GDS')->latest('id')->first();
        $this->assertNotNull($logged);
        $this->assertSame('/v2/shopping/flight-offers', $logged->endpoint);
        $this->assertSame('POST', $logged->http_method);
        $this->assertSame(200, $logged->status_code);
        $this->assertFalse($logged->is_error);

        // Verify request payload in database is sanitized (no plaintext passport)
        $this->assertSame('BD******78', $logged->request_payload['document_number']);
    }

    public function test_mock_provider_supports_full_lifecycle(): void
    {
        $mock = new MockFlightProvider();

        $offers = $mock->search(['origin' => 'DAC', 'destination' => 'CXB', 'adults' => 1]);
        $this->assertNotEmpty($offers);
        $firstOffer = $offers[0];

        // 1. Reprice
        $reprice = $mock->reprice($firstOffer->providerOfferRef, $firstOffer);
        $this->assertSame('BDT', $reprice->currency);
        $this->assertFalse($reprice->isGuaranteed);

        // 2. Reservation
        $res = $mock->createReservation($firstOffer, [
            ['first_name' => 'John', 'last_name' => 'Doe'],
        ], ['email' => 'john@example.com']);
        $this->assertSame('CONFIRMED', $res->status);
        $this->assertNotEmpty($res->pnr);

        // 3. Ticket
        $ticket = $mock->issueTicket($res->providerBookingRef, ['cardholder_name' => 'John Doe']);
        $this->assertSame('ISSUED', $ticket->status);
        $this->assertNotNull($ticket->ticketNumber);

        // 4. Cancellation
        $canc = $mock->cancelReservation($res->providerBookingRef);
        $this->assertTrue($canc->isCancelled);

        // 5. Refund Quote
        $refund = $mock->getRefundQuote($res->providerBookingRef);
        $this->assertTrue($refund->refundable);
        $this->assertGreaterThan(0, $refund->estimatedRefundAmount);

        // 6. Health
        $health = $mock->checkHealth();
        $this->assertSame('healthy', $health['status']);
    }
}
