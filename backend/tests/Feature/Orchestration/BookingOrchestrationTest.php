<?php

namespace Tests\Feature\Orchestration;

use App\DTOs\FlightOfferDTO;
use App\DTOs\ProviderReservationDTO;
use App\DTOs\ProviderTicketDTO;
use App\DTOs\RepriceResultDTO;
use App\Jobs\ReconcilePendingPaymentsJob;
use App\Jobs\ReconcilePendingTicketsJob;
use App\Models\Booking;
use App\Models\BookingPriceSnapshot;
use App\Models\FlightOffer;
use App\Models\Passenger;
use App\Models\User;
use App\Services\Orchestration\BookingOrchestrator;
use App\Services\Orchestration\PriceChangedException;
use App\Services\Providers\FlightProviderInterface;
use App\Services\Providers\MockFlightProvider;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Mockery;
use Tests\TestCase;

class BookingOrchestrationTest extends TestCase
{
    use RefreshDatabase;

    protected Booking $booking;
    protected User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);

        $this->customer = User::where('role', 'customer')->first();

        // Create a draft booking with passengers and snapshot
        $offer = FlightOffer::first();
        $snapshot = BookingPriceSnapshot::first();

        $this->booking = Booking::create([
            'ulid'                      => '01ORCHESTRATE00000000001',
            'reference'                 => 'BK-ORCH-001',
            'user_id'                   => $this->customer->id,
            'booking_price_snapshot_id' => $snapshot->id,
            'booking_status'            => 'held',
            'payment_status'            => 'unpaid',
            'ticket_status'             => 'unissued',
            'servicing_status'          => 'none',
            'hold_expires_at'           => now()->addMinutes(15),
            'currency'                  => 'BDT',
            'total_amount'              => 4850.00,
            'contact_email'             => 'orchestration@fly.com',
            'contact_phone'             => '+8801711000000',
            'contact_country_code'      => '+880',
        ]);

        Passenger::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $this->booking->id,
            'type'          => 'adult',
            'title'         => 'Mr',
            'first_name'    => 'Mahin',
            'last_name'     => 'Rahman',
            'date_of_birth' => '1995-05-15',
        ]);
    }

    public function test_orchestration_confirm_succeeds_end_to_end_with_mock_provider(): void
    {
        $response = $this->postJson("/api/v1/bookings/{$this->booking->ulid}/confirm", [
            'payment' => [
                'method'                    => 'card',
                'gateway'                   => 'simulated',
                'source'                    => 'server_webhook',
                'verified_server_signature' => true,
                'gateway_transaction_id'    => 'TXN-SUCCESS-7788',
                'cardholder_name'           => 'Mahin Rahman',
            ],
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.booking_status', 'confirmed')
            ->assertJsonPath('data.payment_status', 'captured')
            ->assertJsonPath('data.ticket_status', 'ticketed');

        // Check workflow step persistence
        $this->assertDatabaseHas('booking_workflow_steps', [
            'booking_id'  => $this->booking->id,
            'step_name'   => 'payment_verification',
            'step_status' => 'completed',
        ]);

        // Check ticket created
        $this->assertDatabaseHas('tickets', [
            'booking_id'    => $this->booking->id,
            'ticket_status' => 'issued',
        ]);
    }

    public function test_duplicate_submit_is_idempotent_with_header(): void
    {
        $idempotencyKey = 'IDEMP-ORCH-' . Str::random(10);
        $payload = [
            'payment' => [
                'method'                    => 'card',
                'source'                    => 'server_webhook',
                'verified_server_signature' => true,
                'gateway_transaction_id'    => 'TXN-IDEMP-1',
            ],
        ];

        // 1. First call
        $first = $this->withHeader('Idempotency-Key', $idempotencyKey)
            ->postJson("/api/v1/bookings/{$this->booking->ulid}/confirm", $payload);
        $first->assertStatus(200);

        // 2. Second call with same idempotency key
        $second = $this->withHeader('Idempotency-Key', $idempotencyKey)
            ->postJson("/api/v1/bookings/{$this->booking->ulid}/confirm", $payload);
        $second->assertStatus(200);

        $this->assertDatabaseCount('idempotency_records', 1);
    }

    public function test_price_change_stops_workflow_until_customer_explicitly_accepts(): void
    {
        $mockProvider = Mockery::mock(FlightProviderInterface::class);
        $mockProvider->shouldReceive('getProviderCode')->andReturn('MOCK_GDS');

        // Reprice returns a price increase from 4850.00 to 5100.00
        $mockProvider->shouldReceive('reprice')->andReturn(new RepriceResultDTO(
            offerUuid: (string) Str::uuid(),
            hasPriceChanged: true,
            oldAmount: 4850.00,
            newAmount: 5100.00,
            difference: 250.00,
            currency: 'BDT',
            reason: 'Fare bucket increased.',
            isGuaranteed: false,
            disclaimer: 'Price changed',
            snapshotUlid: null,
            recalculatedAt: now()->toIso8601String()
        ));

        $this->app->instance(FlightProviderInterface::class, $mockProvider);

        // 1. Initial attempt without customer acceptance must fail with 409 PRICE_CHANGED
        $rejectedResponse = $this->postJson("/api/v1/bookings/{$this->booking->ulid}/confirm", [
            'payment' => ['source' => 'server_webhook', 'verified_server_signature' => true],
        ]);

        $rejectedResponse->assertStatus(409)
            ->assertJsonPath('success', false)
            ->assertJsonPath('error_code', 'PRICE_CHANGED');

        $newSnapshotUlid = $rejectedResponse->json('errors.new_snapshot_ulid');
        $this->assertNotNull($newSnapshotUlid);

        // Booking status must still be held (not confirmed, not charged)
        $this->assertSame('held', $this->booking->fresh()->booking_status);
        $this->assertSame('unpaid', $this->booking->fresh()->payment_status);

        // Allow mock provider to process reservation & ticketing for accepted call
        $mockProvider->shouldReceive('createReservation')->andReturn(new ProviderReservationDTO(
            providerCode: 'MOCK_GDS',
            providerBookingRef: 'RES-ACCEPTED-1',
            pnr: 'ACCP12',
            status: 'CONFIRMED',
            ticketingRequiredBy: now()->addDay()->toIso8601String(),
            isTicketed: false,
            rawProviderStatus: 'CONFIRMED',
            currency: 'BDT',
            totalPrice: 5100.00,
            passengers: [],
            segments: []
        ));

        $mockProvider->shouldReceive('issueTicket')->andReturn(new ProviderTicketDTO(
            providerCode: 'MOCK_GDS',
            ticketNumber: '098-9999999999',
            passengerName: 'Mahin Rahman',
            status: 'ISSUED',
            issuedAt: now()->toIso8601String()
        ));

        // 2. Retry with explicit acceptance and new snapshot ULID
        $acceptedResponse = $this->postJson("/api/v1/bookings/{$this->booking->ulid}/confirm", [
            'accepted_price_change'  => true,
            'expected_snapshot_ulid' => $newSnapshotUlid,
            'payment' => [
                'source'                    => 'server_webhook',
                'verified_server_signature' => true,
                'gateway_transaction_id'    => 'TXN-NEW-PRICE-01',
            ],
        ]);

        $acceptedResponse->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.total_amount', '5100.00');

        $this->assertEquals(5100.00, (float) $this->booking->fresh()->total_amount);
    }

    public function test_provider_timeout_triggers_recovery_retrieval_and_reconciles_pnr(): void
    {
        $mockProvider = Mockery::mock(FlightProviderInterface::class);
        $mockProvider->shouldReceive('getProviderCode')->andReturn('MOCK_GDS');
        $mockProvider->shouldReceive('reprice')->andReturn(new RepriceResultDTO(
            offerUuid: (string) Str::uuid(),
            hasPriceChanged: false,
            oldAmount: 4850.00,
            newAmount: 4850.00,
            difference: 0,
            currency: 'BDT',
            reason: null,
            isGuaranteed: false,
            disclaimer: '',
            snapshotUlid: null,
            recalculatedAt: now()->toIso8601String()
        ));

        // Create reservation times out!
        $mockProvider->shouldReceive('createReservation')->andThrow(new \RuntimeException('Connection timed out after 15000ms.'));

        // Recovery: Orchestrator calls getReservation and finds the order DID succeed on provider!
        $mockProvider->shouldReceive('getReservation')->andReturn(new ProviderReservationDTO(
            providerCode: 'MOCK_GDS',
            providerBookingRef: 'RECOVERED-REF-77',
            pnr: 'RCV777',
            status: 'CONFIRMED',
            ticketingRequiredBy: now()->addDay()->toIso8601String(),
            isTicketed: false,
            rawProviderStatus: 'CONFIRMED',
            currency: 'BDT',
            totalPrice: 4850.00,
            passengers: [],
            segments: []
        ));

        $mockProvider->shouldReceive('issueTicket')->andReturn(new ProviderTicketDTO(
            providerCode: 'MOCK_GDS',
            ticketNumber: '098-7777777777',
            passengerName: 'Mahin Rahman',
            status: 'ISSUED',
            issuedAt: now()->toIso8601String()
        ));

        $this->app->instance(FlightProviderInterface::class, $mockProvider);

        $response = $this->postJson("/api/v1/bookings/{$this->booking->ulid}/confirm", [
            'payment' => [
                'source'                    => 'server_webhook',
                'verified_server_signature' => true,
                'gateway_transaction_id'    => 'TXN-RECOVERED-1',
            ],
        ]);

        $response->assertStatus(200);
        $this->assertSame('RCV777', $this->booking->fresh()->airline_pnr);
    }

    public function test_unrecoverable_timeout_routes_to_operations_queue_as_unknown(): void
    {
        $mockProvider = Mockery::mock(FlightProviderInterface::class);
        $mockProvider->shouldReceive('getProviderCode')->andReturn('MOCK_GDS');
        $mockProvider->shouldReceive('reprice')->andReturn(new RepriceResultDTO(
            offerUuid: (string) Str::uuid(),
            hasPriceChanged: false,
            oldAmount: 4850.00,
            newAmount: 4850.00,
            difference: 0,
            currency: 'BDT',
            reason: null,
            isGuaranteed: false,
            disclaimer: '',
            snapshotUlid: null,
            recalculatedAt: now()->toIso8601String()
        ));

        // Create reservation times out AND retrieval fails (unknown)
        $mockProvider->shouldReceive('createReservation')->andThrow(new \RuntimeException('Connection timed out.'));
        $mockProvider->shouldReceive('getReservation')->andThrow(new \RuntimeException('Order not found on supplier.'));

        $this->app->instance(FlightProviderInterface::class, $mockProvider);

        $response = $this->postJson("/api/v1/bookings/{$this->booking->ulid}/confirm", [
            'payment' => ['source' => 'server_webhook', 'verified_server_signature' => true],
        ]);

        $response->assertStatus(504);

        // Booking must be flagged for manual review
        $fresh = $this->booking->fresh();
        $this->assertTrue($fresh->requires_manual_review);
        $this->assertSame('SUPPLIER_TIMEOUT_UNKNOWN', $fresh->manual_review_reason);

        // Operations servicing queue request must exist
        $this->assertDatabaseHas('servicing_requests', [
            'booking_id'   => $this->booking->id,
            'request_type' => 'manual_operations_queue',
            'status'       => 'pending_review',
        ]);
    }

    public function test_reconciliation_jobs_cleanly_process_pending_states(): void
    {
        // 1. Test ReconcilePendingPaymentsJob expires timed-out holds
        $this->booking->hold_expires_at = now()->subMinutes(1);
        $this->booking->booking_status = 'pending_payment';
        $this->booking->payment_status = 'unpaid';
        $this->booking->save();

        app(ReconcilePendingPaymentsJob::class)->handle(app(\App\Services\StateMachine\BookingStateMachine::class));

        $this->assertSame('expired', $this->booking->fresh()->booking_status);

        // 2. Test ReconcilePendingTicketsJob issues ticket when supplier confirms
        $this->booking->booking_status = 'confirmed';
        $this->booking->payment_status = 'captured';
        $this->booking->ticket_status = 'queued_for_issuance';
        $this->booking->save();

        app(ReconcilePendingTicketsJob::class)->handle(
            app(FlightProviderInterface::class),
            app(\App\Services\StateMachine\BookingStateMachine::class),
            app(\App\Services\Orchestration\OperationsQueueService::class)
        );

        $this->assertSame('ticketed', $this->booking->fresh()->ticket_status);
    }
}
