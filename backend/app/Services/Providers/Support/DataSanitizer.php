<?php

namespace App\Services\Providers\Support;

class DataSanitizer
{
    /**
     * Keys whose values must be completely or partially redacted in logs.
     */
    protected static array $sensitiveKeyPatterns = [
        '/authorization/i',
        '/client_secret/i',
        '/access_token/i',
        '/refresh_token/i',
        '/api[_-]?key/i',
        '/password/i',
        '/secret/i',
        '/document_number/i',
        '/passport/i',
        '/card_number/i',
        '/cvv/i',
        '/cvc/i',
        '/security_code/i',
        '/birth_date/i',
        '/date_of_birth/i',
    ];

    /**
     * Recursively sanitize array payloads for logging.
     */
    public static function sanitize(mixed $data): mixed
    {
        if (is_null($data) || is_scalar($data)) {
            return $data;
        }

        if (is_array($data)) {
            $sanitized = [];
            foreach ($data as $key => $value) {
                if (is_string($key) && self::isSensitiveKey($key)) {
                    $sanitized[$key] = self::maskValue($value);
                } elseif (is_array($value)) {
                    $sanitized[$key] = self::sanitize($value);
                } else {
                    $sanitized[$key] = $value;
                }
            }
            return $sanitized;
        }

        return $data;
    }

    /**
     * Sanitize HTTP headers array (e.g. redact Authorization, X-API-KEY).
     */
    public static function sanitizeHeaders(array $headers): array
    {
        $sanitized = [];
        foreach ($headers as $key => $value) {
            if (self::isSensitiveKey($key)) {
                $sanitized[$key] = '[REDACTED]';
            } else {
                $sanitized[$key] = $value;
            }
        }
        return $sanitized;
    }

    protected static function isSensitiveKey(string $key): bool
    {
        foreach (self::$sensitiveKeyPatterns as $pattern) {
            if (preg_match($pattern, $key)) {
                return true;
            }
        }
        return false;
    }

    protected static function maskValue(mixed $value): string
    {
        if (is_null($value)) {
            return '[NULL]';
        }
        $str = (string) $value;
        $len = strlen($str);
        if ($len <= 4) {
            return '****';
        }
        return substr($str, 0, 2) . str_repeat('*', max(4, $len - 4)) . substr($str, -2);
    }
}
