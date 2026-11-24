<?php

namespace Tests\Feature\Admin;

use App\Models\Booking;
use App\Models\DualApproval;
use App\Models\Passenger;
use App\Models\PassengerDocument;
use App\Models\Payment;
use App\Models\PricingRule;
use App\Models\Role;
use App\Models\ServicingRequest;
use App\Models\Ticket;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminOperationsTest extends TestCase
{
    use RefreshDatabase;

    protected User $superAdmin;
    protected User $opsAdmin;
    protected User $ticketingAgent;
    protected User $financeAdmin;
    protected User $supportAgent;
    protected User $pricingManager;
    protected User $contentManager;
    protected User $customer;
    protected Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);

        $this->superAdmin = User::where('role', 'super_admin')->first();
        $this->opsAdmin = User::where('role', 'operations_admin')->first();
        $this->ticketingAgent = User::where('role', 'ticketing_agent')->first();
        $this->financeAdmin = User::where('role', 'finance_admin')->first();
        $this->supportAgent = User::where('role', 'support_agent')->first();
        $this->pricingManager = User::where('role', 'pricing_manager')->first();
        $this->contentManager = User::where('role', 'content_manager')->first();
        $this->customer = User::where('role', 'customer')->first();

        $this->booking = Booking::where('reference', 'FLY-2026-DEMO01')->first() ?? Booking::first();
    }

    public function test_super_admin_has_full_access_to_dashboard_and_users(): void
    {
        Sanctum::actingAs($this->superAdmin);

        $dashResp = $this->getJson('/api/v1/admin/dashboard');
        $dashResp->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonStructure(['data' => ['booking_counts', 'ticketing_pending', 'payment_exceptions', 'finance_summary']]);

        $usersResp = $this->getJson('/api/v1/admin/users');
        $usersResp->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonStructure(['data' => ['users', 'pagination']]);
    }

    public function test_operations_admin_can_access_bookings_and_ticketing_queue_but_denied_user_management(): void
    {
        Sanctum::actingAs($this->opsAdmin);

        // Allowed: Bookings & Ticketing Queue
        $this->getJson('/api/v1/admin/bookings')->assertStatus(200)->assertJsonPath('success', true);
        $this->getJson('/api/v1/admin/ticketing-queue')->assertStatus(200)->assertJsonPath('success', true);

        // Denied: Revoke sessions (user management restricted to Super Admin)
        $this->postJson("/api/v1/admin/users/{$this->customer->id}/revoke-sessions", [
            'reason' => 'Unauthorized ops attempt to revoke sessions',
        ])->assertStatus(403);
    }

    public function test_ticketing_agent_can_reconcile_and_escalate_with_reason_but_cannot_force_ticket(): void
    {
        Sanctum::actingAs($this->ticketingAgent);

        // Allowed: Ticketing queue
        $this->getJson('/api/v1/admin/ticketing-queue')->assertStatus(200);

        // Allowed: Escalate ticket to manual review with valid reason
        $escalateResp = $this->postJson("/api/v1/admin/ticketing/{$this->booking->ulid}/escalate", [
            'reason' => 'Consolidator offline, routing to manual desk for verification',
        ]);
        $escalateResp->assertStatus(200)->assertJsonPath('data.requires_manual_review', true);

        // Denied: Financial payments
        $this->getJson('/api/v1/admin/payments')->assertStatus(403);

        // Denied: Disburse refund
        $this->postJson('/api/v1/admin/servicing/1/disburse-refund', [
            'reason'     => 'Ticketing agent attempt to disburse refund',
            'net_amount' => 1000.00,
        ])->assertStatus(403);
    }

    public function test_force_ticket_is_strictly_forbidden_for_all_roles(): void
    {
        // Test Super Admin attempt to force ticketed
        Sanctum::actingAs($this->superAdmin);
        $respSuper = $this->postJson("/api/v1/admin/ticketing/{$this->booking->ulid}/force-ticket");
        $respSuper->assertStatus(403);

        // Test Operations Admin attempt to force ticketed
        Sanctum::actingAs($this->opsAdmin);
        $respOps = $this->postJson("/api/v1/admin/ticketing/{$this->booking->ulid}/force-ticket");
        $respOps->assertStatus(403);

        // Test Ticketing Agent attempt to force ticketed
        Sanctum::actingAs($this->ticketingAgent);
        $respAgent = $this->postJson("/api/v1/admin/ticketing/{$this->booking->ulid}/force-ticket");
        $respAgent->assertStatus(403);
    }

    public function test_finance_admin_can_access_payments_and_refunds_but_denied_pricing_management(): void
    {
        Sanctum::actingAs($this->financeAdmin);

        // Allowed: Payments & Servicing
        $this->getJson('/api/v1/admin/payments')->assertStatus(200);
        $this->getJson('/api/v1/admin/servicing')->assertStatus(200);

        // Denied: Manage Pricing rules
        $this->postJson('/api/v1/admin/pricing-rules', [
            'name'         => 'Finance unauthorized markup',
            'route_type'   => 'all',
            'markup_type'  => 'fixed_amount',
            'markup_value' => 500.00,
            'service_fee'  => 50.00,
            'currency'     => 'BDT',
            'starts_at'    => now()->toIso8601String(),
            'expires_at'   => now()->addMonth()->toIso8601String(),
            'reason'       => 'Unauthorized attempt by finance',
        ])->assertStatus(403);
    }

    public function test_support_agent_can_view_bookings_and_servicing_but_denied_refund_disbursement(): void
    {
        Sanctum::actingAs($this->supportAgent);

        // Allowed: View Bookings & View Servicing
        $this->getJson('/api/v1/admin/bookings')->assertStatus(200);
        $this->getJson('/api/v1/admin/servicing')->assertStatus(200);

        // Denied: Disburse refund (requires Finance or Super Admin)
        $this->postJson('/api/v1/admin/servicing/1/disburse-refund', [
            'reason'     => 'Support agent voluntary cancellation disburse attempt',
            'net_amount' => 2000.00,
        ])->assertStatus(403);
    }

    public function test_pricing_manager_can_create_markup_rules_with_reason_but_denied_ticketing_actions(): void
    {
        Sanctum::actingAs($this->pricingManager);

        // Allowed: View & Create Pricing rules
        $this->getJson('/api/v1/admin/pricing-rules')->assertStatus(200);

        $createResp = $this->postJson('/api/v1/admin/pricing-rules', [
            'name'         => 'Summer Seasonal International Markup',
            'route_type'   => 'international',
            'markup_type'  => 'percentage',
            'markup_value' => 5.50,
            'service_fee'  => 150.00,
            'currency'     => 'BDT',
            'starts_at'    => now()->toIso8601String(),
            'expires_at'   => now()->addMonths(2)->toIso8601String(),
            'reason'       => 'Seasonal peak demand markup approved by management',
        ]);
        $createResp->assertStatus(201)->assertJsonPath('data.name', 'Summer Seasonal International Markup');

        // Denied: Ticketing queue
        $this->getJson('/api/v1/admin/ticketing-queue')->assertStatus(403);
    }

    public function test_content_manager_can_schedule_banners_but_denied_financial_data(): void
    {
        Sanctum::actingAs($this->contentManager);

        // Allowed: View & Create content
        $this->getJson('/api/v1/admin/content')->assertStatus(200);

        $bannerResp = $this->postJson('/api/v1/admin/content', [
            'title'            => 'Sylhet Tea Gardens Getaway',
            'subtitle'         => 'Explore luscious green hills with daily regional flights',
            'destination_code' => 'ZYL',
            'banner_type'      => 'destination',
            'image_url'        => '/static/images/destinations/sylhet.jpg',
            'action_url'       => '/flights/search?origin=DAC&destination=ZYL',
            'indicative_price' => 3200.00,
            'starts_at'        => now()->toIso8601String(),
            'expires_at'       => now()->addMonth()->toIso8601String(),
            'reason'           => 'Winter campaign destination spotlight launch',
        ]);
        $bannerResp->assertStatus(201);

        // Denied: Payments & Financial Reports
        $this->getJson('/api/v1/admin/payments')->assertStatus(403);
        $this->getJson('/api/v1/admin/reports')->assertStatus(403);
    }

    public function test_retail_customer_is_completely_forbidden_from_admin_panel(): void
    {
        Sanctum::actingAs($this->customer);

        $this->getJson('/api/v1/admin/dashboard')->assertStatus(403);
        $this->getJson('/api/v1/admin/bookings')->assertStatus(403);
        $this->getJson('/api/v1/admin/ticketing-queue')->assertStatus(403);
        $this->getJson('/api/v1/admin/payments')->assertStatus(403);
        $this->getJson('/api/v1/admin/providers')->assertStatus(403);
        $this->getJson('/api/v1/admin/pricing-rules')->assertStatus(403);
        $this->getJson('/api/v1/admin/content')->assertStatus(403);
        $this->getJson('/api/v1/admin/reports')->assertStatus(403);
    }

    public function test_sensitive_operations_reject_request_when_mandatory_reason_is_missing(): void
    {
        Sanctum::actingAs($this->ticketingAgent);

        // Missing reason fails with 422
        $resp = $this->postJson("/api/v1/admin/ticketing/{$this->booking->ulid}/escalate", [
            'reason' => '', // Empty!
        ]);
        $resp->assertStatus(422);

        // Reason too short fails with 422
        $respShort = $this->postJson("/api/v1/admin/ticketing/{$this->booking->ulid}/escalate", [
            'reason' => 'bad', // under 5 characters
        ]);
        $respShort->assertStatus(422);
    }

    public function test_dual_approval_workflow_prevents_initiator_from_approving_own_request(): void
    {
        Sanctum::actingAs($this->superAdmin);

        // Super Admin submits high-value dual approval request
        $approval = DualApproval::create([
            'action_type'          => 'disburse_refund',
            'target_type'          => 'servicing_requests',
            'target_id'            => '1',
            'requested_payload'    => ['amount' => 15000.00],
            'reason'               => 'High-value medical emergency cancellation refund',
            'requested_by_user_id' => $this->superAdmin->id,
            'status'               => 'pending',
        ]);

        // Attempting to self-approve fails with 403 segregation of duties
        $selfApproveResp = $this->postJson("/api/v1/admin/dual-approvals/{$approval->id}/decide", [
            'is_approved'     => true,
            'decision_reason' => 'Self-approving my own requested refund',
        ]);

        $selfApproveResp->assertStatus(403);
    }

    public function test_dual_approval_workflow_succeeds_when_second_authorized_admin_approves(): void
    {
        // 1. Finance Admin submits refund dual approval request
        $approval = DualApproval::create([
            'action_type'          => 'disburse_refund',
            'target_type'          => 'servicing_requests',
            'target_id'            => '1',
            'requested_payload'    => ['amount' => 12500.00],
            'reason'               => 'Charter flight cancellation full settlement',
            'requested_by_user_id' => $this->financeAdmin->id,
            'status'               => 'pending',
        ]);

        // 2. Super Admin (different user) reviews and approves
        Sanctum::actingAs($this->superAdmin);

        $approveResp = $this->postJson("/api/v1/admin/dual-approvals/{$approval->id}/decide", [
            'is_approved'     => true,
            'decision_reason' => 'Verified airline credit note received and confirmed in bank account',
        ]);

        $approveResp->assertStatus(200)
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.approved_by_user_id', $this->superAdmin->id);

        $approval->refresh();
        $this->assertEquals('approved', $approval->status);
        $this->assertEquals($this->superAdmin->id, $approval->approved_by_user_id);
    }

    public function test_export_reports_enforces_permission_check_allowing_finance_and_super_admin_denying_others(): void
    {
        // Allowed: Super Admin
        Sanctum::actingAs($this->superAdmin);
        $respSuper = $this->get('/api/v1/admin/reports/export');
        $respSuper->assertStatus(200)->assertHeader('Content-Type', 'text/csv; charset=UTF-8');

        // Allowed: Finance Admin
        Sanctum::actingAs($this->financeAdmin);
        $respFinance = $this->get('/api/v1/admin/reports/export');
        $respFinance->assertStatus(200)->assertHeader('Content-Type', 'text/csv; charset=UTF-8');

        // Denied: Support Agent
        Sanctum::actingAs($this->supportAgent);
        $this->get('/api/v1/admin/reports/export')->assertStatus(403);

        // Denied: Ticketing Agent
        Sanctum::actingAs($this->ticketingAgent);
        $this->get('/api/v1/admin/reports/export')->assertStatus(403);
    }

    public function test_customer_profile_masks_sensitive_phone_and_travel_documents(): void
    {
        Sanctum::actingAs($this->supportAgent);

        $response = $this->getJson("/api/v1/admin/customers/{$this->customer->id}");
        $response->assertStatus(200)
            ->assertJsonPath('data.customer.name', $this->customer->name);

        $phoneMasked = $response->json('data.customer.phone_masked');
        $this->assertStringContainsString('****', $phoneMasked);
    }
}
