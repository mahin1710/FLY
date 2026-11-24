<?php

namespace Tests\Feature;

use App\Services\Providers\MockFlightProvider;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

class FlightSearchApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    public function test_flight_search_validates_required_fields(): void
    {
        $response = $this->postJson('/api/v1/flights/search', []);

        $response->assertStatus(422)
            ->assertJsonPath('success', false)
            ->assertJsonPath('error_code', 'VALIDATION_ERROR')
            ->assertJsonValidationErrors(['origin', 'destination', 'departure_date', 'trip_type', 'cabin_class', 'adults']);
    }

    public function test_flight_search_validates_infant_to_adult_ratio(): void
    {
        $response = $this->postJson('/api/v1/flights/search', [
            'origin'         => 'DAC',
            'destination'    => 'CXB',
            'departure_date' => now()->addDays(5)->toDateString(),
            'trip_type'      => 'one_way',
            'cabin_class'    => 'economy',
            'adults'         => 1,
            'children'       => 0,
            'infants'        => 2, // 2 infants with 1 adult is forbidden
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['infants']);
    }

    public function test_flight_search_validates_different_origin_and_destination(): void
    {
        $response = $this->postJson('/api/v1/flights/search', [
            'origin'         => 'DAC',
            'destination'    => 'DAC', // Identical
            'departure_date' => now()->addDays(5)->toDateString(),
            'trip_type'      => 'one_way',
            'cabin_class'    => 'economy',
            'adults'         => 1,
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['destination']);
    }

    public function test_flight_search_returns_offers_with_demo_disclaimer_and_request_id(): void
    {
        $response = $this->postJson('/api/v1/flights/search', [
            'origin'         => 'DAC',
            'destination'    => 'CXB',
            'departure_date' => now()->addDays(5)->toDateString(),
            'trip_type'      => 'one_way',
            'cabin_class'    => 'economy',
            'adults'         => 1,
            'children'       => 0,
            'infants'        => 0,
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonStructure([
                'success',
                'message',
                'data' => [
                    'request_id',
                    'trip_type',
                    'cabin_class',
                    'passenger_counts',
                    'offers_count',
                    'offers' => [
                        '*' => [
                            'uuid',
                            'provider_code',
                            'provider_offer_ref',
                            'segments',
                            'baggage',
                            'fare_conditions',
                            'price_breakdown' => ['currency', 'total_amount'],
                            'is_bookable',
                            'disclaimer',
                        ],
                    ],
                    'expires_at',
                ],
                'meta' => ['correlation_id', 'timestamp'],
            ]);

        $offers = $response->json('data.offers');
        $this->assertNotEmpty($offers);
        // Guarantee typed constraint
        $this->assertFalse($offers[0]['is_bookable']);
        $this->assertSame('Demo data – not bookable', $offers[0]['disclaimer']);
    }

    public function test_mock_flight_provider_throws_exception_in_production_environment(): void
    {
        // Simulate production environment
        $this->app->detectEnvironment(fn () => 'production');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('MockFlightProvider must never run in production.');

        new MockFlightProvider();
    }
}
