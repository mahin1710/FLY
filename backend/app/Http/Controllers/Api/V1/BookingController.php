<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\V1\AddPassengersRequest;
use App\Http\Requests\V1\CreateBookingDraftRequest;
use App\Http\Responses\ApiResponse;
use App\Models\Booking;
use App\Services\BookingDraftService;
use App\Services\PassengerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class BookingController extends Controller
{
    /**
     * Create a booking draft and hold seats for 15 minutes.
     * Enforces Idempotency-Key and resolves price strictly on the server.
     */
    public function createDraft(
        CreateBookingDraftRequest $request,
        BookingDraftService $draftService
    ): JsonResponse {
        try {
            $idempotencyKey = $request->header('Idempotency-Key');

            $booking = $draftService->createDraft(
                $request->validated(),
                $request->user(),
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
                $request->user()
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
            if ($code === 410) {
                return ApiResponse::error($e->getMessage(), 410, null, [], 'HOLD_EXPIRED');
            }
            return ApiResponse::error($e->getMessage(), 422, null, [], 'VALIDATION_ERROR');
        }
    }

    /**
     * Retrieve complete booking lifecycle status (Booking, Payment, Ticket, Servicing).
     * Protected against IDOR when accessed by customer tokens.
     */
    public function getStatus(string $ulid, Request $request): JsonResponse
    {
        $booking = Booking::with([
            'segments.originAirport',
            'segments.destinationAirport',
            'segments.marketingAirline',
            'passengers.document',
            'priceSnapshot',
            'payments',
            'events',
        ])
        ->where('ulid', $ulid)
        ->orWhere('reference', $ulid)
        ->first();

        if (!$booking) {
            return ApiResponse::error('Booking record not found.', 404, null, [], 'NOT_FOUND');
        }

        // IDOR check: if caller is authenticated, verify ownership unless admin
        $user = $request->user();
        if ($user && $booking->user_id !== $user->id && !$user->hasRole(['admin', 'super_admin'])) {
            return ApiResponse::error('Forbidden. You do not have permission to view this booking.', 403, null, [], 'FORBIDDEN');
        }

        return ApiResponse::success([
            'ulid'             => $booking->ulid,
            'reference'        => $booking->reference,
            'booking_status'   => $booking->booking_status,
            'payment_status'   => $booking->payment_status,
            'ticket_status'    => $booking->ticket_status,
            'servicing_status' => $booking->servicing_status,
            'hold_expires_at'  => $booking->hold_expires_at?->toIso8601String(),
            'currency'         => $booking->currency,
            'total_amount'     => (float) $booking->total_amount,
            'contact'          => [
                'email'        => $booking->contact_email,
                'phone'        => $booking->contact_phone,
                'country_code' => $booking->contact_country_code,
            ],
            'price_breakdown'  => $booking->priceSnapshot?->breakdown_payload,
            'segments'         => $booking->segments,
            'passengers'       => $booking->passengers,
            'created_at'       => $booking->created_at?->toIso8601String(),
            'updated_at'       => $booking->updated_at?->toIso8601String(),
        ], 'Booking status retrieved successfully');
    }
}
