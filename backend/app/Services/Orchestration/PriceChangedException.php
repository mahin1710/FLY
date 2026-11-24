<?php

namespace App\Services\Orchestration;

use RuntimeException;

class PriceChangedException extends RuntimeException
{
    public function __construct(
        public readonly float $oldAmount,
        public readonly float $newAmount,
        public readonly float $difference,
        public readonly string $currency,
        public readonly string $newSnapshotUlid,
        public readonly ?string $reason = null
    ) {
        parent::__construct(
            "Flight fare changed from {$oldAmount} {$currency} to {$newAmount} {$currency} (difference: {$difference} {$currency}). Explicit customer acceptance required to proceed.",
            409
        );
    }
}
