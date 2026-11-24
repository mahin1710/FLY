<?php

namespace Tests\Feature;

use App\Models\FlightOffer;
use App\Models\FlightSearch;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class FlightOfferApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    public function test_flight_offer_retrieval_returns_full_offer_structure(): void
    {
        // 1. Perform search to generate live offers
        $searchRes = $this->postJson('/api/v1/flights/search', [
            'origin'         => 'DAC',
            'destination'    => 'CXB',
            'departure_date' => now()->addDays(7)->toDateString(),
            'trip_type'      => 'one_way',
            'cabin_class'    => 'economy',
            'adults'         => 1,
        ]);

        $offerUuid = $searchRes->json('data.offers.0.uuid');
        $this->assertNotNull($offerUuid);

        // 2. Query individual offer by UUID
        $response = $this->getJson("/api/v1/flights/offers/{$offerUuid}");

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.uuid', $offerUuid)
            ->assertJsonPath('data.is_bookable', false)
            ->assertJsonPath('data.disclaimer', 'Demo data – not bookable')
            ->assertJsonStructure([
                'success',
                'data' => [
                    'uuid',
                    'provider_code',
                    'segments',
                    'baggage' => ['cabin_pieces', 'checked_pieces'],
                    'fare_conditions' => ['refundable', 'changeable', 'fare_family'],
                    'price_breakdown' => ['currency', 'base_amount', 'tax_amount', 'total_amount'],
                ],
            ]);
    }

    public function test_flight_offer_retrieval_returns_410_when_offer_expired(): void
    {
        $offer = FlightOffer::first();
        $this->assertNotNull($offer);

        // Set expires_at in the past
        $offer->expires_at = now()->subMinutes(10);
        $offer->save();

        $response = $this->getJson("/api/v1/flights/offers/{$offer->uuid}");

        $response->assertStatus(410)
            ->assertJsonPath('success', false)
            ->assertJsonPath('error_code', 'OFFER_EXPIRED');
    }

    public function test_flight_offer_retrieval_returns_404_when_offer_not_found(): void
    {
        $randomUuid = (string) Str::uuid();

        $response = $this->getJson("/api/v1/flights/offers/{$randomUuid}");

        $response->assertStatus(404)
            ->assertJsonPath('success', false)
            ->assertJsonPath('error_code', 'NOT_FOUND');
    }
}
