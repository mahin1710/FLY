<?php

namespace App\Services\Support;

use App\Models\Airline;
use App\Models\Airport;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Cache;

class ReferenceDataCacheService
{
    public const CACHE_KEY_AIRPORTS = 'reference_data:airports:v1';
    public const CACHE_KEY_AIRLINES = 'reference_data:airlines:v1';
    public const TTL_SECONDS = 86400; // 24 Hours

    /**
     * Retrieve all airports from safe memory/Redis cache.
     */
    public function getAirports(): Collection
    {
        return Cache::remember(self::CACHE_KEY_AIRPORTS, self::TTL_SECONDS, function () {
            return Airport::orderBy('iata_code')->get();
        });
    }

    /**
     * Retrieve all airlines from safe memory/Redis cache.
     */
    public function getAirlines(): Collection
    {
        return Cache::remember(self::CACHE_KEY_AIRLINES, self::TTL_SECONDS, function () {
            return Airline::orderBy('iata_code')->get();
        });
    }

    /**
     * Invalidate cached reference data upon administrative updates.
     */
    public function invalidate(): void
    {
        Cache::forget(self::CACHE_KEY_AIRPORTS);
        Cache::forget(self::CACHE_KEY_AIRLINES);
    }
}
