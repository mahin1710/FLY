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
        Schema::create('airports', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->char('iata_code', 3)->unique()->index();
            $table->char('icao_code', 4)->nullable()->index();
            $table->string('name', 150);
            $table->string('city', 100)->index();
            $table->char('country_code', 2)->index();
            $table->string('timezone', 50)->default('UTC'); // e.g. Asia/Dhaka
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->boolean('is_active')->default(true)->index();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('airports');
    }
};
