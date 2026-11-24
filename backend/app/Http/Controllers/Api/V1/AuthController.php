<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Responses\ApiResponse;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    /**
     * Register a new customer account.
     */
    public function register(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name'     => ['required', 'string', 'max:255'],
            'email'    => ['required', 'string', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
            'phone'    => ['nullable', 'string', 'max:30'],
        ]);

        $user = User::create([
            'name'     => $validated['name'],
            'email'    => strtolower(trim($validated['email'])),
            'password' => $validated['password'], // Casts handles hashing automatically
            'role'     => 'customer',
            'status'   => 'active',
            'phone'    => $validated['phone'] ?? null,
        ]);

        $token = $user->createToken('customer-auth-token', ['customer:access'])->plainTextToken;

        return ApiResponse::success([
            'user' => [
                'id'         => $user->id,
                'name'       => $user->name,
                'email'      => $user->email,
                'role'       => $user->role,
                'status'     => $user->status,
                'phone'      => $user->phone,
                'created_at' => $user->created_at?->toIso8601String(),
            ],
            'token'      => $token,
            'token_type' => 'Bearer',
        ], 'Account registered successfully.', 201);
    }

    /**
     * Authenticate an existing user (customer or administrator).
     */
    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email'    => ['required', 'string', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('email', strtolower(trim($validated['email'])))->first();

        if (!$user || !Hash::check($validated['password'], $user->password)) {
            return ApiResponse::error('Invalid email or password.', 401);
        }

        if (!$user->isActive()) {
            return ApiResponse::error('Your account is suspended or inactive. Please contact support.', 403);
        }

        // Grant role-appropriate abilities
        $abilities = $user->isAdmin()
            ? ['admin:access', 'customer:access']
            : ['customer:access'];

        $tokenName = $user->isAdmin() ? 'admin-auth-token' : 'customer-auth-token';
        $token = $user->createToken($tokenName, $abilities)->plainTextToken;

        return ApiResponse::success([
            'user' => [
                'id'         => $user->id,
                'name'       => $user->name,
                'email'      => $user->email,
                'role'       => $user->role,
                'status'     => $user->status,
                'phone'      => $user->phone,
                'created_at' => $user->created_at?->toIso8601String(),
            ],
            'token'      => $token,
            'token_type' => 'Bearer',
            'abilities'  => $abilities,
        ], 'Authentication successful.');
    }

    /**
     * Terminate current access token session.
     */
    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return ApiResponse::success(null, 'Successfully logged out.');
    }

    /**
     * Return authenticated user profile.
     */
    public function me(Request $request): JsonResponse
    {
        $user = $request->user();

        return ApiResponse::success([
            'user' => [
                'id'         => $user->id,
                'name'       => $user->name,
                'email'      => $user->email,
                'role'       => $user->role,
                'status'     => $user->status,
                'phone'      => $user->phone,
                'created_at' => $user->created_at?->toIso8601String(),
            ],
            'abilities' => $user->currentAccessToken()->abilities ?? [],
        ], 'Profile retrieved successfully.');
    }
}
