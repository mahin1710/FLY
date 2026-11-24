<?php

namespace App\Services\StateMachine;

use RuntimeException;

class InvalidStateTransitionException extends RuntimeException
{
    public function __construct(
        public readonly string $dimension,
        public readonly string $fromStatus,
        public readonly string $toStatus,
        public readonly array $allowedTransitions = []
    ) {
        $allowed = implode(', ', $allowedTransitions);
        parent::__construct(
            "Invalid transition on dimension [{$dimension}]: cannot transition from '{$fromStatus}' to '{$toStatus}'. Allowed destination states: [{$allowed}].",
            422
        );
    }
}
