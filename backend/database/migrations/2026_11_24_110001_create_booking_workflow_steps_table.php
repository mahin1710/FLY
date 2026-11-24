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
        Schema::create('booking_workflow_steps', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->foreignId('booking_id')->constrained('bookings')->cascadeOnDelete();
            $table->string('step_name', 50)->index(); // reprice, reservation_create, reservation_verify, payment_verify, ticket_issuance, reconcile
            $table->string('step_status', 30)->default('pending')->index(); // pending, in_progress, completed, failed, needs_manual_review
            $table->unsignedSmallInteger('attempt_count')->default(1);
            $table->unsignedSmallInteger('max_attempts')->default(3);
            $table->string('correlation_id', 64)->nullable()->index();
            $table->string('idempotency_key', 120)->nullable()->index();
            $table->string('error_code', 60)->nullable();
            $table->text('error_message')->nullable(); // Safe sanitized error details
            $table->json('context_payload')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('booking_workflow_steps');
    }
};
