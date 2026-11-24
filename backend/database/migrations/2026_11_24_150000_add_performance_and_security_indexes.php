<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations for query performance and operational security indexing.
     */
    public function up(): void
    {
        // 1. Indexes on Bookings table
        Schema::table('bookings', function (Blueprint $table) {
            $table->index(['user_id', 'booking_status'], 'idx_bookings_user_status');
            $table->index(['booking_status', 'created_at'], 'idx_bookings_status_created');
            $table->index(['ticket_status', 'ticketing_deadline_at'], 'idx_bookings_ticket_deadline');
            $table->index('provider_booking_ref', 'idx_bookings_provider_ref');
            $table->index('contact_email', 'idx_bookings_contact_email');
            $table->index('contact_phone', 'idx_bookings_contact_phone');
        });

        // 2. Indexes on Payments table
        Schema::table('payments', function (Blueprint $table) {
            $table->index(['status', 'created_at'], 'idx_payments_status_created');
            $table->index('merchant_transaction_ref', 'idx_payments_merchant_ref');
        });

        // 3. Indexes on Tickets table
        Schema::table('tickets', function (Blueprint $table) {
            $table->index(['booking_id', 'ticket_status'], 'idx_tickets_booking_status');
        });

        // 4. Indexes on Servicing Requests table
        Schema::table('servicing_requests', function (Blueprint $table) {
            $table->index(['status', 'request_type'], 'idx_servicing_status_type');
            $table->index(['booking_id', 'status'], 'idx_servicing_booking_status');
        });

        // 5. Indexes on Admin Audit Logs table
        Schema::table('admin_audit_logs', function (Blueprint $table) {
            $table->index(['user_id', 'created_at'], 'idx_audit_user_created');
            $table->index(['target_type', 'target_id'], 'idx_audit_target');
        });

        // 6. Indexes on Passengers table
        Schema::table('passengers', function (Blueprint $table) {
            $table->index(['booking_id', 'type'], 'idx_passengers_booking_type');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('passengers', function (Blueprint $table) {
            $table->dropIndex('idx_passengers_booking_type');
        });

        Schema::table('admin_audit_logs', function (Blueprint $table) {
            $table->dropIndex('idx_audit_target');
            $table->dropIndex('idx_audit_user_created');
        });

        Schema::table('servicing_requests', function (Blueprint $table) {
            $table->dropIndex('idx_servicing_booking_status');
            $table->dropIndex('idx_servicing_status_type');
        });

        Schema::table('tickets', function (Blueprint $table) {
            $table->dropIndex('idx_tickets_booking_status');
        });

        Schema::table('payments', function (Blueprint $table) {
            $table->dropIndex('idx_payments_merchant_ref');
            $table->dropIndex('idx_payments_status_created');
        });

        Schema::table('bookings', function (Blueprint $table) {
            $table->dropIndex('idx_bookings_contact_phone');
            $table->dropIndex('idx_bookings_contact_email');
            $table->dropIndex('idx_bookings_provider_ref');
            $table->dropIndex('idx_bookings_ticket_deadline');
            $table->dropIndex('idx_bookings_status_created');
            $table->dropIndex('idx_bookings_user_status');
        });
    }
};
