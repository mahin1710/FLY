<?php

namespace App\Console\Commands;

use App\Models\FlightOffer;
use App\Models\FlightSearch;
use App\Models\IdempotencyRecord;
use App\Models\ProviderCall;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class PruneExpiredDataCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'app:prune-expired-data {--days=30 : Retention window for non-compliance operational telemetry}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Enforce data retention policies: prune expired search offers, idempotency locks, and aged telemetry.';

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $days = (int) $this->option('days');
        $this->info("Enforcing GDPR/IATA Data Retention Policy (Window: {$days} days)...");

        // 1. Prune expired idempotency locks older than 24 hours
        $prunedLocks = IdempotencyRecord::where('created_at', '<', now()->subDay())->delete();
        $this->line("• Pruned {$prunedLocks} expired idempotency records.");

        // 2. Prune expired flight searches and unbooked candidate offers older than 7 days
        $oldSearchIds = FlightSearch::where('created_at', '<', now()->subDays(7))->pluck('id');
        $prunedOffers = FlightOffer::whereIn('flight_search_id', $oldSearchIds)->delete();
        $prunedSearches = FlightSearch::whereIn('id', $oldSearchIds)->delete();
        $this->line("• Pruned {$prunedSearches} expired searches and {$prunedOffers} candidate offers.");

        // 3. Prune aged provider telemetry calls older than retention threshold (default 30 days)
        $prunedCalls = ProviderCall::where('created_at', '<', now()->subDays($days))->delete();
        $this->line("• Pruned {$prunedCalls} aged provider telemetry calls.");

        $this->info('Data retention policy successfully enforced. Compliance logs remain immutable.');
        return Command::SUCCESS;
    }
}
