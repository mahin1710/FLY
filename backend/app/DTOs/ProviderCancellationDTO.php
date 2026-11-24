<?php

namespace App\DTOs;

class ProviderCancellationDTO
{
    public function __construct(
        public readonly string $providerCode,
        public readonly string $providerBookingRef,
        public readonly bool $isCancelled,
        public readonly ?string $cancellationRef,
        public readonly string $status, // 'CANCELLED', 'VOIDED', 'PENDING_CONFIRMATION'
        public readonly string $cancelledAt,
        public readonly array $penalties = [],
        public readonly ?string $disclaimer = 'Sandbox cancellation'
    ) {}

    public function toArray(): array
    {
        return [
            'provider_code'        => $this->providerCode,
            'provider_booking_ref' => $this->providerBookingRef,
            'is_cancelled'         => $this->isCancelled,
            'cancellation_ref'     => $this->cancellationRef,
            'status'               => $this->status,
            'cancelled_at'         => $this->cancelledAt,
            'penalties'            => $this->penalties,
            'disclaimer'           => $this->disclaimer,
        ];
    }
}
