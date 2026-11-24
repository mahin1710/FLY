<?php

namespace App\Jobs;

use App\Models\Booking;
use App\Services\Orchestration\OperationsQueueService;
use App\Services\Providers\FlightProviderInterface;
use App\Services\StateMachine\BookingStateMachine;
use App\Services\Ticketing\TicketingService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Throwable;

class ReconcilePendingTicketsJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct()
    {
        $this->onQueue('critical_recovery');
    }

    public function handle(
        TicketingService|FlightProviderInterface $ticketingService,
        ?BookingStateMachine $stateMachine = null,
        ?OperationsQueueService $operationsQueue = null
    ): void {
        if ($ticketingService instanceof FlightProviderInterface) {
            $ticketingService = app(TicketingService::class);
        }

        // Find bookings paid and confirmed, awaiting e-ticket issuance
        $pendingTickets = Booking::where('booking_status', 'confirmed')
            ->where('payment_status', 'captured')
            ->where('ticket_status', 'queued_for_issuance')
            ->get();

        foreach ($pendingTickets as $booking) {
            try {
                $ticketingService->issueTickets($booking, ['action' => 'reconcile_check']);
            } catch (Throwable) {
                // Keep in queued_for_issuance
            }
        }
    }
}
