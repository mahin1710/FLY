<?php

namespace App\Jobs;

use App\Models\Booking;
use App\Services\Providers\FlightProviderInterface;
use App\Services\StateMachine\BookingStateMachine;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Throwable;

class ReconcilePendingReservationsJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function handle(
        FlightProviderInterface $provider,
        BookingStateMachine $stateMachine
    ): void {
        // Find bookings flagged with unknown reservation status
        $pendingBookings = Booking::where('requires_manual_review', true)
            ->whereIn('booking_status', ['held', 'draft'])
            ->get();

        foreach ($pendingBookings as $booking) {
            try {
                $ref = $booking->provider_booking_ref ?? 'OFFER-' . $booking->ulid;
                $res = $provider->getReservation($ref);

                if ($res && !empty($res->pnr) && $res->pnr !== 'PENDING') {
                    $booking->airline_pnr = $res->pnr;
                    $booking->provider_booking_ref = $res->providerBookingRef;
                    $booking->requires_manual_review = false;
                    $booking->manual_review_reason = null;
                    $booking->save();

                    $stateMachine->transitionBookingStatus($booking, 'pending_payment', [
                        'reconciled_by' => 'ReconcilePendingReservationsJob',
                        'pnr'           => $res->pnr,
                    ]);
                }
            } catch (Throwable) {
                // Keep flagged for manual agent intervention
            }
        }
    }
}
