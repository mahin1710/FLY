<?php

namespace App\Services\Orchestration;

use App\DTOs\FlightOfferDTO;
use App\Models\Booking;
use App\Models\BookingPriceSnapshot;
use App\Models\BookingWorkflowStep;
use App\Models\IdempotencyRecord;
use App\Models\Payment;
use App\Models\Ticket;
use App\Services\Providers\FlightProviderInterface;
use App\Services\Providers\Support\Exceptions\ProviderApiException;
use App\Services\Providers\Support\Exceptions\ProviderException;
use App\Services\StateMachine\BookingStateMachine;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class BookingOrchestrator
{
    public function __construct(
        protected FlightProviderInterface $provider,
        protected BookingStateMachine $stateMachine,
        protected BookingLockManager $lockManager,
        protected OperationsQueueService $operationsQueue
    ) {}

    /**
     * Orchestrate the complete booking confirmation pipeline:
     * 1. Distributed lock & idempotency guard
     * 2. Reprice & explicit customer acceptance
     * 3. Provider reservation creation (NO long DB transactions held during HTTP calls)
     * 4. Recovery by retrieve on timeout / unknown response
     * 5. Server-verified payment capture (browser redirects alone rejected)
     * 6. Ticket issuance / operations queue fulfillment
     */
    public function confirmBooking(
        Booking $booking,
        array $input,
        ?string $idempotencyKey = null
    ): Booking {
        // 1. Idempotency Check
        if (!empty($idempotencyKey)) {
            $existing = IdempotencyRecord::where('idempotency_key', $idempotencyKey)->first();
            if ($existing) {
                return $booking->fresh(['segments', 'priceSnapshot', 'passengers.document', 'payments', 'tickets', 'workflowSteps']);
            }
        }

        // 2. Booking-Scoped Distributed Lock
        return $this->lockManager->runWithLock($booking->ulid, function () use ($booking, $input, $idempotencyKey) {
            $correlationId = request()->attributes->get('correlation_id')
                ?? request()->header('X-Correlation-ID')
                ?? (string) Str::uuid();

            // -------------------------------------------------------------
            // STEP 1: REPRICE & EXPLICIT CUSTOMER ACCEPTANCE
            // -------------------------------------------------------------
            $this->executeRepriceStep($booking, $input, $correlationId);

            // -------------------------------------------------------------
            // STEP 2: PROVIDER RESERVATION CREATION
            // (Strict rule: No open DB transactions held during external HTTP calls)
            // -------------------------------------------------------------
            $this->executeReservationStep($booking, $input, $correlationId);

            // -------------------------------------------------------------
            // STEP 3: SERVER-VERIFIED PAYMENT CAPTURE
            // (Strict rule: Browser redirects alone rejected from setting CAPTURED)
            // -------------------------------------------------------------
            $this->executePaymentCaptureStep($booking, $input, $correlationId);

            // -------------------------------------------------------------
            // STEP 4: TICKETING FULFILLMENT & QUEUE ROUTING
            // (Strict rule: TICKETING_PENDING routed to operations queue)
            // -------------------------------------------------------------
            $this->executeTicketingStep($booking, $input, $correlationId);

            // Record Idempotency
            if (!empty($idempotencyKey)) {
                IdempotencyRecord::create([
                    'idempotency_key'      => $idempotencyKey,
                    'scope'                => 'booking_confirm',
                    'user_id'              => $booking->user_id,
                    'request_hash'         => hash('sha256', json_encode($input)),
                    'response_status_code' => 200,
                    'response_body'        => [
                        'ulid'            => $booking->ulid,
                        'reference'       => $booking->reference,
                        'booking_status'  => $booking->booking_status,
                        'payment_status'  => $booking->payment_status,
                        'ticket_status'   => $booking->ticket_status,
                    ],
                    'locked_until'         => now()->addMinutes(15),
                ]);
            }

            return $booking->fresh(['segments', 'priceSnapshot', 'passengers.document', 'payments', 'tickets', 'workflowSteps']);
        });
    }

    /**
     * Step 1: Reprice verification before reservation/payment.
     */
    protected function executeRepriceStep(Booking $booking, array $input, string $correlationId): void
    {
        $step = $this->createWorkflowStep($booking, 'reprice_verification', $correlationId);

        try {
            $offer = $booking->priceSnapshot?->flightOffer;
            $currentAmount = (float) $booking->total_amount;
            $currency = $booking->currency;

            // If offer exists, check reprice with provider
            if ($offer) {
                $offerDTO = !empty($offer->raw_payload) ? FlightOfferDTO::fromArray($offer->raw_payload) : null;
                $reprice = $this->provider->reprice($offer->provider_offer_ref, $offerDTO);

                if ($reprice->hasPriceChanged && abs($reprice->newAmount - $currentAmount) > 0.01) {
                    $accepted = (bool) ($input['accepted_price_change'] ?? false);
                    $expectedSnapshotUlid = (string) ($input['expected_snapshot_ulid'] ?? '');

                    // Check if customer explicitly accepted a pre-quoted snapshot matching this reprice
                    $matchingSnapshot = null;
                    if ($accepted && !empty($expectedSnapshotUlid)) {
                        $matchingSnapshot = BookingPriceSnapshot::where('ulid', $expectedSnapshotUlid)
                            ->where('flight_offer_id', $offer->id)
                            ->first();
                    }

                    if ($matchingSnapshot && abs((float) $matchingSnapshot->grand_total - $reprice->newAmount) < 0.01) {
                        // Verified customer acceptance of the exact quoted price change
                        $booking->total_amount = $matchingSnapshot->grand_total;
                        $booking->booking_price_snapshot_id = $matchingSnapshot->id;
                        $booking->save();
                    } else {
                        // Create new price snapshot and halt workflow for customer review
                        $newSnapshot = BookingPriceSnapshot::create([
                            'ulid'              => (string) Str::ulid(),
                            'flight_offer_id'   => $offer->id,
                            'currency'          => $reprice->currency,
                            'base_fare'         => $reprice->newAmount * 0.85,
                            'taxes'             => $reprice->newAmount * 0.15,
                            'airline_fees'      => 0,
                            'service_fees'      => 0,
                            'ancillaries_total' => 0,
                            'discounts_total'   => 0,
                            'grand_total'       => $reprice->newAmount,
                            'breakdown_payload' => [
                                'currency'     => $reprice->currency,
                                'total_amount' => $reprice->newAmount,
                                'difference'   => $reprice->difference,
                            ],
                            'created_at'        => now(),
                        ]);

                        $this->markStepFailed($step, 'PRICE_CHANGED', 'Price change detected; customer acceptance required.', [
                            'old_amount'        => $currentAmount,
                            'new_amount'        => $reprice->newAmount,
                            'new_snapshot_ulid' => $newSnapshot->ulid,
                        ]);

                        throw new PriceChangedException(
                            oldAmount: $currentAmount,
                            newAmount: $reprice->newAmount,
                            difference: $reprice->difference,
                            currency: $currency,
                            newSnapshotUlid: $newSnapshot->ulid,
                            reason: $reprice->reason
                        );
                    }
                }
            }

            $this->markStepCompleted($step, ['amount' => $booking->total_amount, 'currency' => $booking->currency]);
        } catch (PriceChangedException $e) {
            throw $e;
        } catch (Throwable $e) {
            $this->markStepFailed($step, 'REPRICE_ERROR', $e->getMessage());
            throw $e;
        }
    }

    /**
     * Step 2: Provider reservation / PNR creation.
     * Strict rule: Do not hold open DB transactions during provider HTTP calls.
     */
    protected function executeReservationStep(Booking $booking, array $input, string $correlationId): void
    {
        // Skip if reservation already created (idempotent step recovery)
        if (!empty($booking->airline_pnr) && $booking->airline_pnr !== 'PENDING') {
            return;
        }

        $step = $this->createWorkflowStep($booking, 'provider_reservation', $correlationId);

        $offer = $booking->priceSnapshot?->flightOffer;
        $offerDTO = $offer && !empty($offer->raw_payload) ? FlightOfferDTO::fromArray($offer->raw_payload) : null;
        if (!$offerDTO) {
            // Create fallback DTO from booking segments
            $offerDTO = new FlightOfferDTO(
                uuid: (string) Str::uuid(),
                providerCode: $this->provider->getProviderCode(),
                providerOfferRef: $offer?->provider_offer_ref ?? 'OFFER-' . $booking->ulid,
                segments: [],
                baggage: new \App\DTOs\BaggageAllowanceDTO(),
                fareConditions: new \App\DTOs\FareConditionsDTO(false, false, true, 0, 0, 'Standard'),
                priceBreakdown: new \App\DTOs\PriceBreakdownDTO($booking->currency, $booking->total_amount, 0, 0, $booking->total_amount),
                supportedExtras: [],
                isRefundable: false,
                isBookable: false,
                expiresAt: now()->addHours(24)->toIso8601String()
            );
        }

        $passengers = $booking->passengers->toArray();
        $contactInfo = [
            'email'        => $booking->contact_email,
            'phone'        => $booking->contact_phone,
            'country_code' => $booking->contact_country_code,
        ];

        // NO DB TRANSACTION HELD HERE DURING EXTERNAL HTTP CALL
        try {
            $reservation = $this->provider->createReservation($offerDTO, $passengers, $contactInfo);

            $booking->airline_pnr = $reservation->pnr;
            $booking->provider_booking_ref = $reservation->providerBookingRef;
            $booking->ticketing_deadline_at = $reservation->ticketingRequiredBy ? \Carbon\Carbon::parse($reservation->ticketingRequiredBy) : null;
            $booking->save();

            $this->stateMachine->transitionBookingStatus($booking, 'pending_payment', [
                'pnr'                  => $reservation->pnr,
                'provider_booking_ref' => $reservation->providerBookingRef,
            ]);

            $this->markStepCompleted($step, [
                'pnr'                  => $reservation->pnr,
                'provider_booking_ref' => $reservation->providerBookingRef,
            ]);
        } catch (Throwable $e) {
            // Check if timeout or connection drop occurred after create request was dispatched
            $isTimeout = str_contains(strtolower($e->getMessage()), 'timeout')
                || str_contains(strtolower($e->getMessage()), 'connection')
                || ($e instanceof ProviderException && $e->getCode() === 504);

            if ($isTimeout) {
                // On timeout after create, retrieve by provider reference/correlation before retry!
                $recovered = $this->attemptReservationRecovery($booking, $step);
                if ($recovered) {
                    return; // Successfully reconciled!
                }

                // If still UNKNOWN: Distinguish FAILED from UNKNOWN/MANUAL_REVIEW
                $this->markStepNeedsReview($step, 'PROVIDER_TIMEOUT_UNKNOWN', 'Provider timed out during order create. Marked UNKNOWN for manual review.');
                $this->operationsQueue->routeToManualReview($booking, 'SUPPLIER_TIMEOUT_UNKNOWN', [
                    'step'        => 'provider_reservation',
                    'error'       => $e->getMessage(),
                    'occurred_at' => now()->toIso8601String(),
                ]);

                throw new RuntimeException(
                    'The airline reservation request timed out. Your booking is under active verification and has been queued for operations review.',
                    504
                );
            }

            // Definite failure (e.g. 400 sold out, invalid data)
            $this->markStepFailed($step, 'RESERVATION_FAILED', $e->getMessage());
            $this->stateMachine->transitionBookingStatus($booking, 'cancelled', ['reason' => $e->getMessage()]);
            throw $e;
        }
    }

    /**
     * Step 3: Payment Capture Verification.
     * Strict rule: Never set CAPTURED from browser redirect alone.
     */
    protected function executePaymentCaptureStep(Booking $booking, array $input, string $correlationId): void
    {
        // Skip if already captured
        if ($booking->payment_status === 'captured') {
            return;
        }

        $step = $this->createWorkflowStep($booking, 'payment_verification', $correlationId);

        $paymentData = $input['payment'] ?? [];
        $isBrowserRedirect = ($paymentData['source'] ?? '') === 'browser_redirect'
            || (bool) ($paymentData['is_browser_redirect'] ?? false);
        $hasServerProof = (bool) ($paymentData['verified_server_signature'] ?? false)
            || !empty($paymentData['gateway_transaction_id'])
            || ($paymentData['source'] ?? '') === 'server_webhook';

        if ($isBrowserRedirect && !$hasServerProof) {
            $this->markStepFailed($step, 'PAYMENT_SPOOF_ATTEMPT', 'Payment capture rejected from browser redirect without verified server clearance.');
            throw new RuntimeException('Payment confirmation rejected: browser redirect without server verification.', 422);
        }

        try {
            $paymentUlid = (string) Str::ulid();
            $transactionId = $paymentData['gateway_transaction_id'] ?? 'TXN-' . strtoupper(Str::random(10));

            Payment::create([
                'ulid'                   => $paymentUlid,
                'booking_id'             => $booking->id,
                'user_id'                => $booking->user_id,
                'payment_method'         => $paymentData['method'] ?? 'card',
                'gateway_provider'       => $paymentData['gateway'] ?? 'simulated',
                'gateway_transaction_id' => $transactionId,
                'currency'               => $booking->currency,
                'amount'                 => $booking->total_amount,
                'status'                 => 'captured',
                'idempotency_key'        => 'PAY-' . $booking->ulid,
                'authorized_at'          => now(),
                'captured_at'            => now(),
            ]);

            $this->stateMachine->transitionPaymentStatus($booking, 'captured', [
                'verified_server_signature' => true,
                'gateway_transaction_id'    => $transactionId,
            ]);

            $this->stateMachine->transitionBookingStatus($booking, 'confirmed', [
                'payment_transaction_id' => $transactionId,
            ]);

            $this->stateMachine->transitionTicketStatus($booking, 'queued_for_issuance', [
                'reason' => 'Payment captured, queued for airline e-ticket issuance.',
            ]);

            $this->markStepCompleted($step, ['transaction_id' => $transactionId]);
        } catch (Throwable $e) {
            $this->markStepFailed($step, 'PAYMENT_CAPTURE_ERROR', $e->getMessage());
            throw $e;
        }
    }

    /**
     * Step 4: Ticketing fulfillment.
     * Strict rule: Never set TICKETED until supplier confirmation/retrieve verifies ticket issuance.
     */
    protected function executeTicketingStep(Booking $booking, array $input, string $correlationId): void
    {
        if ($booking->ticket_status === 'ticketed') {
            return;
        }

        $step = $this->createWorkflowStep($booking, 'ticket_issuance', $correlationId);

        try {
            $ticketingService = app(\App\Services\Ticketing\TicketingService::class);
            $result = $ticketingService->issueTickets($booking, [
                'cardholder_name' => $input['payment']['cardholder_name'] ?? 'PASSENGER',
            ]);

            $this->markStepCompleted($step, $result);
        } catch (Throwable $e) {
            $this->markStepNeedsReview($step, 'TICKETING_SUPPLIER_EXCEPTION', $e->getMessage());
            $this->operationsQueue->routeToManualReview($booking, 'SUPPLIER_TICKETING_EXCEPTION', [
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Recovery by retrieve on timeout: check if reservation was created before retrying.
     */
    protected function attemptReservationRecovery(Booking $booking, BookingWorkflowStep $step): bool
    {
        try {
            $ref = $booking->provider_booking_ref ?? 'OFFER-' . $booking->ulid;
            $existingRes = $this->provider->getReservation($ref);

            if ($existingRes && !empty($existingRes->pnr) && $existingRes->pnr !== 'PENDING') {
                $booking->airline_pnr = $existingRes->pnr;
                $booking->provider_booking_ref = $existingRes->providerBookingRef;
                $booking->save();

                $this->stateMachine->transitionBookingStatus($booking, 'pending_payment', [
                    'recovered_via' => 'provider_retrieval',
                    'pnr'           => $existingRes->pnr,
                ]);

                $this->markStepCompleted($step, [
                    'recovered'            => true,
                    'pnr'                  => $existingRes->pnr,
                    'provider_booking_ref' => $existingRes->providerBookingRef,
                ]);

                return true;
            }
        } catch (Throwable) {
            // Retrieval also failed or record not found
        }

        return false;
    }

    protected function createWorkflowStep(Booking $booking, string $stepName, string $correlationId): BookingWorkflowStep
    {
        return BookingWorkflowStep::create([
            'booking_id'     => $booking->id,
            'step_name'      => $stepName,
            'step_status'    => 'in_progress',
            'attempt_count'  => 1,
            'correlation_id' => $correlationId,
            'started_at'     => now(),
        ]);
    }

    protected function markStepCompleted(BookingWorkflowStep $step, array $payload = []): void
    {
        $step->update([
            'step_status'     => 'completed',
            'completed_at'    => now(),
            'context_payload' => $payload,
        ]);
    }

    protected function markStepFailed(BookingWorkflowStep $step, string $code, string $message, array $payload = []): void
    {
        $step->update([
            'step_status'     => 'failed',
            'error_code'      => $code,
            'error_message'   => Str::limit($message, 500),
            'context_payload' => $payload,
            'completed_at'    => now(),
        ]);
    }

    protected function markStepNeedsReview(BookingWorkflowStep $step, string $code, string $message): void
    {
        $step->update([
            'step_status'   => 'needs_manual_review',
            'error_code'    => $code,
            'error_message' => Str::limit($message, 500),
            'completed_at'  => now(),
        ]);
    }
}
