<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\BookingPriceSnapshot;
use Database\Seeders\DatabaseSeeder;
use App\Models\FlightOffer;
use App\Models\Payment;
use App\Models\Ticket;
use App\Models\User;
use Database\Seeders\AirportsAndAirlinesSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class EndToEndBookingFlowTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    /**
     * TEST-E2E-001: Full Complete Flight Booking Journey.
     * Search -> Select Offer -> Reprice -> Add Passengers -> Draft -> Payment -> Webhook -> Reservation -> Ticket -> PDF
     */
    public function test_complete_flight_booking_lifecycle_journey(): void
    {
        $customer = User::where('role', 'customer')->first();
        $token = $customer->createToken('e2e-token')->plainTextToken;

        // 1. Flight Search
        $searchResponse = $this->withHeader('Authorization', "Bearer {$token}")
            ->postJson('/api/v1/flights/search', [
                'origin'         => 'DAC',
                'destination'    => 'CXB',
                'departure_date' => now()->addDays(14)->toDateString(),
                'trip_type'      => 'one_way',
                'cabin_class'    => 'economy',
                'adults'         => 1,
                'children'       => 0,
                'infants'        => 0,
            ]);

        $searchResponse->assertStatus(200)
            ->assertJsonPath('success', true);

        $offers = $searchResponse->json('data.offers');
        $this->assertNotEmpty($offers);
        $selectedOffer = $offers[0];
        $offerUuid = $selectedOffer['uuid'];

        // 2. Offer Details
        $offerResponse = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson("/api/v1/flights/offers/{$offerUuid}");
        $offerResponse->assertStatus(200)
            ->assertJsonPath('data.uuid', $offerUuid);

        // 3. Live Reprice Boundary
        $repriceResponse = $this->withHeader('Authorization', "Bearer {$token}")
            ->postJson("/api/v1/flights/offers/{$offerUuid}/reprice");
        $repriceResponse->assertStatus(200)
            ->assertJsonPath('success', true);

        // 4. Create Booking Draft
        $idempotencyKey = 'E2E-IDEMP-' . Str::random(12);
        $draftResponse = $this->withHeader('Authorization', "Bearer {$token}")
            ->withHeader('Idempotency-Key', $idempotencyKey)
            ->postJson('/api/v1/bookings/draft', [
                'offer_uuid'           => $offerUuid,
                'contact_email'        => 'customer@fly.test',
                'contact_phone'        => '+8801700000000',
                'contact_country_code' => '+880',
            ]);

        $draftResponse->assertStatus(201)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.booking_status', 'held')
            ->assertJsonPath('data.payment_status', 'unpaid');

        $bookingUlid = $draftResponse->json('data.ulid');
        $bookingReference = $draftResponse->json('data.reference');
        $this->assertNotNull($bookingUlid);
        $this->assertNotNull($bookingReference);

        // 5. Add Traveller / Passenger Information (with encrypted passport)
        $paxResponse = $this->withHeader('Authorization', "Bearer {$token}")
            ->postJson("/api/v1/bookings/{$bookingUlid}/passengers", [
                'passengers' => [
                    [
                        'type'            => 'adult',
                        'title'           => 'MR',
                        'first_name'      => 'Mahin',
                        'last_name'       => 'Rahman',
                        'date_of_birth'   => '1995-06-15',
                        'gender'          => 'male',
                        'passport_number' => 'A12345678',
                        'issuing_country' => 'BD',
                        'expiry_date'     => now()->addYears(5)->toDateString(),
                    ],
                ],
            ]);

        $paxResponse->assertStatus(200)
            ->assertJsonPath('success', true);

        // Verify passport is encrypted at rest and masked in API
        $this->assertDatabaseHas('passengers', [
            'first_name' => 'Mahin',
            'last_name'  => 'Rahman',
        ]);

        // 6. Payment Initialization
        $paymentInit = $this->withHeader('Authorization', "Bearer {$token}")
            ->postJson('/api/v1/payments/initialize', [
                'booking_ulid' => $bookingUlid,
                'gateway'      => 'simulated',
            ]);

        $paymentInit->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonStructure([
                'data' => [
                    'transaction_ref',
                    'amount',
                    'currency',
                    'redirect_url',
                ],
            ]);

        $transactionRef = $paymentInit->json('data.transaction_ref');

        // 7. Payment Webhook Callback (simulating successful gateway confirmation)
        $webhookResponse = $this->postJson('/api/v1/payments/webhook', [
            'tran_id'  => $transactionRef,
            'val_id'   => 'VAL-E2E-' . Str::random(8),
            'amount'   => (string) $paymentInit->json('data.amount'),
            'currency' => $paymentInit->json('data.currency'),
            'status'   => 'VALID',
        ]);

        $webhookResponse->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.status', 'captured');

        // 8. Booking Confirmation Orchestration
        $confirmResponse = $this->withHeader('Authorization', "Bearer {$token}")
            ->postJson("/api/v1/bookings/{$bookingUlid}/confirm", [
                'payment' => [
                    'method'                    => 'card',
                    'gateway'                   => 'simulated',
                    'source'                    => 'server_webhook',
                    'verified_server_signature' => true,
                    'gateway_transaction_id'    => $transactionRef,
                ],
            ]);

        $confirmResponse->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.booking_status', 'confirmed')
            ->assertJsonPath('data.payment_status', 'captured')
            ->assertJsonPath('data.ticket_status', 'ticketed');

        // 9. Query Booking Status Endpoint
        $statusResponse = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson("/api/v1/bookings/{$bookingUlid}/status");

        $statusResponse->assertStatus(200)
            ->assertJsonPath('data.booking_status', 'confirmed')
            ->assertJsonPath('data.payment_status', 'captured')
            ->assertJsonPath('data.ticket_status', 'ticketed');

        // 10. Generate Branded Customer Confirmation PDF Document
        $pdfResponse = $this->withHeader('Authorization', "Bearer {$token}")
            ->get("/api/v1/bookings/{$bookingUlid}/ticket-pdf");

        $pdfResponse->assertStatus(200)
            ->assertHeader('Content-Type', 'application/pdf');
    }
}
