<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('idempotency_records', function (Blueprint $table) {
            $table->id();
            $table->string('idempotency_key', 120)->unique()->index();
            $table->string('scope', 60)->index(); // booking_payment, flight_hold
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('request_hash', 64);
            $table->unsignedSmallInteger('response_status_code');
            $table->json('response_body');
            $table->timestamp('locked_until')->nullable();
            $table->timestamps();
        });

        Schema::create('booking_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('booking_id')->constrained('bookings')->cascadeOnDelete();
            $table->string('event_name', 60)->index(); // hold_created, payment_captured, ticket_issued, hold_expired, cancelled
            $table->string('status_from', 30)->nullable();
            $table->string('status_to', 30);
            $table->string('actor_type', 30)->default('customer'); // customer, system_cron, admin, provider_webhook
            $table->string('actor_id', 50)->nullable();
            $table->json('payload')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->timestamp('recorded_at')->useCurrent()->index();
            $table->timestamp('created_at')->useCurrent();
            // APPEND-ONLY STATUS TRANSITION AUDIT - NO SOFT DELETES
        });

        Schema::create('provider_calls', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->string('provider_name', 50)->index(); // AMADEUS, SABRE, BIMAN_DIRECT, BKASH
            $table->string('endpoint', 255);
            $table->string('http_method', 10);
            $table->unsignedSmallInteger('status_code')->index();
            $table->unsignedInteger('duration_ms');
            $table->json('request_payload')->nullable(); // Protected: credentials stripped
            $table->json('response_payload')->nullable();
            $table->boolean('is_error')->default(false)->index();
            $table->text('error_message')->nullable();
            $table->timestamp('created_at')->useCurrent();
        });

        Schema::create('notifications', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->foreignId('booking_id')->nullable()->constrained('bookings')->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('channel', 20)->default('email')->index(); // email, sms, whatsapp, in_app
            $table->string('recipient', 150);
            $table->string('template_name', 80);
            $table->string('title', 200);
            $table->text('body');
            $table->string('status', 30)->default('queued')->index(); // queued, sent, delivered, failed
            $table->timestamp('sent_at')->nullable();
            $table->string('failure_reason', 255)->nullable();
            $table->timestamps();
        });

        Schema::create('admin_audit_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('action', 80)->index();
            $table->string('target_type', 80)->index();
            $table->string('target_id', 80)->index();
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent', 255)->nullable();
            $table->json('before_state')->nullable();
            $table->json('after_state')->nullable();
            $table->timestamp('created_at')->useCurrent();
            // IMMUTABLE COMPLIANCE AUDIT LOG - NO SOFT DELETES
        });

        Schema::create('promotions', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->string('code', 40)->unique()->index();
            $table->string('title', 120);
            $table->text('description')->nullable();
            $table->string('discount_type', 20)->default('fixed_amount'); // fixed_amount, percentage
            $table->decimal('discount_value', 10, 2);
            $table->char('currency', 3)->default('BDT');
            $table->decimal('min_spend', 12, 2)->default(0);
            $table->decimal('max_discount', 12, 2)->nullable();
            $table->unsignedInteger('usage_limit')->nullable();
            $table->unsignedInteger('usage_count')->default(0);
            $table->timestamp('starts_at')->index();
            $table->timestamp('expires_at')->index();
            $table->boolean('is_active')->default(true)->index();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('promotions');
        Schema::dropIfExists('admin_audit_logs');
        Schema::dropIfExists('notifications');
        Schema::dropIfExists('provider_calls');
        Schema::dropIfExists('booking_events');
        Schema::dropIfExists('idempotency_records');
    }
};
