<?php

namespace App\Services\Payments;

use App\Jobs\ReconcilePendingTicketsJob;
use App\Models\Booking;
use App\Models\FinancialLedgerEntry;
use App\Models\Payment;
use App\Models\PaymentEvent;
use App\Models\Refund;
use App\Models\User;
use App\Services\Payments\DTOs\PaymentSessionDTO;
use App\Services\Payments\PaymentGatewayInterface;
use App\Services\StateMachine\BookingStateMachine;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

class PaymentService
{
    public function __construct(
        protected PaymentGatewayInterface $gateway,
        protected BookingStateMachine $stateMachine
    ) {}

    /**
     * Create payment intent and hosted checkout session.
     * Amount and currency are calculated strictly on the backend from verified booking rules;
     * client-submitted amounts are completely ignored.
     */
    public function createIntent(Booking $booking, array $options = []): PaymentSessionDTO
    {
        if (!in_array($booking->booking_status, ['held', 'pending_payment'], true)) {
            throw new RuntimeException("Cannot initiate payment for booking in state '{$booking->booking_status}'.", 422);
        }

        if ($booking->hold_expires_at && $booking->hold_expires_at->isPast()) {
            throw new RuntimeException('Reservation hold expired. Please create a new booking hold.', 410);
        }

        $transactionId = 'TXN-' . date('Ymd') . '-' . strtoupper(Str::random(6));
        $idempotencyKey = 'IDEMP-PAY-' . $booking->ulid . '-' . Str::random(8);

        // Strictly backend-computed financial amounts
        $amount = (float) $booking->total_amount;
        $currency = strtoupper((string) $booking->currency);

        $payment = Payment::create([
            'ulid'                   => (string) Str::ulid(),
            'booking_id'             => $booking->id,
            'user_id'                => $booking->user_id,
            'payment_method'         => 'hosted_checkout',
            'gateway_provider'       => $this->gateway->getGatewayCode(),
            'gateway_transaction_id' => $transactionId,
            'currency'               => $currency,
            'amount'                 => $amount,
            'status'                 => 'initiated',
            'idempotency_key'        => $idempotencyKey,
        ]);

        PaymentEvent::create([
            'payment_id'  => $payment->id,
            'event_type'  => 'payment_intent_created',
            'status_from' => 'none',
            'status_to'   => 'initiated',
            'payload'     => [
                'transaction_id' => $transactionId,
                'amount'         => $amount,
                'currency'       => $currency,
            ],
            'recorded_at' => now(),
        ]);

        if ($booking->booking_status === 'held') {
            $this->stateMachine->transitionBookingStatus($booking, 'pending_payment', [
                'reason' => 'Payment intent initialized on checkout',
            ]);
        }

        return $this->gateway->initiatePayment($booking, $transactionId, $options);
    }

    /**
     * Process server-side IPN/webhook callback with signature validation and deduplication.
     */
    public function handleIpnWebhook(array $payload): array
    {
        // 1. Verify Gateway Signature & Call Server Validation API
        $verification = $this->gateway->validateCallback($payload);

        if (!$verification->isVerified) {
            return [
                'status'  => 'rejected',
                'message' => $verification->failureReason ?? 'Gateway validation check failed',
            ];
        }

        // 2. Find internal payment record
        $payment = Payment::where('gateway_transaction_id', $verification->gatewayTransactionId)->first();
        if (!$payment) {
            return [
                'status'  => 'unknown_transaction',
                'message' => "No payment found matching transaction ID {$verification->gatewayTransactionId}",
            ];
        }

        // 3. Deduplication Check: Webhook processing must be idempotent
        if (in_array($payment->status, ['captured', 'refunded'], true)) {
            return [
                'status'         => 'already_processed',
                'message'        => 'Transaction was already verified and captured.',
                'transaction_id' => $payment->gateway_transaction_id,
            ];
        }

        // 4. Financial Integrity: Compare amount & currency
        $booking = $payment->booking;
        $amountDelta = abs((float) $payment->amount - (float) $verification->amount);
        if ($amountDelta > 0.01 || strtoupper($payment->currency) !== strtoupper($verification->currency)) {
            // Security / fraud alert
            $payment->update([
                'status' => 'failed',
                'gateway_response_payload' => $verification->rawPayload,
            ]);

            PaymentEvent::create([
                'payment_id'  => $payment->id,
                'event_type'  => 'fraud_amount_mismatch',
                'status_from' => $payment->status,
                'status_to'   => 'failed',
                'payload'     => [
                    'expected_amount' => $payment->amount,
                    'verified_amount' => $verification->amount,
                    'currency'        => $payment->currency,
                ],
                'recorded_at' => now(),
            ]);

            return [
                'status'  => 'mismatched_amount',
                'message' => 'Payment amount or currency does not match booking reservation.',
            ];
        }

        return DB::transaction(function () use ($payment, $booking, $verification) {
            // 5. Update Payment record to CAPTURED
            $payment->update([
                'status'                   => 'captured',
                'card_brand'               => $verification->cardBrand,
                'card_last_four'           => $verification->cardLastFour,
                'gateway_reference'        => $verification->validationId,
                'captured_at'              => now(),
                'gateway_response_payload' => $verification->rawPayload,
            ]);

            // 6. Record Payment Audit Event
            PaymentEvent::create([
                'payment_id'  => $payment->id,
                'event_type'  => 'funds_captured',
                'status_from' => 'initiated',
                'status_to'   => 'captured',
                'payload'     => [
                    'bank_transaction_id' => $verification->bankTransactionId,
                    'validation_id'       => $verification->validationId,
                    'card_brand'          => $verification->cardBrand,
                ],
                'recorded_at' => now(),
            ]);

            // 7. Transition Booking State Machine
            $this->stateMachine->transitionPaymentStatus($booking, 'captured', [
                'source'                    => 'server_webhook',
                'verified_server_signature' => true,
                'gateway_transaction_id'    => $verification->gatewayTransactionId,
            ]);

            if ($booking->booking_status === 'held') {
                $this->stateMachine->transitionBookingStatus($booking, 'pending_payment', [
                    'source' => 'server_webhook',
                ]);
            }

            if ($booking->booking_status === 'pending_payment') {
                $this->stateMachine->transitionBookingStatus($booking, 'confirmed', [
                    'payment_captured' => true,
                ]);
            }

            if ($booking->ticket_status === 'unissued') {
                $this->stateMachine->transitionTicketStatus($booking, 'queued_for_issuance', [
                    'reason' => 'Server webhook verified. Queued for ticketing.',
                ]);
            }

            // 8. Immutable Double-Entry Financial Ledger
            FinancialLedgerEntry::create([
                'ulid'          => (string) Str::ulid(),
                'booking_id'    => $booking->id,
                'payment_id'    => $payment->id,
                'entry_type'    => 'credit',
                'debit_amount'  => 0,
                'credit_amount' => $payment->amount,
                'currency'      => $payment->currency,
                'description'   => "Flight reservation revenue captured [{$booking->reference}]",
                'account_code'  => '4000-AIRLINE-REVENUE',
                'recorded_at'   => now(),
            ]);

            FinancialLedgerEntry::create([
                'ulid'          => (string) Str::ulid(),
                'booking_id'    => $booking->id,
                'payment_id'    => $payment->id,
                'entry_type'    => 'debit',
                'debit_amount'  => $payment->amount,
                'credit_amount' => 0,
                'currency'      => $payment->currency,
                'description'   => "Gateway receivable receivable [{$payment->gateway_provider}]",
                'account_code'  => '1100-GATEWAY-RECEIVABLE',
                'recorded_at'   => now(),
            ]);

            return [
                'status'            => 'captured',
                'transaction_id'    => $payment->gateway_transaction_id,
                'booking_reference' => $booking->reference,
                'amount'            => $payment->amount,
                'currency'          => $payment->currency,
            ];
        });
    }

    /**
     * Process gateway refund with immutable financial ledger audit.
     */
    public function processRefund(
        Payment $payment,
        float $amount,
        string $reason,
        ?User $adminUser = null
    ): Refund {
        if ($payment->status !== 'captured') {
            throw new RuntimeException("Cannot refund payment with status '{$payment->status}'. Only CAPTURED payments are refundable.", 422);
        }

        if ($amount <= 0 || $amount > (float) $payment->amount) {
            throw new RuntimeException("Invalid refund amount {$amount}. Maximum refundable is {$payment->amount}.", 422);
        }

        // Call Gateway Refund API
        $refundResult = $this->gateway->processRefund($payment, $amount, $reason);

        if (!$refundResult->success) {
            throw new RuntimeException("Payment gateway refund rejected: {$refundResult->failureReason}", 502);
        }

        return DB::transaction(function () use ($payment, $amount, $reason, $refundResult, $adminUser) {
            $booking = $payment->booking;
            $isFullRefund = abs($amount - (float) $payment->amount) < 0.01;
            $newPaymentStatus = $isFullRefund ? 'refunded' : 'partially_refunded';

            $refund = Refund::create([
                'ulid'                     => (string) Str::ulid(),
                'booking_id'               => $booking->id,
                'payment_id'               => $payment->id,
                'refund_reference'         => $refundResult->refundReference,
                'currency'                 => $payment->currency,
                'gross_amount'             => $amount,
                'airline_penalty_fee'      => 0,
                'service_cancellation_fee' => 0,
                'net_refund_amount'        => $amount,
                'status'                   => 'completed',
                'settled_at'               => now(),
                'processed_by_user_id'     => $adminUser?->id,
            ]);

            $payment->update([
                'status' => $newPaymentStatus,
            ]);

            PaymentEvent::create([
                'payment_id'  => $payment->id,
                'event_type'  => 'refund_settled',
                'status_from' => 'captured',
                'status_to'   => $newPaymentStatus,
                'payload'     => [
                    'refund_reference' => $refundResult->refundReference,
                    'amount'           => $amount,
                    'reason'           => $reason,
                ],
                'recorded_at' => now(),
            ]);

            $this->stateMachine->transitionPaymentStatus($booking, $newPaymentStatus, [
                'refund_reference' => $refundResult->refundReference,
                'amount'           => $amount,
            ]);

            // Financial Ledger entries for refund
            FinancialLedgerEntry::create([
                'ulid'          => (string) Str::ulid(),
                'booking_id'    => $booking->id,
                'payment_id'    => $payment->id,
                'refund_id'     => $refund->id,
                'entry_type'    => 'debit',
                'debit_amount'  => $amount,
                'credit_amount' => 0,
                'currency'      => $payment->currency,
                'description'   => "Refund disbursement to customer [{$refundResult->refundReference}]",
                'account_code'  => '2100-REFUND-PAYABLE',
                'recorded_at'   => now(),
            ]);

            FinancialLedgerEntry::create([
                'ulid'          => (string) Str::ulid(),
                'booking_id'    => $booking->id,
                'payment_id'    => $payment->id,
                'refund_id'     => $refund->id,
                'entry_type'    => 'credit',
                'debit_amount'  => 0,
                'credit_amount' => $amount,
                'currency'      => $payment->currency,
                'description'   => "Gateway credit reduction on refund [{$payment->gateway_provider}]",
                'account_code'  => '1100-GATEWAY-RECEIVABLE',
                'recorded_at'   => now(),
            ]);

            return $refund;
        });
    }
}
