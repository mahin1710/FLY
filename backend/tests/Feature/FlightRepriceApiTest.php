<?php

namespace Tests\Feature;

use App\Models\BookingPriceSnapshot;
use App\Models\FlightOffer;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FlightRepriceApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    public function test_flight_reprice_returns_verified_price_with_snapshot(): void
    {
        $searchRes = $this->postJson('/api/v1/flights/search', [
            'origin'         => 'DAC',
            'destination'    => 'CXB',
            'departure_date' => now()->addDays(7)->toDateString(),
            'trip_type'      => 'one_way',
            'cabin_class'    => 'economy',
            'adults'         => 1,
        ]);

        $offerUuid = $searchRes->json('data.offers.0.uuid');

        $response = $this->postJson("/api/v1/flights/offers/{$offerUuid}/reprice");

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.offer_uuid', $offerUuid)
            ->assertJsonPath('data.is_guaranteed', false)
            ->assertJsonStructure([
                'success',
                'data' => [
                    'offer_uuid',
                    'has_price_changed',
                    'old_amount',
                    'new_amount',
                    'difference',
                    'currency',
                    'is_guaranteed',
                    'disclaimer',
                    'snapshot_ulid',
                    'recalculated_at',
                ],
            ]);

        $snapshotUlid = $response->json('data.snapshot_ulid');
        $this->assertNotNull($snapshotUlid);
        $this->assertDatabaseHas('booking_price_snapshots', [
            'ulid' => $snapshotUlid,
        ]);
    }

    public function test_flight_reprice_returns_410_when_offer_expired(): void
    {
        $offer = FlightOffer::first();
        $offer->expires_at = now()->subHour();
        $offer->save();

        $response = $this->postJson("/api/v1/flights/offers/{$offer->uuid}/reprice");

        $response->assertStatus(410)
            ->assertJsonPath('success', false)
            ->assertJsonPath('error_code', 'OFFER_EXPIRED');
    }
}
