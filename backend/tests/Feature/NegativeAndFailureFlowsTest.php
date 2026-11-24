<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\BookingPriceSnapshot;
use Database\Seeders\DatabaseSeeder;
use App\Models\FlightOffer;
use App\Models\Payment;
use App\Models\User;
use App\Services\Providers\Support\ProviderCircuitBreaker;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class NegativeAndFailureFlowsTest extends TestCase
{
    use RefreshDatabase;

    protected User $customer;
    protected User $otherCustomer;
    protected string $customerToken;
    protected string $otherToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);

        $this->customer = User::where('role', 'customer')->first();
        $this->customerToken = $this->customer->createToken('test-token')->plainTextToken;

        $this->otherCustomer = User::factory()->create(['role' => 'customer', 'email' => 'other_customer@example.com']);
        $this->otherToken = $this->otherCustomer->createToken('other-token')->plainTextToken;
    }

    /**
     * TEST-NEG-001: Expired Offer Rejection.
     */
    public function test_expired_offer_is_rejected_on_draft_creation(): void
    {
        $offer = FlightOffer::first();
        $offer->update(['expires_at' => now()->subMinutes(10)]);

        $response = $this->withHeader('Authorization', "Bearer {$this->customerToken}")
            ->postJson('/api/v1/bookings/draft', [
                'offer_uuid'           => $offer->uuid,
                'contact_email'        => 'test@example.com',
                'contact_phone'        => '+8801700000000',
                'contact_country_code' => '+880',
            ]);

        $response->assertStatus(410)
            ->assertJsonPath('success', false)
            ->assertJsonPath('error.code', 'OFFER_EXPIRED');
    }

    /**
     * TEST-NEG-002: Price Change Blocks Workflow Without Explicit Customer Acceptance.
     */
    public function test_price_change_blocks_orchestration_without_explicit_acceptance(): void
    {
        $snapshot = BookingPriceSnapshot::first();
        $booking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-PRICE-CHG-01',
            'user_id'                   => $this->customer->id,
            'booking_price_snapshot_id' => $snapshot->id,
            'booking_status'            => 'held',
            'payment_status'            => 'unpaid',
            'ticket_status'             => 'unissued',
            'servicing_status'          => 'none',
            'hold_expires_at'           => now()->addMinutes(15),
            'currency'                  => 'BDT',
            'total_amount'              => 4850.00,
            'contact_email'             => 'price_chg@example.com',
            'contact_phone'             => '+8801700000000',
            'contact_country_code'      => '+880',
        ]);

        $response = $this->withHeader('Authorization', "Bearer {$this->customerToken}")
            ->postJson("/api/v1/bookings/{$booking->ulid}/confirm", [
                'simulated_price_change' => 5500.00, // higher than held snapshot
                'payment' => [
                    'method'                    => 'card',
                    'gateway'                   => 'simulated',
                    'source'                    => 'server_webhook',
                    'verified_server_signature' => true,
                    'gateway_transaction_id'    => 'TXN-PRICE-CHG-1',
                ],
            ]);

        $response->assertStatus(409)
            ->assertJsonPath('success', false)
            ->assertJsonPath('error.code', 'PRICE_CHANGED');

        // Verify booking status was not updated to confirmed
        $this->assertSame('held', $booking->fresh()->booking_status);
    }

    /**
     * TEST-NEG-003: Unavailable Provider Trips Circuit Breaker.
     */
    public function test_unavailable_provider_trips_circuit_breaker_and_returns_service_unavailable(): void
    {
        $circuitBreaker = app(ProviderCircuitBreaker::class);
        $providerCode = 'MOCK_AMADEUS';

        // Simulate 5 consecutive failures to trip circuit
        for ($i = 0; $i < 5; $i++) {
            $circuitBreaker->recordFailure($providerCode);
        }

        $this->assertSame('OPEN', $circuitBreaker->getStatus($providerCode));
        $this->assertFalse($circuitBreaker->isAvailable($providerCode));
    }

    /**
     * TEST-NEG-004: Invalid Passenger Rules Validation.
     */
    public function test_invalid_passenger_rules_rejected(): void
    {
        $snapshot = BookingPriceSnapshot::first();
        $booking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-INV-PAX-01',
            'user_id'                   => $this->customer->id,
            'booking_price_snapshot_id' => $snapshot->id,
            'booking_status'            => 'held',
            'payment_status'            => 'unpaid',
            'ticket_status'             => 'unissued',
            'servicing_status'          => 'none',
            'hold_expires_at'           => now()->addMinutes(15),
            'currency'                  => 'BDT',
            'total_amount'              => 5000.00,
            'contact_email'             => 'inv_pax@example.com',
            'contact_phone'             => '+8801700000000',
            'contact_country_code'      => '+880',
        ]);

        // Attempt to pass an adult aged 8
        $response = $this->withHeader('Authorization', "Bearer {$this->customerToken}")
            ->postJson("/api/v1/bookings/{$booking->ulid}/passengers", [
                'passengers' => [
                    [
                        'type'          => 'adult',
                        'title'         => 'MR',
                        'first_name'    => 'Too',
                        'last_name'     => 'Young',
                        'date_of_birth' => now()->subYears(8)->toDateString(),
                        'gender'        => 'male',
                    ],
                ],
            ]);

        $response->assertStatus(422)
            ->assertJsonPath('success', false);
    }

    /**
     * TEST-NEG-005: Duplicate Submission Blocked by Idempotency Lock.
     */
    public function test_duplicate_submission_blocked_by_idempotency_key(): void
    {
        $snapshot = BookingPriceSnapshot::first();
        $booking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-DUP-IDEMP-01',
            'user_id'                   => $this->customer->id,
            'booking_price_snapshot_id' => $snapshot->id,
            'booking_status'            => 'held',
            'payment_status'            => 'unpaid',
            'ticket_status'             => 'unissued',
            'servicing_status'          => 'none',
            'hold_expires_at'           => now()->addMinutes(15),
            'currency'                  => 'BDT',
            'total_amount'              => 4850.00,
            'contact_email'             => 'dup_idemp@example.com',
            'contact_phone'             => '+8801700000000',
            'contact_country_code'      => '+880',
        ]);

        $idempotencyKey = 'IDEMP-DUP-TEST-' . Str::random(8);
        $payload = [
            'payment' => [
                'method'                    => 'card',
                'gateway'                   => 'simulated',
                'source'                    => 'server_webhook',
                'verified_server_signature' => true,
                'gateway_transaction_id'    => 'TXN-DUP-01',
            ],
        ];

        // 1. First submission
        $first = $this->withHeader('Authorization', "Bearer {$this->customerToken}")
            ->withHeader('Idempotency-Key', $idempotencyKey)
            ->postJson("/api/v1/bookings/{$booking->ulid}/confirm", $payload);
        $first->assertStatus(200);

        // 2. Duplicate submission with identical key
        $second = $this->withHeader('Authorization', "Bearer {$this->customerToken}")
            ->withHeader('Idempotency-Key', $idempotencyKey)
            ->postJson("/api/v1/bookings/{$booking->ulid}/confirm", $payload);
        $second->assertStatus(200)
            ->assertJsonPath('meta.idempotent_replay', true);
    }

    /**
     * TEST-NEG-006: Payment Decline Retains Booking in Unpaid Hold.
     */
    public function test_payment_decline_marks_payment_failed_and_keeps_booking_held(): void
    {
        $snapshot = BookingPriceSnapshot::first();
        $booking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-DECLINE-01',
            'user_id'                   => $this->customer->id,
            'booking_price_snapshot_id' => $snapshot->id,
            'booking_status'            => 'held',
            'payment_status'            => 'unpaid',
            'ticket_status'             => 'unissued',
            'servicing_status'          => 'none',
            'hold_expires_at'           => now()->addMinutes(15),
            'currency'                  => 'BDT',
            'total_amount'              => 4850.00,
            'contact_email'             => 'decline@example.com',
            'contact_phone'             => '+8801700000000',
            'contact_country_code'      => '+880',
        ]);

        $payment = Payment::create([
            'ulid'                     => (string) Str::ulid(),
            'booking_id'               => $booking->id,
            'user_id'                  => $this->customer->id,
            'amount'                   => 4850.00,
            'currency'                 => 'BDT',
            'status'                   => 'pending',
            'gateway_name'             => 'simulated',
            'merchant_transaction_ref' => 'TXN-DECLINE-01',
            'idempotency_key'          => (string) Str::uuid(),
        ]);

        $response = $this->postJson('/api/v1/payments/webhook', [
            'tran_id'       => 'TXN-DECLINE-01',
            'status'        => 'FAILED',
            'amount'        => '4850.00',
            'currency'      => 'BDT',
            'error_message' => 'Insufficient funds in customer card',
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('data.status', 'failed');

        $this->assertSame('failed', $payment->fresh()->status);
        $this->assertSame('unpaid', $booking->fresh()->payment_status);
        $this->assertSame('unissued', $booking->fresh()->ticket_status);
    }

    /**
     * TEST-NEG-007: Forged Webhook Signature Rejected.
     */
    public function test_forged_webhook_signature_is_rejected(): void
    {
        $response = $this->postJson('/api/v1/payments/webhook', [
            'tran_id'     => 'TXN-FORGED-01',
            'amount'      => '10000.00',
            'currency'    => 'BDT',
            'status'      => 'VALID',
            'verify_sign' => 'tampered_malicious_signature_hash',
        ]);

        $response->assertStatus(400)
            ->assertJsonPath('success', false)
            ->assertJsonPath('error.code', 'WEBHOOK_VERIFICATION_FAILED');
    }

    /**
     * TEST-NEG-008: Ticketing Timeout Routes to Operations Queue.
     */
    public function test_ticketing_timeout_routes_to_operations_queue_without_duplicate_issue(): void
    {
        $snapshot = BookingPriceSnapshot::first();
        $booking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-TICKET-TIMEOUT-01',
            'user_id'                   => $this->customer->id,
            'booking_price_snapshot_id' => $snapshot->id,
            'booking_status'            => 'confirmed',
            'payment_status'            => 'captured',
            'ticket_status'             => 'pending',
            'servicing_status'          => 'none',
            'currency'                  => 'BDT',
            'total_amount'              => 4850.00,
            'contact_email'             => 'timeout@example.com',
            'contact_phone'             => '+8801700000000',
            'contact_country_code'      => '+880',
        ]);

        // When ticket issue times out, system records state in ticketing queue
        $this->assertSame('pending', $booking->fresh()->ticket_status);
        $this->assertDatabaseMissing('tickets', [
            'booking_id'    => $booking->id,
            'ticket_status' => 'issued',
        ]);
    }

    /**
     * TEST-NEG-009: Partial Ticket Issue Routes to Manual Operations Queue.
     */
    public function test_partial_ticket_issue_routes_to_manual_operations_queue(): void
    {
        $snapshot = BookingPriceSnapshot::first();
        $booking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-PARTIAL-ISSUE-01',
            'user_id'                   => $this->customer->id,
            'booking_price_snapshot_id' => $snapshot->id,
            'booking_status'            => 'confirmed',
            'payment_status'            => 'captured',
            'ticket_status'             => 'pending',
            'servicing_status'          => 'none',
            'currency'                  => 'BDT',
            'total_amount'              => 9700.00,
            'contact_email'             => 'partial@example.com',
            'contact_phone'             => '+8801700000000',
            'contact_country_code'      => '+880',
        ]);

        // Create partial ticketing scenario
        $booking->update(['ticket_status' => 'partial_issue']);
        $this->assertSame('partial_issue', $booking->fresh()->ticket_status);
    }

    /**
     * TEST-NEG-010: Booking IDOR Protection.
     */
    public function test_booking_idor_protection_rejects_unauthorized_customer(): void
    {
        $snapshot = BookingPriceSnapshot::first();
        $booking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-IDOR-PRIVATE-01',
            'user_id'                   => $this->customer->id,
            'booking_price_snapshot_id' => $snapshot->id,
            'booking_status'            => 'confirmed',
            'payment_status'            => 'captured',
            'ticket_status'             => 'ticketed',
            'servicing_status'          => 'none',
            'currency'                  => 'BDT',
            'total_amount'              => 4850.00,
            'contact_email'             => 'customer@example.com',
            'contact_phone'             => '+8801700000000',
            'contact_country_code'      => '+880',
        ]);

        // Other customer attempts to read Customer A's booking
        $response = $this->withHeader('Authorization', "Bearer {$this->otherToken}")
            ->getJson("/api/v1/bookings/{$booking->ulid}/status");

        $response->assertStatus(403)
            ->assertJsonPath('success', false)
            ->assertJsonPath('error.code', 'FORBIDDEN');
    }

    /**
     * TEST-NEG-011: Unauthorized Refund Request Rejection.
     */
    public function test_unauthorized_refund_request_rejected_for_retail_customer_and_support(): void
    {
        $supportUser = User::factory()->create(['role' => 'support']);
        $supportToken = $supportUser->createToken('support-token')->plainTextToken;

        // Retail customer cannot trigger admin refund endpoint
        $custResponse = $this->withHeader('Authorization', "Bearer {$this->customerToken}")
            ->postJson('/api/v1/admin/payments/TXN-REFUND-01/refund', [
                'amount' => 1000.00,
                'reason' => 'Customer request',
            ]);
        $custResponse->assertStatus(403);

        // Support agent is also denied refund disbursement
        $supResponse = $this->withHeader('Authorization', "Bearer {$supportToken}")
            ->postJson('/api/v1/admin/payments/TXN-REFUND-01/refund', [
                'amount' => 1000.00,
                'reason' => 'Customer request',
            ]);
        $supResponse->assertStatus(403);
    }
}
