<?php

namespace App\DTOs;

class ProviderRefundQuoteDTO
{
    public function __construct(
        public readonly string $providerCode,
        public readonly string $providerBookingRef,
        public readonly bool $refundable,
        public readonly float $originalAmount,
        public readonly float $cancellationFee,
        public readonly float $estimatedRefundAmount,
        public readonly string $currency,
        public readonly ?string $quoteRef,
        public readonly string $quotedAt,
        public readonly ?string $disclaimer = 'Estimated sandbox refund calculation – subject to airline tariff validation'
    ) {}

    public function toArray(): array
    {
        return [
            'provider_code'           => $this->providerCode,
            'provider_booking_ref'    => $this->providerBookingRef,
            'refundable'              => $this->refundable,
            'original_amount'         => round($this->originalAmount, 2),
            'cancellation_fee'        => round($this->cancellationFee, 2),
            'estimated_refund_amount' => round($this->estimatedRefundAmount, 2),
            'currency'                => $this->currency,
            'quote_ref'               => $this->quoteRef,
            'quoted_at'               => $this->quotedAt,
            'disclaimer'              => $this->disclaimer,
        ];
    }
}
