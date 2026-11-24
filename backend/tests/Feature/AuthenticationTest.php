<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthenticationTest extends TestCase
{
    use RefreshDatabase;

    public function test_customer_can_register_and_receive_sanctum_bearer_token(): void
    {
        $payload = [
            'name'                  => 'Mahin Rahman',
            'email'                 => 'mahin.test@flyaviation.com',
            'password'              => 'SecurePass123!',
            'password_confirmation' => 'SecurePass123!',
            'phone'                 => '+8801700000000',
        ];

        $response = $this->postJson('/api/v1/auth/register', $payload);

        $response->assertStatus(201)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.user.email', 'mahin.test@flyaviation.com')
            ->assertJsonPath('data.user.role', 'customer')
            ->assertJsonPath('data.token_type', 'Bearer')
            ->assertJsonStructure([
                'data' => [
                    'user' => ['id', 'name', 'email', 'role', 'status'],
                    'token',
                    'token_type',
                ],
                'meta' => ['correlation_id', 'timestamp'],
            ]);

        $this->assertDatabaseHas('users', [
            'email' => 'mahin.test@flyaviation.com',
            'role'  => 'customer',
        ]);
    }

    public function test_registration_validates_password_confirmation_and_minimum_length(): void
    {
        $payload = [
            'name'                  => 'Mahin Rahman',
            'email'                 => 'short@example.com',
            'password'              => 'short',
            'password_confirmation' => 'mismatch',
        ];

        $response = $this->postJson('/api/v1/auth/register', $payload);

        $response->assertStatus(422)
            ->assertJsonPath('success', false)
            ->assertJsonStructure([
                'success',
                'message',
                'errors' => ['password'],
                'meta' => ['correlation_id'],
            ]);
    }

    public function test_user_can_login_with_valid_credentials(): void
    {
        $user = User::factory()->create([
            'email'    => 'pilot@flyaviation.com',
            'password' => 'Password123!',
            'role'     => 'customer',
            'status'   => 'active',
        ]);

        $response = $this->postJson('/api/v1/auth/login', [
            'email'    => 'pilot@flyaviation.com',
            'password' => 'Password123!',
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.user.email', 'pilot@flyaviation.com')
            ->assertJsonStructure([
                'data' => [
                    'user',
                    'token',
                    'token_type',
                    'abilities',
                ],
            ]);
    }

    public function test_login_fails_with_invalid_credentials(): void
    {
        User::factory()->create([
            'email'    => 'pilot@flyaviation.com',
            'password' => 'Password123!',
        ]);

        $response = $this->postJson('/api/v1/auth/login', [
            'email'    => 'pilot@flyaviation.com',
            'password' => 'WrongPassword!',
        ]);

        $response->assertStatus(401)
            ->assertJsonPath('success', false)
            ->assertJsonPath('message', 'Invalid email or password.');
    }

    public function test_suspended_user_cannot_login(): void
    {
        User::factory()->suspended()->create([
            'email'    => 'suspended@flyaviation.com',
            'password' => 'Password123!',
        ]);

        $response = $this->postJson('/api/v1/auth/login', [
            'email'    => 'suspended@flyaviation.com',
            'password' => 'Password123!',
        ]);

        $response->assertStatus(403)
            ->assertJsonPath('success', false);
    }

    public function test_authenticated_user_can_retrieve_profile_via_me_endpoint(): void
    {
        $user = User::factory()->create([
            'name'  => 'Captain Mahin',
            'email' => 'captain@flyaviation.com',
        ]);

        $token = $user->createToken('test-token')->plainTextToken;

        $response = $this->withHeader('Authorization', 'Bearer ' . $token)
            ->getJson('/api/v1/auth/me');

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.user.name', 'Captain Mahin')
            ->assertJsonPath('data.user.email', 'captain@flyaviation.com');
    }

    public function test_authenticated_user_can_logout_and_revoke_token(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('logout-token')->plainTextToken;

        $response = $this->withHeader('Authorization', 'Bearer ' . $token)
            ->postJson('/api/v1/auth/logout');

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonPath('message', 'Successfully logged out.');

        // Verify token is deleted
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_unauthenticated_request_returns_401_in_standard_envelope(): void
    {
        $response = $this->getJson('/api/v1/auth/me');

        $response->assertStatus(401)
            ->assertJsonPath('success', false)
            ->assertJsonStructure([
                'success',
                'message',
                'meta' => ['correlation_id', 'timestamp'],
            ]);
    }
}
