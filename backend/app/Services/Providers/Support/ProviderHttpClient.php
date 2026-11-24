<?php

namespace App\Services\Providers\Support;

use App\Models\ProviderCall;
use App\Services\Providers\Support\Exceptions\ProviderApiException;
use App\Services\Providers\Support\Exceptions\ProviderCircuitOpenException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Throwable;

class ProviderHttpClient
{
    public function __construct(
        protected string $providerCode,
        protected ProviderCircuitBreaker $circuitBreaker,
        protected float $connectTimeout = 5.0,
        protected float $requestTimeout = 15.0,
        protected int $maxRetries = 2
    ) {}

    /**
     * Execute an HTTP request to the external provider with correlation tracking,
     * timeout, retry policy, circuit breaking, and sanitized audit logging.
     */
    public function send(
        string $method,
        string $url,
        array $options = []
    ): Response {
        // 1. Guard against open circuit
        $this->circuitBreaker->guard();

        $correlationId = request()->attributes->get('correlation_id')
            ?? request()->header('X-Correlation-ID')
            ?? (string) Str::uuid();

        $headers = array_merge([
            'X-Correlation-ID' => $correlationId,
            'Accept'           => 'application/json',
            'User-Agent'       => 'FLY-Aviation-Platform/1.0',
        ], $options['headers'] ?? []);

        $startTime = microtime(true);
        $response = null;
        $error = null;
        $isError = false;

        $isIdempotent = in_array(strtoupper($method), ['GET', 'HEAD', 'OPTIONS'], true);
        $retriesAllowed = $isIdempotent ? $this->maxRetries : 0;

        try {
            $client = Http::withHeaders($headers)
                ->connectTimeout($this->connectTimeout)
                ->timeout($this->requestTimeout);

            if ($retriesAllowed > 0) {
                // Retry only on transient 429/503 or network connection drops
                $client->retry($retriesAllowed, 100, function ($exception, $request) {
                    if ($exception instanceof \Illuminate\Http\Client\ConnectionException) {
                        return true;
                    }
                    if ($exception instanceof \Illuminate\Http\Client\RequestException) {
                        return in_array($exception->response->status(), [429, 502, 503, 504], true);
                    }
                    return false;
                }, throw: false);
            }

            $methodLower = strtolower($method);
            if ($methodLower === 'get') {
                $response = $client->get($url, $options['query'] ?? []);
            } elseif ($methodLower === 'post') {
                $response = $client->post($url, $options['json'] ?? []);
            } elseif ($methodLower === 'delete') {
                $response = $client->delete($url, $options['json'] ?? []);
            } else {
                $response = $client->send($method, $url, $options);
            }

            if ($response->failed()) {
                $isError = true;
                $this->circuitBreaker->recordFailure();
            } else {
                $this->circuitBreaker->recordSuccess();
            }

            return $response;
        } catch (Throwable $e) {
            $isError = true;
            $error = $e;
            $this->circuitBreaker->recordFailure();
            throw $e;
        } finally {
            $durationMs = (int) round((microtime(true) - $startTime) * 1000);
            $statusCode = $response ? $response->status() : 500;

            // Audit record with sanitized payload (no secrets, no passport plaintext)
            $this->logProviderCall(
                endpoint: $url,
                httpMethod: strtoupper($method),
                statusCode: $statusCode,
                durationMs: $durationMs,
                requestPayload: DataSanitizer::sanitize($options['json'] ?? $options['query'] ?? null),
                responsePayload: $response ? DataSanitizer::sanitize($response->json()) : null,
                isError: $isError,
                errorMessage: $error ? $error->getMessage() : ($response && $response->failed() ? $response->body() : null)
            );
        }
    }

    protected function logProviderCall(
        string $endpoint,
        string $httpMethod,
        int $statusCode,
        int $durationMs,
        mixed $requestPayload,
        mixed $responsePayload,
        bool $isError,
        ?string $errorMessage
    ): void {
        try {
            ProviderCall::create([
                'ulid'             => (string) Str::ulid(),
                'provider_name'    => $this->providerCode,
                'endpoint'         => parse_url($endpoint, PHP_URL_PATH) ?? $endpoint,
                'http_method'      => $httpMethod,
                'status_code'      => $statusCode,
                'duration_ms'      => $durationMs,
                'request_payload'  => $requestPayload,
                'response_payload' => $responsePayload,
                'is_error'         => $isError,
                'error_message'    => $errorMessage ? Str::limit($errorMessage, 500) : null,
            ]);
        } catch (Throwable) {
            // Fail silent on audit log failure so core flight search / booking is not blocked
        }
    }
}
