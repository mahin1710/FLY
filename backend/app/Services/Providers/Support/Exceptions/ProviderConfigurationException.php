<?php

namespace App\Services\Providers\Support\Exceptions;

class ProviderConfigurationException extends ProviderException
{
    public function __construct(
        string $message = 'Provider configuration or credentials are missing.',
        ?string $providerCode = null,
        ?array $context = []
    ) {
        parent::__construct($message, 500, $providerCode, $context);
    }
}
