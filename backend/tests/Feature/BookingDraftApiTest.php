<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\FlightOffer;
use App\Models\IdempotencyRecord;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class BookingDraftApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    public function test_booking_draft_creation_requires_valid_offer_uuid(): void
    {
        $response = $this->postJson('/api/v1/bookings/draft', [
            'contact_email' => 'customer@example.com',
            'contact_phone' => '+8801700000000',
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['offer_uuid']);
    }

    public function test_booking_draft_resolves_price_from_offer_not_client(): void
    {
        $searchRes = $this->postJson('/api/v1/flights/search', [
            'origin'         => 'DAC',
            'destination'    => 'CXB',
            'departure_date' => now()->addDays(7)->toDateString(),
            'trip_type'      => 'one_way',
            'cabin_class'    => 'economy',
            'adults'         => 1,
        ]);

        $offer = $searchRes->json('data.offers.0');
        $offerUuid = $offer['uuid'];
        $actualOfferAmount = (float) $offer['price_breakdown']['total_amount'];

        // Attempt malicious client request trying to override price to 1.00 BDT
        $response = $this->postJson('/api/v1/bookings/draft', [
            'offer_uuid'           => $offerUuid,
            'contact_email'        => 'traveller@example.com',
            'contact_phone'        => '+8801711223344',
            'contact_country_code' => '+880',
            'total_amount'         => 1.00, // Client tries to spoof price!
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.booking_status', 'held')
            ->assertJsonPath('data.payment_status', 'unpaid');

        // Price in database MUST match the original server-side offer, not the malicious client amount
        $createdBookingUlid = $response->json('data.ulid');
        $bookingInDb = Booking::where('ulid', $createdBookingUlid)->first();
        $this->assertNotNull($bookingInDb);
        $this->assertEquals($actualOfferAmount, (float) $bookingInDb->total_amount);
    }

    public function test_booking_draft_creates_15_minute_inventory_hold(): void
    {
        $offer = FlightOffer::first();

        $response = $this->postJson('/api/v1/bookings/draft', [
            'offer_uuid'    => $offer->uuid,
            'contact_email' => 'tester@example.com',
            'contact_phone' => '+8801811223344',
        ]);

        $response->assertStatus(201);
        $holdExpiresAt = $response->json('data.hold_expires_at');
        $this->assertNotNull($holdExpiresAt);

        // Verify hold is approximately 15 minutes into the future
        $expiryTimestamp = strtotime($holdExpiresAt);
        $diffMinutes = round(($expiryTimestamp - time()) / 60);
        $this->assertGreaterThanOrEqual(14, $diffMinutes);
        $this->assertLessThanOrEqual(16, $diffMinutes);
    }

    public function test_booking_draft_creation_is_idempotent_with_header(): void
    {
        $offer = FlightOffer::first();
        $idempotencyKey = 'IDEMPOTENT-TEST-' . Str::random(12);

        $payload = [
            'offer_uuid'    => $offer->uuid,
            'contact_email' => 'idempotent@example.com',
            'contact_phone' => '+8801911223344',
        ];

        // First call
        $firstResponse = $this->withHeader('Idempotency-Key', $idempotencyKey)
            ->postJson('/api/v1/bookings/draft', $payload);

        $firstResponse->assertStatus(201);
        $firstUlid = $firstResponse->json('data.ulid');

        // Second call with same idempotency key
        $secondResponse = $this->withHeader('Idempotency-Key', $idempotencyKey)
            ->postJson('/api/v1/bookings/draft', $payload);

        $secondResponse->assertStatus(201);
        $secondUlid = $secondResponse->json('data.ulid');

        // Both calls must return identical booking ULID
        $this->assertSame($firstUlid, $secondUlid);
        $this->assertDatabaseCount('idempotency_records', 1);
    }

    public function test_booking_draft_creation_fails_if_offer_expired(): void
    {
        $offer = FlightOffer::first();
        $offer->expires_at = now()->subMinute();
        $offer->save();

        $response = $this->postJson('/api/v1/bookings/draft', [
            'offer_uuid'    => $offer->uuid,
            'contact_email' => 'tester@example.com',
            'contact_phone' => '+8801811223344',
        ]);

        $response->assertStatus(410)
            ->assertJsonPath('success', false)
            ->assertJsonPath('error_code', 'OFFER_EXPIRED');
    }
}
