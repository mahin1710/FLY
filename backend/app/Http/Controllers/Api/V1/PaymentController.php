<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Responses\ApiResponse;
use App\Models\Booking;
use App\Models\Payment;
use App\Services\Payments\PaymentGatewayInterface;
use App\Services\Payments\PaymentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Throwable;

class PaymentController extends Controller
{
    /**
     * Create payment session / intent for a held booking.
     * The amount and currency are determined exclusively by the server;
     * client-provided financial amounts are completely ignored.
     */
    public function createIntent(Request $request, PaymentService $paymentService): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'booking_ulid' => 'required|string|exists:bookings,ulid',
            'success_url'  => 'nullable|url',
            'fail_url'     => 'nullable|url',
            'cancel_url'   => 'nullable|url',
        ]);

        if ($validator->fails()) {
            return ApiResponse::error(
                'Invalid payment initiation request',
                422,
                $validator->errors()->toArray(),
                [],
                'VALIDATION_FAILED'
            );
        }

        try {
            $booking = Booking::where('ulid', $request->input('booking_ulid'))->firstOrFail();

            $session = $paymentService->createIntent($booking, [
                'success_url' => $request->input('success_url'),
                'fail_url'    => $request->input('fail_url'),
                'cancel_url'  => $request->input('cancel_url'),
            ]);

            return ApiResponse::success(
                $session->toArray(),
                'Payment intent initialized successfully',
                201
            );
        } catch (Throwable $e) {
            $statusCode = $e->getCode();
            $code = ($statusCode >= 400 && $statusCode < 600) ? $statusCode : 500;
            return ApiResponse::error($e->getMessage(), $code, null, [], 'PAYMENT_INITIATION_FAILED');
        }
    }

    /**
     * Handle Server-to-Server IPN / Webhook Callback.
     * Validates authentic signature/credentials against the gateway validation API,
     * deduplicates incoming webhooks idempotently, detects fraud/amount mismatches,
     * and transitions booking and payment states safely.
     */
    public function handleIpnWebhook(Request $request, PaymentService $paymentService): JsonResponse
    {
        try {
            $payload = $request->all();
            $result = $paymentService->handleIpnWebhook($payload);

            if (($result['status'] ?? '') === 'rejected') {
                return ApiResponse::error(
                    $result['message'] ?? 'Gateway validation signature rejected',
                    403,
                    $result,
                    [],
                    'SIGNATURE_VERIFICATION_FAILED'
                );
            }

            if (($result['status'] ?? '') === 'mismatched_amount') {
                return ApiResponse::error(
                    $result['message'] ?? 'Payment amount or currency mismatch detected',
                    422,
                    $result,
                    [],
                    'AMOUNT_CURRENCY_MISMATCH'
                );
            }

            if (($result['status'] ?? '') === 'unknown_transaction') {
                return ApiResponse::error(
                    $result['message'] ?? 'Unknown transaction reference',
                    404,
                    $result,
                    [],
                    'TRANSACTION_NOT_FOUND'
                );
            }

            // Captured or already_processed return 200 HTTP OK
            return ApiResponse::success(
                $result,
                $result['status'] === 'already_processed'
                    ? 'Webhook already processed (Idempotent response)'
                    : 'Payment verified and captured successfully',
                200
            );
        } catch (Throwable $e) {
            return ApiResponse::error($e->getMessage(), 500, null, [], 'WEBHOOK_PROCESSING_ERROR');
        }
    }

    /**
     * Query safe status of a payment attempt by merchant transaction ID.
     * Does NOT expose raw credit card numbers or gateway secrets.
     */
    public function getStatus(string $transactionId, PaymentGatewayInterface $gateway): JsonResponse
    {
        $payment = Payment::with('booking')
            ->where('gateway_transaction_id', $transactionId)
            ->first();

        if (!$payment) {
            return ApiResponse::error("Transaction not found for ID {$transactionId}", 404, null, [], 'NOT_FOUND');
        }

        return ApiResponse::success([
            'payment_ulid'           => $payment->ulid,
            'gateway_transaction_id' => $payment->gateway_transaction_id,
            'gateway_provider'       => $payment->gateway_provider,
            'payment_method'         => $payment->payment_method,
            'amount'                 => (float) $payment->amount,
            'currency'               => $payment->currency,
            'status'                 => $payment->status,
            'card_brand'             => $payment->card_brand,
            'card_last_four'         => $payment->card_last_four,
            'captured_at'            => $payment->captured_at?->toIso8601String(),
            'booking'                => [
                'ulid'           => $payment->booking->ulid,
                'reference'      => $payment->booking->reference,
                'booking_status' => $payment->booking->booking_status,
                'payment_status' => $payment->booking->payment_status,
                'ticket_status'  => $payment->booking->ticket_status,
            ],
            'disclaimer'             => 'Payment confirmation is finalized server-to-server; return URLs are for user interface orientation only.',
        ], 'Payment status retrieved successfully', 200);
    }

    /**
     * Refund a captured payment (Admin / Servicing only).
     */
    public function refund(string $ulid, Request $request, PaymentService $paymentService): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'amount' => 'required|numeric|min:0.01',
            'reason' => 'required|string|max:255',
        ]);

        if ($validator->fails()) {
            return ApiResponse::error(
                'Invalid refund payload',
                422,
                $validator->errors()->toArray(),
                [],
                'VALIDATION_FAILED'
            );
        }

        try {
            $payment = Payment::where('ulid', $ulid)->firstOrFail();

            $refund = $paymentService->processRefund(
                $payment,
                (float) $request->input('amount'),
                $request->input('reason'),
                $request->user()
            );

            return ApiResponse::success([
                'refund_ulid'      => $refund->ulid,
                'refund_reference' => $refund->refund_reference,
                'payment_ulid'     => $payment->ulid,
                'net_amount'       => (float) $refund->net_refund_amount,
                'currency'         => $refund->currency,
                'status'           => $refund->status,
                'settled_at'       => $refund->settled_at?->toIso8601String(),
            ], 'Payment refunded successfully', 200);
        } catch (Throwable $e) {
            $statusCode = $e->getCode();
            $code = ($statusCode >= 400 && $statusCode < 600) ? $statusCode : 500;
            return ApiResponse::error($e->getMessage(), $code, null, [], 'REFUND_FAILED');
        }
    }
}
