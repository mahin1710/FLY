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
        Schema::create('airlines', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->char('iata_code', 2)->unique()->index();
            $table->char('icao_code', 3)->nullable()->index();
            $table->string('name', 120);
            $table->string('logo_symbol', 100)->nullable();
            $table->char('country_code', 2)->default('BD');
            $table->boolean('is_active')->default(true)->index();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('airlines');
    }
};
