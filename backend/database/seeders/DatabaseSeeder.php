<?php

namespace Database\Seeders;

use App\Models\Airline;
use App\Models\Airport;
use App\Models\AncillaryItem;
use App\Models\Booking;
use App\Models\BookingPriceSnapshot;
use App\Models\BookingSegment;
use App\Models\FinancialLedgerEntry;
use App\Models\FlightOffer;
use App\Models\FlightSearch;
use App\Models\Passenger;
use App\Models\PassengerDocument;
use App\Models\Payment;
use App\Models\PaymentEvent;
use App\Models\Permission;
use App\Models\Promotion;
use App\Models\Role;
use App\Models\Ticket;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database with synthetic demo data.
     */
    public function run(): void
    {
        // ---------------------------------------------------------
        // 1. ROLES & PERMISSIONS
        // ---------------------------------------------------------
        $roleCustomer = Role::firstOrCreate(['name' => 'customer'], [
            'display_name' => 'Retail Customer',
            'description'  => 'Standard passenger account for searching, booking, and managing flights.',
        ]);

        $roleAdmin = Role::firstOrCreate(['name' => 'admin'], [
            'display_name' => 'Operations Administrator',
            'description'  => 'Airline staff and operational support with booking management rights.',
        ]);

        $roleSuperAdmin = Role::firstOrCreate(['name' => 'super_admin'], [
            'display_name' => 'Super Administrator',
            'description'  => 'Full platform authority, system settings, and audit oversight.',
        ]);

        $permViewBookings = Permission::firstOrCreate(['name' => 'view_bookings'], [
            'display_name' => 'View Bookings',
            'category'     => 'reservations',
        ]);

        $permManageFlights = Permission::firstOrCreate(['name' => 'manage_flights'], [
            'display_name' => 'Manage Flights',
            'category'     => 'inventory',
        ]);

        $permProcessRefunds = Permission::firstOrCreate(['name' => 'process_refunds'], [
            'display_name' => 'Process Refunds',
            'category'     => 'finance',
        ]);

        $roleAdmin->permissions()->syncWithoutDetaching([$permViewBookings->id, $permManageFlights->id]);
        $roleSuperAdmin->permissions()->syncWithoutDetaching([$permViewBookings->id, $permManageFlights->id, $permProcessRefunds->id]);

        // ---------------------------------------------------------
        // 2. SYNTHETIC USERS
        // ---------------------------------------------------------
        $customer = User::firstOrCreate(['email' => 'customer@flyaviation.com'], [
            'name'     => 'Mahin Rahman',
            'password' => Hash::make('Customer123!'),
            'role'     => 'customer',
            'status'   => 'active',
            'phone'    => '+8801700000000',
        ]);
        $customer->roles()->syncWithoutDetaching([$roleCustomer->id]);

        $admin = User::firstOrCreate(['email' => 'admin.biman@flyaviation.com'], [
            'name'     => 'Biman Admin',
            'password' => Hash::make('AdminBiman123!'),
            'role'     => 'admin',
            'status'   => 'active',
            'phone'    => '+8801800000000',
        ]);
        $admin->roles()->syncWithoutDetaching([$roleAdmin->id]);

        $superAdmin = User::firstOrCreate(['email' => 'admin@flyaviation.com'], [
            'name'     => 'Platform Super Admin',
            'password' => Hash::make('SuperSecret123!'),
            'role'     => 'super_admin',
            'status'   => 'active',
            'phone'    => '+8801900000000',
        ]);
        $superAdmin->roles()->syncWithoutDetaching([$roleSuperAdmin->id]);

        // ---------------------------------------------------------
        // 3. AIRPORTS (BANGLADESH & REGIONAL GATEWAYS)
        // ---------------------------------------------------------
        $dac = Airport::firstOrCreate(['iata_code' => 'DAC'], [
            'ulid'         => (string) Str::ulid(),
            'icao_code'    => 'VGHS',
            'name'         => 'Hazrat Shahjalal International Airport',
            'city'         => 'Dhaka',
            'country_code' => 'BD',
            'timezone'     => 'Asia/Dhaka',
            'latitude'     => 23.8433000,
            'longitude'    => 90.3978000,
            'is_active'    => true,
        ]);

        $cxb = Airport::firstOrCreate(['iata_code' => 'CXB'], [
            'ulid'         => (string) Str::ulid(),
            'icao_code'    => 'VGCB',
            'name'         => "Cox's Bazar Airport",
            'city'         => "Cox's Bazar",
            'country_code' => 'BD',
            'timezone'     => 'Asia/Dhaka',
            'latitude'     => 21.4522000,
            'longitude'    => 91.9639000,
            'is_active'    => true,
        ]);

        $cgp = Airport::firstOrCreate(['iata_code' => 'CGP'], [
            'ulid'         => (string) Str::ulid(),
            'icao_code'    => 'VGEG',
            'name'         => 'Shah Amanat International Airport',
            'city'         => 'Chittagong',
            'country_code' => 'BD',
            'timezone'     => 'Asia/Dhaka',
            'latitude'     => 22.2496000,
            'longitude'    => 91.8133000,
            'is_active'    => true,
        ]);

        $dxb = Airport::firstOrCreate(['iata_code' => 'DXB'], [
            'ulid'         => (string) Str::ulid(),
            'icao_code'    => 'OMDB',
            'name'         => 'Dubai International Airport',
            'city'         => 'Dubai',
            'country_code' => 'AE',
            'timezone'     => 'Asia/Dubai',
            'latitude'     => 25.2528000,
            'longitude'    => 55.3644000,
            'is_active'    => true,
        ]);

        // ---------------------------------------------------------
        // 4. AIRLINES
        // ---------------------------------------------------------
        $biman = Airline::firstOrCreate(['iata_code' => 'BG'], [
            'ulid'         => (string) Str::ulid(),
            'icao_code'    => 'BBC',
            'name'         => 'Biman Bangladesh Airlines',
            'logo_symbol'  => '✈️',
            'country_code' => 'BD',
            'is_active'    => true,
        ]);

        $usBangla = Airline::firstOrCreate(['iata_code' => 'BS'], [
            'ulid'         => (string) Str::ulid(),
            'icao_code'    => 'UBG',
            'name'         => 'US-Bangla Airlines',
            'logo_symbol'  => '🛫',
            'country_code' => 'BD',
            'is_active'    => true,
        ]);

        $airAstra = Airline::firstOrCreate(['iata_code' => '2A'], [
            'ulid'         => (string) Str::ulid(),
            'icao_code'    => 'AWA',
            'name'         => 'Air Astra',
            'logo_symbol'  => '✨',
            'country_code' => 'BD',
            'is_active'    => true,
        ]);

        $emirates = Airline::firstOrCreate(['iata_code' => 'EK'], [
            'ulid'         => (string) Str::ulid(),
            'icao_code'    => 'UAE',
            'name'         => 'Emirates',
            'logo_symbol'  => '🔴',
            'country_code' => 'AE',
            'is_active'    => true,
        ]);

        // ---------------------------------------------------------
        // 5. SYNTHETIC FLIGHT SEARCH & OFFER FIXTURE
        // ---------------------------------------------------------
        $search = FlightSearch::create([
            'uuid'           => (string) Str::uuid(),
            'user_id'        => $customer->id,
            'trip_type'      => 'one_way',
            'cabin_class'    => 'economy',
            'adults_count'   => 1,
            'children_count' => 0,
            'infants_count'  => 0,
            'search_params'  => [
                'from' => 'DAC',
                'to'   => 'CXB',
                'date' => now()->addDays(3)->toDateString(),
            ],
            'ip_address'     => '127.0.0.1',
        ]);

        $offer = FlightOffer::create([
            'uuid'               => (string) Str::uuid(),
            'flight_search_id'   => $search->id,
            'provider_code'      => 'DEMO_FIXTURE',
            'provider_offer_ref' => 'DEMO-DAC-CXB-BG433',
            'fare_family'        => 'Economy Flex',
            'is_refundable'      => true,
            'is_bookable'        => false,
            'currency'           => 'BDT',
            'base_amount'        => 3600.00,
            'tax_amount'         => 650.00,
            'fee_amount'         => 250.00,
            'total_amount'       => 4500.00,
            'stops_count'        => 0,
            'duration_minutes'   => 55,
            'expires_at'         => now()->addMinutes(20),
            'raw_payload'        => ['disclaimer' => 'Synthetic demo offer'],
        ]);

        $priceSnapshot = BookingPriceSnapshot::create([
            'ulid'              => (string) Str::ulid(),
            'flight_offer_id'   => $offer->id,
            'currency'          => 'BDT',
            'base_fare'         => 3600.00,
            'taxes'             => 650.00,
            'airline_fees'      => 250.00,
            'service_fees'      => 0.00,
            'ancillaries_total' => 450.00, // Travel Insurance
            'discounts_total'   => 0.00,
            'grand_total'       => 4950.00,
            'breakdown_payload' => [
                'insurance' => 450.00,
                'seat_hold' => 0.00,
            ],
        ]);

        // ---------------------------------------------------------
        // 6. SYNTHETIC BOOKING & SEGMENTS (DAC -> CXB)
        // ---------------------------------------------------------
        $booking = Booking::create([
            'ulid'                      => (string) Str::ulid(),
            'reference'                 => 'FLY-2026-DEMO01',
            'user_id'                   => $customer->id,
            'booking_price_snapshot_id' => $priceSnapshot->id,
            'booking_status'            => 'confirmed',
            'payment_status'            => 'captured',
            'ticket_status'             => 'ticketed',
            'servicing_status'          => 'none',
            'hold_expires_at'           => now()->addMinutes(15),
            'currency'                  => 'BDT',
            'total_amount'              => 4950.00,
            'contact_email'             => 'passenger@example.com',
            'contact_phone'             => '1700000000',
            'contact_country_code'      => '+880',
            'airline_pnr'               => 'BG7788',
            'provider_booking_ref'      => 'PROV-DEMO-REQ-7788',
            'remarks'                   => 'Synthetic demo booking verification',
        ]);

        $segment = BookingSegment::create([
            'ulid'                   => (string) Str::ulid(),
            'booking_id'             => $booking->id,
            'segment_order'          => 1,
            'marketing_airline_id'   => $biman->id,
            'operating_airline_id'   => $biman->id,
            'flight_number'          => 'BG-433',
            'aircraft_type'          => 'Boeing 737-800',
            'origin_airport_id'      => $dac->id,
            'destination_airport_id' => $cxb->id,
            'departure_time_utc'     => now()->addDays(3)->setTime(4, 30), // 10:30 AM local (+6)
            'departure_local_time'   => now()->addDays(3)->format('Y-m-d') . ' 10:30:00',
            'departure_timezone'     => 'Asia/Dhaka',
            'arrival_time_utc'       => now()->addDays(3)->setTime(5, 25), // 11:25 AM local
            'arrival_local_time'     => now()->addDays(3)->format('Y-m-d') . ' 11:25:00',
            'arrival_timezone'       => 'Asia/Dhaka',
            'departure_terminal'     => 'Terminal 1',
            'arrival_terminal'       => 'Main Terminal',
            'duration_minutes'       => 55,
            'layover_minutes'        => 0,
            'cabin_class'            => 'Economy',
            'booking_class'          => 'Y',
            'status'                 => 'confirmed',
        ]);

        // ---------------------------------------------------------
        // 7. PASSENGERS & ENCRYPTED TRAVEL DOCUMENTS
        // ---------------------------------------------------------
        $passenger = Passenger::create([
            'ulid'                => (string) Str::ulid(),
            'booking_id'          => $booking->id,
            'type'                => 'adult',
            'title'               => 'MR',
            'first_name'          => 'Mahin',
            'last_name'           => 'Rahman',
            'date_of_birth'       => '1998-05-15',
            'gender'              => 'MALE',
            'nationality'         => 'BD',
            'wheelchair_required' => false,
        ]);

        PassengerDocument::create([
            'ulid'                   => (string) Str::ulid(),
            'passenger_id'           => $passenger->id,
            'document_type'          => 'passport',
            'document_number'        => 'A09876543', // Encrypted at rest via Eloquent encrypted cast
            'document_number_masked' => 'A098****',
            'issuing_country'        => 'BD',
            'expiry_date'            => '2030-05-15',
            'date_of_birth'          => '1998-05-15',
        ]);

        // ---------------------------------------------------------
        // 8. TICKETS & ANCILLARY ITEMS
        // ---------------------------------------------------------
        Ticket::create([
            'ulid'                    => (string) Str::ulid(),
            'booking_id'              => $booking->id,
            'passenger_id'            => $passenger->id,
            'ticket_number'           => '098-2490182741', // 13-digit IATA format
            'pnr_reference'           => 'BG7788',
            'ticket_status'           => 'issued',
            'issuing_carrier_id'      => $biman->id,
            'currency'                => 'BDT',
            'fare_amount'             => 4500.00,
            'issued_at'               => now(),
            'validating_airline_code' => 'BG',
            'digital_coupon_data'     => ['status' => 'OPEN_FOR_USE', 'seat' => '12A'],
        ]);

        AncillaryItem::create([
            'ulid'               => (string) Str::ulid(),
            'booking_id'         => $booking->id,
            'passenger_id'       => $passenger->id,
            'booking_segment_id' => $segment->id,
            'type'               => 'seat',
            'item_code'          => 'SEAT-12A',
            'name'               => 'Seat 12A (Window)',
            'currency'           => 'BDT',
            'unit_price'         => 0.00,
            'quantity'           => 1,
            'total_price'        => 0.00,
            'status'             => 'confirmed',
            'details'            => ['row' => 12, 'column' => 'A', 'preference' => 'window'],
        ]);

        AncillaryItem::create([
            'ulid'               => (string) Str::ulid(),
            'booking_id'         => $booking->id,
            'passenger_id'       => $passenger->id,
            'booking_segment_id' => $segment->id,
            'type'               => 'insurance',
            'item_code'          => 'INS-STD',
            'name'               => 'Travel Protection Insurance',
            'currency'           => 'BDT',
            'unit_price'         => 450.00,
            'quantity'           => 1,
            'total_price'        => 450.00,
            'status'             => 'confirmed',
            'details'            => ['coverage' => 'Baggage, Medical, Delay > 2h'],
        ]);

        // ---------------------------------------------------------
        // 9. FINANCIAL LEDGER, PAYMENT & EVENTS
        // ---------------------------------------------------------
        $payment = Payment::create([
            'ulid'                     => (string) Str::ulid(),
            'booking_id'               => $booking->id,
            'user_id'                  => $customer->id,
            'payment_method'           => 'card',
            'gateway_provider'         => 'simulated',
            'gateway_transaction_id'   => 'TXN-SIM-' . strtoupper(Str::random(10)),
            'currency'                 => 'BDT',
            'amount'                   => 4950.00,
            'status'                   => 'captured',
            'card_last_four'           => '4111',
            'card_brand'               => 'Visa',
            'idempotency_key'          => (string) Str::uuid(),
            'gateway_response_payload' => ['auth_code' => 'AUTH123', 'simulated' => true],
            'authorized_at'            => now()->subMinute(),
            'captured_at'              => now(),
        ]);

        PaymentEvent::create([
            'payment_id'  => $payment->id,
            'event_type'  => 'funds_captured',
            'status_from' => 'authorized',
            'status_to'   => 'captured',
            'payload'     => ['amount' => 4950.00, 'currency' => 'BDT'],
            'recorded_at' => now(),
            'created_at'  => now(),
        ]);

        FinancialLedgerEntry::create([
            'ulid'          => (string) Str::ulid(),
            'booking_id'    => $booking->id,
            'payment_id'    => $payment->id,
            'entry_type'    => 'customer_charge',
            'debit_amount'  => 4950.00,
            'credit_amount' => 0.00,
            'currency'      => 'BDT',
            'description'   => "Customer charge for booking {$booking->reference}",
            'account_code'  => '1100-RECEIVABLES',
            'recorded_at'   => now(),
            'created_at'    => now(),
        ]);

        // ---------------------------------------------------------
        // 10. PROMOTIONS
        // ---------------------------------------------------------
        Promotion::firstOrCreate(['code' => 'FLYBANGLA'], [
            'ulid'           => (string) Str::ulid(),
            'title'          => 'Fly Bangla Inaugural Discount',
            'description'    => 'Special ৳500 flat discount on domestic flights within Bangladesh',
            'discount_type'  => 'fixed_amount',
            'discount_value' => 500.00,
            'currency'       => 'BDT',
            'min_spend'      => 4000.00,
            'max_discount'   => 500.00,
            'usage_limit'    => 1000,
            'usage_count'    => 12,
            'starts_at'      => now()->subDays(5),
            'expires_at'     => now()->addMonths(3),
            'is_active'      => true,
        ]);
    }
}
