<?php

namespace App\Services\Payments\DTOs;

class PaymentSessionDTO
{
    public function __construct(
        public readonly string $gatewayCode,
        public readonly string $gatewayTransactionId,
        public readonly ?string $sessionKey,
        public readonly string $redirectUrl,
        public readonly string $currency,
        public readonly float $amount,
        public readonly ?string $expiresAt = null,
        public readonly array $metadata = []
    ) {}

    public function toArray(): array
    {
        return [
            'gateway_code'           => $this->gatewayCode,
            'gateway_transaction_id' => $this->gatewayTransactionId,
            'session_key'            => $this->sessionKey,
            'redirect_url'           => $this->redirectUrl,
            'currency'               => $this->currency,
            'amount'                 => round($this->amount, 2),
            'expires_at'             => $this->expiresAt,
            'metadata'               => $this->metadata,
        ];
    }
}
