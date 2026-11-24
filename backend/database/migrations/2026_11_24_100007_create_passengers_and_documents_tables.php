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
        Schema::create('passengers', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->foreignId('booking_id')->constrained('bookings')->cascadeOnDelete();
            $table->string('type', 20)->default('adult')->index(); // adult, child, infant
            $table->string('title', 20);
            $table->string('first_name', 100);
            $table->string('last_name', 100);
            $table->date('date_of_birth');
            $table->string('gender', 20)->nullable();
            $table->char('nationality', 2)->default('BD');
            $table->boolean('wheelchair_required')->default(false);
            $table->timestamps();
        });

        Schema::create('passenger_documents', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->foreignId('passenger_id')->constrained('passengers')->cascadeOnDelete();
            $table->string('document_type', 30)->default('passport')->index(); // passport, national_id, birth_certificate
            
            // Highly sensitive document number: Encrypted at rest, hidden from JSON serialization
            $table->text('document_number');
            $table->string('document_number_masked', 30); // e.g. A098****
            $table->char('issuing_country', 2)->default('BD');
            $table->date('expiry_date')->nullable();
            $table->date('date_of_birth')->nullable();
            
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('passenger_documents');
        Schema::dropIfExists('passengers');
    }
};
