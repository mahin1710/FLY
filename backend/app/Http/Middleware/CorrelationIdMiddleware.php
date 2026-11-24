<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class CorrelationIdMiddleware
{
    /**
     * Handle an incoming request and assign a request correlation ID.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $correlationId = $request->header('X-Correlation-ID');

        if (empty($correlationId) || !is_string($correlationId)) {
            $correlationId = (string) Str::uuid();
        }

        // Store correlation ID on request attributes for downstream controllers/exceptions
        $request->attributes->set('correlation_id', $correlationId);

        $response = $next($request);

        // Append X-Correlation-ID header to outgoing response
        $response->headers->set('X-Correlation-ID', $correlationId);

        return $response;
    }
}
