<?php

namespace App\Services\Payments\Adapters;

use App\Models\Booking;
use App\Models\Payment;
use App\Services\Payments\DTOs\PaymentRefundResultDTO;
use App\Services\Payments\DTOs\PaymentSessionDTO;
use App\Services\Payments\DTOs\PaymentVerificationDTO;
use App\Services\Payments\PaymentGatewayInterface;
use App\Services\Providers\Support\DataSanitizer;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class SslCommerzAdapter implements PaymentGatewayInterface
{
    public const GATEWAY_CODE = 'SSLCOMMERZ';

    public function __construct(
        protected ?string $storeId = null,
        protected ?string $storePassword = null,
        protected bool $isSandbox = true,
        protected ?string $baseUrl = null,
        protected float $timeoutSeconds = 15.0
    ) {
        $this->baseUrl = $baseUrl ?: ($this->isSandbox
            ? 'https://sandbox.sslcommerz.com'
            : 'https://securepay.sslcommerz.com');
    }

    public function getGatewayCode(): string
    {
        return self::GATEWAY_CODE;
    }

    /**
     * Initiate hosted checkout session.
     * Amount and currency are calculated strictly on the backend from verified booking rules;
     * client-submitted amounts are completely ignored.
     */
    public function initiatePayment(
        Booking $booking,
        string $transactionId,
        array $options = []
    ): PaymentSessionDTO {
        $this->ensureConfigured();

        $amount = (float) $booking->total_amount;
        $currency = strtoupper((string) $booking->currency);

        $appUrl = rtrim((string) config('app.url', 'http://localhost:8000'), '/');
        $successUrl = $options['success_url'] ?? "{$appUrl}/payment/result?tran_id={$transactionId}";
        $failUrl = $options['fail_url'] ?? "{$appUrl}/payment/result?tran_id={$transactionId}";
        $cancelUrl = $options['cancel_url'] ?? "{$appUrl}/payment/result?tran_id={$transactionId}";
        $ipnUrl = $options['ipn_url'] ?? "{$appUrl}/api/v1/payments/ipn";

        $postData = [
            'store_id'         => $this->storeId,
            'store_passwd'     => $this->storePassword,
            'total_amount'     => number_format($amount, 2, '.', ''),
            'currency'         => $currency,
            'tran_id'          => $transactionId,
            'success_url'      => $successUrl,
            'fail_url'         => $failUrl,
            'cancel_url'       => $cancelUrl,
            'ipn_url'          => $ipnUrl,
            // Customer Contact Info
            'cus_name'         => $booking->contact_email,
            'cus_email'        => $booking->contact_email,
            'cus_add1'         => 'Dhaka, Bangladesh',
            'cus_city'         => 'Dhaka',
            'cus_country'      => 'Bangladesh',
            'cus_phone'        => ($booking->contact_country_code ?: '+880') . ($booking->contact_phone ?: '1700000000'),
            // Travel / Flight Booking Product Parameters
            'shipping_method'  => 'NO',
            'num_of_item'      => 1,
            'product_name'     => "Flight Ticket Hold [{$booking->reference}]",
            'product_category' => 'Travel',
            'product_profile'  => 'airline-tickets',
            'value_a'          => $booking->ulid,
            'value_b'          => $booking->reference,
        ];

        try {
            $response = Http::asForm()
                ->timeout($this->timeoutSeconds)
                ->post("{$this->baseUrl}/gwprocess/v4/api.php", $postData);

            if ($response->failed()) {
                throw new RuntimeException("SSLCOMMERZ session creation failed with HTTP {$response->status()}: {$response->body()}");
            }

            $body = $response->json();
            $status = strtoupper((string) ($body['status'] ?? ''));

            if ($status !== 'SUCCESS') {
                $failedReason = $body['failedreason'] ?? 'SSLCOMMERZ rejected session initiation';
                throw new RuntimeException("SSLCOMMERZ session creation rejected: {$failedReason}");
            }

            $redirectUrl = $body['GatewayPageURL'] ?? null;
            $sessionKey = $body['sessionkey'] ?? null;

            if (empty($redirectUrl)) {
                throw new RuntimeException('SSLCOMMERZ response missing GatewayPageURL redirect.');
            }

            return new PaymentSessionDTO(
                gatewayCode: self::GATEWAY_CODE,
                gatewayTransactionId: $transactionId,
                sessionKey: $sessionKey,
                redirectUrl: $redirectUrl,
                currency: $currency,
                amount: $amount,
                expiresAt: now()->addMinutes(15)->toIso8601String(),
                metadata: [
                    'sessionkey'       => $sessionKey,
                    'booking_ulid'     => $booking->ulid,
                    'booking_reference'=> $booking->reference,
                ]
            );
        } catch (Throwable $e) {
            throw new RuntimeException("Payment initiation failed: {$e->getMessage()}", 502, $e);
        }
    }

    /**
     * Validate server-side IPN/webhook callback by querying SSLCOMMERZ order validation API.
     */
    public function validateCallback(array $payload): PaymentVerificationDTO
    {
        $this->ensureConfigured();

        $valId = (string) ($payload['val_id'] ?? '');
        $tranId = (string) ($payload['tran_id'] ?? '');
        $status = strtoupper((string) ($payload['status'] ?? ''));

        if (empty($valId)) {
            // Immediate failure if no validation ID returned
            return new PaymentVerificationDTO(
                isVerified: false,
                status: 'FAILED',
                gatewayTransactionId: $tranId,
                bankTransactionId: null,
                amount: (float) ($payload['amount'] ?? 0.0),
                currency: (string) ($payload['currency'] ?? 'BDT'),
                failureReason: 'Missing val_id in SSLCOMMERZ callback payload.'
            );
        }

        // Call SSLCOMMERZ server-to-server validation API
        try {
            $validationResponse = Http::timeout($this->timeoutSeconds)
                ->get("{$this->baseUrl}/validator/api/validationserverAPI.php", [
                    'val_id'       => $valId,
                    'store_id'     => $this->storeId,
                    'store_passwd' => $this->storePassword,
                    'format'       => 'json',
                ]);

            if ($validationResponse->failed()) {
                throw new RuntimeException("Validation API failed with HTTP {$validationResponse->status()}");
            }

            $valData = $validationResponse->json();
            $valStatus = strtoupper((string) ($valData['status'] ?? ''));

            $isSuccess = in_array($valStatus, ['VALID', 'VALIDATED'], true);

            $cardType = (string) ($valData['card_type'] ?? $valData['card_issuer'] ?? 'UNKNOWN');
            $cardNo = (string) ($valData['card_no'] ?? '');
            $cardLastFour = strlen($cardNo) >= 4 ? substr($cardNo, -4) : null;

            return new PaymentVerificationDTO(
                isVerified: $isSuccess,
                status: $isSuccess ? 'CAPTURED' : 'FAILED',
                gatewayTransactionId: $valData['tran_id'] ?? $tranId,
                bankTransactionId: $valData['bank_tran_id'] ?? null,
                amount: (float) ($valData['amount'] ?? $payload['amount'] ?? 0.0),
                currency: (string) ($valData['currency'] ?? 'BDT'),
                cardBrand: $cardType,
                cardLastFour: $cardLastFour,
                validationId: $valId,
                failureReason: $isSuccess ? null : ($valData['error'] ?? "SSLCOMMERZ validation status was {$valStatus}"),
                rawPayload: DataSanitizer::sanitize($valData)
            );
        } catch (Throwable $e) {
            return new PaymentVerificationDTO(
                isVerified: false,
                status: 'FAILED',
                gatewayTransactionId: $tranId,
                bankTransactionId: null,
                amount: (float) ($payload['amount'] ?? 0.0),
                currency: (string) ($payload['currency'] ?? 'BDT'),
                failureReason: "Gateway validation request exception: {$e->getMessage()}"
            );
        }
    }

    /**
     * Query transaction status for background reconciliation.
     */
    public function queryTransaction(string $transactionId): PaymentVerificationDTO
    {
        $this->ensureConfigured();

        try {
            $response = Http::timeout($this->timeoutSeconds)
                ->get("{$this->baseUrl}/validator/api/merchantTransIDvalidationAPI.php", [
                    'tran_id'      => $transactionId,
                    'store_id'     => $this->storeId,
                    'store_passwd' => $this->storePassword,
                    'format'       => 'json',
                ]);

            if ($response->failed()) {
                throw new RuntimeException("Status query failed with HTTP {$response->status()}");
            }

            $data = $response->json();
            $element = $data['element'][0] ?? $data;
            $status = strtoupper((string) ($element['status'] ?? ''));

            $isValid = in_array($status, ['VALID', 'VALIDATED'], true);

            return new PaymentVerificationDTO(
                isVerified: $isValid,
                status: $isValid ? 'CAPTURED' : ($status === 'FAILED' ? 'FAILED' : 'PENDING'),
                gatewayTransactionId: $transactionId,
                bankTransactionId: $element['bank_tran_id'] ?? null,
                amount: (float) ($element['amount'] ?? 0.0),
                currency: (string) ($element['currency'] ?? 'BDT'),
                cardBrand: $element['card_type'] ?? null,
                cardLastFour: isset($element['card_no']) && strlen($element['card_no']) >= 4 ? substr($element['card_no'], -4) : null,
                validationId: $element['val_id'] ?? null,
                failureReason: $isValid ? null : ($element['error'] ?? "Status is {$status}"),
                rawPayload: DataSanitizer::sanitize($element)
            );
        } catch (Throwable $e) {
            return new PaymentVerificationDTO(
                isVerified: false,
                status: 'PENDING',
                gatewayTransactionId: $transactionId,
                bankTransactionId: null,
                amount: 0.0,
                currency: 'BDT',
                failureReason: "Reconciliation query failed: {$e->getMessage()}"
            );
        }
    }

    /**
     * Process refund with SSLCOMMERZ refund API.
     */
    public function processRefund(
        Payment $payment,
        float $amount,
        string $reason
    ): PaymentRefundResultDTO {
        $this->ensureConfigured();

        $refundRef = 'REF-' . strtoupper(Str::random(10));
        $bankTranId = $payment->gateway_response_payload['bank_tran_id'] ?? null;

        try {
            $response = Http::timeout($this->timeoutSeconds)
                ->get("{$this->baseUrl}/validator/api/merchantTransIDvalidationAPI.php", [
                    'refund_amount' => number_format($amount, 2, '.', ''),
                    'refund_remarks'=> Str::limit($reason, 100),
                    'bank_tran_id'  => $bankTranId,
                    'refe_id'       => $refundRef,
                    'store_id'      => $this->storeId,
                    'store_passwd'  => $this->storePassword,
                    'format'        => 'json',
                ]);

            $body = $response->json();
            $status = strtoupper((string) ($body['status'] ?? ''));
            $isSuccess = in_array($status, ['SUCCESS', 'PROCESSING', 'VALID'], true);

            return new PaymentRefundResultDTO(
                success: $isSuccess,
                refundReference: $refundRef,
                status: $isSuccess ? 'COMPLETED' : 'REJECTED',
                refundedAmount: $amount,
                currency: $payment->currency,
                gatewayRefundId: $body['refund_ref_id'] ?? null,
                failureReason: $isSuccess ? null : ($body['errorReason'] ?? 'Refund rejected by gateway'),
                rawPayload: DataSanitizer::sanitize($body)
            );
        } catch (Throwable $e) {
            return new PaymentRefundResultDTO(
                success: false,
                refundReference: $refundRef,
                status: 'REJECTED',
                refundedAmount: 0.0,
                currency: $payment->currency,
                failureReason: "Refund exception: {$e->getMessage()}"
            );
        }
    }

    public function checkHealth(): array
    {
        $isConfigured = !empty($this->storeId) && !empty($this->storePassword);

        return [
            'gateway'     => self::GATEWAY_CODE,
            'configured'  => $isConfigured,
            'sandbox'     => $this->isSandbox,
            'base_url'    => $this->baseUrl,
        ];
    }

    protected function ensureConfigured(): void
    {
        if (empty($this->storeId) || empty($this->storePassword)) {
            throw new RuntimeException('SSLCOMMERZ credentials (SSLCOMMERZ_STORE_ID, SSLCOMMERZ_STORE_PASSWORD) are not configured in backend environment secrets.');
        }
    }
}
