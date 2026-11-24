<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Responses\ApiResponse;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminController extends Controller
{
    /**
     * Administrative system metrics and operations overview.
     */
    public function overview(Request $request): JsonResponse
    {
        $user = $request->user();

        // Enforce admin permission
        if (!$user || !$user->isAdmin()) {
            return ApiResponse::error('Forbidden: Administrator access required.', 403);
        }

        $metrics = [
            'total_users'     => User::count(),
            'customers_count' => User::where('role', 'customer')->count(),
            'admins_count'    => User::whereIn('role', ['admin', 'super_admin'])->count(),
            'active_accounts' => User::where('status', 'active')->count(),
            'system_time'     => now()->toIso8601String(),
            'environment'     => config('app.env'),
        ];

        return ApiResponse::success($metrics, 'Admin metrics overview retrieved successfully.');
    }

    /**
     * List all registered system users (paginated).
     */
    public function users(Request $request): JsonResponse
    {
        $user = $request->user();

        if (!$user || !$user->isAdmin()) {
            return ApiResponse::error('Forbidden: Administrator access required.', 403);
        }

        $users = User::select(['id', 'name', 'email', 'role', 'status', 'phone', 'created_at'])
            ->orderBy('id', 'desc')
            ->paginate(15);

        return ApiResponse::success([
            'users' => $users->items(),
            'pagination' => [
                'current_page' => $users->currentPage(),
                'per_page'     => $users->perPage(),
                'total'        => $users->total(),
                'last_page'    => $users->lastPage(),
            ],
        ], 'Users list retrieved successfully.');
    }
}
