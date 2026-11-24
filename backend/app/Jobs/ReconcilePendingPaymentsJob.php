<?php

namespace App\Jobs;

use App\Models\Booking;
use App\Services\StateMachine\BookingStateMachine;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class ReconcilePendingPaymentsJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct()
    {
        $this->onQueue('critical_recovery');
    }

    public function handle(BookingStateMachine $stateMachine): void
    {
        // Expire holds where customer failed to pay before hold expiration
        $expiredHolds = Booking::whereIn('booking_status', ['held', 'pending_payment'])
            ->where('payment_status', 'unpaid')
            ->where('hold_expires_at', '<=', now())
            ->get();

        foreach ($expiredHolds as $booking) {
            $stateMachine->transitionBookingStatus($booking, 'expired', [
                'reconciled_by' => 'ReconcilePendingPaymentsJob',
                'reason'        => '15-minute reservation hold timer elapsed without payment.',
            ]);
        }
    }
}
