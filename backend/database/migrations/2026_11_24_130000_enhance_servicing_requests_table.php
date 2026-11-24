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
        Schema::table('servicing_requests', function (Blueprint $table) {
            $table->string('case_number', 40)->nullable()->unique()->after('ulid');
            $table->string('actor_type', 30)->default('customer')->after('user_id');
            $table->string('actor_id', 60)->nullable()->after('actor_type');
            $table->string('servicing_capability', 30)->default('manual_consolidator')->after('request_type'); // online_supplier, manual_consolidator
            $table->boolean('is_approved_by_customer')->default(false)->after('status');
            $table->timestamp('customer_approved_at')->nullable()->after('is_approved_by_customer');
            $table->json('fare_rule_snapshot')->nullable()->after('customer_approved_at');
            $table->string('supplier_case_id', 60)->nullable()->after('fare_rule_snapshot');
            $table->json('supplier_response')->nullable()->after('supplier_case_id');
            $table->json('financial_effects')->nullable()->after('supplier_response');
            $table->json('affected_passenger_ids')->nullable()->after('financial_effects');
            $table->json('affected_segment_ids')->nullable()->after('affected_passenger_ids');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('servicing_requests', function (Blueprint $table) {
            $table->dropColumn([
                'case_number',
                'actor_type',
                'actor_id',
                'servicing_capability',
                'is_approved_by_customer',
                'customer_approved_at',
                'fare_rule_snapshot',
                'supplier_case_id',
                'supplier_response',
                'financial_effects',
                'affected_passenger_ids',
                'affected_segment_ids',
            ]);
        });
    }
};
