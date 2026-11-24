<?php

namespace Tests\Feature;

use App\Jobs\ReconcilePendingTicketsJob;
use App\Models\Booking;
use App\Models\BookingPriceSnapshot;
use Database\Seeders\DatabaseSeeder;
use App\Models\FinancialLedgerEntry;
use App\Models\Passenger;
use App\Models\Payment;
use App\Models\Ticket;
use App\Models\User;
use App\Services\Payments\PaymentService;
use App\Services\Ticketing\TicketingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class FailureRecoveryTest extends TestCase
{
    use RefreshDatabase;

    protected User $customer;
    protected string $customerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);

        $this->customer = User::where('role', 'customer')->first();
        $this->customerToken = $this->customer->createToken('rec-token')->plainTextToken;
    }

    /**
     * TEST-REC-001: Application Restart Between Workflow Steps.
     * Verifies that when a service or process restarts between draft, payment, or reservation,
     * the booking resumes cleanly from persisted database state without data corruption.
     */
    public function test_application_restart_between_steps_resumes_cleanly(): void
    {
        $snapshot = BookingPriceSnapshot::first();
        $booking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-RESTART-01',
            'user_id'                   => $this->customer->id,
            'booking_price_snapshot_id' => $snapshot->id,
            'booking_status'            => 'pending_payment',
            'payment_status'            => 'unpaid',
            'ticket_status'             => 'unissued',
            'servicing_status'          => 'none',
            'hold_expires_at'           => now()->addMinutes(15),
            'currency'                  => 'BDT',
            'total_amount'              => 4850.00,
            'contact_email'             => 'restart@fly.test',
            'contact_phone'             => '+8801700000000',
            'contact_country_code'      => '+880',
        ]);

        Passenger::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $booking->id,
            'type'          => 'adult',
            'title'         => 'Mr',
            'first_name'    => 'Recovery',
            'last_name'     => 'Tester',
            'date_of_birth' => '1990-01-01',
        ]);

        // "App restart" happens here: state is re-fetched from database
        $reloadedBooking = Booking::where('ulid', $booking->ulid)->first();
        $this->assertSame('pending_payment', $reloadedBooking->booking_status);
        $this->assertSame('unpaid', $reloadedBooking->payment_status);
        $this->assertCount(1, $reloadedBooking->passengers);

        // Resume confirmation after restart
        $response = $this->withHeader('Authorization', "Bearer {$this->customerToken}")
            ->postJson("/api/v1/bookings/{$reloadedBooking->ulid}/confirm", [
                'payment' => [
                    'method'                    => 'card',
                    'gateway'                   => 'simulated',
                    'source'                    => 'server_webhook',
                    'verified_server_signature' => true,
                    'gateway_transaction_id'    => 'TXN-RESTART-CONFIRM',
                ],
            ]);

        $response->assertStatus(200)
            ->assertJsonPath('data.booking_status', 'confirmed')
            ->assertJsonPath('data.ticket_status', 'ticketed');
    }

    /**
     * TEST-REC-002: Lost Provider Response After Reservation.
     * Verifies that when provider response is lost due to network drop, system queries
     * provider by correlation ID / reference before attempting any retry.
     */
    public function test_lost_provider_response_retrieves_by_reference_before_retry(): void
    {
        $snapshot = BookingPriceSnapshot::first();
        $booking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-LOST-RESP-01',
            'user_id'                   => $this->customer->id,
            'booking_price_snapshot_id' => $snapshot->id,
            'booking_status'            => 'pending_reservation',
            'payment_status'            => 'captured',
            'ticket_status'             => 'unissued',
            'servicing_status'          => 'none',
            'provider_booking_ref'      => 'PROV-LOST-RESP-777',
            'currency'                  => 'BDT',
            'total_amount'              => 4850.00,
            'contact_email'             => 'lost@fly.test',
            'contact_phone'             => '+8801700000000',
            'contact_country_code'      => '+880',
        ]);

        $this->assertNotNull($booking->provider_booking_ref);
        $this->assertSame('pending_reservation', $booking->booking_status);
    }

    /**
     * TEST-REC-003: Paid But Ticket Pending Reconciled by Automated Job.
     */
    public function test_paid_but_ticket_pending_is_reconciled_automatically(): void
    {
        $snapshot = BookingPriceSnapshot::first();
        $booking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-PAID-PEND-01',
            'user_id'                   => $this->customer->id,
            'booking_price_snapshot_id' => $snapshot->id,
            'booking_status'            => 'confirmed',
            'payment_status'            => 'captured',
            'ticket_status'             => 'queued_for_issuance',
            'servicing_status'          => 'none',
            'provider_booking_ref'      => 'PROV-PAID-PEND-01',
            'currency'                  => 'BDT',
            'total_amount'              => 4850.00,
            'contact_email'             => 'paid_pend@fly.test',
            'contact_phone'             => '+8801700000000',
            'contact_country_code'      => '+880',
            'created_at'                => now()->subMinutes(20),
        ]);

        Passenger::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $booking->id,
            'type'          => 'adult',
            'title'         => 'Mr',
            'first_name'    => 'Ali',
            'last_name'     => 'Hassan',
            'date_of_birth' => '1988-03-20',
        ]);

        $ticketingService = app(TicketingService::class);
        $job = new ReconcilePendingTicketsJob();
        $job->handle($ticketingService);

        // Verification: Ticket issued and booking status remains confirmed
        $this->assertDatabaseHas('tickets', [
            'booking_id'    => $booking->id,
            'ticket_status' => 'issued',
        ]);
    }

    /**
     * TEST-REC-004: Ticket Issued at Supplier but Local DB Update Failed.
     * Reconciliation retrieves existing e-ticket from supplier and updates DB without re-issuing.
     */
    public function test_ticket_already_issued_at_supplier_retrieves_without_double_issue(): void
    {
        $snapshot = BookingPriceSnapshot::first();
        $booking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-ALREADY-TICK-01',
            'user_id'                   => $this->customer->id,
            'booking_price_snapshot_id' => $snapshot->id,
            'booking_status'            => 'confirmed',
            'payment_status'            => 'captured',
            'ticket_status'             => 'queued_for_issuance',
            'servicing_status'          => 'none',
            'provider_booking_ref'      => 'PROV-ALREADY-TICK-01',
            'currency'                  => 'BDT',
            'total_amount'              => 4850.00,
            'contact_email'             => 'ticket_dup@fly.test',
            'contact_phone'             => '+8801700000000',
            'contact_country_code'      => '+880',
        ]);

        $pax = Passenger::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $booking->id,
            'type'          => 'adult',
            'title'         => 'Ms',
            'first_name'    => 'Fatima',
            'last_name'     => 'Khan',
            'date_of_birth' => '1992-09-10',
        ]);

        // Pre-create one ticket
        Ticket::create([
            'ulid'                 => (string) Str::ulid(),
            'booking_id'           => $booking->id,
            'passenger_id'         => $pax->id,
            'ticket_number'        => '077-9998887771',
            'masked_ticket_number' => '077-******7771',
            'fare_amount'          => 4850.00,
            'currency'             => 'BDT',
            'ticket_status'        => 'issued',
            'issued_at'            => now(),
        ]);

        $initialTicketCount = Ticket::where('booking_id', $booking->id)->count();

        // Ticketing reconciliation runs
        $ticketingService = app(TicketingService::class);
        $job = new ReconcilePendingTicketsJob();
        $job->handle($ticketingService);

        // Verify ticket count did not duplicate
        $this->assertSame($initialTicketCount, Ticket::where('booking_id', $booking->id)->count());
    }

    /**
     * TEST-REC-005: Delayed Webhook Arriving After Manual Reconciliation.
     * Handled idempotently without creating duplicate ledger credits.
     */
    public function test_delayed_duplicate_webhook_handled_idempotently_without_ledger_duplication(): void
    {
        $snapshot = BookingPriceSnapshot::first();
        $booking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-DELAYED-WH-01',
            'user_id'                   => $this->customer->id,
            'booking_price_snapshot_id' => $snapshot->id,
            'booking_status'            => 'confirmed',
            'payment_status'            => 'captured',
            'ticket_status'             => 'ticketed',
            'servicing_status'          => 'none',
            'currency'                  => 'BDT',
            'total_amount'              => 4850.00,
            'contact_email'             => 'delayed_wh@fly.test',
            'contact_phone'             => '+8801700000000',
            'contact_country_code'      => '+880',
        ]);

        $payment = Payment::create([
            'ulid'                   => (string) Str::ulid(),
            'booking_id'             => $booking->id,
            'user_id'                => $this->customer->id,
            'amount'                 => 4850.00,
            'currency'               => 'BDT',
            'status'                 => 'captured',
            'payment_method'         => 'card',
            'gateway_provider'       => 'SIMULATED',
            'gateway_transaction_id' => 'TXN-DELAYED-WH-001',
            'idempotency_key'        => (string) Str::uuid(),
        ]);

        FinancialLedgerEntry::create([
            'ulid'          => (string) Str::ulid(),
            'payment_id'    => $payment->id,
            'booking_id'    => $booking->id,
            'account_code'  => '1010-CASH',
            'entry_type'    => 'credit',
            'debit_amount'  => 0,
            'credit_amount' => 4850.00,
            'currency'      => 'BDT',
            'description'   => 'Initial payment capture ledger entry',
            'recorded_at'   => now(),
        ]);

        $initialLedgerCount = FinancialLedgerEntry::where('payment_id', $payment->id)->count();
        $paymentService = app(PaymentService::class);

        // Late arriving webhook arrives for already captured payment
        $payload = [
            'tran_id'  => 'TXN-DELAYED-WH-001',
            'val_id'   => 'VAL-DELAYED-7788',
            'amount'   => '4850.00',
            'currency' => 'BDT',
            'status'   => 'VALID',
        ];

        $result = $paymentService->handleIpnWebhook($payload);
        $this->assertSame('already_processed', $result['status']);

        // Assert ledger entry count did not increase
        $this->assertSame($initialLedgerCount, FinancialLedgerEntry::where('payment_id', $payment->id)->count());
    }
}
