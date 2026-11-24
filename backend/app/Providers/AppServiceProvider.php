<?php

namespace App\Providers;

use App\Services\Payments\Adapters\SimulatedGatewayAdapter;
use App\Services\Payments\Adapters\SslCommerzAdapter;
use App\Services\Payments\PaymentGatewayInterface;
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

        $this->app->bind(PaymentGatewayInterface::class, function () {
            $gateway = config('services.payment.gateway', 'sslcommerz');
            $storeId = config('services.payment.sslcommerz.store_id');
            $storePasswd = config('services.payment.sslcommerz.store_password');

            if ($gateway === 'sslcommerz' && !empty($storeId) && !empty($storePasswd)) {
                return new SslCommerzAdapter(
                    storeId: $storeId,
                    storePassword: $storePasswd,
                    isSandbox: (bool) config('services.payment.sslcommerz.sandbox', true),
                    baseUrl: config('services.payment.sslcommerz.base_url')
                );
            }

            return new SimulatedGatewayAdapter(
                secretKey: (string) config('services.payment.simulated.secret_key', 'simulated_payment_secret_key_12345')
            );
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
