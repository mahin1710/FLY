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
        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->foreignId('booking_id')->constrained('bookings')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('payment_method', 30); // card, bkash, nagad, bank_transfer, instant_verify
            $table->string('gateway_provider', 40)->default('simulated'); // sslcommerz, bkash, stripe, simulated
            $table->string('gateway_transaction_id', 100)->nullable()->index();
            $table->string('gateway_reference', 100)->nullable();
            $table->char('currency', 3)->default('BDT');
            $table->decimal('amount', 12, 2);
            $table->string('status', 30)->default('initiated')->index(); // initiated, authorized, captured, refunded, failed
            $table->char('card_last_four', 4)->nullable();
            $table->string('card_brand', 30)->nullable();
            $table->string('idempotency_key', 100)->unique()->index();
            $table->json('gateway_response_payload')->nullable();
            $table->timestamp('authorized_at')->nullable();
            $table->timestamp('captured_at')->nullable();
            $table->timestamps();
            // IMMUTABLE FINANCIAL RECORD - NO SOFT DELETES
        });

        Schema::create('payment_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('payment_id')->constrained('payments')->cascadeOnDelete();
            $table->string('event_type', 60)->index(); // authorization_initiated, 3ds_challenge_passed, funds_captured, gateway_declined, refund_settled
            $table->string('status_from', 30)->nullable();
            $table->string('status_to', 30);
            $table->json('payload')->nullable();
            $table->timestamp('recorded_at')->useCurrent();
            $table->timestamp('created_at')->useCurrent();
            // APPEND-ONLY AUDIT STREAM - NO SOFT DELETES
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('payment_events');
        Schema::dropIfExists('payments');
    }
};
