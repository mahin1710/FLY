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
            ->middleware('role:admin,super_admin,operations_admin,ticketing_agent,finance_admin,support_agent,pricing_manager,content_manager')
            ->group(function () {
                // Legacy compatibility
                Route::get('/overview', [AdminController::class, 'overview'])->name('v1.admin.overview');
                Route::post('/payments/{ulid}/refund', [PaymentController::class, 'refund'])->name('v1.admin.payments.refund');

                // 1. Dashboard
                Route::get('/dashboard', [AdminController::class, 'dashboard'])->name('v1.admin.dashboard');

                // 2. Bookings
                Route::get('/bookings', [AdminController::class, 'bookings'])->name('v1.admin.bookings');
                Route::get('/bookings/{ulid}', [AdminController::class, 'bookingDetail'])->name('v1.admin.bookings.detail');

                // 3. Ticketing Queue
                Route::get('/ticketing-queue', [AdminController::class, 'ticketingQueue'])->name('v1.admin.ticketing_queue');
                Route::post('/ticketing/{ulid}/reconcile', [AdminController::class, 'reconcileTicket'])->name('v1.admin.ticketing.reconcile');
                Route::post('/ticketing/{ulid}/escalate', [AdminController::class, 'escalateTicket'])->name('v1.admin.ticketing.escalate');
                Route::post('/ticketing/{ulid}/force-ticket', [AdminController::class, 'forceTicketAttempt'])->name('v1.admin.ticketing.force_ticket');

                // 4. Payments
                Route::get('/payments', [AdminController::class, 'payments'])->name('v1.admin.payments');
                Route::post('/payments/{id}/reconcile', [AdminController::class, 'reconcilePayment'])->name('v1.admin.payments.reconcile');

                // 5. Servicing & Refunds
                Route::get('/servicing', [AdminController::class, 'servicing'])->name('v1.admin.servicing');
                Route::post('/servicing/{id}/disburse-refund', [AdminController::class, 'disburseRefund'])->name('v1.admin.servicing.disburse_refund');

                // 6. Customers
                Route::get('/customers', [AdminController::class, 'customers'])->name('v1.admin.customers');
                Route::get('/customers/{id}', [AdminController::class, 'customerDetail'])->name('v1.admin.customers.detail');

                // 7. Provider Settings
                Route::get('/providers', [AdminController::class, 'providers'])->name('v1.admin.providers');
                Route::post('/providers/{code}/toggle-mode', [AdminController::class, 'toggleProviderMode'])->name('v1.admin.providers.toggle_mode');

                // 8. Pricing & Markups
                Route::get('/pricing-rules', [AdminController::class, 'pricingRules'])->name('v1.admin.pricing_rules');
                Route::post('/pricing-rules', [AdminController::class, 'createPricingRule'])->name('v1.admin.pricing_rules.create');

                // 9. Content Management
                Route::get('/content', [AdminController::class, 'contentBanners'])->name('v1.admin.content');
                Route::post('/content', [AdminController::class, 'createContentBanner'])->name('v1.admin.content.create');

                // 10. Users & Roles
                Route::get('/users', [AdminController::class, 'users'])->name('v1.admin.users');
                Route::post('/users/{id}/revoke-sessions', [AdminController::class, 'revokeSessions'])->name('v1.admin.users.revoke_sessions');
                Route::get('/audit-logs', [AdminController::class, 'auditLogs'])->name('v1.admin.audit_logs');

                // 11. Reports & Exports
                Route::get('/reports', [AdminController::class, 'reports'])->name('v1.admin.reports');
                Route::get('/reports/export', [AdminController::class, 'exportReports'])->name('v1.admin.reports.export');

                // 12. Dual Approvals
                Route::get('/dual-approvals', [AdminController::class, 'dualApprovals'])->name('v1.admin.dual_approvals');
                Route::post('/dual-approvals/{id}/decide', [AdminController::class, 'decideDualApproval'])->name('v1.admin.dual_approvals.decide');
            });
    });
});
