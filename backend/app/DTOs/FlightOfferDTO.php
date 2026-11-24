<?php

namespace App\DTOs;

class FlightOfferDTO
{
    /**
     * @param FlightSegmentDTO[] $segments
     */
    public function __construct(
        public readonly string $uuid,
        public readonly string $providerCode,
        public readonly string $providerOfferRef,
        public readonly array $segments,
        public readonly BaggageAllowanceDTO $baggage,
        public readonly FareConditionsDTO $fareConditions,
        public readonly PriceBreakdownDTO $priceBreakdown,
        public readonly array $supportedExtras,
        public readonly bool $isRefundable,
        public readonly bool $isBookable,
        public readonly string $expiresAt,
        public readonly string $disclaimer = 'Demo data – not bookable'
    ) {}

    public static function fromArray(array $data): self
    {
        $segments = array_map(function ($seg) {
            return $seg instanceof FlightSegmentDTO ? $seg : FlightSegmentDTO::fromArray($seg);
        }, $data['segments'] ?? []);

        $baggage = ($data['baggage'] ?? null) instanceof BaggageAllowanceDTO
            ? $data['baggage']
            : BaggageAllowanceDTO::fromArray($data['baggage'] ?? []);

        $fareConditions = ($data['fare_conditions'] ?? null) instanceof FareConditionsDTO
            ? $data['fare_conditions']
            : FareConditionsDTO::fromArray($data['fare_conditions'] ?? []);

        $priceBreakdown = ($data['price_breakdown'] ?? null) instanceof PriceBreakdownDTO
            ? $data['price_breakdown']
            : PriceBreakdownDTO::fromArray($data['price_breakdown'] ?? []);

        return new self(
            uuid: (string) ($data['uuid'] ?? ''),
            providerCode: (string) ($data['provider_code'] ?? 'MOCK_GDS'),
            providerOfferRef: (string) ($data['provider_offer_ref'] ?? ''),
            segments: $segments,
            baggage: $baggage,
            fareConditions: $fareConditions,
            priceBreakdown: $priceBreakdown,
            supportedExtras: (array) ($data['supported_extras'] ?? [
                'seats' => false,
                'baggage' => false,
                'meals' => false,
            ]),
            isRefundable: (bool) ($data['is_refundable'] ?? false),
            isBookable: (bool) ($data['is_bookable'] ?? false),
            expiresAt: (string) ($data['expires_at'] ?? ''),
            disclaimer: (string) ($data['disclaimer'] ?? 'Demo data – not bookable')
        );
    }

    public function toArray(): array
    {
        return [
            'uuid'               => $this->uuid,
            'provider_code'      => $this->providerCode,
            'provider_offer_ref' => $this->providerOfferRef,
            'segments'           => array_map(fn (FlightSegmentDTO $s) => $s->toArray(), $this->segments),
            'baggage'            => $this->baggage->toArray(),
            'fare_conditions'    => $this->fareConditions->toArray(),
            'price_breakdown'    => $this->priceBreakdown->toArray(),
            'supported_extras'   => $this->supportedExtras,
            'is_refundable'      => $this->isRefundable,
            'is_bookable'        => $this->isBookable,
            'expires_at'         => $this->expiresAt,
            'disclaimer'         => $this->disclaimer,
        ];
    }
}
