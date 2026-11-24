<?php

namespace Tests\Feature\Servicing;

use App\Models\Airline;
use App\Models\Airport;
use App\Models\Booking;
use App\Models\BookingPriceSnapshot;
use App\Models\BookingSegment;
use App\Models\Passenger;
use App\Models\Payment;
use App\Models\Refund;
use App\Models\ServicingRequest;
use App\Models\Ticket;
use App\Models\User;
use App\Services\Security\GuestSessionService;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CustomerServicingTest extends TestCase
{
    use RefreshDatabase;

    protected Booking $booking;
    protected User $customer;
    protected User $otherCustomer;
    protected User $admin;
    protected GuestSessionService $guestService;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);

        $this->customer = User::where('role', 'customer')->first();
        $this->otherCustomer = User::create([
            'name'     => 'Other Customer',
            'email'    => 'other@fly.com',
            'password' => bcrypt('Password123!'),
            'role'     => 'customer',
            'status'   => 'active',
        ]);
        $this->admin = User::where('role', 'admin')->first();

        $snapshot = BookingPriceSnapshot::first();

        $this->booking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-SERV-001',
            'user_id'                   => $this->customer->id,
            'booking_price_snapshot_id' => $snapshot->id,
            'booking_status'            => 'confirmed',
            'payment_status'            => 'captured',
            'ticket_status'             => 'ticketed',
            'servicing_status'          => 'none',
            'hold_expires_at'           => now()->addMinutes(15),
            'currency'                  => 'BDT',
            'total_amount'              => 4850.00,
            'contact_email'             => 'customer@fly.com',
            'contact_phone'             => '1711223344',
            'contact_country_code'      => '+880',
            'provider_booking_reference'=> 'MCK778',
        ]);

        $p = Passenger::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $this->booking->id,
            'type'          => 'adult',
            'title'         => 'Mr',
            'first_name'    => 'Mahin',
            'last_name'     => 'Rahman',
            'date_of_birth' => '1995-05-15',
        ]);

        Ticket::create([
            'ulid'                 => (string) Str::ulid(),
            'booking_id'           => $this->booking->id,
            'passenger_id'         => $p->id,
            'ticket_number'        => '098-1122334455',
            'masked_ticket_number' => '098-******4455',
            'pnr_reference'        => 'MCK778',
            'ticket_status'        => 'issued',
            'fare_amount'          => 4850.00,
            'currency'             => 'BDT',
            'issued_at'            => now(),
        ]);

        Payment::create([
            'ulid'                   => (string) Str::ulid(),
            'booking_id'             => $this->booking->id,
            'user_id'                => $this->booking->user_id,
            'payment_method'         => 'hosted_checkout',
            'gateway_provider'       => 'SIMULATED',
            'gateway_transaction_id' => 'TXN-SERV-001',
            'currency'               => 'BDT',
            'amount'                 => 4850.00,
            'status'                 => 'captured',
            'captured_at'            => now(),
        ]);

        $this->guestService = app(GuestSessionService::class);
    }

    public function test_authenticated_customer_can_retrieve_booking_list_with_routes_and_status(): void
    {
        Sanctum::actingAs($this->customer);

        $response = $this->getJson('/api/v1/bookings');

        $response->assertStatus(200)
            ->assertJsonPath('success', true);

        $this->assertTrue(collect($response->json('data'))->contains('reference', 'BK-SERV-001'));
    }

    public function test_guest_retrieval_with_secondary_verification_succeeds_and_issues_token(): void
    {
        // Reference + matching passenger last name
        $response = $this->postJson('/api/v1/bookings/guest-retrieve', [
            'reference' => 'BK-SERV-001',
            'last_name' => 'Rahman',
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.reference', 'BK-SERV-001')
            ->assertJsonStructure(['data' => ['guest_token', 'expires_at', 'booking_ulid', 'reference']]);
    }

    public function test_guest_retrieval_with_invalid_credentials_returns_generic_error_preventing_enumeration(): void
    {
        // Non-existent booking reference
        $response1 = $this->postJson('/api/v1/bookings/guest-retrieve', [
            'reference' => 'BK-DOES-NOT-EXIST-999',
            'last_name' => 'Rahman',
        ]);

        $response1->assertStatus(422)
            ->assertJsonPath('error_code', 'INVALID_VERIFICATION')
            ->assertJsonPath('message', 'Booking reference or passenger verification details could not be validated.');

        // Real booking reference but wrong last name
        $response2 = $this->postJson('/api/v1/bookings/guest-retrieve', [
            'reference' => 'BK-SERV-001',
            'last_name' => 'WrongSurname',
        ]);

        // Responses must be completely identical to avoid enumeration
        $response2->assertStatus(422)
            ->assertJsonPath('error_code', 'INVALID_VERIFICATION')
            ->assertJsonPath('message', 'Booking reference or passenger verification details could not be validated.');
    }

    public function test_unauthorized_booking_access_is_rejected_with_403(): void
    {
        // Other customer attempts to access booking they do not own
        Sanctum::actingAs($this->otherCustomer);

        $response = $this->getJson("/api/v1/bookings/{$this->booking->ulid}");

        $response->assertStatus(403)
            ->assertJsonPath('error_code', 'UNAUTHORIZED_ACCESS');
    }

    public function test_expired_guest_retrieval_token_is_rejected(): void
    {
        // Construct an expired guest token manually
        $expiredPayload = [
            'booking_ulid' => $this->booking->ulid,
            'expires_at'   => now()->subMinutes(10)->timestamp,
            'issued_at'    => now()->subMinutes(40)->timestamp,
            'nonce'        => Str::random(16),
        ];

        $tokenStr = base64_encode(json_encode($expiredPayload));
        $secret = (string) config('app.key');
        $signature = hash_hmac('sha256', $tokenStr, $secret);
        $expiredToken = "{$tokenStr}.{$signature}";

        $response = $this->withHeaders(['X-Guest-Token' => $expiredToken])
            ->getJson("/api/v1/bookings/{$this->booking->ulid}");

        $response->assertStatus(401)
            ->assertJsonPath('error_code', 'UNAUTHORIZED_ACCESS')
            ->assertJsonPath('message', 'Guest authorization session has expired. Please verify booking again.');
    }

    public function test_booking_detail_timeline_contains_reservation_payment_ticketing_and_cancellation(): void
    {
        Sanctum::actingAs($this->customer);

        $response = $this->getJson("/api/v1/bookings/{$this->booking->ulid}");

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.timeline.reservation.status', 'confirmed')
            ->assertJsonPath('data.timeline.payment.status', 'captured')
            ->assertJsonPath('data.timeline.ticketing.status', 'ticketed')
            ->assertJsonPath('data.timeline.ticketing.has_verified_ticket', true);
    }

    public function test_download_ticket_only_allowed_when_verified_ticket_exists(): void
    {
        // 1. Booking has verified ticket: download succeeds
        Sanctum::actingAs($this->customer);
        $resSuccess = $this->get("/api/v1/bookings/{$this->booking->ulid}/document");
        $resSuccess->assertStatus(200)
            ->assertHeader('Content-Type', 'application/pdf');

        // 2. Unticketed booking: download fails with 422
        $unticketedBooking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-UNTICKETED-01',
            'user_id'                   => $this->customer->id,
            'booking_status'            => 'held',
            'payment_status'            => 'unpaid',
            'ticket_status'             => 'unissued',
            'servicing_status'          => 'none',
            'currency'                  => 'BDT',
            'total_amount'              => 4850.00,
            'contact_email'             => 'customer@fly.com',
            'contact_phone'             => '1711223344',
            'contact_country_code'      => '+880',
        ]);

        $resFailed = $this->get("/api/v1/bookings/{$unticketedBooking->ulid}/document");
        $resFailed->assertStatus(422)
            ->assertJsonPath('error_code', 'TICKET_NOT_ISSUED');
    }

    public function test_non_refundable_fare_refund_quote_returns_zero_net_amount(): void
    {
        // Create booking tagged as NONREF
        $nonRefBooking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-NONREF-001',
            'user_id'                   => $this->customer->id,
            'booking_status'            => 'confirmed',
            'payment_status'            => 'captured',
            'ticket_status'             => 'ticketed',
            'servicing_status'          => 'none',
            'currency'                  => 'BDT',
            'total_amount'              => 4850.00,
            'contact_email'             => 'customer@fly.com',
            'contact_phone'             => '1711223344',
            'contact_country_code'      => '+880',
            'provider_booking_reference'=> 'NONREF_MCK999',
        ]);

        Sanctum::actingAs($this->customer);

        $response = $this->postJson("/api/v1/bookings/{$nonRefBooking->ulid}/servicing/refund-quote");

        $response->assertStatus(200)
            ->assertJsonPath('data.refundable', false)
            ->assertJsonPath('data.net_refund_amount', 0)
            ->assertJsonPath('data.airline_penalty_fee', 4850);
    }

    public function test_partial_itinerary_request_calculates_proportional_refund_quote(): void
    {
        // Add second passenger
        $p2 = Passenger::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $this->booking->id,
            'type'          => 'adult',
            'title'         => 'Mrs',
            'first_name'    => 'Sara',
            'last_name'     => 'Rahman',
            'date_of_birth' => '1998-08-20',
        ]);

        Sanctum::actingAs($this->customer);

        // Request refund quote for 1 out of 2 passengers (50% partial)
        $response = $this->postJson("/api/v1/bookings/{$this->booking->ulid}/servicing/refund-quote", [
            'affected_passenger_ids' => [$p2->id],
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('data.is_partial', true)
            ->assertJsonPath('data.original_amount', 2425) // 50% of 4850.00
            ->assertJsonPath('data.airline_penalty_fee', 500); // 50% of 1000.00
    }

    public function test_supplier_rejection_halts_refund_and_does_not_execute_gateway_refund(): void
    {
        // Booking with PNR triggering supplier rejection
        $rejectBooking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-REJECT-001',
            'user_id'                   => $this->customer->id,
            'booking_status'            => 'confirmed',
            'payment_status'            => 'captured',
            'ticket_status'             => 'ticketed',
            'servicing_status'          => 'cancellation_requested',
            'currency'                  => 'BDT',
            'total_amount'              => 4850.00,
            'contact_email'             => 'customer@fly.com',
            'contact_phone'             => '1711223344',
            'contact_country_code'      => '+880',
            'provider_booking_reference'=> 'REJECT_MCK000',
        ]);

        Payment::create([
            'ulid'                   => (string) Str::ulid(),
            'booking_id'             => $rejectBooking->id,
            'user_id'                => $this->customer->id,
            'payment_method'         => 'hosted_checkout',
            'gateway_provider'       => 'SIMULATED',
            'gateway_transaction_id' => 'TXN-REJECT-001',
            'currency'               => 'BDT',
            'amount'                 => 4850.00,
            'status'                 => 'captured',
        ]);

        Sanctum::actingAs($this->customer);

        $response = $this->postJson("/api/v1/bookings/{$rejectBooking->ulid}/servicing/refund-approve", [
            'customer_approved'    => true,
            'quote_ref'            => 'QUOTE-REJECT-123',
            'net_refund_amount'    => 3600.00,
            'servicing_capability' => 'online_supplier',
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('error_code', 'SUPPLIER_REJECTED');

        $rejectBooking->refresh();
        $this->assertEquals('refund_rejected', $rejectBooking->servicing_status);
        $this->assertEquals('confirmed', $rejectBooking->booking_status); // Not cancelled!
        $this->assertDatabaseMissing('refunds', ['booking_id' => $rejectBooking->id]);
    }

    public function test_pending_refund_for_manual_consolidator_servicing_does_not_mark_completed(): void
    {
        Sanctum::actingAs($this->customer);

        $response = $this->postJson("/api/v1/bookings/{$this->booking->ulid}/servicing/refund-approve", [
            'customer_approved'    => true,
            'quote_ref'            => 'QUOTE-CONSOLIDATOR-999',
            'net_refund_amount'    => 3600.00,
            'servicing_capability' => 'manual_consolidator',
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('data.status', 'PENDING_CONSOLIDATOR_SETTLEMENT');

        $this->booking->refresh();
        $this->assertEquals('refund_approved', $this->booking->servicing_status);

        // Strict Check: No false completed status! Refund is in status 'approved' (pending settlement)
        $this->assertDatabaseHas('refunds', [
            'booking_id' => $this->booking->id,
            'status'     => 'approved',
        ]);
        $this->assertDatabaseMissing('refunds', [
            'booking_id' => $this->booking->id,
            'status'     => 'completed',
        ]);
    }

    public function test_completed_refund_for_online_supplier_reconciles_and_marks_completed(): void
    {
        Sanctum::actingAs($this->customer);

        $response = $this->postJson("/api/v1/bookings/{$this->booking->ulid}/servicing/refund-approve", [
            'customer_approved'    => true,
            'quote_ref'            => 'QUOTE-ONLINE-777',
            'net_refund_amount'    => 3600.00,
            'servicing_capability' => 'online_supplier',
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('data.status', 'COMPLETED');

        $this->booking->refresh();
        $this->assertEquals('cancelled', $this->booking->booking_status);
        $this->assertEquals('partially_refunded', $this->booking->payment_status); // 3600 of 4850 is partial
        $this->assertEquals('closed', $this->booking->servicing_status);

        $this->assertDatabaseHas('refunds', [
            'booking_id' => $this->booking->id,
            'status'     => 'completed',
        ]);
    }

    public function test_servicing_request_creation_generates_support_case_number(): void
    {
        Sanctum::actingAs($this->customer);

        $response = $this->postJson("/api/v1/bookings/{$this->booking->ulid}/servicing/request", [
            'request_type'     => 'cancellation',
            'customer_remarks' => 'Voluntary trip cancellation due to personal emergency.',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('success', true)
            ->assertJsonStructure(['data' => ['case_number', 'request_type', 'status', 'disclaimer']]);

        $caseNumber = $response->json('data.case_number');
        $this->assertStringStartsWith('CASE-', $caseNumber);

        $this->assertDatabaseHas('servicing_requests', [
            'booking_id'   => $this->booking->id,
            'case_number'  => $caseNumber,
            'request_type' => 'cancellation',
        ]);
    }
}
