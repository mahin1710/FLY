<?php

namespace App\DTOs;

class BaggageAllowanceDTO
{
    public function __construct(
        public readonly int $cabinPieces = 1,
        public readonly int $cabinWeightKg = 7,
        public readonly int $checkedPieces = 1,
        public readonly int $checkedWeightKg = 20
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            cabinPieces: (int) ($data['cabin_pieces'] ?? 1),
            cabinWeightKg: (int) ($data['cabin_weight_kg'] ?? 7),
            checkedPieces: (int) ($data['checked_pieces'] ?? 1),
            checkedWeightKg: (int) ($data['checked_weight_kg'] ?? 20)
        );
    }

    public function toArray(): array
    {
        return [
            'cabin_pieces'       => $this->cabinPieces,
            'cabin_weight_kg'    => $this->cabinWeightKg,
            'checked_pieces'     => $this->checkedPieces,
            'checked_weight_kg'  => $this->checkedWeightKg,
        ];
    }
}
