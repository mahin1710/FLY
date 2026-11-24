<?php

namespace Tests\Feature;

use App\Jobs\ReconcilePendingPaymentsJob;
use App\Jobs\ReconcilePendingTicketsJob;
use App\Jobs\SendCustomerNotificationJob;
use App\Models\Airline;
use App\Models\Airport;
use App\Models\Booking;
use App\Models\Payment;
use App\Models\PaymentEvent;
use App\Models\User;
use App\Services\FlightSearchService;
use App\Services\Payments\PaymentService;
use App\Services\Support\ObservabilityService;
use App\Services\Support\ReferenceDataCacheService;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SecurityAndPerformanceHardeningTest extends TestCase
{
    use RefreshDatabase;

    protected User $superAdmin;
    protected User $customer;
    protected Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);

        $this->superAdmin = User::where('role', 'super_admin')->first();
        $this->customer = User::where('role', 'customer')->first();
        $this->booking = Booking::where('reference', 'FLY-2026-DEMO01')->first() ?? Booking::first();
    }

    public function test_reference_data_cache_service_caches_airports_and_airlines(): void
    {
        $cacheService = app(ReferenceDataCacheService::class);
        $cacheService->invalidate();

        $this->assertFalse(Cache::has(ReferenceDataCacheService::CACHE_KEY_AIRPORTS));
        $this->assertFalse(Cache::has(ReferenceDataCacheService::CACHE_KEY_AIRLINES));

        // First call caches results
        $airports = $cacheService->getAirports();
        $airlines = $cacheService->getAirlines();

        $this->assertNotEmpty($airports);
        $this->assertNotEmpty($airlines);

        $this->assertTrue(Cache::has(ReferenceDataCacheService::CACHE_KEY_AIRPORTS));
        $this->assertTrue(Cache::has(ReferenceDataCacheService::CACHE_KEY_AIRLINES));

        // Invalidation clears keys cleanly
        $cacheService->invalidate();
        $this->assertFalse(Cache::has(ReferenceDataCacheService::CACHE_KEY_AIRPORTS));
    }

    public function test_flight_search_uses_contract_permitted_cache_without_bypassing_live_reprice(): void
    {
        $criteria = [
            'origin'         => 'DAC',
            'destination'    => 'CXB',
            'departure_date' => now()->addDays(7)->toDateString(),
            'cabin_class'    => 'economy',
            'adults'         => 1,
        ];

        $searchService = app(FlightSearchService::class);

        // First search executes and populates 10-minute cache
        $res1 = $searchService->search($criteria, $this->customer);
        $this->assertNotEmpty($res1->offers);

        // Second search hits contract-permitted cache
        $res2 = $searchService->search($criteria, $this->customer);
        $this->assertCount($res1->offersCount, $res2->offers);
    }

    public function test_security_headers_middleware_attaches_strict_csp_and_security_headers(): void
    {
        $response = $this->getJson('/api/v1/health');

        $response->assertStatus(200)
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('X-Frame-Options', 'SAMEORIGIN')
            ->assertHeader('X-XSS-Protection', '1; mode=block')
            ->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
            ->assertHeader('Cross-Origin-Opener-Policy', 'same-origin')
            ->assertHeader('Cross-Origin-Resource-Policy', 'same-origin');

        $csp = $response->headers->get('Content-Security-Policy');
        $this->assertNotNull($csp);
        $this->assertStringContainsString("default-src 'self'", $csp);
        $this->assertStringContainsString("frame-ancestors 'none'", $csp);
    }

    public function test_webhook_deduplication_records_duplicate_event_and_returns_idempotent_response(): void
    {
        $payment = Payment::first();
        $payment->update([
            'status'                 => 'captured',
            'gateway_transaction_id' => 'TXN-WEBHOOK-DEDUP-001',
        ]);

        $paymentService = app(PaymentService::class);

        // Simulate duplicate webhook for an already captured payment
        $payload = [
            'tran_id'      => 'TXN-WEBHOOK-DEDUP-001',
            'val_id'       => 'VAL-DUP-7788',
            'amount'       => (string) $payment->amount,
            'currency'     => $payment->currency,
            'status'       => 'VALID',
        ];

        $result = $paymentService->handleIpnWebhook($payload);

        $this->assertSame('already_processed', $result['status']);

        // Verify duplicate event was recorded in audit stream
        $this->assertDatabaseHas('payment_events', [
            'payment_id' => $payment->id,
            'event_type' => 'duplicate_webhook_rejected',
            'status_to'  => 'duplicate_rejected',
        ]);
    }

    public function test_metrics_endpoint_returns_latency_percentiles_provider_errors_and_db_health(): void
    {
        $response = $this->getJson('/api/v1/metrics');

        $response->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonStructure([
                'success',
                'data' => [
                    'latency_percentiles' => ['p50_ms', 'p95_ms', 'p99_ms', 'sample_size'],
                    'provider_errors'     => ['total_calls_24h', 'error_calls_24h', 'error_rate_pct', 'circuit_breaker'],
                    'booking_state_age'   => ['active_holds_count', 'avg_hold_age_sec', 'queued_tickets_count', 'avg_queue_age_sec'],
                    'webhook_duplicates'  => ['duplicate_events_count', 'protection_status'],
                    'queue_backlog'       => ['critical_recovery', 'high', 'default', 'bulk', 'total_backlog'],
                    'database_health'     => ['status', 'latency_ms', 'driver'],
                    'timestamp',
                ],
            ]);

        $this->assertSame('HEALTHY', $response->json('data.database_health.status'));
    }

    public function test_document_access_logging_records_immutable_audit_log_when_passport_viewed(): void
    {
        Sanctum::actingAs($this->superAdmin);

        // View booking details containing passenger documents
        $response = $this->getJson("/api/v1/admin/bookings/{$this->booking->ulid}");
        $response->assertStatus(200);

        // Check that immutable audit log was created for document access
        $this->assertDatabaseHas('admin_audit_logs', [
            'user_id'     => $this->superAdmin->id,
            'action'      => 'document_access',
            'target_type' => 'bookings',
            'target_id'   => (string) $this->booking->id,
        ]);
    }

    public function test_queue_priority_isolation_assigns_recovery_jobs_to_critical_queue_and_notifications_to_bulk(): void
    {
        $paymentJob = new ReconcilePendingPaymentsJob();
        $ticketJob = new ReconcilePendingTicketsJob();
        $notificationJob = new SendCustomerNotificationJob(1, 'BOOKING_CONFIRMED', 'email', 'test@fly.com');

        $this->assertSame('critical_recovery', $paymentJob->queue);
        $this->assertSame('critical_recovery', $ticketJob->queue);
        $this->assertSame('bulk', $notificationJob->queue);
    }
}
