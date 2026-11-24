<?php

namespace App\Services\Payments\DTOs;

class PaymentVerificationDTO
{
    public function __construct(
        public readonly bool $isVerified,
        public readonly string $status, // 'CAPTURED', 'FAILED', 'CANCELLED', 'PENDING'
        public readonly string $gatewayTransactionId,
        public readonly ?string $bankTransactionId,
        public readonly float $amount,
        public readonly string $currency,
        public readonly ?string $cardBrand = null,
        public readonly ?string $cardLastFour = null,
        public readonly ?string $validationId = null,
        public readonly ?string $failureReason = null,
        public readonly array $rawPayload = []
    ) {}

    public function toArray(): array
    {
        return [
            'is_verified'            => $this->isVerified,
            'status'                 => $this->status,
            'gateway_transaction_id' => $this->gatewayTransactionId,
            'bank_transaction_id'    => $this->bankTransactionId,
            'amount'                 => round($this->amount, 2),
            'currency'               => $this->currency,
            'card_brand'             => $this->cardBrand,
            'card_last_four'         => $this->cardLastFour,
            'validation_id'          => $this->validationId,
            'failure_reason'         => $this->failureReason,
        ];
    }
}
