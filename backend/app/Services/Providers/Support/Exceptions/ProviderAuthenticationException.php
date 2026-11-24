<?php

namespace App\Services\Providers\Support\Exceptions;

class ProviderAuthenticationException extends ProviderException
{
    public function __construct(
        string $message = 'Failed to authenticate with external flight provider.',
        ?string $providerCode = null,
        ?array $context = []
    ) {
        parent::__construct($message, 401, $providerCode, $context);
    }
}
