<?php

namespace App\Providers;

use App\Services\Providers\FlightProviderInterface;
use App\Services\Providers\MockFlightProvider;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->bind(FlightProviderInterface::class, MockFlightProvider::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
