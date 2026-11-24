<?php

namespace App\Services\Providers\Support\Exceptions;

class ProviderApiException extends ProviderException
{
    public function __construct(
        string $message,
        int $statusCode = 502,
        ?string $providerCode = null,
        protected ?string $providerErrorCode = null,
        ?array $context = []
    ) {
        parent::__construct($message, $statusCode, $providerCode, $context);
    }

    public function getProviderErrorCode(): ?string
    {
        return $this->providerErrorCode;
    }
}
