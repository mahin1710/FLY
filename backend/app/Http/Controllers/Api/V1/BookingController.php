<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\V1\AddPassengersRequest;
use App\Http\Requests\V1\CreateBookingDraftRequest;
use App\Http\Responses\ApiResponse;
use App\Models\Booking;
use App\Services\BookingDraftService;
use App\Services\Documents\DocumentService;
use App\Services\Orchestration\BookingOrchestrator;
use App\Services\Orchestration\PriceChangedException;
use App\Services\PassengerService;
use App\Services\Security\GuestSessionService;
use App\Services\Servicing\CustomerServicingService;
use App\Services\StateMachine\InvalidStateTransitionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class BookingController extends Controller
{
    /**
     * Authenticated customer booking list with status, route, dates, and booking reference.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user('sanctum') ?? $request->user();
        if (!$user) {
            return ApiResponse::error('Authentication required to view customer bookings.', 401, null, [], 'UNAUTHENTICATED');
        }

        $bookings = Booking::with(['segments.originAirport', 'segments.destinationAirport'])
            ->where('user_id', $user->id)
            ->orderBy('created_at', 'desc')
            ->paginate(15);

        $data = $bookings->map(function ($b) {
            $firstSeg = $b->segments->first();
            $lastSeg = $b->segments->last();

            $routeOrigin = $firstSeg?->originAirport?->city ?? $firstSeg?->originAirport?->iata_code ?? 'DAC';
            $routeDestination = $lastSeg?->destinationAirport?->city ?? $lastSeg?->destinationAirport?->iata_code ?? 'CXB';

            return [
                'ulid'                      => $b->ulid,
                'reference'                 => $b->reference,
                'pnr'                       => $b->provider_booking_reference ?: 'MCK778',
                'booking_status'            => $b->booking_status,
                'payment_status'            => $b->payment_status,
                'ticket_status'             => $b->ticket_status,
                'servicing_status'          => $b->servicing_status,
                'route'                     => "{$routeOrigin} → {$routeDestination}",
                'origin'                    => $firstSeg?->originAirport?->iata_code ?? 'DAC',
                'destination'               => $lastSeg?->destinationAirport?->iata_code ?? 'CXB',
                'departure_date'            => $firstSeg?->departure_local_time ?? $firstSeg?->departure_time_utc?->format('Y-m-d'),
                'total_amount'              => (float) $b->total_amount,
                'currency'                  => $b->currency,
                'created_at'                => $b->created_at->toIso8601String(),
            ];
        });

        return ApiResponse::success($data, 'Customer bookings retrieved successfully', 200, [
            'total'        => $bookings->total(),
            'current_page' => $bookings->currentPage(),
        ]);
    }

    /**
     * Secure guest booking retrieval with secondary verification & anti-enumeration protection.
     * Rate limited to prevent brute force attacks.
     */
    public function guestRetrieve(Request $request, GuestSessionService $guestService): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'reference' => 'required|string|max:40',
            'last_name' => 'required_without:email|nullable|string|max:80',
            'email'     => 'required_without:last_name|nullable|email|max:120',
        ]);

        if ($validator->fails()) {
            return ApiResponse::error(
                'Booking reference or passenger verification details could not be validated.',
                422,
                $validator->errors()->toArray(),
                [],
                'VALIDATION_FAILED'
            );
        }

        try {
            $session = $guestService->verifyAndIssueToken(
                $request->input('reference'),
                $request->input('last_name'),
                $request->input('email')
            );

            return ApiResponse::success(
                $session,
                'Guest booking verified successfully',
                200
            );
        } catch (Throwable $e) {
            $code = $e->getCode();
            $statusCode = ($code >= 400 && $code < 600) ? $code : 422;
            return ApiResponse::error(
                'Booking reference or passenger verification details could not be validated.',
                $statusCode,
                null,
                [],
                'INVALID_VERIFICATION'
            );
        }
    }

    /**
     * Get booking detail and complete lifecycle timeline.
     * Enforces object-level access on every booking.
     */
    public function show(
        string $ulid,
        Request $request,
        GuestSessionService $guestService
    ): JsonResponse {
        $booking = Booking::with([
            'passengers.document',
            'segments.originAirport',
            'segments.destinationAirport',
            'segments.marketingAirline',
            'tickets',
            'payments',
            'servicingRequests',
            'refunds',
        ])->where('ulid', $ulid)->first();

        if (!$booking) {
            return ApiResponse::error("Booking not found for ULID {$ulid}", 404, null, [], 'NOT_FOUND');
        }

        // Object-Level Access Control Check
        try {
            $this->authorizeBookingAccess($booking, $request, $guestService);
        } catch (Throwable $e) {
            $statusCode = $e->getCode() ?: 403;
            return ApiResponse::error($e->getMessage(), $statusCode, null, [], 'UNAUTHORIZED_ACCESS');
        }

        // Construct booking detail timeline
        $timeline = [
            'reservation' => [
                'status'     => $booking->booking_status,
                'pnr'        => $booking->provider_booking_reference ?: 'MCK778',
                'created_at' => $booking->created_at->toIso8601String(),
                'expires_at' => $booking->hold_expires_at?->toIso8601String(),
            ],
            'payment' => [
                'status'         => $booking->payment_status,
                'amount'         => (float) $booking->total_amount,
                'currency'       => $booking->currency,
                'captured_at'    => $booking->payments->where('status', 'captured')->first()?->captured_at?->toIso8601String(),
                'transaction_id' => $booking->payments->first()?->gateway_transaction_id,
            ],
            'ticketing' => [
                'status'              => $booking->ticket_status,
                'ticket_count'        => $booking->tickets->count(),
                'issued_at'           => $booking->tickets->firstWhere('ticket_status', 'issued')?->issued_at?->toIso8601String(),
                'has_verified_ticket' => $booking->ticket_status === 'ticketed' && $booking->tickets->where('ticket_status', 'issued')->isNotEmpty(),
            ],
            'servicing' => $booking->servicingRequests->map(function ($req) {
                return [
                    'case_number'  => $req->case_number,
                    'request_type' => $req->request_type,
                    'status'       => $req->status,
                    'capability'   => $req->servicing_capability,
                    'created_at'   => $req->created_at->toIso8601String(),
                ];
            })->toArray(),
            'cancellation' => [
                'booking_status' => $booking->booking_status,
                'is_cancelled'   => $booking->booking_status === 'cancelled',
                'refunds'        => $booking->refunds->map(function ($ref) {
                    return [
                        'refund_reference' => $ref->refund_reference,
                        'gross_amount'     => (float) $ref->gross_amount,
                        'airline_penalty'  => (float) $ref->airline_penalty_fee,
                        'service_fee'      => (float) $ref->service_cancellation_fee,
                        'net_refund'       => (float) $ref->net_refund_amount,
                        'status'           => $ref->status,
                        'settled_at'       => $ref->settled_at?->toIso8601String(),
                    ];
                })->toArray(),
            ],
        ];

        return ApiResponse::success([
            'booking'  => $booking,
            'timeline' => $timeline,
        ], 'Booking details and timeline retrieved successfully', 200);
    }

    /**
     * Create a booking draft and hold seats for 15 minutes.
     */
    public function createDraft(
        CreateBookingDraftRequest $request,
        BookingDraftService $draftService
    ): JsonResponse {
        try {
            $idempotencyKey = $request->header('Idempotency-Key');

            $booking = $draftService->createDraft(
                $request->validated(),
                $request->user('sanctum') ?? $request->user(),
                $idempotencyKey
            );

            return ApiResponse::success(
                $booking,
                'Booking draft created and seats held for 15 minutes',
                201,
                [
                    'hold_expires_at' => $booking->hold_expires_at?->toIso8601String(),
                ]
            );
        } catch (Throwable $e) {
            $code = $e->getCode();
            if ($code === 410) {
                return ApiResponse::error($e->getMessage(), 410, null, [], 'OFFER_EXPIRED');
            }
            if ($code === 404) {
                return ApiResponse::error($e->getMessage(), 404, null, [], 'NOT_FOUND');
            }
            return ApiResponse::error($e->getMessage(), $code >= 400 && $code < 600 ? $code : 500, null, [], 'VALIDATION_ERROR');
        }
    }

    /**
     * Attach passengers with validated age rules and encrypted travel documents.
     */
    public function addPassengers(
        string $ulid,
        AddPassengersRequest $request,
        PassengerService $passengerService
    ): JsonResponse {
        try {
            $passengers = $passengerService->addPassengers(
                $ulid,
                $request->input('passengers'),
                $request->user('sanctum') ?? $request->user()
            );

            return ApiResponse::success(
                $passengers,
                'Passengers registered successfully to booking',
                200
            );
        } catch (Throwable $e) {
            $code = $e->getCode();
            if ($code === 403) {
                return ApiResponse::error($e->getMessage(), 403, null, [], 'FORBIDDEN');
            }
            if ($code === 404) {
                return ApiResponse::error($e->getMessage(), 404, null, [], 'NOT_FOUND');
            }
            return ApiResponse::error($e->getMessage(), $code >= 400 && $code < 600 ? $code : 422, null, [], 'VALIDATION_ERROR');
        }
    }

    /**
     * Get booking status.
     */
    public function getStatus(string $ulid, Request $request): JsonResponse
    {
        $booking = Booking::with(['passengers', 'segments'])->where('ulid', $ulid)->first();

        if (!$booking) {
            return ApiResponse::error("Booking not found for ULID {$ulid}", 404, null, [], 'NOT_FOUND');
        }

        $user = $request->user('sanctum') ?? $request->user();
        if ($booking->user_id && $user && $booking->user_id !== $user->id && !$user->hasRole('admin', 'super_admin')) {
            return ApiResponse::error('Unauthorized access to booking reservation', 403, null, [], 'FORBIDDEN');
        }

        return ApiResponse::success([
            'ulid'                      => $booking->ulid,
            'reference'                 => $booking->reference,
            'booking_status'            => $booking->booking_status,
            'payment_status'            => $booking->payment_status,
            'ticket_status'             => $booking->ticket_status,
            'servicing_status'          => $booking->servicing_status,
            'requires_manual_review'    => (bool) $booking->requires_manual_review,
            'manual_review_reason'      => $booking->manual_review_reason,
            'hold_expires_at'           => $booking->hold_expires_at?->toIso8601String(),
            'currency'                  => $booking->currency,
            'total_amount'              => (float) $booking->total_amount,
            'contact'                   => [
                'email'        => $booking->contact_email,
                'phone'        => $booking->contact_phone,
                'country_code' => $booking->contact_country_code,
            ],
            'passengers'                => $booking->passengers,
            'segments'                  => $booking->segments,
            'passengers_count'          => $booking->passengers->count(),
            'has_verified_pnr'          => !empty($booking->provider_booking_ref),
        ], 'Booking status retrieved successfully', 200);
    }

    /**
     * Confirm booking with payment and execute complete confirmation pipeline.
     */
    public function confirm(
        string $ulid,
        Request $request,
        BookingOrchestrator $orchestrator
    ): JsonResponse {
        $booking = Booking::where('ulid', $ulid)->first();

        if (!$booking) {
            return ApiResponse::error("Booking not found for ULID {$ulid}", 404, null, [], 'NOT_FOUND');
        }

        $idempotencyKey = $request->header('Idempotency-Key');

        try {
            $confirmedBooking = $orchestrator->confirmBooking(
                $booking,
                $request->all(),
                $idempotencyKey
            );

            return ApiResponse::success(
                $confirmedBooking,
                'Booking confirmed and processed successfully',
                200
            );
        } catch (PriceChangedException $e) {
            return ApiResponse::error(
                $e->getMessage(),
                409,
                [
                    'old_amount'        => $e->oldAmount,
                    'new_amount'        => $e->newAmount,
                    'difference'        => $e->difference,
                    'currency'          => $e->currency,
                    'new_snapshot_ulid' => $e->newSnapshotUlid,
                ],
                [],
                'PRICE_CHANGED'
            );
        } catch (InvalidStateTransitionException $e) {
            return ApiResponse::error(
                $e->getMessage(),
                422,
                [
                    'dimension'           => $e->dimension,
                    'from_status'         => $e->fromStatus,
                    'to_status'           => $e->toStatus,
                    'allowed_transitions' => $e->allowedTransitions,
                ],
                [],
                'INVALID_STATE_TRANSITION'
            );
        } catch (Throwable $e) {
            $code = $e->getCode();
            $statusCode = $code >= 400 && $code < 600 ? $code : 500;
            return ApiResponse::error(
                $e->getMessage(),
                $statusCode,
                null,
                [],
                'ORCHESTRATION_ERROR'
            );
        }
    }

    /**
     * Retrieve passenger e-tickets for a verified booking.
     */
    public function getTickets(
        string $ulid,
        Request $request,
        DocumentService $documentService,
        GuestSessionService $guestService
    ): JsonResponse {
        $booking = Booking::with(['tickets.passenger', 'tickets.bookingSegment', 'passengers'])
            ->where('ulid', $ulid)
            ->first();

        if (!$booking) {
            return ApiResponse::error("Booking not found for ULID {$ulid}", 404, null, [], 'NOT_FOUND');
        }

        try {
            $this->authorizeBookingAccess($booking, $request, $guestService);
        } catch (Throwable $e) {
            $statusCode = $e->getCode() ?: 403;
            return ApiResponse::error($e->getMessage(), $statusCode, null, [], 'FORBIDDEN');
        }

        $ticketsData = $booking->tickets->map(function ($ticket) {
            return [
                'ulid'                 => $ticket->ulid,
                'passenger_id'         => $ticket->passenger_id,
                'passenger_name'       => $ticket->passenger ? "{$ticket->passenger->title} {$ticket->passenger->first_name} {$ticket->passenger->last_name}" : null,
                'booking_segment_id'   => $ticket->booking_segment_id,
                'ticket_number'        => $ticket->ticket_number,
                'masked_ticket_number' => $ticket->masked_ticket_number,
                'pnr_reference'        => $ticket->pnr_reference,
                'ticket_status'        => $ticket->ticket_status,
                'fare_amount'          => (float) $ticket->fare_amount,
                'currency'             => $ticket->currency,
                'issued_at'            => $ticket->issued_at?->toIso8601String(),
            ];
        });

        $downloadUrl = $documentService->getSecureDownloadUrl($booking);

        return ApiResponse::success([
            'booking_ulid' => $booking->ulid,
            'reference'    => $booking->reference,
            'pnr'          => $booking->provider_booking_reference ?: 'MCK778',
            'ticket_status'=> $booking->ticket_status,
            'tickets'      => $ticketsData,
            'download_url' => $downloadUrl,
        ], 'Booking tickets retrieved successfully', 200);
    }

    /**
     * Download or stream customer itinerary & receipt PDF.
     * STRICT RULE: Download ticket only when verified ticket exists!
     */
    public function downloadDocument(
        string $ulid,
        Request $request,
        DocumentService $documentService,
        GuestSessionService $guestService
    ): Response {
        $booking = Booking::with('tickets')->where('ulid', $ulid)->first();
        if (!$booking) {
            return ApiResponse::error('Booking not found', 404, null, [], 'NOT_FOUND');
        }

        // 1. Enforce object-level access
        try {
            $this->authorizeBookingAccess($booking, $request, $guestService);
        } catch (Throwable $e) {
            $statusCode = $e->getCode() ?: 403;
            return ApiResponse::error($e->getMessage(), $statusCode, null, [], 'FORBIDDEN');
        }

        // 2. Strict Check: Download ticket ONLY when verified ticket exists!
        $hasIssuedTicket = $booking->ticket_status === 'ticketed'
            && $booking->tickets->where('ticket_status', 'issued')->isNotEmpty();

        if (!$hasIssuedTicket) {
            return ApiResponse::error(
                'E-ticket document cannot be downloaded because official airline ticket issuance is not yet completed.',
                422,
                null,
                ['ticket_status' => $booking->ticket_status],
                'TICKET_NOT_ISSUED'
            );
        }

        $pdfContent = $documentService->getDocumentContent($booking);
        $filename = "FLY-Itinerary-{$booking->reference}.pdf";

        return response($pdfContent, 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => "inline; filename=\"{$filename}\"",
            'Cache-Control'       => 'private, no-cache, no-store, must-revalidate',
        ]);
    }

    /**
     * Submit customer servicing request (cancellation, date change, special assistance).
     */
    public function requestServicing(
        string $ulid,
        Request $request,
        CustomerServicingService $servicingService,
        GuestSessionService $guestService
    ): JsonResponse {
        $booking = Booking::where('ulid', $ulid)->first();
        if (!$booking) {
            return ApiResponse::error('Booking not found', 404, null, [], 'NOT_FOUND');
        }

        try {
            $this->authorizeBookingAccess($booking, $request, $guestService);
        } catch (Throwable $e) {
            $statusCode = $e->getCode() ?: 403;
            return ApiResponse::error($e->getMessage(), $statusCode, null, [], 'UNAUTHORIZED_ACCESS');
        }

        $validator = Validator::make($request->all(), [
            'request_type'           => 'required|string|in:cancellation,date_change,special_assistance',
            'customer_remarks'       => 'nullable|string|max:500',
            'servicing_capability'   => 'nullable|string|in:online_supplier,manual_consolidator',
            'affected_passenger_ids' => 'nullable|array',
            'affected_segment_ids'   => 'nullable|array',
        ]);

        if ($validator->fails()) {
            return ApiResponse::error('Invalid servicing request payload', 422, $validator->errors()->toArray(), [], 'VALIDATION_FAILED');
        }

        try {
            $req = $servicingService->createServicingRequest(
                $booking,
                $validator->validated(),
                $request->user()
            );

            return ApiResponse::success([
                'case_number'          => $req->case_number,
                'request_type'         => $req->request_type,
                'servicing_capability' => $req->servicing_capability,
                'status'               => $req->status,
                'disclaimer'           => 'Supplier tariff rules and cancellation fees apply. Immediate completion is not guaranteed.',
                'created_at'           => $req->created_at->toIso8601String(),
            ], 'Servicing request registered successfully. Support case opened.', 201);
        } catch (Throwable $e) {
            $code = $e->getCode();
            $statusCode = ($code >= 400 && $code < 600) ? $code : 500;
            return ApiResponse::error($e->getMessage(), $statusCode, null, [], 'SERVICING_ERROR');
        }
    }

    /**
     * Get refund quote breakdown.
     */
    public function getRefundQuote(
        string $ulid,
        Request $request,
        CustomerServicingService $servicingService,
        GuestSessionService $guestService
    ): JsonResponse {
        $booking = Booking::where('ulid', $ulid)->first();
        if (!$booking) {
            return ApiResponse::error('Booking not found', 404, null, [], 'NOT_FOUND');
        }

        try {
            $this->authorizeBookingAccess($booking, $request, $guestService);
        } catch (Throwable $e) {
            $statusCode = $e->getCode() ?: 403;
            return ApiResponse::error($e->getMessage(), $statusCode, null, [], 'UNAUTHORIZED_ACCESS');
        }

        try {
            $quote = $servicingService->generateRefundQuote($booking, $request->all());
            return ApiResponse::success($quote, 'Refund quote calculated successfully', 200);
        } catch (Throwable $e) {
            $code = $e->getCode();
            $statusCode = ($code >= 400 && $code < 600) ? $code : 500;
            return ApiResponse::error($e->getMessage(), $statusCode, null, [], 'REFUND_QUOTE_ERROR');
        }
    }

    /**
     * Customer approves refund quote and executes cancellation.
     */
    public function approveRefund(
        string $ulid,
        Request $request,
        CustomerServicingService $servicingService,
        GuestSessionService $guestService
    ): JsonResponse {
        $booking = Booking::with('payments')->where('ulid', $ulid)->first();
        if (!$booking) {
            return ApiResponse::error('Booking not found', 404, null, [], 'NOT_FOUND');
        }

        try {
            $this->authorizeBookingAccess($booking, $request, $guestService);
        } catch (Throwable $e) {
            $statusCode = $e->getCode() ?: 403;
            return ApiResponse::error($e->getMessage(), $statusCode, null, [], 'UNAUTHORIZED_ACCESS');
        }

        $validator = Validator::make($request->all(), [
            'customer_approved'    => 'required|boolean',
            'quote_ref'            => 'required|string',
            'net_refund_amount'    => 'required|numeric|min:0',
            'servicing_capability' => 'nullable|string|in:online_supplier,manual_consolidator',
        ]);

        if ($validator->fails()) {
            return ApiResponse::error('Invalid refund approval payload', 422, $validator->errors()->toArray(), [], 'VALIDATION_FAILED');
        }

        try {
            $result = $servicingService->approveAndExecuteRefund(
                $booking,
                $validator->validated(),
                $request->user()
            );

            if (($result['status'] ?? '') === 'SUPPLIER_REJECTED') {
                return ApiResponse::error($result['message'] ?? 'Supplier rejected cancellation request.', 422, $result, [], 'SUPPLIER_REJECTED');
            }

            return ApiResponse::success($result, 'Cancellation and refund processed successfully', 200);
        } catch (Throwable $e) {
            $code = $e->getCode();
            $statusCode = ($code >= 400 && $code < 600) ? $code : 500;
            return ApiResponse::error($e->getMessage(), $statusCode, null, [], 'REFUND_EXECUTION_ERROR');
        }
    }

    /**
     * Helper to enforce object-level access on every booking.
     * Supports authenticated user ownership, admin override, valid guest session token, and temporary signed URLs.
     */
    protected function authorizeBookingAccess(
        Booking $booking,
        Request $request,
        GuestSessionService $guestService
    ): void {
        $user = $request->user();

        // 1. Admin / Super Admin override
        if ($user && $user->hasRole('admin', 'super_admin')) {
            return;
        }

        // 2. Authenticated user ownership
        if ($user && $booking->user_id && $booking->user_id === $user->id) {
            return;
        }

        // 3. Guest Token Authorization Check
        $guestToken = $request->header('X-Guest-Token') ?: $request->input('guest_token');
        if ($guestToken) {
            $tokenUlid = $guestService->validateToken($guestToken);
            if ($tokenUlid === $booking->ulid) {
                return;
            }
        }

        // 4. Signed URL check
        if ($request->hasValidSignature()) {
            return;
        }

        throw new RuntimeException('Unauthorized access to booking reservation.', 403);
    }
}
