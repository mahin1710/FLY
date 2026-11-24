<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\FlightOffer;
use App\Models\Passenger;
use App\Models\PassengerDocument;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PassengerApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    protected function createDraftBooking(): Booking
    {
        $offer = FlightOffer::first();
        $res = $this->postJson('/api/v1/bookings/draft', [
            'offer_uuid'    => $offer->uuid,
            'contact_email' => 'passengers@example.com',
            'contact_phone' => '+8801700000000',
        ]);

        return Booking::where('ulid', $res->json('data.ulid'))->firstOrFail();
    }

    public function test_add_passengers_validates_adult_age_requirement(): void
    {
        $booking = $this->createDraftBooking();

        // 8 year old marked as adult must fail validation
        $response = $this->postJson("/api/v1/bookings/{$booking->ulid}/passengers", [
            'passengers' => [
                [
                    'type'          => 'adult',
                    'title'         => 'Mr',
                    'first_name'    => 'TooYoung',
                    'last_name'     => 'Adult',
                    'date_of_birth' => now()->subYears(8)->toDateString(),
                ],
            ],
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('success', false)
            ->assertJsonPath('error_code', 'VALIDATION_ERROR');
    }

    public function test_add_passengers_validates_child_age_bracket(): void
    {
        $booking = $this->createDraftBooking();

        // 14 year old marked as child must fail
        $response = $this->postJson("/api/v1/bookings/{$booking->ulid}/passengers", [
            'passengers' => [
                [
                    'type'          => 'child',
                    'title'         => 'Master',
                    'first_name'    => 'TooOld',
                    'last_name'     => 'Child',
                    'date_of_birth' => now()->subYears(14)->toDateString(),
                ],
            ],
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('error_code', 'VALIDATION_ERROR');
    }

    public function test_add_passengers_validates_infant_age_and_adult_ratio(): void
    {
        $booking = $this->createDraftBooking();

        // 1 adult with 2 infants must fail ratio rule
        $response = $this->postJson("/api/v1/bookings/{$booking->ulid}/passengers", [
            'passengers' => [
                [
                    'type'          => 'adult',
                    'title'         => 'Mr',
                    'first_name'    => 'Single',
                    'last_name'     => 'Adult',
                    'date_of_birth' => '1990-01-01',
                ],
                [
                    'type'          => 'infant',
                    'title'         => 'Miss',
                    'first_name'    => 'Infant',
                    'last_name'     => 'One',
                    'date_of_birth' => now()->subMonths(6)->toDateString(),
                ],
                [
                    'type'          => 'infant',
                    'title'         => 'Master',
                    'first_name'    => 'Infant',
                    'last_name'     => 'Two',
                    'date_of_birth' => now()->subMonths(8)->toDateString(),
                ],
            ],
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('error_code', 'VALIDATION_ERROR');
    }

    public function test_sensitive_passport_number_is_encrypted_and_concealed_from_json(): void
    {
        $booking = $this->createDraftBooking();
        $rawPassport = 'BD99887766';

        $response = $this->postJson("/api/v1/bookings/{$booking->ulid}/passengers", [
            'passengers' => [
                [
                    'type'          => 'adult',
                    'title'         => 'Mr',
                    'first_name'    => 'Mahin',
                    'last_name'     => 'Rahman',
                    'date_of_birth' => '1995-05-15',
                    'nationality'   => 'BD',
                    'document'      => [
                        'document_type'   => 'passport',
                        'document_number' => $rawPassport,
                        'issuing_country' => 'BD',
                        'expiry_date'     => now()->addYears(5)->toDateString(),
                    ],
                ],
            ],
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('success', true);

        // Verify JSON output does NOT leak plaintext document_number
        $this->assertArrayNotHasKey('document_number', $response->json('data.0.document'));
        $this->assertSame('BD****66', $response->json('data.0.document.document_number_masked'));

        // Verify database storage
        $pax = $booking->fresh()->passengers()->first();
        $this->assertNotNull($pax);
        $doc = $pax->document;
        $this->assertNotNull($doc);
        // Eloquent decrypts on model property access:
        $this->assertSame($rawPassport, $doc->document_number);

        // Raw DB column must NOT be plaintext
        $rawDbValue = \DB::table('passenger_documents')->where('id', $doc->id)->value('document_number');
        $this->assertNotSame($rawPassport, $rawDbValue);
    }

    public function test_get_booking_status_returns_decoupled_lifecycle_dimensions(): void
    {
        $booking = $this->createDraftBooking();

        $response = $this->getJson("/api/v1/bookings/{$booking->ulid}/status");

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.booking_status', 'held')
            ->assertJsonPath('data.payment_status', 'unpaid')
            ->assertJsonPath('data.ticket_status', 'unissued')
            ->assertJsonPath('data.servicing_status', 'none')
            ->assertJsonStructure([
                'success',
                'data' => [
                    'ulid',
                    'reference',
                    'booking_status',
                    'payment_status',
                    'ticket_status',
                    'servicing_status',
                    'hold_expires_at',
                    'currency',
                    'total_amount',
                    'contact',
                    'segments',
                    'passengers',
                ],
            ]);
    }

    public function test_idor_protection_prevents_unauthorized_user_from_accessing_booking_status(): void
    {
        $owner = User::where('role', 'customer')->first();
        $stranger = User::create([
            'name'     => 'Stranger',
            'email'    => 'stranger@example.com',
            'password' => bcrypt('Password123!'),
            'role'     => 'customer',
            'status'   => 'active',
        ]);

        $booking = $this->createDraftBooking();
        $booking->user_id = $owner->id;
        $booking->save();

        // Stranger attempts to view owner's booking status
        $response = $this->actingAs($stranger, 'sanctum')
            ->getJson("/api/v1/bookings/{$booking->ulid}/status");

        $response->assertStatus(403)
            ->assertJsonPath('success', false)
            ->assertJsonPath('error_code', 'FORBIDDEN');
    }
}
