<?php

namespace App\Services\Providers\Support\Exceptions;

use RuntimeException;

class ProviderException extends RuntimeException
{
    public function __construct(
        string $message,
        int $code = 500,
        protected ?string $providerCode = null,
        protected ?array $context = []
    ) {
        parent::__construct($message, $code);
    }

    public function getProviderCode(): ?string
    {
        return $this->providerCode;
    }

    public function getContext(): ?array
    {
        return $this->context;
    }
}
