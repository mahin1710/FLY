<?php

namespace App\Jobs;

use App\Models\Payment;
use App\Services\Payments\PaymentGatewayInterface;
use App\Services\Payments\PaymentService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Throwable;

class ReconcilePendingTransactionsJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct()
    {
        $this->onQueue('critical_recovery');
    }

    public function handle(
        PaymentGatewayInterface $gateway,
        PaymentService $paymentService
    ): void {
        // Query payments in 'initiated' state older than 5 minutes
        $pendingPayments = Payment::where('status', 'initiated')
            ->where('created_at', '<=', now()->subMinutes(5))
            ->get();

        foreach ($pendingPayments as $payment) {
            try {
                $verification = $gateway->queryTransaction($payment->gateway_transaction_id);

                if ($verification->isVerified && $verification->status === 'CAPTURED') {
                    // Gateway confirms transaction succeeded! Execute idempotent IPN capture
                    $paymentService->handleIpnWebhook([
                        'val_id'   => $verification->validationId,
                        'tran_id'  => $payment->gateway_transaction_id,
                        'amount'   => $verification->amount,
                        'currency' => $verification->currency,
                        'status'   => 'VALID',
                    ]);
                } elseif ($verification->status === 'FAILED') {
                    $payment->update(['status' => 'failed']);
                }
            } catch (Throwable) {
                // Keep for next reconciliation cycle
            }
        }
    }
}
