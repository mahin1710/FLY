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
        Schema::create('servicing_requests', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->foreignId('booking_id')->constrained('bookings')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            
            $table->string('request_type', 40)->index(); // date_change, passenger_cancellation, special_assistance, refund
            $table->string('status', 30)->default('pending_review')->index(); // pending_review, approved, rejected, processing, settled
            $table->text('customer_remarks')->nullable();
            $table->text('agent_notes')->nullable();
            $table->foreignId('assigned_agent_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('refunds', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->foreignId('booking_id')->constrained('bookings')->cascadeOnDelete();
            $table->foreignId('payment_id')->nullable()->constrained('payments')->nullOnDelete();
            $table->foreignId('servicing_request_id')->nullable()->constrained('servicing_requests')->nullOnDelete();
            
            $table->string('refund_reference', 40)->unique()->index();
            $table->char('currency', 3)->default('BDT');
            $table->decimal('gross_amount', 12, 2);
            $table->decimal('airline_penalty_fee', 12, 2)->default(0);
            $table->decimal('service_cancellation_fee', 12, 2)->default(0);
            $table->decimal('net_refund_amount', 12, 2);
            $table->string('status', 30)->default('requested')->index(); // requested, approved, processing, completed, rejected
            
            $table->timestamp('settled_at')->nullable();
            $table->foreignId('processed_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            // IMMUTABLE FINANCIAL RECORD - NO SOFT DELETES
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('refunds');
        Schema::dropIfExists('servicing_requests');
    }
};
