<?php

namespace Tests\Unit\Providers;

use App\Services\Providers\Amadeus\AmadeusMapper;
use Tests\TestCase;

class AmadeusContractTest extends TestCase
{
    protected array $searchFixture;
    protected array $orderFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $fixturesDir = __DIR__ . '/../../Fixtures/Amadeus';
        $this->searchFixture = json_decode(
            file_get_contents($fixturesDir . '/flight_offers_search_response.json'),
            true
        );
        $this->orderFixture = json_decode(
            file_get_contents($fixturesDir . '/flight_create_order_response.json'),
            true
        );
    }

    public function test_amadeus_mapper_transforms_raw_offer_to_normalized_dto(): void
    {
        $rawOffer = $this->searchFixture['data'][0];
        $dictionaries = $this->searchFixture['dictionaries'];

        $dto = AmadeusMapper::mapOffer($rawOffer, $dictionaries);

        $this->assertSame('AMADEUS_GDS', $dto->providerCode);
        $this->assertSame('AMD-OFFER-001', $dto->providerOfferRef);
        $this->assertFalse($dto->isBookable); // Non-production safety tag
        $this->assertSame('Amadeus Sandbox offer – non-production simulation', $dto->disclaimer);

        // Price breakdown
        $this->assertSame('BDT', $dto->priceBreakdown->currency);
        $this->assertSame(4500.00, $dto->priceBreakdown->totalAmount);
        $this->assertSame(3800.00, $dto->priceBreakdown->baseAmount);
        $this->assertSame(700.00, $dto->priceBreakdown->taxAmount);

        // Segments
        $this->assertCount(1, $dto->segments);
        $seg = $dto->segments[0];
        $this->assertSame('BG', $seg->carrierCode);
        $this->assertSame('BIMAN BANGLADESH AIRLINES', $seg->carrierName);
        $this->assertSame('BG-433', $seg->flightNumber);
        $this->assertSame('DAC', $seg->origin['code']);
        $this->assertSame('CXB', $seg->destination['code']);
        $this->assertSame(60, $seg->durationMinutes);
        $this->assertSame('Economy', $seg->cabinClass);

        // Baggage
        $this->assertSame(1, $dto->baggage->checkedPieces);
        $this->assertSame(23, $dto->baggage->checkedWeightKg);
    }

    public function test_amadeus_mapper_transforms_raw_order_to_normalized_reservation_dto(): void
    {
        $dto = AmadeusMapper::mapOrder($this->orderFixture);

        $this->assertSame('AMADEUS_GDS', $dto->providerCode);
        $this->assertSame('eJzTd9f3NfcL9AwJ8gsAAnsDBH4=', $dto->providerBookingRef);
        $this->assertSame('ABC123', $dto->pnr);
        $this->assertSame('TICKETING_PENDING', $dto->status);
        $this->assertFalse($dto->isTicketed);
        $this->assertSame('BDT', $dto->currency);
        $this->assertSame(4500.00, $dto->totalPrice);
        $this->assertStringContainsString('requires consolidator / operations queue', $dto->disclaimer);
    }

    public function test_parse_iso_duration_converts_correctly_to_minutes(): void
    {
        $this->assertSame(60, AmadeusMapper::parseIsoDuration('PT1H00M'));
        $this->assertSame(65, AmadeusMapper::parseIsoDuration('PT1H05M'));
        $this->assertSame(45, AmadeusMapper::parseIsoDuration('PT45M'));
        $this->assertSame(315, AmadeusMapper::parseIsoDuration('PT5H15M'));
        $this->assertSame(1440, AmadeusMapper::parseIsoDuration('P1D'));
    }
}
