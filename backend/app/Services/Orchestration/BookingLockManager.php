<?php

namespace App\Services\Orchestration;

use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;
use RuntimeException;

class BookingLockManager
{
    /**
     * Acquire a booking-scoped distributed lock to guarantee safe concurrency.
     *
     * @throws RuntimeException
     */
    public function runWithLock(string $bookingUlid, callable $callback, int $waitSeconds = 5): mixed
    {
        $lockKey = "booking_lock:{$bookingUlid}";
        $lock = Cache::lock($lockKey, 15);

        try {
            return $lock->block($waitSeconds, $callback);
        } catch (LockTimeoutException) {
            throw new RuntimeException(
                "Booking [{$bookingUlid}] is currently locked by another concurrent process. Please wait a moment and try again.",
                409
            );
        }
    }
}
