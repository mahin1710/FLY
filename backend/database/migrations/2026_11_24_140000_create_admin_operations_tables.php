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
        // 1. Add reason to admin_audit_logs if missing
        if (Schema::hasTable('admin_audit_logs') && !Schema::hasColumn('admin_audit_logs', 'reason')) {
            Schema::table('admin_audit_logs', function (Blueprint $table) {
                $table->string('reason', 255)->nullable()->after('target_id');
            });
        }

        // 2. Add MFA and activity columns to users
        if (Schema::hasTable('users') && !Schema::hasColumn('users', 'is_mfa_enabled')) {
            Schema::table('users', function (Blueprint $table) {
                $table->boolean('is_mfa_enabled')->default(false)->after('status');
                $table->timestamp('last_active_at')->nullable()->after('is_mfa_enabled');
            });
        }

        // 3. Dual Approval Workflow Requests Table
        if (!Schema::hasTable('dual_approvals')) {
            Schema::create('dual_approvals', function (Blueprint $table) {
                $table->id();
                $table->string('ulid', 26)->unique();
                $table->string('action_type', 60)->index(); // disburse_refund, update_pricing_rule, update_provider_settings, manual_status_change
                $table->string('target_type', 80)->nullable();
                $table->string('target_id', 80)->nullable();
                $table->json('requested_payload');
                $table->string('reason', 255);
                $table->foreignId('requested_by_user_id')->constrained('users')->cascadeOnDelete();
                $table->foreignId('approved_by_user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->string('status', 30)->default('pending')->index(); // pending, approved, rejected, executed
                $table->string('decision_reason', 255)->nullable();
                $table->timestamp('decided_at')->nullable();
                $table->timestamps();
            });
        }

        // 4. Pricing & Markup Configuration Table
        if (!Schema::hasTable('pricing_rules')) {
            Schema::create('pricing_rules', function (Blueprint $table) {
                $table->id();
                $table->string('ulid', 26)->unique();
                $table->string('name', 100);
                $table->string('route_type', 30)->default('all'); // all, domestic, international
                $table->char('airline_code', 3)->nullable()->index();
                $table->string('markup_type', 20)->default('fixed_amount'); // fixed_amount, percentage
                $table->decimal('markup_value', 10, 2)->default(0.00);
                $table->decimal('service_fee', 10, 2)->default(0.00);
                $table->char('currency', 3)->default('BDT');
                $table->timestamp('starts_at')->index();
                $table->timestamp('expires_at')->index();
                $table->boolean('is_active')->default(true)->index();
                $table->string('status', 30)->default('active')->index(); // pending_approval, active, inactive, rejected
                $table->foreignId('created_by_user_id')->constrained('users')->cascadeOnDelete();
                $table->foreignId('approved_by_user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
                $table->softDeletes();
            });
        }

        // 5. Content Management: Destinations, Banners, Schedules (No invented fare)
        if (!Schema::hasTable('content_banners')) {
            Schema::create('content_banners', function (Blueprint $table) {
                $table->id();
                $table->string('ulid', 26)->unique();
                $table->string('title', 150);
                $table->string('subtitle', 255)->nullable();
                $table->char('destination_code', 3)->nullable()->index();
                $table->string('banner_type', 40)->default('promo_deal'); // hero, destination, promo_deal
                $table->string('image_url', 255);
                $table->string('action_url', 255)->nullable();
                $table->decimal('indicative_price', 12, 2)->nullable(); // Dynamic starting from guide only
                $table->char('currency', 3)->default('BDT');
                $table->timestamp('starts_at')->index();
                $table->timestamp('expires_at')->index();
                $table->boolean('is_active')->default(true)->index();
                $table->foreignId('created_by_user_id')->constrained('users')->cascadeOnDelete();
                $table->timestamps();
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('content_banners');
        Schema::dropIfExists('pricing_rules');
        Schema::dropIfExists('dual_approvals');
    }
};
