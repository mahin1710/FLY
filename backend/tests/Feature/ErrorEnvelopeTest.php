<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ErrorEnvelopeTest extends TestCase
{
    use RefreshDatabase;

    public function test_not_found_endpoint_returns_404_in_standard_json_envelope(): void
    {
        $response = $this->getJson('/api/v1/non-existent-endpoint');

        $response->assertStatus(404)
            ->assertJsonPath('success', false)
            ->assertJsonPath('message', 'Resource or endpoint not found.')
            ->assertJsonStructure([
                'success',
                'message',
                'meta' => ['correlation_id', 'timestamp'],
            ]);
    }

    public function test_correlation_id_is_preserved_when_client_sends_x_correlation_id(): void
    {
        $customId = 'my-custom-trace-uuid-12345';

        $response = $this->withHeader('X-Correlation-ID', $customId)
            ->getJson('/api/v1/health');

        $response->assertHeader('X-Correlation-ID', $customId)
            ->assertJsonPath('meta.correlation_id', $customId);
    }

    public function test_security_headers_are_attached_to_api_responses(): void
    {
        $response = $this->getJson('/api/v1/health');

        $response->assertHeader('X-Content-Type-Options', 'nosniff');
        $response->assertHeader('X-Frame-Options', 'SAMEORIGIN');
        $response->assertHeader('X-XSS-Protection', '1; mode=block');
        $response->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    }
}
