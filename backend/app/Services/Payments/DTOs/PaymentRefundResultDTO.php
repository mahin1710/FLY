<?php

namespace App\Services\Payments\DTOs;

class PaymentRefundResultDTO
{
    public function __construct(
        public readonly bool $success,
        public readonly string $refundReference,
        public readonly string $status, // 'COMPLETED', 'PENDING', 'REJECTED'
        public readonly float $refundedAmount,
        public readonly string $currency,
        public readonly ?string $gatewayRefundId = null,
        public readonly ?string $failureReason = null,
        public readonly array $rawPayload = []
    ) {}

    public function toArray(): array
    {
        return [
            'success'           => $this->success,
            'refund_reference'  => $this->refundReference,
            'status'            => $this->status,
            'refunded_amount'   => round($this->refundedAmount, 2),
            'currency'          => $this->currency,
            'gateway_refund_id' => $this->gatewayRefundId,
            'failure_reason'    => $this->failureReason,
        ];
    }
}
