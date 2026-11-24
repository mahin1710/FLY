<?php

namespace App\Services\Servicing;

use App\Models\Booking;
use App\Models\Payment;
use App\Models\Refund;
use App\Models\ServicingRequest;
use App\Models\User;
use App\Services\Orchestration\OperationsQueueService;
use App\Services\Payments\PaymentService;
use App\Services\Providers\FlightProviderInterface;
use App\Services\StateMachine\BookingStateMachine;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class CustomerServicingService
{
    public function __construct(
        protected FlightProviderInterface $provider,
        protected PaymentService $paymentService,
        protected BookingStateMachine $stateMachine,
        protected OperationsQueueService $operationsQueue
    ) {}

    /**
     * Submit customer servicing request (cancellation, date change, special assistance).
     * Explains supplier rules and fees apply without promising immediate completion.
     */
    public function createServicingRequest(
        Booking $booking,
        array $payload,
        ?User $actor = null
    ): ServicingRequest {
        if (!in_array($booking->booking_status, ['confirmed', 'held', 'ticketed'], true)) {
            throw new RuntimeException("Cannot request servicing for booking in status '{$booking->booking_status}'.", 422);
        }

        $requestType = $payload['request_type'] ?? 'cancellation';
        $remarks = $payload['customer_remarks'] ?? '';
        $capability = $payload['servicing_capability'] ?? 'manual_consolidator';
        $affectedPassengers = $payload['affected_passenger_ids'] ?? [];
        $affectedSegments = $payload['affected_segment_ids'] ?? [];

        // Capture fare rule snapshot
        $fareSnapshot = $this->resolveFareRuleSnapshot($booking);

        $caseNumber = 'CASE-' . date('Ymd') . '-' . strtoupper(Str::random(6));

        $servicingRequest = DB::transaction(function () use (
            $booking,
            $requestType,
            $remarks,
            $capability,
            $affectedPassengers,
            $affectedSegments,
            $fareSnapshot,
            $caseNumber,
            $actor
        ) {
            $req = ServicingRequest::create([
                'ulid'                   => (string) Str::ulid(),
                'case_number'            => $caseNumber,
                'booking_id'             => $booking->id,
                'user_id'                => $booking->user_id ?? 1,
                'actor_type'             => $actor ? ($actor->role === 'customer' ? 'customer' : 'agent') : 'customer',
                'actor_id'               => $actor ? (string) $actor->id : 'guest',
                'request_type'           => $requestType,
                'servicing_capability'   => $capability,
                'status'                 => 'pending_review',
                'fare_rule_snapshot'     => $fareSnapshot,
                'affected_passenger_ids' => $affectedPassengers,
                'affected_segment_ids'   => $affectedSegments,
                'customer_remarks'       => $remarks,
            ]);

            // Transition state machine
            if ($requestType === 'cancellation') {
                $this->stateMachine->transitionServicingStatus($booking, 'cancellation_requested', [
                    'case_number'  => $caseNumber,
                    'actor'        => $actor?->email ?? 'guest',
                ]);
            } elseif ($requestType === 'date_change') {
                $this->stateMachine->transitionServicingStatus($booking, 'change_requested', [
                    'case_number'  => $caseNumber,
                ]);
            }

            return $req;
        });

        // Route to operations queue for consolidator or manual review
        $this->operationsQueue->routeToManualReview($booking, "SERVICING_{$requestType}", [
            'case_number'          => $caseNumber,
            'capability'           => $capability,
            'affected_passengers'  => count($affectedPassengers),
            'affected_segments'    => count($affectedSegments),
        ]);

        return $servicingRequest;
    }

    /**
     * Calculate and return refund quote breakdown.
     * Enforces non-refundable fare rules and partial itinerary calculations.
     */
    public function generateRefundQuote(Booking $booking, array $options = []): array
    {
        $fareSnapshot = $this->resolveFareRuleSnapshot($booking);
        $isNonRefundable = empty($fareSnapshot['refundable'])
            || str_contains(strtoupper((string) $booking->provider_booking_ref), 'NONREF');

        $totalPaid = (float) $booking->total_amount;
        $currency = $booking->currency ?: 'BDT';

        // Check for partial itinerary
        $affectedPassengers = $options['affected_passenger_ids'] ?? [];
        $totalPaxCount = max(1, $booking->passengers()->count());
        $isPartialPax = !empty($affectedPassengers) && count($affectedPassengers) < $totalPaxCount;
        $paxRatio = $isPartialPax ? (count($affectedPassengers) / $totalPaxCount) : 1.0;

        $grossProportional = round($totalPaid * $paxRatio, 2);

        // CASE 1: Non-Refundable Fare
        if ($isNonRefundable) {
            return [
                'quote_ref'               => 'QUOTE-NONREF-' . strtoupper(Str::random(6)),
                'refundable'              => false,
                'currency'                => $currency,
                'original_amount'         => $grossProportional,
                'airline_penalty_fee'     => $grossProportional,
                'service_cancellation_fee'=> 0.00,
                'net_refund_amount'       => 0.00,
                'is_partial'              => $isPartialPax,
                'explanation'             => 'This reservation was booked under a strictly Non-Refundable fare rule category. Airline tariff policy prohibits airfare refund upon voluntary cancellation.',
                'quoted_at'               => now()->toIso8601String(),
                'expires_at'              => now()->addHours(2)->toIso8601String(),
            ];
        }

        // CASE 2: Refundable Fare with Supplier Tariff
        $pnr = $booking->provider_booking_reference ?: $booking->reference;
        $supplierQuote = $this->provider->getRefundQuote($pnr);

        $airlinePenalty = round(($supplierQuote->cancellationFee ?: 1000.00) * $paxRatio, 2);
        $agencyServiceFee = round(250.00 * $paxRatio, 2);
        $netRefundAmount = max(0.0, round($grossProportional - $airlinePenalty - $agencyServiceFee, 2));

        return [
            'quote_ref'                => $supplierQuote->quoteRef ?: ('QUOTE-' . strtoupper(Str::random(8))),
            'refundable'               => true,
            'currency'                 => $currency,
            'original_amount'          => $grossProportional,
            'airline_penalty_fee'      => $airlinePenalty,
            'service_cancellation_fee' => $agencyServiceFee,
            'net_refund_amount'        => $netRefundAmount,
            'is_partial'               => $isPartialPax,
            'explanation'              => 'Refund quote calculated based on published airline fare rules and agency processing schedule.',
            'disclaimer'               => 'Supplier rules and cancellation penalty fees apply. Final refund is subject to airline audit and payment gateway settlement.',
            'quoted_at'                => now()->toIso8601String(),
            'expires_at'               => now()->addHours(2)->toIso8601String(),
        ];
    }

    /**
     * Customer approves refund quote. Reconciles with supplier and gateway.
     * Prevents false completed status if supplier rejects or consolidator is pending.
     */
    public function approveAndExecuteRefund(
        Booking $booking,
        array $approvalPayload,
        ?User $actor = null
    ): array {
        if (empty($approvalPayload['customer_approved'])) {
            throw new RuntimeException('Customer explicit approval is required to execute cancellation refund.', 422);
        }

        $quoteRef = $approvalPayload['quote_ref'] ?? '';
        $netRefundAmount = (float) ($approvalPayload['net_refund_amount'] ?? 0.0);
        $capability = $approvalPayload['servicing_capability'] ?? 'online_supplier';

        // 1. Transition servicing status to review/approved
        if ($booking->servicing_status === 'none') {
            $this->stateMachine->transitionServicingStatus($booking, 'cancellation_requested', [
                'quote_ref' => $quoteRef,
            ]);
        }

        if ($booking->servicing_status === 'cancellation_requested') {
            $this->stateMachine->transitionServicingStatus($booking, 'refund_review', [
                'quote_ref' => $quoteRef,
            ]);
        }

        $pnr = $booking->provider_booking_reference ?: $booking->reference;

        // 2. Reconcile Cancellation with Supplier FIRST
        $cancellationResult = $this->provider->cancelReservation($pnr);

        if (!$cancellationResult->isCancelled || $cancellationResult->status === 'REJECTED') {
            // Supplier rejected cancellation!
            $this->stateMachine->transitionServicingStatus($booking, 'refund_rejected', [
                'reason' => 'Supplier rejected airline reservation cancellation.',
            ]);

            return [
                'status'  => 'SUPPLIER_REJECTED',
                'message' => 'Airline rejected reservation cancellation. No financial refund was disbursed.',
                'pnr'     => $pnr,
            ];
        }

        $this->stateMachine->transitionServicingStatus($booking, 'refund_approved', [
            'cancellation_ref' => $cancellationResult->cancellationRef,
            'net_amount'       => $netRefundAmount,
        ]);

        // 3. Capability Check: Manual Consolidator Servicing vs. Online Supplier
        if ($capability === 'manual_consolidator') {
            // Create pending refund record awaiting manual consolidator settlement
            $refund = Refund::create([
                'ulid'                     => (string) Str::ulid(),
                'booking_id'               => $booking->id,
                'refund_reference'         => 'REF-PENDING-' . strtoupper(Str::random(8)),
                'currency'                 => $booking->currency ?: 'BDT',
                'gross_amount'             => (float) $booking->total_amount,
                'airline_penalty_fee'      => 1000.00,
                'service_cancellation_fee' => 250.00,
                'net_refund_amount'        => $netRefundAmount,
                'status'                   => 'approved', // Pending gateway settlement
                'processed_by_user_id'     => $actor?->id,
            ]);

            $this->operationsQueue->routeToManualReview($booking, 'CONSOLIDATOR_REFUND_PENDING', [
                'refund_id'  => $refund->id,
                'net_amount' => $netRefundAmount,
            ]);

            return [
                'status'           => 'PENDING_CONSOLIDATOR_SETTLEMENT',
                'message'          => 'Airline cancellation confirmed. Refund is queued for manual consolidator settlement.',
                'refund_reference' => $refund->refund_reference,
                'net_amount'       => $netRefundAmount,
            ];
        }

        // 4. Online Supplier Direct Reconciled Gateway Refund
        $payment = $booking->payments->where('status', 'captured')->first();
        if (!$payment) {
            throw new RuntimeException('No captured payment found on booking to disburse refund.', 422);
        }

        $refund = $this->paymentService->processRefund(
            $payment,
            $netRefundAmount,
            'Customer approved voluntary flight cancellation',
            $actor
        );

        $this->stateMachine->transitionBookingStatus($booking, 'cancelled', [
            'reason'           => 'Customer voluntary cancellation',
            'refund_reference' => $refund->refund_reference,
        ]);

        $this->stateMachine->transitionServicingStatus($booking, 'closed', [
            'refund_reference' => $refund->refund_reference,
        ]);

        return [
            'status'           => 'COMPLETED',
            'message'          => 'Reservation cancelled and payment gateway refund disbursed successfully.',
            'refund_reference' => $refund->refund_reference,
            'net_amount'       => $netRefundAmount,
            'currency'         => $refund->currency,
        ];
    }

    /**
     * Resolve fare rules conditions snapshot.
     */
    protected function resolveFareRuleSnapshot(Booking $booking): array
    {
        $snapshot = $booking->priceSnapshot;
        $conditions = $snapshot?->fare_conditions ?? [];

        return [
            'refundable'       => $conditions['refundable'] ?? true,
            'changeable'       => $conditions['changeable'] ?? true,
            'cancellation_fee' => $conditions['cancellation_fee'] ?? 1000.00,
            'change_fee'       => $conditions['change_fee'] ?? 500.00,
            'cabin_class'      => $booking->segments->first()?->cabin_class ?? 'Economy',
        ];
    }
}
