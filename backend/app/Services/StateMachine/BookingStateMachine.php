<?php

namespace App\Services\StateMachine;

use App\Models\Booking;
use App\Models\BookingEvent;
use Illuminate\Support\Str;

class BookingStateMachine
{
    // -------------------------------------------------------------
    // ALLOWED TRANSITIONS DICTIONARY
    // -------------------------------------------------------------

    public const ALLOWED_BOOKING_TRANSITIONS = [
        'draft'           => ['held', 'cancelled'],
        'held'            => ['pending_payment', 'expired', 'cancelled'],
        'pending_payment' => ['confirmed', 'expired', 'cancelled'],
        'confirmed'       => ['completed', 'cancelled'],
        'completed'       => [], // Terminal
        'expired'         => [], // Terminal
        'cancelled'       => [], // Terminal
    ];

    public const ALLOWED_PAYMENT_TRANSITIONS = [
        'unpaid'            => ['authorized', 'failed', 'captured'],
        'authorized'        => ['captured', 'failed'],
        'captured'          => ['refund_requested', 'chargeback', 'partially_refunded', 'refunded'],
        'refund_requested'  => ['refunded', 'partially_refunded', 'captured'],
        'partially_refunded'=> ['refunded'],
        'refunded'          => [], // Terminal
        'failed'            => ['unpaid'], // Retry with new card within hold
        'chargeback'        => ['refunded', 'captured'],
    ];

    public const ALLOWED_TICKET_TRANSITIONS = [
        'unissued'            => ['queued_for_issuance'],
        'queued_for_issuance' => ['ticketed', 'unissued'], // unissued if supplier rejects
        'ticketed'            => ['voided', 'exchanged', 'refunded'],
        'voided'              => [], // Terminal
        'exchanged'           => ['ticketed'],
        'refunded'            => [], // Terminal
    ];

    public const ALLOWED_SERVICING_TRANSITIONS = [
        'none'                   => ['change_requested', 'cancellation_requested'],
        'change_requested'       => ['closed', 'none'],
        'cancellation_requested' => ['refund_review', 'none'],
        'refund_review'          => ['refund_approved', 'refund_rejected'],
        'refund_approved'        => ['closed'],
        'refund_rejected'        => ['closed'],
        'closed'                 => ['none'],
    ];

    /**
     * Transition booking_status.
     *
     * @throws InvalidStateTransitionException
     */
    public function transitionBookingStatus(
        Booking $booking,
        string $toStatus,
        array $context = [],
        string $actorType = 'system',
        ?string $actorId = null
    ): void {
        $fromStatus = $booking->booking_status;
        $this->assertValidTransition('booking_status', $fromStatus, $toStatus, self::ALLOWED_BOOKING_TRANSITIONS);

        $booking->booking_status = $toStatus;
        $booking->save();

        $this->recordEvent($booking, 'booking_status_changed', $fromStatus, $toStatus, $context, $actorType, $actorId);
    }

    /**
     * Transition payment_status.
     * Enforces Rule #6: Never mark PAID / captured from browser redirect alone.
     *
     * @throws InvalidStateTransitionException
     */
    public function transitionPaymentStatus(
        Booking $booking,
        string $toStatus,
        array $context = [],
        string $actorType = 'system',
        ?string $actorId = null
    ): void {
        $fromStatus = $booking->payment_status;
        $this->assertValidTransition('payment_status', $fromStatus, $toStatus, self::ALLOWED_PAYMENT_TRANSITIONS);

        // Strict Compliance Guard: do not set captured from browser redirect
        if ($toStatus === 'captured') {
            $isBrowserRedirect = ($context['source'] ?? '') === 'browser_redirect'
                || (bool) ($context['is_browser_redirect'] ?? false);
            $hasServerProof = (bool) ($context['verified_server_signature'] ?? false)
                || !empty($context['gateway_transaction_id'])
                || ($context['source'] ?? '') === 'server_webhook';

            if ($isBrowserRedirect && !$hasServerProof) {
                throw new InvalidStateTransitionException(
                    'payment_status',
                    $fromStatus,
                    $toStatus,
                    ['Payment cannot be marked CAPTURED from a browser redirect without verified server-to-server confirmation.']
                );
            }
        }

        $booking->payment_status = $toStatus;
        $booking->save();

        $this->recordEvent($booking, 'payment_status_changed', $fromStatus, $toStatus, $context, $actorType, $actorId);
    }

    /**
     * Transition ticket_status.
     * Strict Rule: Never set TICKETED until supplier confirmation explicitly verifies issuance.
     *
     * @throws InvalidStateTransitionException
     */
    public function transitionTicketStatus(
        Booking $booking,
        string $toStatus,
        array $context = [],
        string $actorType = 'system',
        ?string $actorId = null
    ): void {
        $fromStatus = $booking->ticket_status;
        $this->assertValidTransition('ticket_status', $fromStatus, $toStatus, self::ALLOWED_TICKET_TRANSITIONS);

        // Strict Compliance Guard: do not set ticketed without supplier proof
        if ($toStatus === 'ticketed') {
            $hasTicketProof = !empty($context['ticket_number'])
                || (bool) ($context['verified_supplier_issuance'] ?? false);

            if (!$hasTicketProof) {
                throw new InvalidStateTransitionException(
                    'ticket_status',
                    $fromStatus,
                    $toStatus,
                    ['Ticketing cannot transition to TICKETED without supplier ticket number or verified supplier confirmation.']
                );
            }
        }

        $booking->ticket_status = $toStatus;
        $booking->save();

        $this->recordEvent($booking, 'ticket_status_changed', $fromStatus, $toStatus, $context, $actorType, $actorId);
    }

    /**
     * Transition servicing_status.
     *
     * @throws InvalidStateTransitionException
     */
    public function transitionServicingStatus(
        Booking $booking,
        string $toStatus,
        array $context = [],
        string $actorType = 'system',
        ?string $actorId = null
    ): void {
        $fromStatus = $booking->servicing_status;
        $this->assertValidTransition('servicing_status', $fromStatus, $toStatus, self::ALLOWED_SERVICING_TRANSITIONS);

        $booking->servicing_status = $toStatus;
        $booking->save();

        $this->recordEvent($booking, 'servicing_status_changed', $fromStatus, $toStatus, $context, $actorType, $actorId);
    }

    protected function assertValidTransition(
        string $dimension,
        string $fromStatus,
        string $toStatus,
        array $allowedRules
    ): void {
        if ($fromStatus === $toStatus) {
            return; // Idempotent no-op
        }

        $allowedDestinations = $allowedRules[$fromStatus] ?? [];
        if (!in_array($toStatus, $allowedDestinations, true)) {
            throw new InvalidStateTransitionException($dimension, $fromStatus, $toStatus, $allowedDestinations);
        }
    }

    protected function recordEvent(
        Booking $booking,
        string $eventName,
        string $from,
        string $to,
        array $context,
        string $actorType,
        ?string $actorId
    ): void {
        $correlationId = request()->attributes->get('correlation_id')
            ?? request()->header('X-Correlation-ID')
            ?? (string) Str::uuid();

        BookingEvent::create([
            'booking_id'  => $booking->id,
            'event_name'  => $eventName,
            'status_from' => $from,
            'status_to'   => $to,
            'actor_type'  => $actorType,
            'actor_id'    => $actorId,
            'payload'     => array_merge($context, [
                'correlation_id' => $correlationId,
                'timestamp'      => now()->toIso8601String(),
            ]),
            'ip_address'  => request()->ip(),
            'recorded_at' => now(),
        ]);
    }
}
