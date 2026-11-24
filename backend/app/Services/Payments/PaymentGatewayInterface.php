<?php

namespace App\Services\Payments;

use App\Models\Booking;
use App\Models\Payment;
use App\Services\Payments\DTOs\PaymentRefundResultDTO;
use App\Services\Payments\DTOs\PaymentSessionDTO;
use App\Services\Payments\DTOs\PaymentVerificationDTO;

interface PaymentGatewayInterface
{
    /**
     * Identifying gateway code (e.g. SSLCOMMERZ, SIMULATED, BKASH).
     */
    public function getGatewayCode(): string;

    /**
     * Initiate a secure hosted checkout session.
     * Price is calculated strictly on the backend from verified booking rules;
     * browser-submitted amounts are completely ignored.
     *
     * @param Booking $booking Verified booking record
     * @param string $transactionId Unique merchant transaction ID (e.g. TXN-YYYYMMDD-XXXXXX)
     * @param array $options Optional metadata / return URL configurations
     */
    public function initiatePayment(
        Booking $booking,
        string $transactionId,
        array $options = []
    ): PaymentSessionDTO;

    /**
     * Verify server-side IPN/webhook payload:
     * - Validates signature / hash authenticity
     * - Queries the gateway's server-to-server transaction validation API
     * - Checks amount, currency, and transaction ID
     */
    public function validateCallback(array $payload): PaymentVerificationDTO;

    /**
     * Query gateway transaction status for background reconciliation.
     */
    public function queryTransaction(string $transactionId): PaymentVerificationDTO;

    /**
     * Execute a refund operation with the gateway.
     */
    public function processRefund(
        Payment $payment,
        float $amount,
        string $reason
    ): PaymentRefundResultDTO;

    /**
     * Check gateway operational health and configuration status.
     */
    public function checkHealth(): array;
}
