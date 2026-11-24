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
        Schema::table('bookings', function (Blueprint $table) {
            $table->timestamp('ticketing_deadline_at')->nullable()->after('hold_expires_at')->index();
            $table->boolean('requires_manual_review')->default(false)->after('remarks')->index();
            $table->string('manual_review_reason', 150)->nullable()->after('requires_manual_review');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn([
                'ticketing_deadline_at',
                'requires_manual_review',
                'manual_review_reason',
            ]);
        });
    }
};
