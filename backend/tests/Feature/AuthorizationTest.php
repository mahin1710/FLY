<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthorizationTest extends TestCase
{
    use RefreshDatabase;

    public function test_customer_is_forbidden_from_accessing_admin_endpoints(): void
    {
        $customer = User::factory()->create([
            'role'   => 'customer',
            'status' => 'active',
        ]);

        $token = $customer->createToken('customer-token')->plainTextToken;

        $response = $this->withHeader('Authorization', 'Bearer ' . $token)
            ->getJson('/api/v1/admin/overview');

        $response->assertStatus(403)
            ->assertJsonPath('success', false)
            ->assertJsonStructure([
                'success',
                'message',
                'meta' => ['correlation_id'],
            ]);
    }

    public function test_admin_user_can_access_admin_overview_metrics(): void
    {
        $admin = User::factory()->admin()->create([
            'status' => 'active',
        ]);

        $token = $admin->createToken('admin-token')->plainTextToken;

        $response = $this->withHeader('Authorization', 'Bearer ' . $token)
            ->getJson('/api/v1/admin/overview');

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonStructure([
                'success',
                'message',
                'data' => [
                    'total_users',
                    'customers_count',
                    'admins_count',
                    'active_accounts',
                    'system_time',
                    'environment',
                ],
                'meta' => ['correlation_id'],
            ]);
    }

    public function test_super_admin_can_access_admin_users_list(): void
    {
        $superAdmin = User::factory()->superAdmin()->create();
        User::factory()->count(3)->create(['role' => 'customer']);

        $token = $superAdmin->createToken('super-token')->plainTextToken;

        $response = $this->withHeader('Authorization', 'Bearer ' . $token)
            ->getJson('/api/v1/admin/users');

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonStructure([
                'data' => [
                    'users',
                    'pagination' => ['current_page', 'per_page', 'total', 'last_page'],
                ],
            ]);
    }
}
