<?php

namespace App\Jobs;

use App\Models\Booking;
use App\Models\Ticket;
use App\Services\Orchestration\OperationsQueueService;
use App\Services\Providers\FlightProviderInterface;
use App\Services\StateMachine\BookingStateMachine;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Throwable;

class ReconcilePendingTicketsJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function handle(
        FlightProviderInterface $provider,
        BookingStateMachine $stateMachine,
        OperationsQueueService $operationsQueue
    ): void {
        // Find bookings paid and confirmed, awaiting e-ticket issuance
        $pendingTickets = Booking::where('booking_status', 'confirmed')
            ->where('payment_status', 'captured')
            ->where('ticket_status', 'queued_for_issuance')
            ->get();

        foreach ($pendingTickets as $booking) {
            try {
                $ref = $booking->provider_booking_ref ?? $booking->reference;
                $ticketResult = $provider->issueTicket($ref, ['action' => 'reconcile_check']);

                if ($ticketResult->status === 'ISSUED' && !empty($ticketResult->ticketNumber)) {
                    Ticket::create([
                        'ulid'          => (string) \Illuminate\Support\Str::ulid(),
                        'booking_id'    => $booking->id,
                        'passenger_id'  => $booking->passengers->first()?->id ?? 1,
                        'ticket_number' => $ticketResult->ticketNumber,
                        'ticket_status' => 'issued',
                        'fare_amount'   => (float) $booking->total_amount,
                        'currency'      => $booking->currency,
                        'issued_at'     => now(),
                    ]);

                    $stateMachine->transitionTicketStatus($booking, 'ticketed', [
                        'reconciled_by'              => 'ReconcilePendingTicketsJob',
                        'ticket_number'              => $ticketResult->ticketNumber,
                        'verified_supplier_issuance' => true,
                    ]);
                } elseif ($booking->ticketing_deadline_at && $booking->ticketing_deadline_at->diffInHours(now()) <= 2) {
                    // Near-deadline ticketing alert (< 2 hours before airline ticketing deadline)
                    $operationsQueue->routeToManualReview($booking, 'CRITICAL_NEAR_DEADLINE_TICKETING', [
                        'hours_remaining'       => $booking->ticketing_deadline_at->diffInHours(now()),
                        'ticketing_deadline_at' => $booking->ticketing_deadline_at->toIso8601String(),
                    ]);
                }
            } catch (Throwable) {
                // Keep in queued_for_issuance
            }
        }
    }
}
