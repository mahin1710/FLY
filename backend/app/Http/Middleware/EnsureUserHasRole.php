<?php

namespace App\Http\Middleware;

use App\Http\Responses\ApiResponse;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureUserHasRole
{
    /**
     * Handle an incoming request and enforce user role authorization.
     */
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();

        if (!$user) {
            return ApiResponse::error('Unauthenticated.', 401);
        }

        if (!$user->isActive()) {
            return ApiResponse::error('Your account is suspended or inactive.', 403);
        }

        if (!empty($roles) && !in_array($user->role, $roles, true)) {
            return ApiResponse::error(
                'Forbidden: You do not have permission to access this administrative resource.',
                403
            );
        }

        return $next($request);
    }
}
