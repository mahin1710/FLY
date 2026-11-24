<?php

namespace App\DTOs;

class FareConditionsDTO
{
    public function __construct(
        public readonly bool $refundable,
        public readonly bool $refundableWithFee,
        public readonly bool $changeable,
        public readonly float $cancellationFee,
        public readonly float $changeFee,
        public readonly string $fareFamily,
        public readonly ?string $policyText = null
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            refundable: (bool) ($data['refundable'] ?? false),
            refundableWithFee: (bool) ($data['refundable_with_fee'] ?? false),
            changeable: (bool) ($data['changeable'] ?? true),
            cancellationFee: (float) ($data['cancellation_fee'] ?? 0.0),
            changeFee: (float) ($data['change_fee'] ?? 0.0),
            fareFamily: (string) ($data['fare_family'] ?? 'Standard'),
            policyText: $data['policy_text'] ?? null
        );
    }

    public function toArray(): array
    {
        return [
            'refundable'           => $this->refundable,
            'refundable_with_fee'  => $this->refundableWithFee,
            'changeable'           => $this->changeable,
            'cancellation_fee'     => $this->cancellationFee,
            'change_fee'           => $this->changeFee,
            'fare_family'          => $this->fareFamily,
            'policy_text'          => $this->policyText,
        ];
    }
}
