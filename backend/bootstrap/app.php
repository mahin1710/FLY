<?php

use App\Http\Middleware\CorrelationIdMiddleware;
use App\Http\Middleware\EnsureUserHasRole;
use App\Http\Middleware\SecurityHeadersMiddleware;
use App\Http\Responses\ApiResponse;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Global correlation ID & security headers for all incoming requests
        $middleware->append(CorrelationIdMiddleware::class);
        $middleware->append(SecurityHeadersMiddleware::class);

        // Alias for role authorization policy middleware
        $middleware->alias([
            'role' => EnsureUserHasRole::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Enforce JSON rendering for all API routes and JSON-expecting clients
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson()
        );

        // 1. Validation Exception (HTTP 422)
        $exceptions->render(function (ValidationException $e, Request $request) {
            if ($request->is('api/*') || $request->expectsJson()) {
                return ApiResponse::error(
                    'The given data was invalid.',
                    422,
                    $e->errors(),
                    [],
                    'VALIDATION_ERROR'
                );
            }
        });

        // 2. Authentication Exception (HTTP 401)
        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if ($request->is('api/*') || $request->expectsJson()) {
                return ApiResponse::error(
                    'Unauthenticated. A valid Bearer token is required.',
                    401,
                    null,
                    [],
                    'UNAUTHENTICATED'
                );
            }
        });

        // 3. Authorization Exception (HTTP 403)
        $exceptions->render(function (AuthorizationException|AccessDeniedHttpException $e, Request $request) {
            if ($request->is('api/*') || $request->expectsJson()) {
                return ApiResponse::error(
                    'Forbidden. You do not have the required permissions for this action.',
                    403,
                    null,
                    [],
                    'FORBIDDEN'
                );
            }
        });

        // 4. Model / Route Not Found Exception (HTTP 404)
        $exceptions->render(function (ModelNotFoundException|NotFoundHttpException $e, Request $request) {
            if ($request->is('api/*') || $request->expectsJson()) {
                return ApiResponse::error(
                    'Resource or endpoint not found.',
                    404,
                    null,
                    [],
                    'NOT_FOUND'
                );
            }
        });

        // 5. Rate Limit / Throttling Exception (HTTP 429)
        $exceptions->render(function (ThrottleRequestsException|TooManyRequestsHttpException $e, Request $request) {
            if ($request->is('api/*') || $request->expectsJson()) {
                return ApiResponse::error(
                    'Too many requests. Please slow down and try again later.',
                    429,
                    null,
                    [],
                    'RATE_LIMITED'
                );
            }
        });

        // 6. Centralized Fallback for all other Exceptions (HTTP 500)
        $exceptions->render(function (Throwable $e, Request $request) {
            if ($request->is('api/*') || $request->expectsJson()) {
                $isDebug = (bool) config('app.debug', false);
                $message = $isDebug
                    ? $e->getMessage()
                    : 'An unexpected internal server error occurred. Please contact system support.';

                $meta = [];
                if ($isDebug) {
                    $meta['exception'] = get_class($e);
                    $meta['file'] = $e->getFile();
                    $meta['line'] = $e->getLine();
                }

                return ApiResponse::error(
                    $message,
                    500,
                    null,
                    $meta,
                    'INTERNAL_ERROR'
                );
            }
        });
    })->create();
