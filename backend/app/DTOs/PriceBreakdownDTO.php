<?php

namespace App\DTOs;

class PriceBreakdownDTO
{
    public function __construct(
        public readonly string $currency,
        public readonly float $baseAmount,
        public readonly float $taxAmount,
        public readonly float $feeAmount,
        public readonly float $totalAmount
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            currency: (string) ($data['currency'] ?? 'BDT'),
            baseAmount: (float) ($data['base_amount'] ?? 0.0),
            taxAmount: (float) ($data['tax_amount'] ?? 0.0),
            feeAmount: (float) ($data['fee_amount'] ?? 0.0),
            totalAmount: (float) ($data['total_amount'] ?? 0.0)
        );
    }

    public function toArray(): array
    {
        return [
            'currency'     => $this->currency,
            'base_amount'  => round($this->baseAmount, 2),
            'tax_amount'   => round($this->taxAmount, 2),
            'fee_amount'   => round($this->feeAmount, 2),
            'total_amount' => round($this->totalAmount, 2),
        ];
    }
}
