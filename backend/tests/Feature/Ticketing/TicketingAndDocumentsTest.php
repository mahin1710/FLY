<?php

namespace Tests\Feature\Ticketing;

use App\Jobs\SendCustomerNotificationJob;
use App\Models\Booking;
use App\Models\BookingPriceSnapshot;
use App\Models\BookingSegment;
use App\Models\Notification;
use App\Models\Passenger;
use App\Models\Ticket;
use App\Models\User;
use App\Services\Documents\DocumentService;
use App\Services\Notifications\NotificationService;
use App\Services\Orchestration\OperationsQueueService;
use App\Services\Providers\FlightProviderInterface;
use App\Services\Providers\MockFlightProvider;
use App\Services\StateMachine\BookingStateMachine;
use App\Services\Ticketing\TicketingService;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TicketingAndDocumentsTest extends TestCase
{
    use RefreshDatabase;

    protected Booking $booking;
    protected User $customer;
    protected User $admin;
    protected TicketingService $ticketingService;
    protected DocumentService $documentService;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);

        $this->customer = User::where('role', 'customer')->first();
        $this->admin = User::where('role', 'admin')->first();

        $snapshot = BookingPriceSnapshot::first();

        $this->booking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'BK-TICKET-TEST-001',
            'user_id'                   => $this->customer->id,
            'booking_price_snapshot_id' => $snapshot->id,
            'booking_status'            => 'confirmed',
            'payment_status'            => 'captured',
            'ticket_status'             => 'queued_for_issuance',
            'servicing_status'          => 'none',
            'hold_expires_at'           => now()->addMinutes(15),
            'currency'                  => 'BDT',
            'total_amount'              => 9700.00,
            'contact_email'             => 'customer@fly.com',
            'contact_phone'             => '1711223344',
            'contact_country_code'      => '+880',
            'provider_booking_reference'=> 'MCK778',
        ]);

        $this->ticketingService = app(TicketingService::class);
        $this->documentService = app(DocumentService::class);
    }

    public function test_ticketing_succeeds_for_multiple_passengers_with_distinct_pnr_and_masked_numbers(): void
    {
        $p1 = Passenger::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $this->booking->id,
            'type'          => 'adult',
            'title'         => 'Mr',
            'first_name'    => 'Mahin',
            'last_name'     => 'Rahman',
            'date_of_birth' => '1995-05-15',
        ]);

        $p2 = Passenger::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $this->booking->id,
            'type'          => 'adult',
            'title'         => 'Mrs',
            'first_name'    => 'Sara',
            'last_name'     => 'Rahman',
            'date_of_birth' => '1998-08-20',
        ]);

        $result = $this->ticketingService->issueTickets($this->booking);

        $this->assertEquals('ISSUED', $result['status']);
        $this->assertEquals('MCK778', $result['pnr']);
        $this->assertNotEmpty($result['download_url']);

        $tickets = Ticket::where('booking_id', $this->booking->id)->get();
        $this->assertCount(2, $tickets);

        foreach ($tickets as $ticket) {
            $this->assertEquals('issued', $ticket->ticket_status);
            $this->assertEquals('MCK778', $ticket->pnr_reference); // Distinct PNR locator
            $this->assertStringStartsWith('098-', $ticket->ticket_number); // E-ticket number distinct from PNR
            $this->assertNotEquals($ticket->pnr_reference, $ticket->ticket_number);
            $this->assertNotNull($ticket->masked_ticket_number);
            $this->assertStringContainsString('***', $ticket->masked_ticket_number);
        }

        // Booking ticket status transitioned to ticketed
        $this->booking->refresh();
        $this->assertEquals('ticketed', $this->booking->ticket_status);
    }

    public function test_ticketing_with_multiple_segments_assigns_tickets_per_passenger_and_segment(): void
    {
        $passenger = Passenger::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $this->booking->id,
            'type'          => 'adult',
            'title'         => 'Mr',
            'first_name'    => 'Tanvir',
            'last_name'     => 'Ahmed',
            'date_of_birth' => '1990-01-01',
        ]);

        $airline = \App\Models\Airline::first();
        $dac = \App\Models\Airport::where('iata_code', 'DAC')->first() ?? \App\Models\Airport::first();
        $cxb = \App\Models\Airport::where('iata_code', 'CXB')->first() ?? \App\Models\Airport::skip(1)->first();

        $seg1 = BookingSegment::create([
            'ulid'                   => (string) Str::ulid(),
            'booking_id'             => $this->booking->id,
            'segment_order'          => 1,
            'marketing_airline_id'   => $airline->id,
            'operating_airline_id'   => $airline->id,
            'origin_airport_id'      => $dac->id,
            'destination_airport_id' => $cxb->id,
            'flight_number'          => '0601',
            'departure_time_utc'     => now()->addDays(2),
            'departure_local_time'   => now()->addDays(2)->format('Y-m-d H:i:s'),
            'departure_timezone'     => 'Asia/Dhaka',
            'arrival_time_utc'       => now()->addDays(2)->addHour(),
            'arrival_local_time'     => now()->addDays(2)->addHour()->format('Y-m-d H:i:s'),
            'arrival_timezone'       => 'Asia/Dhaka',
            'cabin_class'            => 'economy',
        ]);

        $seg2 = BookingSegment::create([
            'ulid'                   => (string) Str::ulid(),
            'booking_id'             => $this->booking->id,
            'segment_order'          => 2,
            'marketing_airline_id'   => $airline->id,
            'operating_airline_id'   => $airline->id,
            'origin_airport_id'      => $cxb->id,
            'destination_airport_id' => $dac->id,
            'flight_number'          => '0602',
            'departure_time_utc'     => now()->addDays(5),
            'departure_local_time'   => now()->addDays(5)->format('Y-m-d H:i:s'),
            'departure_timezone'     => 'Asia/Dhaka',
            'arrival_time_utc'       => now()->addDays(5)->addHour(),
            'arrival_local_time'     => now()->addDays(5)->addHour()->format('Y-m-d H:i:s'),
            'arrival_timezone'       => 'Asia/Dhaka',
            'cabin_class'            => 'economy',
        ]);

        $result = $this->ticketingService->issueTickets($this->booking);

        $this->assertEquals('ISSUED', $result['status']);
        $tickets = Ticket::where('booking_id', $this->booking->id)->get();
        $this->assertCount(2, $tickets);

        $this->assertTrue($tickets->contains('booking_segment_id', $seg1->id));
        $this->assertTrue($tickets->contains('booking_segment_id', $seg2->id));
    }

    public function test_missing_ticket_number_or_consolidator_pending_routes_to_operations_queue_and_does_not_issue(): void
    {
        Passenger::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $this->booking->id,
            'type'          => 'adult',
            'title'         => 'Mr',
            'first_name'    => 'Kamrul',
            'last_name'     => 'Hasan',
            'date_of_birth' => '1992-03-10',
        ]);

        $result = $this->ticketingService->issueTickets($this->booking, [
            'simulation_mode' => 'TICKETING_PENDING',
        ]);

        $this->assertEquals('TICKETING_PENDING_CONSOLIDATOR', $result['status']);

        // Strict Rule: Ticket status must NOT become issued without supplier ticket number!
        $this->booking->refresh();
        $this->assertEquals('queued_for_issuance', $this->booking->ticket_status);

        // Checked operations queue routing
        $this->assertDatabaseHas('bookings', [
            'id'                   => $this->booking->id,
            'manual_review_reason' => 'NEAR_DEADLINE_TICKETING',
        ]);
        $this->assertDatabaseHas('servicing_requests', [
            'booking_id'   => $this->booking->id,
            'request_type' => 'manual_operations_queue',
            'status'       => 'pending_review',
        ]);
    }

    public function test_partial_ticket_issue_routes_to_manual_operations_queue_and_keeps_booking_queued(): void
    {
        $p1 = Passenger::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $this->booking->id,
            'type'          => 'adult',
            'title'         => 'Mr',
            'first_name'    => 'First',
            'last_name'     => 'Passenger',
            'date_of_birth' => '1985-02-02',
        ]);

        $p2 = Passenger::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $this->booking->id,
            'type'          => 'adult',
            'title'         => 'Mr',
            'first_name'    => 'Second',
            'last_name'     => 'Passenger',
            'date_of_birth' => '1988-04-04',
        ]);

        $result = $this->ticketingService->issueTickets($this->booking, [
            'simulation_mode' => 'PARTIAL',
        ]);

        $this->assertEquals('PARTIAL_TICKETING', $result['status']);
        $this->assertEquals(1, $result['issued_count']);
        $this->assertEquals(1, $result['pending_count']);

        // Booking remains in queued_for_issuance due to partial issue
        $this->booking->refresh();
        $this->assertEquals('queued_for_issuance', $this->booking->ticket_status);

        // Operations queue receives alert
        $this->assertDatabaseHas('bookings', [
            'id'                   => $this->booking->id,
            'manual_review_reason' => 'PARTIAL_TICKET_ISSUE_DETECTED',
        ]);
        $this->assertDatabaseHas('servicing_requests', [
            'booking_id'   => $this->booking->id,
            'request_type' => 'manual_operations_queue',
            'status'       => 'pending_review',
        ]);
    }

    public function test_timeout_retrieves_reservation_before_retry_and_does_not_blindly_issue_twice(): void
    {
        Passenger::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $this->booking->id,
            'type'          => 'adult',
            'title'         => 'Mr',
            'first_name'    => 'Timeout',
            'last_name'     => 'Tester',
            'date_of_birth' => '1991-01-01',
        ]);

        // When supplier times out, retrieve reservation confirms whether tickets were issued
        $result = $this->ticketingService->issueTickets($this->booking, [
            'simulation_mode' => 'TIMEOUT',
        ]);

        // It caught the timeout, ran getReservation, and since reservation was not yet ticketed in mock, routed to manual review without blind retry
        $this->assertEquals('TIMEOUT_PENDING_MANUAL_REVIEW', $result['status']);

        $this->booking->refresh();
        $this->assertEquals('queued_for_issuance', $this->booking->ticket_status);

        $this->assertDatabaseHas('bookings', [
            'id'                   => $this->booking->id,
            'manual_review_reason' => 'TICKETING_TIMEOUT_UNRESOLVED',
        ]);
        $this->assertDatabaseHas('servicing_requests', [
            'booking_id'   => $this->booking->id,
            'request_type' => 'manual_operations_queue',
            'status'       => 'pending_review',
        ]);
    }

    public function test_notification_failure_does_not_undo_ticket_issuance_and_records_delivery_log(): void
    {
        $p = Passenger::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $this->booking->id,
            'type'          => 'adult',
            'title'         => 'Mr',
            'first_name'    => 'Resilient',
            'last_name'     => 'Traveller',
            'date_of_birth' => '1993-07-07',
        ]);

        $ticket = Ticket::create([
            'ulid'                 => (string) Str::ulid(),
            'booking_id'           => $this->booking->id,
            'passenger_id'         => $p->id,
            'ticket_number'        => '098-9998887776',
            'masked_ticket_number' => '098-******7776',
            'pnr_reference'        => 'MCK778',
            'ticket_status'        => 'issued',
            'fare_amount'          => 4850.00,
            'currency'             => 'BDT',
            'issued_at'            => now(),
        ]);

        $this->booking->update(['ticket_status' => 'ticketed']);

        // Execute notification job with failure simulation injected
        $job = new SendCustomerNotificationJob(
            $this->booking->id,
            'ETICKET_ISSUED',
            'email',
            'traveller@fly.com',
            ['simulate_failure' => true, 'download_url' => 'http://localhost/test-download']
        );

        $job->handle();

        // 1. Delivery log recorded failure
        $log = Notification::where('booking_id', $this->booking->id)->first();
        $this->assertNotNull($log);
        $this->assertEquals('failed', $log->status);
        $this->assertEquals(1, $log->retry_count);
        $this->assertStringContainsString('Simulated upstream gateway delivery failure', $log->failure_reason);

        // 2. Ticket issuance is NOT undone!
        $this->booking->refresh();
        $this->assertEquals('ticketed', $this->booking->ticket_status);
        $ticket->refresh();
        $this->assertEquals('issued', $ticket->ticket_status);
    }

    public function test_customer_confirmation_pdf_generation_and_secure_download(): void
    {
        Passenger::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $this->booking->id,
            'type'          => 'adult',
            'title'         => 'Mr',
            'first_name'    => 'PDF',
            'last_name'     => 'Passenger',
            'date_of_birth' => '1990-10-10',
        ]);

        $airline = \App\Models\Airline::first();
        $dac = \App\Models\Airport::where('iata_code', 'DAC')->first() ?? \App\Models\Airport::first();
        $cxb = \App\Models\Airport::where('iata_code', 'CXB')->first() ?? \App\Models\Airport::skip(1)->first();

        BookingSegment::create([
            'ulid'                   => (string) Str::ulid(),
            'booking_id'             => $this->booking->id,
            'segment_order'          => 1,
            'marketing_airline_id'   => $airline->id,
            'operating_airline_id'   => $airline->id,
            'origin_airport_id'      => $dac->id,
            'destination_airport_id' => $cxb->id,
            'flight_number'          => '0601',
            'departure_time_utc'     => now()->addDays(3),
            'departure_local_time'   => now()->addDays(3)->format('Y-m-d H:i:s'),
            'departure_timezone'     => 'Asia/Dhaka',
            'arrival_time_utc'       => now()->addDays(3)->addHour(),
            'arrival_local_time'     => now()->addDays(3)->addHour()->format('Y-m-d H:i:s'),
            'arrival_timezone'       => 'Asia/Dhaka',
            'cabin_class'            => 'economy',
        ]);

        // Generate PDF
        $relPath = $this->documentService->generateCustomerItineraryPdf($this->booking);
        $this->assertTrue(Storage::disk('local')->exists($relPath));

        $pdfBytes = Storage::disk('local')->get($relPath);
        $this->assertStringStartsWith('%PDF-', $pdfBytes);

        // Unsigned request returns 403 Forbidden
        $unsignedResponse = $this->get("/api/v1/bookings/{$this->booking->ulid}/document");
        $unsignedResponse->assertStatus(403);

        // Temporary signed URL returns 200 with PDF content
        $signedUrl = $this->documentService->getSecureDownloadUrl($this->booking);
        $signedResponse = $this->get($signedUrl);
        $signedResponse->assertStatus(200)
            ->assertHeader('Content-Type', 'application/pdf');
    }

    public function test_get_booking_tickets_endpoint_returns_distinct_pnr_and_masked_numbers(): void
    {
        $p = Passenger::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $this->booking->id,
            'type'          => 'adult',
            'title'         => 'Mr',
            'first_name'    => 'Endpoint',
            'last_name'     => 'Verifier',
            'date_of_birth' => '1995-05-05',
        ]);

        Ticket::create([
            'ulid'                 => (string) Str::ulid(),
            'booking_id'           => $this->booking->id,
            'passenger_id'         => $p->id,
            'ticket_number'        => '098-1234567899',
            'masked_ticket_number' => '098-******7899',
            'pnr_reference'        => 'MCK778',
            'ticket_status'        => 'issued',
            'fare_amount'          => 4850.00,
            'currency'             => 'BDT',
            'issued_at'            => now(),
        ]);

        Sanctum::actingAs($this->customer);

        $response = $this->getJson("/api/v1/bookings/{$this->booking->ulid}/tickets");

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.pnr', 'MCK778')
            ->assertJsonPath('data.tickets.0.pnr_reference', 'MCK778')
            ->assertJsonPath('data.tickets.0.ticket_number', '098-1234567899')
            ->assertJsonPath('data.tickets.0.masked_ticket_number', '098-******7899')
            ->assertJsonPath('data.tickets.0.ticket_status', 'issued');
    }
}
