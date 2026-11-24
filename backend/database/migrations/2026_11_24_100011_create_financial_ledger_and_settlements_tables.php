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
        Schema::create('financial_ledger_entries', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->foreignId('booking_id')->nullable()->constrained('bookings')->nullOnDelete();
            $table->foreignId('payment_id')->nullable()->constrained('payments')->nullOnDelete();
            $table->foreignId('refund_id')->nullable()->constrained('refunds')->nullOnDelete();
            
            // Double-entry accounting types
            $table->string('entry_type', 40)->index(); // customer_charge, supplier_payable, agency_commission, tax_withholding, customer_refund, chargeback_debit
            $table->decimal('debit_amount', 12, 2)->default(0);
            $table->decimal('credit_amount', 12, 2)->default(0);
            $table->char('currency', 3)->default('BDT');
            $table->string('description', 255);
            $table->string('account_code', 50)->index();
            $table->timestamp('recorded_at')->useCurrent()->index();
            $table->timestamp('created_at')->useCurrent();
            // IMMUTABLE AUDIT FINANCIAL LEDGER - NO SOFT DELETES
        });

        Schema::create('supplier_settlements', function (Blueprint $table) {
            $table->id();
            $table->string('ulid', 26)->unique();
            $table->foreignId('booking_id')->constrained('bookings')->cascadeOnDelete();
            $table->foreignId('airline_id')->constrained('airlines');
            
            $table->string('provider_name', 50);
            $table->string('supplier_invoice_ref', 100)->nullable()->index();
            $table->char('settlement_currency', 3)->default('BDT');
            $table->decimal('settlement_amount', 12, 2);
            $table->string('settlement_status', 30)->default('pending')->index(); // pending, settled, disputed
            $table->timestamp('settled_at')->nullable();
            $table->timestamps();
            // IMMUTABLE SUPPLIER SETTLEMENT AUDIT - NO SOFT DELETES
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('supplier_settlements');
        Schema::dropIfExists('financial_ledger_entries');
    }
};
