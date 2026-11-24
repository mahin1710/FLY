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
        Schema::create('tickets', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->foreignId('booking_id')->constrained('bookings')->cascadeOnDelete();
            $table->foreignId('passenger_id')->constrained('passengers')->cascadeOnDelete();
            
            // 13-digit IATA e-ticket format: e.g. 098-1234567890
            $table->string('ticket_number', 30)->nullable()->unique()->index();
            $table->string('pnr_reference', 20)->nullable()->index();
            $table->string('ticket_status', 30)->default('unissued')->index(); // unissued, queued, issued, voided, refunded, exchanged
            $table->foreignId('issuing_carrier_id')->nullable()->constrained('airlines')->nullOnDelete();
            
            $table->char('currency', 3)->default('BDT');
            $table->decimal('fare_amount', 12, 2);
            $table->timestamp('issued_at')->nullable();
            $table->char('validating_airline_code', 2)->nullable();
            $table->json('digital_coupon_data')->nullable();
            $table->timestamps();
        });

        Schema::create('ancillary_items', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->foreignId('booking_id')->constrained('bookings')->cascadeOnDelete();
            $table->foreignId('passenger_id')->nullable()->constrained('passengers')->nullOnDelete();
            $table->foreignId('booking_segment_id')->nullable()->constrained('booking_segments')->nullOnDelete();

            $table->string('type', 30)->index(); // seat, baggage, meal, insurance, lounge
            $table->string('item_code', 50);
            $table->string('name', 120);
            $table->char('currency', 3)->default('BDT');
            $table->decimal('unit_price', 12, 2);
            $table->unsignedSmallInteger('quantity')->default(1);
            $table->decimal('total_price', 12, 2);
            $table->string('status', 30)->default('reserved')->index(); // reserved, confirmed, cancelled, refunded
            $table->json('details')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('ancillary_items');
        Schema::dropIfExists('tickets');
    }
};
