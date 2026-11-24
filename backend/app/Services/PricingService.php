<?php

namespace App\Services;

use App\DTOs\FlightOfferDTO;
use App\DTOs\RepriceResultDTO;
use App\Models\BookingPriceSnapshot;
use App\Models\FlightOffer;
use App\Models\User;
use App\Services\Providers\FlightProviderInterface;
use Illuminate\Support\Str;
use RuntimeException;

class PricingService
{
    public function __construct(
        protected FlightProviderInterface $provider
    ) {}

    /**
     * Reprice an existing offer, revalidate fare availability, and record an immutable price snapshot.
     */
    public function reprice(string $offerUuid, ?User $user = null): RepriceResultDTO
    {
        $offer = FlightOffer::where('uuid', $offerUuid)->first();
        if (!$offer) {
            throw new RuntimeException('Flight offer not found for repricing.', 404);
        }

        if ($offer->expires_at->isPast()) {
            throw new RuntimeException('The selected flight offer has expired. Repricing is unavailable.', 410);
        }

        $offerDTO = !empty($offer->raw_payload) ? FlightOfferDTO::fromArray($offer->raw_payload) : null;
        $repriceResult = $this->provider->reprice($offer->provider_offer_ref, $offerDTO);

        // Store immutable price snapshot in database
        $snapshotUlid = (string) Str::ulid();
        $taxes = (float) $offer->tax_amount;
        $fees = (float) $offer->fee_amount;
        $base = $repriceResult->newAmount - $taxes - $fees;
        if ($base < 0) {
            $base = $repriceResult->newAmount;
            $taxes = 0;
            $fees = 0;
        }

        BookingPriceSnapshot::create([
            'ulid'              => $snapshotUlid,
            'flight_offer_id'   => $offer->id,
            'currency'          => $repriceResult->currency,
            'base_fare'         => round($base, 2),
            'taxes'             => round($taxes, 2),
            'airline_fees'      => round($fees, 2),
            'service_fees'      => 0,
            'ancillaries_total' => 0,
            'discounts_total'   => 0,
            'grand_total'       => round($repriceResult->newAmount, 2),
            'breakdown_payload' => [
                'currency'          => $repriceResult->currency,
                'base_fare'         => round($base, 2),
                'taxes'             => round($taxes, 2),
                'airline_fees'      => round($fees, 2),
                'total_amount'      => round($repriceResult->newAmount, 2),
                'has_price_changed' => $repriceResult->hasPriceChanged,
                'difference'        => $repriceResult->difference,
                'recalculated_at'   => $repriceResult->recalculatedAt,
            ],
            'created_at'        => now(),
        ]);

        return new RepriceResultDTO(
            offerUuid: $offer->uuid,
            hasPriceChanged: $repriceResult->hasPriceChanged,
            oldAmount: $repriceResult->oldAmount,
            newAmount: $repriceResult->newAmount,
            difference: $repriceResult->difference,
            currency: $repriceResult->currency,
            reason: $repriceResult->reason,
            isGuaranteed: false, // Typed guarantee: demo reprice is not live guarantee
            disclaimer: $repriceResult->disclaimer,
            snapshotUlid: $snapshotUlid,
            recalculatedAt: $repriceResult->recalculatedAt
        );
    }
}
