<?php

use App\Http\Controllers\Api\V1\Admin\AdminController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\DocsController;
use App\Http\Controllers\Api\V1\HealthController;
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
    // 3. AUTHENTICATION (RATE LIMITED: 10 ATTEMPTS / MINUTE)
    // -------------------------------------------------------------
    Route::middleware('throttle:10,1')->prefix('auth')->group(function () {
        Route::post('/register', [AuthController::class, 'register'])->name('v1.auth.register');
        Route::post('/login', [AuthController::class, 'login'])->name('v1.auth.login');
    });

    // -------------------------------------------------------------
    // 4. AUTHENTICATED USER ROUTES (SANCTUM PROTECTED)
    // -------------------------------------------------------------
    Route::middleware('auth:sanctum')->group(function () {
        Route::prefix('auth')->group(function () {
            Route::post('/logout', [AuthController::class, 'logout'])->name('v1.auth.logout');
            Route::get('/me', [AuthController::class, 'me'])->name('v1.auth.me');
        });

        // ---------------------------------------------------------
        // 5. ADMINISTRATIVE RESTRICTED ENDPOINTS
        // ---------------------------------------------------------
        Route::prefix('admin')
            ->middleware('role:admin,super_admin')
            ->group(function () {
                Route::get('/overview', [AdminController::class, 'overview'])->name('v1.admin.overview');
                Route::get('/users', [AdminController::class, 'users'])->name('v1.admin.users');
            });
    });
});
