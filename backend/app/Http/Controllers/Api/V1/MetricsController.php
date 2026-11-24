<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Responses\ApiResponse;
use App\Services\Support\ObservabilityService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MetricsController extends Controller
{
    /**
     * System reliability, performance, and health metrics endpoint.
     */
    public function index(ObservabilityService $observabilityService): JsonResponse
    {
        $metrics = $observabilityService->getMetrics();

        return ApiResponse::success(
            $metrics,
            'System observability and performance metrics retrieved successfully.'
        );
    }
}
