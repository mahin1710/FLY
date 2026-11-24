<?php

namespace Tests\Unit\Orchestration;

use App\Models\Booking;
use App\Models\BookingEvent;
use App\Models\User;
use App\Services\StateMachine\BookingStateMachine;
use App\Services\StateMachine\InvalidStateTransitionException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BookingStateMachineTest extends TestCase
{
    use RefreshDatabase;

    protected BookingStateMachine $stateMachine;
    protected Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();
        $this->stateMachine = new BookingStateMachine();

        $user = User::create([
            'name'     => 'Test Customer',
            'email'    => 'customer_sm@example.com',
            'password' => bcrypt('Password123!'),
            'role'     => 'customer',
        ]);

        $this->booking = Booking::create([
            'ulid'                 => '01TESTBOOKINGSM0000000001',
            'reference'            => 'BK-TEST-001',
            'user_id'              => $user->id,
            'booking_status'       => 'draft',
            'payment_status'       => 'unpaid',
            'ticket_status'        => 'unissued',
            'servicing_status'     => 'none',
            'currency'             => 'BDT',
            'total_amount'         => 5000.00,
            'contact_email'        => 'customer_sm@example.com',
            'contact_phone'        => '+8801700000000',
            'contact_country_code' => '+880',
        ]);
    }

    public function test_allowed_booking_transitions_succeed_and_record_events(): void
    {
        // 1. draft -> held
        $this->stateMachine->transitionBookingStatus($this->booking, 'held');
        $this->assertSame('held', $this->booking->fresh()->booking_status);

        // 2. held -> pending_payment
        $this->stateMachine->transitionBookingStatus($this->booking, 'pending_payment');
        $this->assertSame('pending_payment', $this->booking->fresh()->booking_status);

        // 3. pending_payment -> confirmed
        $this->stateMachine->transitionBookingStatus($this->booking, 'confirmed');
        $this->assertSame('confirmed', $this->booking->fresh()->booking_status);

        // 4. confirmed -> completed
        $this->stateMachine->transitionBookingStatus($this->booking, 'completed');
        $this->assertSame('completed', $this->booking->fresh()->booking_status);

        // Verify audit event trail
        $this->assertDatabaseHas('booking_events', [
            'booking_id' => $this->booking->id,
            'event_name' => 'booking_status_changed',
            'status_from'=> 'pending_payment',
            'status_to'  => 'confirmed',
        ]);
    }

    public function test_invalid_booking_transition_is_rejected(): void
    {
        // Attempting direct jump from draft to confirmed must throw InvalidStateTransitionException
        $this->expectException(InvalidStateTransitionException::class);
        $this->expectExceptionMessage("cannot transition from 'draft' to 'confirmed'");

        $this->stateMachine->transitionBookingStatus($this->booking, 'confirmed');
    }

    public function test_terminal_booking_states_cannot_transition(): void
    {
        $this->booking->booking_status = 'expired';
        $this->booking->save();

        $this->expectException(InvalidStateTransitionException::class);
        $this->expectExceptionMessage("cannot transition from 'expired' to 'confirmed'");

        $this->stateMachine->transitionBookingStatus($this->booking, 'confirmed');
    }

    public function test_payment_status_captured_rejected_from_browser_redirect_alone(): void
    {
        $this->expectException(InvalidStateTransitionException::class);
        $this->expectExceptionMessage('Payment cannot be marked CAPTURED from a browser redirect');

        // Customer browser returns with spoofed GET parameter
        $this->stateMachine->transitionPaymentStatus($this->booking, 'captured', [
            'source' => 'browser_redirect',
            'verified_server_signature' => false,
        ]);
    }

    public function test_payment_status_captured_succeeds_with_verified_server_signature(): void
    {
        $this->stateMachine->transitionPaymentStatus($this->booking, 'captured', [
            'source'                    => 'server_webhook',
            'verified_server_signature' => true,
            'gateway_transaction_id'    => 'TXN_TEST_9988',
        ]);

        $this->assertSame('captured', $this->booking->fresh()->payment_status);
    }

    public function test_ticket_status_ticketed_rejected_without_supplier_proof(): void
    {
        $this->booking->ticket_status = 'queued_for_issuance';
        $this->booking->save();

        $this->expectException(InvalidStateTransitionException::class);
        $this->expectExceptionMessage('Ticketing cannot transition to TICKETED without supplier ticket number');

        $this->stateMachine->transitionTicketStatus($this->booking, 'ticketed', []);
    }

    public function test_ticket_status_ticketed_succeeds_with_verified_ticket_number(): void
    {
        $this->booking->ticket_status = 'queued_for_issuance';
        $this->booking->save();

        $this->stateMachine->transitionTicketStatus($this->booking, 'ticketed', [
            'ticket_number'              => '098-1234567890',
            'verified_supplier_issuance' => true,
        ]);

        $this->assertSame('ticketed', $this->booking->fresh()->ticket_status);
    }
}
