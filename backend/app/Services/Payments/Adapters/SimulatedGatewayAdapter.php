<?php

namespace App\Services\Payments\Adapters;

use App\Models\Booking;
use App\Models\Payment;
use App\Services\Payments\DTOs\PaymentRefundResultDTO;
use App\Services\Payments\DTOs\PaymentSessionDTO;
use App\Services\Payments\DTOs\PaymentVerificationDTO;
use App\Services\Payments\PaymentGatewayInterface;
use App\Services\Providers\Support\DataSanitizer;
use Illuminate\Support\Str;

class SimulatedGatewayAdapter implements PaymentGatewayInterface
{
    public const GATEWAY_CODE = 'SIMULATED';

    public function __construct(
        protected string $secretKey = 'simulated_payment_secret_key_12345'
    ) {}

    public function getGatewayCode(): string
    {
        return self::GATEWAY_CODE;
    }

    /**
     * Initiate simulated hosted checkout.
     */
    public function initiatePayment(
        Booking $booking,
        string $transactionId,
        array $options = []
    ): PaymentSessionDTO {
        $amount = (float) $booking->total_amount;
        $currency = strtoupper((string) $booking->currency);
        $appUrl = rtrim((string) config('app.url', 'http://localhost:8000'), '/');

        $sessionKey = 'SIM-SESS-' . Str::random(24);
        $redirectUrl = "{$appUrl}/payment/result?tran_id={$transactionId}&session={$sessionKey}";

        return new PaymentSessionDTO(
            gatewayCode: self::GATEWAY_CODE,
            gatewayTransactionId: $transactionId,
            sessionKey: $sessionKey,
            redirectUrl: $redirectUrl,
            currency: $currency,
            amount: $amount,
            expiresAt: now()->addMinutes(15)->toIso8601String(),
            metadata: [
                'booking_ulid'      => $booking->ulid,
                'booking_reference' => $booking->reference,
                'is_simulation'     => true,
            ]
        );
    }

    /**
     * Validate simulated IPN/webhook callback.
     */
    public function validateCallback(array $payload): PaymentVerificationDTO
    {
        $tranId = (string) ($payload['tran_id'] ?? '');
        $status = strtoupper((string) ($payload['status'] ?? 'VALID'));
        $amount = (float) ($payload['amount'] ?? 0.0);
        $currency = (string) ($payload['currency'] ?? 'BDT');

        // Signature check simulation if verify_sign provided
        if (isset($payload['verify_sign'])) {
            $expectedSign = hash_hmac('sha256', "{$tranId}:{$amount}:{$currency}", $this->secretKey);
            if ($payload['verify_sign'] !== $expectedSign) {
                return new PaymentVerificationDTO(
                    isVerified: false,
                    status: 'FAILED',
                    gatewayTransactionId: $tranId,
                    bankTransactionId: null,
                    amount: $amount,
                    currency: $currency,
                    failureReason: 'Invalid cryptographic gateway signature'
                );
            }
        }

        $isSuccess = in_array($status, ['VALID', 'CAPTURED', 'SUCCESS'], true);

        return new PaymentVerificationDTO(
            isVerified: $isSuccess,
            status: $isSuccess ? 'CAPTURED' : 'FAILED',
            gatewayTransactionId: $tranId,
            bankTransactionId: 'SIM-BANK-' . strtoupper(Str::random(8)),
            amount: $amount,
            currency: $currency,
            cardBrand: $payload['card_brand'] ?? 'VISA',
            cardLastFour: $payload['card_last_four'] ?? '4242',
            validationId: 'SIM-VAL-' . strtoupper(Str::random(12)),
            failureReason: $isSuccess ? null : ($payload['error_message'] ?? 'Payment declined by simulated bank'),
            rawPayload: DataSanitizer::sanitize($payload)
        );
    }

    /**
     * Query simulated transaction status.
     */
    public function queryTransaction(string $transactionId): PaymentVerificationDTO
    {
        return new PaymentVerificationDTO(
            isVerified: true,
            status: 'CAPTURED',
            gatewayTransactionId: $transactionId,
            bankTransactionId: 'SIM-BANK-' . strtoupper(Str::random(8)),
            amount: 4850.00,
            currency: 'BDT',
            cardBrand: 'VISA',
            cardLastFour: '4242',
            validationId: 'SIM-VAL-QUERY',
            failureReason: null
        );
    }

    /**
     * Process simulated refund.
     */
    public function processRefund(
        Payment $payment,
        float $amount,
        string $reason
    ): PaymentRefundResultDTO {
        $refundRef = 'SIM-REF-' . strtoupper(Str::random(10));

        return new PaymentRefundResultDTO(
            success: true,
            refundReference: $refundRef,
            status: 'COMPLETED',
            refundedAmount: $amount,
            currency: $payment->currency,
            gatewayRefundId: 'SIM-GW-REF-' . strtoupper(Str::random(8))
        );
    }

    public function checkHealth(): array
    {
        return [
            'gateway'    => self::GATEWAY_CODE,
            'configured' => true,
            'sandbox'    => true,
            'status'     => 'healthy',
        ];
    }
}
