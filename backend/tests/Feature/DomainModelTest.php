<?php

namespace Tests\Feature;

use App\Models\Airline;
use App\Models\Airport;
use App\Models\Booking;
use App\Models\BookingPriceSnapshot;
use App\Models\BookingSegment;
use App\Models\FinancialLedgerEntry;
use App\Models\FlightOffer;
use App\Models\Passenger;
use App\Models\PassengerDocument;
use App\Models\Payment;
use App\Models\Ticket;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class DomainModelTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
    }

    /**
     * 1. RELATIONSHIP NAVIGATION TEST
     */
    public function test_booking_relationships_navigate_seamlessly(): void
    {
        $booking = Booking::with([
            'user',
            'priceSnapshot',
            'segments.originAirport',
            'segments.destinationAirport',
            'segments.marketingAirline',
            'passengers.document',
            'passengers.ticket',
            'payments.events',
            'tickets',
            'ancillaries',
            'ledgerEntries',
        ])->first();

        $this->assertNotNull($booking);
        $this->assertInstanceOf(User::class, $booking->user);
        $this->assertInstanceOf(BookingPriceSnapshot::class, $booking->priceSnapshot);
        $this->assertNotEmpty($booking->segments);
        $this->assertInstanceOf(Airport::class, $booking->segments->first()->originAirport);
        $this->assertInstanceOf(Airport::class, $booking->segments->first()->destinationAirport);
        $this->assertInstanceOf(Airline::class, $booking->segments->first()->marketingAirline);
        $this->assertNotEmpty($booking->passengers);
        $this->assertInstanceOf(PassengerDocument::class, $booking->passengers->first()->document);
        $this->assertInstanceOf(Ticket::class, $booking->passengers->first()->ticket);
        $this->assertNotEmpty($booking->payments);
        $this->assertNotEmpty($booking->payments->first()->events);
        $this->assertNotEmpty($booking->ledgerEntries);
    }

    /**
     * 2. UNIQUE CONSTRAINTS ENFORCEMENT TEST
     */
    public function test_airport_iata_code_uniqueness_is_enforced(): void
    {
        $this->expectException(QueryException::class);

        Airport::create([
            'iata_code'    => 'DAC', // Already exists in seeded data
            'name'         => 'Duplicate Dhaka Airport',
            'city'         => 'Dhaka',
            'country_code' => 'BD',
            'timezone'     => 'Asia/Dhaka',
        ]);
    }

    public function test_airline_iata_code_uniqueness_is_enforced(): void
    {
        $this->expectException(QueryException::class);

        Airline::create([
            'iata_code'    => 'BG', // Already exists
            'name'         => 'Duplicate Biman',
            'country_code' => 'BD',
        ]);
    }

    public function test_booking_reference_uniqueness_is_enforced(): void
    {
        $this->expectException(QueryException::class);

        $existing = Booking::first();

        Booking::create([
            'reference'            => $existing->reference, // Duplicate reference
            'user_id'              => $existing->user_id,
            'booking_status'       => 'draft',
            'total_amount'         => 1000.00,
            'contact_email'        => 'dup@example.com',
            'contact_phone'        => '12345678',
            'contact_country_code' => '+880',
        ]);
    }

    public function test_ticket_number_uniqueness_is_enforced(): void
    {
        $this->expectException(QueryException::class);

        $existing = Ticket::first();

        Ticket::create([
            'booking_id'    => $existing->booking_id,
            'passenger_id'  => $existing->passenger_id,
            'ticket_number' => $existing->ticket_number, // Duplicate e-ticket number
            'ticket_status' => 'issued',
            'fare_amount'   => 4500.00,
        ]);
    }

    public function test_payment_idempotency_key_uniqueness_is_enforced(): void
    {
        $this->expectException(QueryException::class);

        $existing = Payment::first();

        Payment::create([
            'booking_id'      => $existing->booking_id,
            'payment_method'  => 'card',
            'amount'          => 4950.00,
            'status'          => 'captured',
            'idempotency_key' => $existing->idempotency_key, // Duplicate idempotency key
        ]);
    }

    /**
     * 3. MONEY PRECISION & CURRENCY TEST
     */
    public function test_money_fields_store_exact_decimals_without_float_distortion(): void
    {
        $snapshot = BookingPriceSnapshot::create([
            'base_fare'         => 3650.75,
            'taxes'             => 649.25,
            'airline_fees'      => 125.50,
            'service_fees'      => 75.33,
            'ancillaries_total' => 450.00,
            'discounts_total'   => 50.00,
            'grand_total'       => 4900.83,
            'currency'          => 'BDT',
            'breakdown_payload' => ['cents' => 83],
        ]);

        $fresh = BookingPriceSnapshot::find($snapshot->id);

        $this->assertSame('3650.75', (string) $fresh->base_fare);
        $this->assertSame('649.25', (string) $fresh->taxes);
        $this->assertSame('4900.83', (string) $fresh->grand_total);
        $this->assertSame('BDT', $fresh->currency);
    }

    /**
     * 4. SENSITIVE FIELD ENCRYPTION & SERIALIZATION HIDING TEST
     */
    public function test_passenger_document_is_encrypted_at_rest_and_hidden_from_json(): void
    {
        $doc = PassengerDocument::first();
        $this->assertNotNull($doc);

        // 1. Transparent decryption when accessed through Eloquent attribute
        $this->assertSame('A09876543', $doc->document_number);

        // 2. Encrypted at rest in database table (raw SQL query must NOT contain plaintext)
        $rawRow = DB::table('passenger_documents')->where('id', $doc->id)->first();
        $this->assertNotEquals('A09876543', $rawRow->document_number);
        $this->assertStringStartsWith('eyJ', $rawRow->document_number, 'Encrypted value must be serialized payload');

        // 3. Serialization hiding: toArray() and toJson() must NEVER contain plaintext document_number
        $array = $doc->toArray();
        $this->assertArrayNotHasKey('document_number', $array);
        $this->assertArrayHasKey('document_number_masked', $array);
        $this->assertSame('A098****', $array['document_number_masked']);

        $json = $doc->toJson();
        $this->assertStringNotContainsString('A09876543', $json);
        $this->assertStringContainsString('A098****', $json);
    }

    public function test_payment_gateway_payload_is_hidden_from_json_serialization(): void
    {
        $payment = Payment::first();
        $this->assertNotNull($payment);

        $json = $payment->toJson();
        $this->assertStringNotContainsString('gateway_response_payload', $json);
    }

    public function test_booking_provider_booking_ref_is_hidden_from_json_serialization(): void
    {
        $booking = Booking::first();
        $this->assertNotNull($booking);

        $json = $booking->toJson();
        $this->assertStringNotContainsString('provider_booking_ref', $json);
    }

    /**
     * 5. UTC INSTANT AND LOCAL TIMEZONE PRESERVATION TEST
     */
    public function test_booking_segment_preserves_both_utc_and_local_timezone_context(): void
    {
        $segment = BookingSegment::first();
        $this->assertNotNull($segment);

        $this->assertNotEmpty($segment->departure_time_utc);
        $this->assertNotEmpty($segment->departure_local_time);
        $this->assertSame('Asia/Dhaka', $segment->departure_timezone);
        $this->assertNotEmpty($segment->arrival_time_utc);
        $this->assertSame('Asia/Dhaka', $segment->arrival_timezone);
    }

    /**
     * 6. IMMUTABILITY RULES: FINANCIAL & AUDIT TABLES DO NOT SOFT DELETE
     */
    public function test_financial_and_audit_tables_are_immutable(): void
    {
        // Payments are immutable financial records
        $payment = Payment::first();
        $paymentClass = get_class($payment);
        $this->assertFalse(
            in_array(\Illuminate\Database\Eloquent\SoftDeletes::class, class_uses($paymentClass), true),
            'Payment model must NOT use SoftDeletes'
        );

        // Financial Ledger Entries are immutable double-entry records
        $entry = FinancialLedgerEntry::first();
        $entryClass = get_class($entry);
        $this->assertFalse(
            in_array(\Illuminate\Database\Eloquent\SoftDeletes::class, class_uses($entryClass), true),
            'FinancialLedgerEntry model must NOT use SoftDeletes'
        );

        // Bookings can be soft deleted for domain recovery
        $booking = Booking::first();
        $bookingClass = get_class($booking);
        $this->assertTrue(
            in_array(\Illuminate\Database\Eloquent\SoftDeletes::class, class_uses($bookingClass), true),
            'Booking model must support SoftDeletes'
        );
    }
}
