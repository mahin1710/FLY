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
        Schema::create('flight_searches', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('trip_type', 30)->default('round_trip'); // one_way, round_trip, multi_city
            $table->string('cabin_class', 30)->default('economy');
            $table->unsignedSmallInteger('adults_count')->default(1);
            $table->unsignedSmallInteger('children_count')->default(0);
            $table->unsignedSmallInteger('infants_count')->default(0);
            $table->json('search_params');
            $table->string('ip_address', 45)->nullable();
            $table->timestamps();
        });

        Schema::create('flight_offers', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('flight_search_id')->nullable()->constrained('flight_searches')->nullOnDelete();
            $table->string('provider_code', 50)->default('DEMO_FIXTURE')->index();
            $table->string('provider_offer_ref', 120)->index();
            $table->string('fare_family', 80)->default('Economy Standard');
            $table->boolean('is_refundable')->default(false)->index();
            $table->boolean('is_bookable')->default(false); // Typed guarantee: demo offers are not live bookable
            $table->char('currency', 3)->default('BDT');
            $table->decimal('base_amount', 12, 2);
            $table->decimal('tax_amount', 12, 2);
            $table->decimal('fee_amount', 12, 2)->default(0);
            $table->decimal('total_amount', 12, 2)->index();
            $table->unsignedSmallInteger('stops_count')->default(0)->index();
            $table->unsignedInteger('duration_minutes')->default(60);
            $table->timestamp('expires_at')->index();
            $table->json('raw_payload')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('flight_offers');
        Schema::dropIfExists('flight_searches');
    }
};
