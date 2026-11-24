<?php

namespace App\Services\Providers\Support;

use App\Services\Providers\Support\Exceptions\ProviderCircuitOpenException;
use Illuminate\Support\Facades\Cache;

class ProviderCircuitBreaker
{
    public const STATE_CLOSED = 'CLOSED';
    public const STATE_OPEN = 'OPEN';
    public const STATE_HALF_OPEN = 'HALF_OPEN';

    public function __construct(
        protected string $providerCode,
        protected int $failureThreshold = 5,
        protected int $recoveryTimeSeconds = 60
    ) {}

    /**
     * Check if request should be allowed through or fast-failed.
     *
     * @throws ProviderCircuitOpenException
     */
    public function guard(): void
    {
        $state = $this->getState();

        if ($state === self::STATE_OPEN) {
            $lastFailure = (int) Cache::get($this->getCacheKey('last_failure'), 0);
            $timeSince = time() - $lastFailure;

            if ($timeSince >= $this->recoveryTimeSeconds) {
                // Transition to HALF_OPEN for a single probe
                $this->setState(self::STATE_HALF_OPEN);
                return;
            }

            throw new ProviderCircuitOpenException($this->providerCode, $this->recoveryTimeSeconds - $timeSince);
        }
    }

    /**
     * Record a successful request. Resets failure count and closes circuit.
     */
    public function recordSuccess(): void
    {
        $this->setState(self::STATE_CLOSED);
        Cache::forget($this->getCacheKey('failures'));
        Cache::forget($this->getCacheKey('last_failure'));
    }

    /**
     * Record a failed request. Trips circuit to OPEN if threshold reached.
     */
    public function recordFailure(): void
    {
        $failures = (int) Cache::increment($this->getCacheKey('failures'), 1);
        Cache::put($this->getCacheKey('last_failure'), time(), 3600);

        if ($failures >= $this->failureThreshold || $this->getState() === self::STATE_HALF_OPEN) {
            $this->setState(self::STATE_OPEN);
        }
    }

    public function getState(): string
    {
        return (string) Cache::get($this->getCacheKey('state'), self::STATE_CLOSED);
    }

    public function setState(string $state): void
    {
        Cache::put($this->getCacheKey('state'), $state, 3600);
    }

    public function reset(): void
    {
        Cache::forget($this->getCacheKey('state'));
        Cache::forget($this->getCacheKey('failures'));
        Cache::forget($this->getCacheKey('last_failure'));
    }

    protected function getCacheKey(string $suffix): string
    {
        return "circuit_breaker:{$this->providerCode}:{$suffix}";
    }
}
