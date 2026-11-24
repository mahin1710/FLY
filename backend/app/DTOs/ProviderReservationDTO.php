<?php

namespace App\DTOs;

class ProviderReservationDTO
{
    public function __construct(
        public readonly string $providerCode,
        public readonly string $providerBookingRef,
        public readonly string $pnr,
        public readonly string $status, // 'CONFIRMED', 'HELD', 'TICKETING_PENDING', 'CANCELLED'
        public readonly ?string $ticketingRequiredBy,
        public readonly bool $isTicketed,
        public readonly string $rawProviderStatus,
        public readonly string $currency,
        public readonly float $totalPrice,
        public readonly array $passengers,
        public readonly array $segments,
        public readonly array $warnings = [],
        public readonly ?string $disclaimer = 'Sandbox reservation – not a valid live airline PNR'
    ) {}

    public function toArray(): array
    {
        return [
            'provider_code'         => $this->providerCode,
            'provider_booking_ref'  => $this->providerBookingRef,
            'pnr'                   => $this->pnr,
            'status'                => $this->status,
            'ticketing_required_by' => $this->ticketingRequiredBy,
            'is_ticketed'           => $this->isTicketed,
            'raw_provider_status'   => $this->rawProviderStatus,
            'currency'              => $this->currency,
            'total_price'           => round($this->totalPrice, 2),
            'passengers'            => $this->passengers,
            'segments'              => $this->segments,
            'warnings'              => $this->warnings,
            'disclaimer'            => $this->disclaimer,
        ];
    }
}
