<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\V1\FlightSearchRequest;
use App\Http\Responses\ApiResponse;
use App\Services\FlightOfferService;
use App\Services\FlightSearchService;
use App\Services\PricingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class FlightController extends Controller
{
    /**
     * Search available flight offers.
     */
    public function search(FlightSearchRequest $request, FlightSearchService $searchService): JsonResponse
    {
        try {
            $result = $searchService->search(
                $request->validated(),
                $request->user(),
                $request->ip()
            );

            if ($result->offersCount === 0) {
                return ApiResponse::error(
                    'No flight offers found matching the specified search criteria.',
                    404,
                    null,
                    [],
                    'NO_OFFERS'
                );
            }

            return ApiResponse::success(
                $result->toArray(),
                'Flight offers retrieved successfully',
                200
            );
        } catch (Throwable $e) {
            $statusCode = $e->getCode() >= 400 && $e->getCode() <= 500 ? $e->getCode() : 500;
            return ApiResponse::error(
                $e->getMessage(),
                $statusCode,
                null,
                [],
                'PROVIDER_UNAVAILABLE'
            );
        }
    }

    /**
     * Retrieve flight offer details by UUID.
     */
    public function getOffer(string $uuid, FlightOfferService $offerService, Request $request): JsonResponse
    {
        try {
            $offer = $offerService->getOfferByUuid($uuid, $request->user());

            return ApiResponse::success(
                $offer->toArray(),
                'Flight offer details retrieved successfully',
                200
            );
        } catch (Throwable $e) {
            $code = $e->getCode();
            if ($code === 410) {
                return ApiResponse::error($e->getMessage(), 410, null, [], 'OFFER_EXPIRED');
            }
            if ($code === 404) {
                return ApiResponse::error($e->getMessage(), 404, null, [], 'NOT_FOUND');
            }
            return ApiResponse::error($e->getMessage(), 500, null, [], 'INTERNAL_ERROR');
        }
    }

    /**
     * Reprice an existing offer before checkout commitment.
     */
    public function reprice(string $uuid, PricingService $pricingService, Request $request): JsonResponse
    {
        try {
            $repriceResult = $pricingService->reprice($uuid, $request->user());

            $errorCode = $repriceResult->hasPriceChanged ? 'PRICE_CHANGED' : null;

            return ApiResponse::success(
                $repriceResult->toArray(),
                $repriceResult->hasPriceChanged
                    ? 'Price changed based on current airline inventory'
                    : 'Flight price confirmed and verified',
                200,
                $errorCode ? ['notice_code' => $errorCode] : []
            );
        } catch (Throwable $e) {
            $code = $e->getCode();
            if ($code === 410) {
                return ApiResponse::error($e->getMessage(), 410, null, [], 'OFFER_EXPIRED');
            }
            if ($code === 404) {
                return ApiResponse::error($e->getMessage(), 404, null, [], 'NOT_FOUND');
            }
            return ApiResponse::error($e->getMessage(), 500, null, [], 'PROVIDER_UNAVAILABLE');
        }
    }
}
