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
        Schema::create('booking_price_snapshots', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->foreignId('flight_offer_id')->nullable()->constrained('flight_offers')->nullOnDelete();
            $table->char('currency', 3)->default('BDT');
            $table->decimal('base_fare', 12, 2);
            $table->decimal('taxes', 12, 2);
            $table->decimal('airline_fees', 12, 2)->default(0);
            $table->decimal('service_fees', 12, 2)->default(0);
            $table->decimal('ancillaries_total', 12, 2)->default(0);
            $table->decimal('discounts_total', 12, 2)->default(0);
            $table->decimal('grand_total', 12, 2);
            $table->json('breakdown_payload');
            $table->timestamp('created_at')->useCurrent();
        });

        Schema::create('bookings', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->string('reference', 30)->unique()->index(); // e.g. BK-DAC-7788
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('booking_price_snapshot_id')->nullable()->constrained('booking_price_snapshots')->nullOnDelete();
            
            // Four decoupled status dimensions
            $table->string('booking_status', 30)->default('draft')->index(); // draft, held, pending_payment, confirmed, completed, expired, cancelled
            $table->string('payment_status', 30)->default('unpaid')->index(); // unpaid, authorized, captured, refund_requested, partially_refunded, refunded, failed, chargeback
            $table->string('ticket_status', 30)->default('unissued')->index(); // unissued, queued_for_issuance, ticketed, voided, exchanged, refunded
            $table->string('servicing_status', 30)->default('none')->index(); // none, change_requested, cancellation_requested, refund_review, refund_approved, refund_rejected, closed

            $table->timestamp('hold_expires_at')->nullable()->index();
            $table->char('currency', 3)->default('BDT');
            $table->decimal('total_amount', 12, 2);
            
            // Contact information
            $table->string('contact_email', 150);
            $table->string('contact_phone', 30);
            $table->string('contact_country_code', 10)->default('+880');

            // Airline PNR and Provider Reference (Protected)
            $table->string('airline_pnr', 20)->nullable()->index();
            $table->string('provider_booking_ref', 100)->nullable();
            $table->text('remarks')->nullable();

            $table->timestamps();
            $table->softDeletes();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('bookings');
        Schema::dropIfExists('booking_price_snapshots');
    }
};
