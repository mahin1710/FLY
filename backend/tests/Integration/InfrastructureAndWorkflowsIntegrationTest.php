<?php

namespace Tests\Integration;

use App\DTOs\FlightOfferDTO;
use App\Jobs\ReconcilePendingPaymentsJob;
use App\Jobs\ReconcilePendingTicketsJob;
use App\Jobs\SendCustomerNotificationJob;
use App\Models\Booking;
use App\Models\FinancialLedgerEntry;
use App\Models\Payment;
use App\Models\User;
use App\Services\Orchestration\BookingLockManager;
use App\Services\Payments\Adapters\SimulatedGatewayAdapter;
use App\Services\Providers\MockFlightProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

class InfrastructureAndWorkflowsIntegrationTest extends TestCase
{
    use RefreshDatabase;

    /**
     * TEST-INT-001: Distributed Locking Mutual Exclusion (BookingLockManager).
     */
    public function test_distributed_locking_mutual_exclusion_and_release(): void
    {
        $lockManager = new BookingLockManager();
        $bookingUlid = (string) Str::ulid();

        // 1. Run with lock successfully
        $result = $lockManager->runWithLock($bookingUlid, function () {
            return 'locked_and_executed';
        });
        $this->assertSame('locked_and_executed', $result);

        // 2. Simulate concurrent collision
        $lock = \Illuminate\Support\Facades\Cache::lock("booking_lock:{$bookingUlid}", 10);
        $lock->acquire();

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('currently locked by another concurrent process');

        $lockManager->runWithLock($bookingUlid, function () {
            return 'should_fail';
        }, 0);
    }

    /**
     * TEST-INT-002: Database Transaction Atomic Rollback on Failure.
     */
    public function test_database_transaction_atomic_rollback_preserves_consistency(): void
    {
        $user = User::factory()->create(['role' => 'customer']);
        $initialLedgerCount = FinancialLedgerEntry::count();

        try {
            DB::transaction(function () use ($user) {
                Booking::create([
                    'ulid'                 => (string) Str::ulid(),
                    'reference'            => 'BK-ROLLBACK-01',
                    'user_id'              => $user->id,
                    'booking_status'       => 'draft',
                    'payment_status'       => 'unpaid',
                    'ticket_status'        => 'unissued',
                    'servicing_status'     => 'none',
                    'currency'             => 'BDT',
                    'total_amount'         => 9999.00,
                    'contact_email'        => 'rollback@example.com',
                    'contact_phone'        => '+8801700000000',
                    'contact_country_code' => '+880',
                ]);

                FinancialLedgerEntry::create([
                    'ulid'            => (string) Str::ulid(),
                    'account_code'    => '1010',
                    'entry_type'      => 'customer_charge',
                    'debit_amount'    => 9999.00,
                    'currency'        => 'BDT',
                    'description'     => 'Temporary transaction',
                ]);

                // Deliberate simulated exception during orchestration
                throw new \RuntimeException('Simulated supplier crash during order orchestration');
            });
        } catch (\RuntimeException $e) {
            $this->assertSame('Simulated supplier crash during order orchestration', $e->getMessage());
        }

        // Verify neither booking nor ledger entry was persisted
        $this->assertDatabaseMissing('bookings', ['reference' => 'BK-ROLLBACK-01']);
        $this->assertSame($initialLedgerCount, FinancialLedgerEntry::count());
    }

    /**
     * TEST-INT-003: Queue Priority Channel Assignment.
     */
    public function test_queue_priority_channel_assignment_for_critical_recovery_and_bulk(): void
    {
        $recoveryJob = new ReconcilePendingPaymentsJob();
        $this->assertSame('critical_recovery', $recoveryJob->queue);

        $ticketingJob = new ReconcilePendingTicketsJob();
        $this->assertSame('critical_recovery', $ticketingJob->queue);

        $notificationJob = new SendCustomerNotificationJob(1, 'EMAIL', 'Ticket Confirmed', 'template_01');
        $this->assertSame('bulk', $notificationJob->queue);
    }

    /**
     * TEST-INT-004: Payment Reconciliation Worker Execution.
     */
    public function test_payment_reconciliation_worker_recovers_pending_records(): void
    {
        $user = User::factory()->create(['role' => 'customer']);
        $booking = Booking::create([
            'ulid'                 => (string) Str::ulid(),
            'reference'            => 'BK-INT-REC-01',
            'user_id'              => $user->id,
            'booking_status'       => 'held',
            'payment_status'       => 'unpaid',
            'ticket_status'        => 'unissued',
            'servicing_status'     => 'none',
            'hold_expires_at'      => now()->subMinutes(5),
            'currency'             => 'BDT',
            'total_amount'         => 6000.00,
            'contact_email'        => 'rec@example.com',
            'contact_phone'        => '+8801700000000',
            'contact_country_code' => '+880',
        ]);

        $job = new ReconcilePendingPaymentsJob();
        $job->handle(app(\App\Services\StateMachine\BookingStateMachine::class));

        $this->assertSame('expired', $booking->fresh()->booking_status);
    }

    /**
     * TEST-INT-005: Mock Provider Sandbox Integration.
     */
    public function test_mock_provider_sandbox_full_lifecycle(): void
    {
        $provider = new MockFlightProvider();

        // 1. Search
        $offers = $provider->search(['origin' => 'DAC', 'destination' => 'DXB', 'departure_date' => '2026-12-01']);
        $this->assertNotEmpty($offers);
        $firstOffer = $offers[0];

        // 2. Reprice
        $reprice = $provider->reprice($firstOffer->providerOfferRef, $firstOffer);
        $this->assertSame('BDT', $reprice->currency);
        $this->assertGreaterThan(0, $reprice->newAmount);

        // 3. Reservation
        $res = $provider->createReservation($firstOffer, [
            ['first_name' => 'John', 'last_name' => 'Doe', 'type' => 'adult']
        ], [
            'email' => 'john@example.com',
            'phone' => '+8801700000000',
        ]);
        $this->assertSame('CONFIRMED_HOLD', $res->rawProviderStatus);
        $this->assertNotNull($res->pnr);

        // 4. Issue Ticket
        $ticketRes = $provider->issueTicket($res->providerBookingRef, ['amount' => 45000.00, 'currency' => 'BDT']);
        $this->assertSame('ISSUED', $ticketRes->status);
        $this->assertNotEmpty($ticketRes->tickets);
    }

    /**
     * TEST-INT-006: Simulated Payment Gateway Sandbox Integration.
     */
    public function test_simulated_payment_gateway_sandbox_session_and_verification(): void
    {
        $user = User::factory()->create(['role' => 'customer']);
        $booking = Booking::create([
            'ulid'                 => (string) Str::ulid(),
            'reference'            => 'BK-GATEWAY-01',
            'user_id'              => $user->id,
            'booking_status'       => 'held',
            'payment_status'       => 'unpaid',
            'ticket_status'        => 'unissued',
            'servicing_status'     => 'none',
            'currency'             => 'BDT',
            'total_amount'         => 7500.00,
            'contact_email'        => 'gateway@example.com',
            'contact_phone'        => '+8801700000000',
            'contact_country_code' => '+880',
        ]);

        $gateway = new SimulatedGatewayAdapter();
        $session = $gateway->initiatePayment($booking, 'TXN-SANDBOX-001');

        $this->assertSame('TXN-SANDBOX-001', $session->gatewayTransactionId);
        $this->assertStringContainsString('/payment/result', $session->redirectUrl);

        $verification = $gateway->queryTransaction('TXN-SANDBOX-001');
        $this->assertTrue($verification->isVerified);
        $this->assertSame('CAPTURED', $verification->status);
    }
}
