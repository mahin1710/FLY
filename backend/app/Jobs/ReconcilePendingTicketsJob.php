<?php

namespace App\Jobs;

use App\Models\Booking;
use App\Services\Orchestration\OperationsQueueService;
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

    public function handle(
        TicketingService $ticketingService,
        OperationsQueueService $operationsQueue
    ): void {
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
