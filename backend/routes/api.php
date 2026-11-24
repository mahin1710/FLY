<?php

use App\Http\Controllers\Api\V1\Admin\AdminController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\BookingController;
use App\Http\Controllers\Api\V1\DocsController;
use App\Http\Controllers\Api\V1\FlightController;
use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\PaymentController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes — Version 1 (/api/v1)
|--------------------------------------------------------------------------
|
| Base API routes for the FLY Flight Ticketing Platform.
| Enforces correlation IDs, security headers, role authorization policies,
| and consistent JSON envelopes.
|
*/

Route::prefix('v1')->group(function () {
    // -------------------------------------------------------------
    // 1. HEALTH & SYSTEM DIAGNOSTICS (PUBLIC)
    // -------------------------------------------------------------
    Route::get('/health', [HealthController::class, 'check'])->name('v1.health');

    // -------------------------------------------------------------
    // 2. OPENAPI DOCUMENTATION SPECIFICATION (PUBLIC)
    // -------------------------------------------------------------
    Route::get('/docs', [DocsController::class, 'spec'])->name('v1.docs');

    // -------------------------------------------------------------
    // 3. FLIGHT SEARCH, OFFERS & REPRICING (PUBLIC / RATE LIMITED)
    // -------------------------------------------------------------
    Route::prefix('flights')->group(function () {
        Route::post('/search', [FlightController::class, 'search'])->name('v1.flights.search');
        Route::get('/offers/{uuid}', [FlightController::class, 'getOffer'])->name('v1.flights.offer');
        Route::post('/offers/{uuid}/reprice', [FlightController::class, 'reprice'])->name('v1.flights.reprice');
    });

    // -------------------------------------------------------------
    // 4. BOOKING RESERVATION DRAFT & PASSENGERS (PUBLIC / OPTIONAL AUTH)
    // -------------------------------------------------------------
    Route::prefix('bookings')->group(function () {
        Route::get('/', [BookingController::class, 'index'])->name('v1.bookings.index');
        Route::post('/guest-retrieve', [BookingController::class, 'guestRetrieve'])
            ->middleware('throttle:5,1')
            ->name('v1.bookings.guest_retrieve');
        Route::post('/draft', [BookingController::class, 'createDraft'])->name('v1.bookings.draft');
        Route::post('/{ulid}/passengers', [BookingController::class, 'addPassengers'])->name('v1.bookings.passengers');
        Route::get('/{ulid}', [BookingController::class, 'show'])->name('v1.bookings.show');
        Route::get('/{ulid}/status', [BookingController::class, 'getStatus'])->name('v1.bookings.status');
        Route::post('/{ulid}/confirm', [BookingController::class, 'confirm'])->name('v1.bookings.confirm');
        Route::get('/{ulid}/tickets', [BookingController::class, 'getTickets'])->name('v1.bookings.tickets');
        Route::get('/{ulid}/document', [BookingController::class, 'downloadDocument'])->name('v1.bookings.document.download');

        // Servicing, Cancellation & Refund
        Route::post('/{ulid}/servicing/request', [BookingController::class, 'requestServicing'])->name('v1.bookings.servicing.request');
        Route::post('/{ulid}/servicing/refund-quote', [BookingController::class, 'getRefundQuote'])->name('v1.bookings.servicing.refund_quote');
        Route::post('/{ulid}/servicing/refund-approve', [BookingController::class, 'approveRefund'])->name('v1.bookings.servicing.refund_approve');
    });

    // -------------------------------------------------------------
    // 5. PAYMENT GATEWAY INTEGRATION (SANDBOX & IPN WEBHOOKS)
    // -------------------------------------------------------------
    Route::prefix('payments')->group(function () {
        Route::post('/intent', [PaymentController::class, 'createIntent'])->name('v1.payments.intent');
        Route::post('/ipn', [PaymentController::class, 'handleIpnWebhook'])->name('v1.payments.ipn');
        Route::get('/{transactionId}/status', [PaymentController::class, 'getStatus'])->name('v1.payments.status');
    });

    // -------------------------------------------------------------
    // 6. AUTHENTICATION (RATE LIMITED: 10 ATTEMPTS / MINUTE)
    // -------------------------------------------------------------
    Route::middleware('throttle:10,1')->prefix('auth')->group(function () {
        Route::post('/register', [AuthController::class, 'register'])->name('v1.auth.register');
        Route::post('/login', [AuthController::class, 'login'])->name('v1.auth.login');
    });

    // -------------------------------------------------------------
    // 6. AUTHENTICATED USER ROUTES (SANCTUM PROTECTED)
    // -------------------------------------------------------------
    Route::middleware('auth:sanctum')->group(function () {
        Route::prefix('auth')->group(function () {
            Route::post('/logout', [AuthController::class, 'logout'])->name('v1.auth.logout');
            Route::get('/me', [AuthController::class, 'me'])->name('v1.auth.me');
        });

        // ---------------------------------------------------------
        // 7. ADMINISTRATIVE RESTRICTED ENDPOINTS
        // ---------------------------------------------------------
        Route::prefix('admin')
            ->middleware('role:admin,super_admin')
            ->group(function () {
                Route::get('/overview', [AdminController::class, 'overview'])->name('v1.admin.overview');
                Route::get('/users', [AdminController::class, 'users'])->name('v1.admin.users');
                Route::post('/payments/{ulid}/refund', [PaymentController::class, 'refund'])->name('v1.admin.payments.refund');
            });
    });
});
