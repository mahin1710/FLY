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
        Schema::table('tickets', function (Blueprint $table) {
            $table->foreignId('booking_segment_id')->nullable()->after('passenger_id')->constrained('booking_segments')->nullOnDelete();
            $table->string('masked_ticket_number', 40)->nullable()->after('ticket_number')->index();
        });

        Schema::table('notifications', function (Blueprint $table) {
            $table->unsignedTinyInteger('retry_count')->default(0)->after('status');
            $table->json('metadata')->nullable()->after('failure_reason');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('tickets', function (Blueprint $table) {
            $table->dropForeign(['booking_segment_id']);
            $table->dropColumn(['booking_segment_id', 'masked_ticket_number']);
        });

        Schema::table('notifications', function (Blueprint $table) {
            $table->dropColumn(['retry_count', 'metadata']);
        });
    }
};
