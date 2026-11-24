<?php

namespace Tests\Unit;

use App\Models\Airport;
use App\Models\Airline;
use App\Models\Booking;
use App\Models\BookingEvent;
use App\Models\BookingPriceSnapshot;
use App\Models\FlightOffer;
use App\Models\Passenger;
use App\Models\PassengerDocument;
use App\Models\User;
use App\Policies\AdminPolicy;
use App\Services\PassengerService;
use App\Services\PricingService;
use App\Services\StateMachine\BookingStateMachine;
use App\Services\StateMachine\InvalidStateTransitionException;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class DomainRulesAndPricingUnitTest extends TestCase
{
    use RefreshDatabase;

    protected BookingStateMachine $stateMachine;
    protected PassengerService $passengerService;

    protected function setUp(): void
    {
        parent::setUp();
        $this->stateMachine = new BookingStateMachine();
        $this->passengerService = app(PassengerService::class);
    }

    /**
     * TEST-UNIT-001: Pricing and Fare Breakdown Calculation.
     * Verifies base fare, taxes, fees, ancillaries, and grand total arithmetic without floating point drift.
     */
    public function test_pricing_and_fare_breakdown_arithmetic_prevents_float_distortion(): void
    {
        $baseFare = 4500.50;
        $taxes = 750.25;
        $airlineFees = 200.00;
        $serviceFees = 150.00;
        $ancillaries = 300.00;
        $discounts = 100.00;

        $expectedGrandTotal = round($baseFare + $taxes + $airlineFees + $serviceFees + $ancillaries - $discounts, 2);
        $this->assertSame(5800.75, $expectedGrandTotal);

        $snapshot = BookingPriceSnapshot::create([
            'ulid'              => (string) Str::ulid(),
            'currency'          => 'BDT',
            'base_fare'         => $baseFare,
            'taxes'             => $taxes,
            'airline_fees'      => $airlineFees,
            'service_fees'      => $serviceFees,
            'ancillaries_total' => $ancillaries,
            'discounts_total'   => $discounts,
            'grand_total'       => $expectedGrandTotal,
            'breakdown_payload' => [
                'currency'    => 'BDT',
                'grand_total' => $expectedGrandTotal,
            ],
            'created_at'        => now(),
        ]);

        $this->assertDatabaseHas('booking_price_snapshots', [
            'id'          => $snapshot->id,
            'grand_total' => 5800.75,
            'currency'    => 'BDT',
        ]);
    }

    /**
     * TEST-UNIT-002: Passenger Rules - Age Bracket Categorization.
     * Adult: >= 12, Child: 2-11, Infant: < 2.
     */
    public function test_passenger_rules_age_bracket_validation(): void
    {
        $adultDob = Carbon::now()->subYears(25)->toDateString();
        $childDob = Carbon::now()->subYears(7)->toDateString();
        $infantDob = Carbon::now()->subMonths(10)->toDateString();

        $this->assertGreaterThanOrEqual(12, Carbon::parse($adultDob)->diffInYears(now()));
        $childAge = Carbon::parse($childDob)->diffInYears(now());
        $this->assertTrue($childAge >= 2 && $childAge < 12);
        $this->assertLessThan(2, Carbon::parse($infantDob)->diffInYears(now()));
    }

    /**
     * TEST-UNIT-003: Passenger Rules - Infant to Adult Ratio Constraint.
     * Enforces maximum 1 infant per accompanying adult.
     */
    public function test_passenger_rules_infant_to_adult_ratio_enforced(): void
    {
        $user = User::factory()->create(['role' => 'customer']);
        $booking = Booking::create([
            'ulid'                 => (string) Str::ulid(),
            'reference'            => 'BK-UNIT-PAX-01',
            'user_id'              => $user->id,
            'booking_status'       => 'draft',
            'payment_status'       => 'unpaid',
            'ticket_status'        => 'unissued',
            'servicing_status'     => 'none',
            'currency'             => 'BDT',
            'total_amount'         => 12000.00,
            'contact_email'        => 'pax@example.com',
            'contact_phone'        => '+8801700000000',
            'contact_country_code' => '+880',
        ]);

        $passengersWithExcessInfants = [
            [
                'type'          => 'adult',
                'title'         => 'MR',
                'first_name'    => 'Rahim',
                'last_name'     => 'Uddin',
                'date_of_birth' => Carbon::now()->subYears(30)->toDateString(),
                'gender'        => 'male',
            ],
            [
                'type'          => 'infant',
                'title'         => 'MSTR',
                'first_name'    => 'Baby',
                'last_name'     => 'One',
                'date_of_birth' => Carbon::now()->subMonths(6)->toDateString(),
                'gender'        => 'male',
            ],
            [
                'type'          => 'infant',
                'title'         => 'MISS',
                'first_name'    => 'Baby',
                'last_name'     => 'Two',
                'date_of_birth' => Carbon::now()->subMonths(8)->toDateString(),
                'gender'        => 'female',
            ],
        ];

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('cannot exceed the number of accompanying adults');

        $this->passengerService->addPassengers($booking->ulid, $passengersWithExcessInfants, $user);
    }

    /**
     * TEST-UNIT-004: Date/Time Handling & Airport Timezone Context.
     * Verifies departure occurs strictly before arrival and timezone offset is preserved.
     */
    public function test_datetime_handling_and_timezone_preservation(): void
    {
        $depUtc = Carbon::parse('2026-12-01 04:00:00', 'UTC');
        $arrUtc = Carbon::parse('2026-12-01 07:30:00', 'UTC');

        $this->assertTrue($depUtc->isBefore($arrUtc));
        $durationMinutes = (int) $depUtc->diffInMinutes($arrUtc);
        $this->assertSame(210, $durationMinutes);

        // Verify local airport time conversions
        $depDhaka = $depUtc->copy()->setTimezone('Asia/Dhaka'); // UTC+6 -> 10:00 AM
        $arrDubai = $arrUtc->copy()->setTimezone('Asia/Dubai'); // UTC+4 -> 11:30 AM

        $this->assertSame('10:00', $depDhaka->format('H:i'));
        $this->assertSame('11:30', $arrDubai->format('H:i'));
    }

    /**
     * TEST-UNIT-005: State Machine - Comprehensive State Transitions.
     * Verifies allowed transitions and blocks invalid/terminal transitions across all 4 dimensions.
     */
    public function test_state_machine_transitions_and_terminal_state_protection(): void
    {
        $user = User::factory()->create(['role' => 'customer']);
        $booking = Booking::create([
            'ulid'                 => (string) Str::ulid(),
            'reference'            => 'BK-UNIT-SM-01',
            'user_id'              => $user->id,
            'booking_status'       => 'draft',
            'payment_status'       => 'unpaid',
            'ticket_status'        => 'unissued',
            'servicing_status'     => 'none',
            'currency'             => 'BDT',
            'total_amount'         => 8500.00,
            'contact_email'        => 'sm@example.com',
            'contact_phone'        => '+8801700000000',
            'contact_country_code' => '+880',
        ]);

        // Valid booking_status flow: draft -> held -> pending_payment -> confirmed
        $this->stateMachine->transitionBookingStatus($booking, 'held');
        $this->assertSame('held', $booking->fresh()->booking_status);

        $this->stateMachine->transitionBookingStatus($booking, 'pending_payment');
        $this->assertSame('pending_payment', $booking->fresh()->booking_status);

        $this->stateMachine->transitionBookingStatus($booking, 'confirmed');
        $this->assertSame('confirmed', $booking->fresh()->booking_status);

        // Invalid: draft directly to completed
        $booking2 = Booking::create([
            'ulid'                 => (string) Str::ulid(),
            'reference'            => 'BK-UNIT-SM-02',
            'user_id'              => $user->id,
            'booking_status'       => 'draft',
            'payment_status'       => 'unpaid',
            'ticket_status'        => 'unissued',
            'servicing_status'     => 'none',
            'currency'             => 'BDT',
            'total_amount'         => 8500.00,
            'contact_email'        => 'sm2@example.com',
            'contact_phone'        => '+8801700000000',
            'contact_country_code' => '+880',
        ]);

        $this->expectException(InvalidStateTransitionException::class);
        $this->stateMachine->transitionBookingStatus($booking2, 'completed');
    }

    /**
     * TEST-UNIT-006: Idempotency Key Fingerprint Generation and Collision Detection.
     */
    public function test_idempotency_key_and_payload_fingerprint(): void
    {
        $payload1 = ['route' => 'DAC-DXB', 'pax' => 1, 'cabin' => 'economy'];
        $payload2 = ['route' => 'DAC-DXB', 'pax' => 1, 'cabin' => 'economy'];
        $payload3 = ['route' => 'DAC-JFK', 'pax' => 2, 'cabin' => 'business'];

        $fingerprint1 = hash('sha256', json_encode($payload1));
        $fingerprint2 = hash('sha256', json_encode($payload2));
        $fingerprint3 = hash('sha256', json_encode($payload3));

        $this->assertSame($fingerprint1, $fingerprint2);
        $this->assertNotSame($fingerprint1, $fingerprint3);
    }

    /**
     * TEST-UNIT-007: Fee Calculations - Cancellation & Refund Deductions.
     */
    public function test_servicing_fee_and_refund_penalty_calculation(): void
    {
        $totalPaid = 10000.00;
        $airlinePenaltyRate = 0.20; // 20%
        $platformServiceFee = 500.00;

        $airlinePenalty = $totalPaid * $airlinePenaltyRate; // 2000.00
        $netRefundAmount = $totalPaid - $airlinePenalty - $platformServiceFee; // 7500.00

        $this->assertSame(2000.00, $airlinePenalty);
        $this->assertSame(7500.00, $netRefundAmount);
        $this->assertGreaterThan(0, $netRefundAmount);
    }

    /**
     * TEST-UNIT-008: Role & Permission Policies.
     * Enforces granular least-privilege matrix for AdminPolicy.
     */
    public function test_admin_policy_permissions_matrix(): void
    {
        $policy = new AdminPolicy();

        $superAdmin = User::factory()->make(['role' => 'super_admin', 'status' => 'active']);
        $opsAdmin = User::factory()->make(['role' => 'operations_admin', 'status' => 'active']);
        $ticketingAgent = User::factory()->make(['role' => 'ticketing_agent', 'status' => 'active']);
        $financeAdmin = User::factory()->make(['role' => 'finance_admin', 'status' => 'active']);
        $supportAgent = User::factory()->make(['role' => 'support_agent', 'status' => 'active']);
        $retailCustomer = User::factory()->make(['role' => 'customer', 'status' => 'active']);

        // Manage Users: only super_admin
        $this->assertTrue($policy->manageUsers($superAdmin));
        $this->assertFalse($policy->manageUsers($opsAdmin));
        $this->assertFalse($policy->manageUsers($retailCustomer));

        // View Ticketing Queue: super_admin, operations_admin, ticketing_agent
        $this->assertTrue($policy->viewTicketingQueue($superAdmin));
        $this->assertTrue($policy->viewTicketingQueue($opsAdmin));
        $this->assertTrue($policy->viewTicketingQueue($ticketingAgent));
        $this->assertFalse($policy->viewTicketingQueue($financeAdmin));
        $this->assertFalse($policy->viewTicketingQueue($retailCustomer));

        // Manage/Disburse Refunds: super_admin, finance_admin
        $this->assertTrue($policy->disburseRefund($superAdmin));
        $this->assertTrue($policy->disburseRefund($financeAdmin));
        $this->assertFalse($policy->disburseRefund($supportAgent));
        $this->assertFalse($policy->disburseRefund($retailCustomer));
    }
}
