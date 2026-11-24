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
        Schema::create('booking_segments', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->foreignId('booking_id')->constrained('bookings')->cascadeOnDelete();
            $table->unsignedSmallInteger('segment_order')->default(1);
            
            $table->foreignId('marketing_airline_id')->constrained('airlines');
            $table->foreignId('operating_airline_id')->constrained('airlines');
            $table->string('flight_number', 20);
            $table->string('aircraft_type', 80)->nullable();

            $table->foreignId('origin_airport_id')->constrained('airports');
            $table->foreignId('destination_airport_id')->constrained('airports');

            // UTC instant + provider local time & timezone
            $table->timestamp('departure_time_utc')->index();
            $table->string('departure_local_time', 40); // e.g. 2026-11-28 10:30:00
            $table->string('departure_timezone', 50)->default('Asia/Dhaka');
            
            $table->timestamp('arrival_time_utc')->index();
            $table->string('arrival_local_time', 40);
            $table->string('arrival_timezone', 50)->default('Asia/Dhaka');

            $table->string('departure_terminal', 40)->nullable();
            $table->string('arrival_terminal', 40)->nullable();
            $table->unsignedInteger('duration_minutes')->default(55);
            $table->unsignedInteger('layover_minutes')->default(0);
            $table->string('cabin_class', 30)->default('Economy');
            $table->char('booking_class', 2)->nullable();
            $table->string('status', 30)->default('confirmed')->index();

            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('booking_segments');
    }
};
