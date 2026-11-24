<?php

namespace Tests\Feature\Payments;

use App\Jobs\ReconcilePendingTransactionsJob;
use App\Models\Booking;
use App\Models\BookingPriceSnapshot;
use App\Models\FinancialLedgerEntry;
use App\Models\FlightOffer;
use App\Models\Payment;
use App\Models\PaymentEvent;
use App\Models\Refund;
use App\Models\User;
use App\Services\Payments\Adapters\SimulatedGatewayAdapter;
use App\Services\Payments\PaymentGatewayInterface;
use App\Services\Payments\PaymentService;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PaymentGatewayTest extends TestCase
{
    use RefreshDatabase;

    protected Booking $booking;
    protected User $customer;
    protected User $admin;
    protected string $secretKey = 'simulated_payment_secret_key_12345';

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);

        $this->customer = User::where('role', 'customer')->first();
        $this->admin = User::where('role', 'admin')->first();

        $snapshot = BookingPriceSnapshot::first();

        $this->booking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-TEST-PAY-001',
            'user_id'                   => $this->customer->id,
            'booking_price_snapshot_id' => $snapshot->id,
            'booking_status'            => 'held',
            'payment_status'            => 'unpaid',
            'ticket_status'             => 'unissued',
            'servicing_status'          => 'none',
            'hold_expires_at'           => now()->addMinutes(15),
            'currency'                  => 'BDT',
            'total_amount'              => 4850.00,
            'contact_email'             => 'customer@fly.com',
            'contact_phone'             => '+8801711000000',
            'contact_country_code'      => '+880',
        ]);
    }

    public function test_payment_intent_creation_strictly_calculates_amount_from_backend_booking(): void
    {
        // Client attempts to pass an unauthorized low amount
        $response = $this->postJson('/api/v1/payments/intent', [
            'booking_ulid' => $this->booking->ulid,
            'amount'       => 10.00, // Attempted client-side amount tampering
            'currency'     => 'USD', // Attempted currency spoofing
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.amount', 4850) // Strictly enforced from server booking record
            ->assertJsonPath('data.currency', 'BDT');

        $this->assertDatabaseHas('payments', [
            'booking_id' => $this->booking->id,
            'amount'     => 4850.00,
            'currency'   => 'BDT',
            'status'     => 'initiated',
        ]);

        $this->assertDatabaseHas('payment_events', [
            'event_type' => 'payment_intent_created',
            'status_to'  => 'initiated',
        ]);
    }

    public function test_ipn_webhook_valid_signature_captures_payment_and_confirms_booking(): void
    {
        // 1. Create initiated payment
        $transactionId = 'TXN-TEST-12345';
        $payment = Payment::create([
            'ulid'                   => (string) Str::ulid(),
            'booking_id'             => $this->booking->id,
            'user_id'                => $this->booking->user_id,
            'payment_method'         => 'hosted_checkout',
            'gateway_provider'       => 'SIMULATED',
            'gateway_transaction_id' => $transactionId,
            'currency'               => 'BDT',
            'amount'                 => 4850.00,
            'status'                 => 'initiated',
            'idempotency_key'        => 'IDEMP-TEST-001',
        ]);

        $verifySign = hash_hmac('sha256', "{$transactionId}:4850:BDT", $this->secretKey);

        $payload = [
            'tran_id'        => $transactionId,
            'amount'         => 4850.00,
            'currency'       => 'BDT',
            'status'         => 'VALID',
            'card_brand'     => 'VISA',
            'card_last_four' => '4242',
            'verify_sign'    => $verifySign,
        ];

        $response = $this->postJson('/api/v1/payments/ipn', $payload);

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.status', 'captured')
            ->assertJsonPath('data.transaction_id', $transactionId);

        // Check payment updated
        $payment->refresh();
        $this->assertEquals('captured', $payment->status);
        $this->assertEquals('VISA', $payment->card_brand);
        $this->assertEquals('4242', $payment->card_last_four);
        $this->assertNotNull($payment->captured_at);

        // Check booking updated
        $this->booking->refresh();
        $this->assertEquals('confirmed', $this->booking->booking_status);
        $this->assertEquals('captured', $this->booking->payment_status);
        $this->assertEquals('queued_for_issuance', $this->booking->ticket_status);

        // Check double-entry financial ledger records created
        $ledgerEntries = FinancialLedgerEntry::where('booking_id', $this->booking->id)->get();
        $this->assertCount(2, $ledgerEntries);
        $this->assertTrue($ledgerEntries->contains('account_code', '4000-AIRLINE-REVENUE'));
        $this->assertTrue($ledgerEntries->contains('account_code', '1100-GATEWAY-RECEIVABLE'));
    }

    public function test_ipn_webhook_replayed_is_idempotent_and_does_not_duplicate_ledger(): void
    {
        $transactionId = 'TXN-REPLAY-999';
        Payment::create([
            'ulid'                   => (string) Str::ulid(),
            'booking_id'             => $this->booking->id,
            'user_id'                => $this->booking->user_id,
            'payment_method'         => 'hosted_checkout',
            'gateway_provider'       => 'SIMULATED',
            'gateway_transaction_id' => $transactionId,
            'currency'               => 'BDT',
            'amount'                 => 4850.00,
            'status'                 => 'initiated',
            'idempotency_key'        => 'IDEMP-REPLAY-001',
        ]);

        $payload = [
            'tran_id'        => $transactionId,
            'amount'         => 4850.00,
            'currency'       => 'BDT',
            'status'         => 'VALID',
            'card_brand'     => 'MASTERCARD',
            'card_last_four' => '8899',
        ];

        // First call captures payment
        $firstResponse = $this->postJson('/api/v1/payments/ipn', $payload);
        $firstResponse->assertStatus(200)
            ->assertJsonPath('data.status', 'captured');

        $ledgerCountBefore = FinancialLedgerEntry::where('booking_id', $this->booking->id)->count();
        $this->assertEquals(2, $ledgerCountBefore);

        // Replayed call must be idempotent
        $replayResponse = $this->postJson('/api/v1/payments/ipn', $payload);
        $replayResponse->assertStatus(200)
            ->assertJsonPath('data.status', 'already_processed');

        // Ledger entries must not be duplicated
        $ledgerCountAfter = FinancialLedgerEntry::where('booking_id', $this->booking->id)->count();
        $this->assertEquals(2, $ledgerCountAfter);
    }

    public function test_ipn_webhook_amount_mismatch_rejected_and_marked_failed(): void
    {
        $transactionId = 'TXN-MISMATCH-404';
        $payment = Payment::create([
            'ulid'                   => (string) Str::ulid(),
            'booking_id'             => $this->booking->id,
            'user_id'                => $this->booking->user_id,
            'payment_method'         => 'hosted_checkout',
            'gateway_provider'       => 'SIMULATED',
            'gateway_transaction_id' => $transactionId,
            'currency'               => 'BDT',
            'amount'                 => 4850.00,
            'status'                 => 'initiated',
            'idempotency_key'        => 'IDEMP-MISMATCH-001',
        ]);

        // Attacker or corrupted gateway sends 100.00 instead of 4850.00
        $payload = [
            'tran_id'  => $transactionId,
            'amount'   => 100.00,
            'currency' => 'BDT',
            'status'   => 'VALID',
        ];

        $response = $this->postJson('/api/v1/payments/ipn', $payload);

        $response->assertStatus(422)
            ->assertJsonPath('error_code', 'AMOUNT_CURRENCY_MISMATCH');

        $payment->refresh();
        $this->assertEquals('failed', $payment->status);

        $this->assertDatabaseHas('payment_events', [
            'payment_id' => $payment->id,
            'event_type' => 'fraud_amount_mismatch',
            'status_to'  => 'failed',
        ]);

        // Booking must not be confirmed
        $this->booking->refresh();
        $this->assertEquals('held', $this->booking->booking_status);
        $this->assertEquals('unpaid', $this->booking->payment_status);
    }

    public function test_ipn_webhook_invalid_signature_rejected(): void
    {
        $transactionId = 'TXN-SIG-ERR-001';
        $payment = Payment::create([
            'ulid'                   => (string) Str::ulid(),
            'booking_id'             => $this->booking->id,
            'user_id'                => $this->booking->user_id,
            'payment_method'         => 'hosted_checkout',
            'gateway_provider'       => 'SIMULATED',
            'gateway_transaction_id' => $transactionId,
            'currency'               => 'BDT',
            'amount'                 => 4850.00,
            'status'                 => 'initiated',
            'idempotency_key'        => 'IDEMP-SIG-001',
        ]);

        $payload = [
            'tran_id'     => $transactionId,
            'amount'      => 4850.00,
            'currency'    => 'BDT',
            'status'      => 'VALID',
            'verify_sign' => 'bogus_tampered_signature_string',
        ];

        $response = $this->postJson('/api/v1/payments/ipn', $payload);

        $response->assertStatus(403)
            ->assertJsonPath('error_code', 'SIGNATURE_VERIFICATION_FAILED');

        $payment->refresh();
        $this->assertEquals('initiated', $payment->status);
    }

    public function test_reconciliation_job_recovers_pending_transaction(): void
    {
        $transactionId = 'TXN-RECONCILE-001';
        $payment = Payment::create([
            'ulid'                   => (string) Str::ulid(),
            'booking_id'             => $this->booking->id,
            'user_id'                => $this->booking->user_id,
            'payment_method'         => 'hosted_checkout',
            'gateway_provider'       => 'SIMULATED',
            'gateway_transaction_id' => $transactionId,
            'currency'               => 'BDT',
            'amount'                 => 4850.00,
            'status'                 => 'initiated',
            'idempotency_key'        => 'IDEMP-RECON-001',
        ]);
        $payment->timestamps = false;
        $payment->created_at = now()->subMinutes(10);
        $payment->save();

        $gateway = app(PaymentGatewayInterface::class);
        $paymentService = app(PaymentService::class);

        $job = new ReconcilePendingTransactionsJob();
        $job->handle($gateway, $paymentService);

        $payment->refresh();
        $this->assertEquals('captured', $payment->status);

        $this->booking->refresh();
        $this->assertEquals('confirmed', $this->booking->booking_status);
        $this->assertEquals('captured', $this->booking->payment_status);
    }

    public function test_get_payment_status_endpoint_returns_safe_non_sensitive_data(): void
    {
        $transactionId = 'TXN-SAFE-STATUS-101';
        Payment::create([
            'ulid'                   => (string) Str::ulid(),
            'booking_id'             => $this->booking->id,
            'user_id'                => $this->booking->user_id,
            'payment_method'         => 'hosted_checkout',
            'gateway_provider'       => 'SIMULATED',
            'gateway_transaction_id' => $transactionId,
            'currency'               => 'BDT',
            'amount'                 => 4850.00,
            'status'                 => 'captured',
            'card_brand'             => 'VISA',
            'card_last_four'         => '4242',
            'captured_at'            => now(),
            'idempotency_key'        => 'IDEMP-SAFE-001',
        ]);

        $response = $this->getJson("/api/v1/payments/{$transactionId}/status");

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.gateway_transaction_id', $transactionId)
            ->assertJsonPath('data.card_last_four', '4242')
            ->assertJsonPath('data.amount', 4850)
            ->assertJsonMissing(['card_number', 'pan', 'cvv', 'store_passwd']);
    }

    public function test_admin_refund_endpoint_processes_refund_and_financial_ledger(): void
    {
        $transactionId = 'TXN-REFUND-777';
        $payment = Payment::create([
            'ulid'                   => (string) Str::ulid(),
            'booking_id'             => $this->booking->id,
            'user_id'                => $this->booking->user_id,
            'payment_method'         => 'hosted_checkout',
            'gateway_provider'       => 'SIMULATED',
            'gateway_transaction_id' => $transactionId,
            'currency'               => 'BDT',
            'amount'                 => 4850.00,
            'status'                 => 'captured',
            'idempotency_key'        => 'IDEMP-REF-001',
        ]);

        // Transition booking to confirmed
        $this->booking->update([
            'booking_status' => 'confirmed',
            'payment_status' => 'captured',
        ]);

        Sanctum::actingAs($this->admin);

        $response = $this->postJson("/api/v1/admin/payments/{$payment->ulid}/refund", [
            'amount' => 4850.00,
            'reason' => 'Customer requested voluntary cancellation',
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.net_amount', 4850);

        $payment->refresh();
        $this->assertEquals('refunded', $payment->status);

        $this->booking->refresh();
        $this->assertEquals('refunded', $this->booking->payment_status);

        // Check Refund table record
        $this->assertDatabaseHas('refunds', [
            'payment_id'        => $payment->id,
            'net_refund_amount' => 4850.00,
            'status'            => 'completed',
        ]);

        // Check refund ledger entries (debit 2100-REFUND-PAYABLE, credit 1100-GATEWAY-RECEIVABLE)
        $this->assertDatabaseHas('financial_ledger_entries', [
            'booking_id'   => $this->booking->id,
            'payment_id'   => $payment->id,
            'entry_type'   => 'debit',
            'debit_amount' => 4850.00,
            'account_code' => '2100-REFUND-PAYABLE',
        ]);
        $this->assertDatabaseHas('financial_ledger_entries', [
            'booking_id'    => $this->booking->id,
            'payment_id'    => $payment->id,
            'entry_type'    => 'credit',
            'credit_amount' => 4850.00,
            'account_code'  => '1100-GATEWAY-RECEIVABLE',
        ]);
    }
}
