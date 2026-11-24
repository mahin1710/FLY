<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class HealthCheckTest extends TestCase
{
    use RefreshDatabase;

    public function test_health_endpoint_returns_ok_and_standard_envelope(): void
    {
        $response = $this->getJson('/api/v1/health');

        $response->assertStatus(200)
            ->assertJsonStructure([
                'success',
                'message',
                'data' => [
                    'status',
                    'services' => [
                        'app' => ['status', 'version', 'environment', 'php_version'],
                        'database' => ['status', 'driver', 'latency_ms'],
                        'cache' => ['status', 'driver', 'latency_ms'],
                        'queue' => ['status', 'driver'],
                    ],
                ],
                'meta' => [
                    'correlation_id',
                    'timestamp',
                ],
            ])
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.status', 'healthy');
    }

    public function test_health_endpoint_does_not_leak_secrets_or_hostnames(): void
    {
        $response = $this->getJson('/api/v1/health');

        $content = $response->getContent();

        // Must not leak passwords, tokens, full server paths, or user credentials
        $this->assertStringNotContainsString('password', strtolower($content));
        $this->assertStringNotContainsString('DB_PASSWORD', $content);
        $this->assertStringNotContainsString('root', $content);
        $this->assertStringNotContainsString('APP_KEY', $content);
    }

    public function test_health_endpoint_attaches_correlation_id_header(): void
    {
        $response = $this->getJson('/api/v1/health');

        $response->assertHeader('X-Correlation-ID');
        $correlationId = $response->headers->get('X-Correlation-ID');
        $this->assertNotEmpty($correlationId);
        $this->assertEquals($correlationId, $response->json('meta.correlation_id'));
    }
}
