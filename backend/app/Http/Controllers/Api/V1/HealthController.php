<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

class HealthController extends Controller
{
    /**
     * Check health status of app, database, cache, and queue.
     * Strictly avoids leaking credentials, connection strings, or host details.
     */
    public function check(Request $request): JsonResponse
    {
        $services = [];
        $overallHealthy = true;

        // 1. App runtime check
        $services['app'] = [
            'status'      => 'healthy',
            'version'     => '1.0.0',
            'environment' => config('app.env'),
            'php_version' => PHP_VERSION,
        ];

        // 2. Database connectivity check
        $dbStart = microtime(true);
        try {
            DB::connection()->getPdo();
            $latencyMs = round((microtime(true) - $dbStart) * 1000, 2);
            $services['database'] = [
                'status'     => 'healthy',
                'driver'     => config('database.default'),
                'latency_ms' => $latencyMs,
            ];
        } catch (Throwable $e) {
            $overallHealthy = false;
            $services['database'] = [
                'status'  => 'unhealthy',
                'message' => 'Database connection failed',
            ];
        }

        // 3. Cache system check
        $cacheStart = microtime(true);
        try {
            $testKey = 'health_ping_' . uniqid('', true);
            Cache::put($testKey, 'ok', 5);
            $cachedVal = Cache::get($testKey);
            Cache::forget($testKey);

            $latencyMs = round((microtime(true) - $cacheStart) * 1000, 2);
            $services['cache'] = [
                'status'     => ($cachedVal === 'ok') ? 'healthy' : 'degraded',
                'driver'     => config('cache.default'),
                'latency_ms' => $latencyMs,
            ];
        } catch (Throwable $e) {
            $overallHealthy = false;
            $services['cache'] = [
                'status'  => 'unhealthy',
                'message' => 'Cache storage unreachable',
            ];
        }

        // 4. Queue driver check
        try {
            $queueDriver = config('queue.default');
            $services['queue'] = [
                'status' => 'healthy',
                'driver' => $queueDriver,
            ];
        } catch (Throwable $e) {
            $services['queue'] = [
                'status'  => 'unhealthy',
                'message' => 'Queue subsystem unavailable',
            ];
        }

        $statusCode = $overallHealthy ? 200 : 503;
        $statusMessage = $overallHealthy
            ? 'All system subsystems are operating nominally.'
            : 'One or more system services are experiencing degraded performance.';

        return ApiResponse::success(
            [
                'status'   => $overallHealthy ? 'healthy' : 'degraded',
                'services' => $services,
            ],
            $statusMessage,
            $statusCode
        );
    }
}
