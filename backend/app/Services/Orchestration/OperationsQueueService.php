<?php

namespace App\Services\Orchestration;

use App\Models\Booking;
use App\Models\ServicingRequest;
use App\Models\User;
use Illuminate\Support\Str;

class OperationsQueueService
{
    /**
     * Route a booking to the manual operations servicing queue
     * for agent investigation, supplier reconciliation, or ticketing exceptions.
     */
    public function routeToManualReview(
        Booking $booking,
        string $reason,
        array $context = []
    ): ServicingRequest {
        $booking->requires_manual_review = true;
        $booking->manual_review_reason = $reason;
        $booking->save();

        $userId = $booking->user_id;
        if (!$userId) {
            $defaultUser = User::first();
            $userId = $defaultUser ? $defaultUser->id : 1;
        }

        return ServicingRequest::create([
            'ulid'             => (string) Str::ulid(),
            'booking_id'       => $booking->id,
            'user_id'          => $userId,
            'request_type'     => 'manual_operations_queue',
            'status'           => 'pending_review',
            'customer_remarks' => "System alert: {$reason}",
            'agent_notes'      => json_encode(array_merge($context, [
                'flagged_at'     => now()->toIso8601String(),
                'booking_status' => $booking->booking_status,
                'payment_status' => $booking->payment_status,
                'ticket_status'  => $booking->ticket_status,
            ])),
        ]);
    }
}
