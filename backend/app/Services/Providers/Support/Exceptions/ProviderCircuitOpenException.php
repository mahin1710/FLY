<?php

namespace App\Services\Providers\Support\Exceptions;

class ProviderCircuitOpenException extends ProviderException
{
    public function __construct(
        string $providerCode,
        int $retryAfterSeconds = 60
    ) {
        parent::__construct(
            "Circuit breaker is OPEN for provider [{$providerCode}]. Fast-failing requests to protect upstream availability.",
            503,
            $providerCode,
            ['retry_after_seconds' => $retryAfterSeconds]
        );
    }
}
