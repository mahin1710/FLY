<?php

namespace App\Http\Responses;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;

class ApiResponse
{
    /**
     * Create a standard successful JSON response envelope.
     */
    public static function success(
        mixed $data = null,
        string $message = 'Operation successful',
        int $statusCode = 200,
        array $meta = []
    ): JsonResponse {
        $correlationId = request()->attributes->get('correlation_id')
            ?? request()->header('X-Correlation-ID')
            ?? (string) Str::uuid();

        $payload = [
            'success' => true,
            'message' => $message,
            'data'    => $data,
            'meta'    => array_merge([
                'correlation_id' => $correlationId,
                'timestamp'      => now()->toIso8601String(),
            ], $meta),
        ];

        return response()->json($payload, $statusCode)
            ->header('X-Correlation-ID', $correlationId);
    }

    /**
     * Create a standard error JSON response envelope.
     */
    public static function error(
        string $message = 'An error occurred',
        int $statusCode = 400,
        mixed $errors = null,
        array $meta = []
    ): JsonResponse {
        $correlationId = request()->attributes->get('correlation_id')
            ?? request()->header('X-Correlation-ID')
            ?? (string) Str::uuid();

        $payload = [
            'success' => false,
            'message' => $message,
            'errors'  => $errors,
            'meta'    => array_merge([
                'correlation_id' => $correlationId,
                'timestamp'      => now()->toIso8601String(),
            ], $meta),
        ];

        return response()->json($payload, $statusCode)
            ->header('X-Correlation-ID', $correlationId);
    }
}
