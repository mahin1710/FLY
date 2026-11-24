<?php

namespace App\DTOs;

class RepriceResultDTO
{
    public function __construct(
        public readonly string $offerUuid,
        public readonly bool $hasPriceChanged,
        public readonly float $oldAmount,
        public readonly float $newAmount,
        public readonly float $difference,
        public readonly string $currency,
        public readonly ?string $reason,
        public readonly bool $isGuaranteed,
        public readonly string $disclaimer,
        public readonly ?string $snapshotUlid,
        public readonly string $recalculatedAt
    ) {}

    public function toArray(): array
    {
        return [
            'offer_uuid'        => $this->offerUuid,
            'has_price_changed' => $this->hasPriceChanged,
            'old_amount'        => round($this->oldAmount, 2),
            'new_amount'        => round($this->newAmount, 2),
            'difference'        => round($this->difference, 2),
            'currency'          => $this->currency,
            'reason'            => $this->reason,
            'is_guaranteed'     => $this->isGuaranteed,
            'disclaimer'        => $this->disclaimer,
            'snapshot_ulid'     => $this->snapshotUlid,
            'recalculated_at'   => $this->recalculatedAt,
        ];
    }
}
