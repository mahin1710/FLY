<?php

namespace App\Jobs;

use App\Models\Booking;
use App\Models\Notification;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Str;
use Throwable;

class SendCustomerNotificationJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public readonly int $bookingId,
        public readonly string $templateName, // BOOKING_CONFIRMED, TICKET_PENDING, ETICKET_ISSUED, ACTION_REQUIRED
        public readonly string $channel,      // email, sms
        public readonly string $recipient,
        public readonly array $metadata = []
    ) {
        $this->onQueue('bulk');
    }

    public function handle(): void
    {
        $booking = Booking::with('passengers', 'tickets')->find($this->bookingId);
        if (!$booking) {
            return;
        }

        // Initialize notification delivery log record
        $notification = Notification::create([
            'ulid'           => (string) Str::ulid(),
            'booking_id'     => $booking->id,
            'user_id'        => $booking->user_id,
            'channel'        => $this->channel,
            'recipient'      => $this->recipient,
            'template_name'  => $this->templateName,
            'title'          => 'Pending Preparation',
            'body'           => 'Pending Preparation',
            'status'         => 'queued',
            'retry_count'    => 0,
            'metadata'       => $this->metadata,
        ]);

        try {
            // Check for simulated failure injection in testing/resilience mode
            if (!empty($this->metadata['simulate_failure'])) {
                throw new \RuntimeException('Simulated upstream gateway delivery failure (SMTP/SMS timeout).');
            }

            [$title, $body] = $this->compileTemplate($booking);

            // Update log to SENT with full compiled payload
            $notification->update([
                'title'   => $title,
                'body'    => $body,
                'status'  => 'sent',
                'sent_at' => now(),
            ]);
        } catch (Throwable $e) {
            // CRITICAL RESILIENCE RULE: Notification failure NEVER rolls back or cancels ticket issuance!
            $notification->update([
                'status'         => 'failed',
                'failure_reason' => $e->getMessage(),
                'retry_count'    => $notification->retry_count + 1,
            ]);
        }
    }

    /**
     * Compile branded notification text according to template type and sandbox boundary.
     */
    protected function compileTemplate(Booking $booking): array
    {
        $isDemo = config('app.env') !== 'production'
            || str_contains(strtoupper((string) $booking->provider_booking_ref), 'MCK')
            || empty($booking->provider_booking_ref);

        $demoPrefix = $isDemo ? '[DEMO / SANDBOX - NOT REAL TRAVEL TICKET] ' : '';
        $pnr = $booking->provider_booking_reference ?: 'MCK778';

        switch ($this->templateName) {
            case 'BOOKING_CONFIRMED':
                $title = "{$demoPrefix}Booking Confirmed - Hold Active [{$booking->reference}]";
                $body = "Dear Traveller, your payment for booking {$booking->reference} has been verified and captured. Your airline seats are confirmed under PNR {$pnr}. E-ticket issuance is now being initiated.";
                break;

            case 'TICKET_PENDING':
                $title = "{$demoPrefix}Ticket Fulfillment In Progress [{$booking->reference}]";
                $body = "Dear Traveller, your booking {$booking->reference} is confirmed (PNR: {$pnr}). Ticket issuance is currently being processed by the consolidator/airline queue. You will receive your official 13-digit e-ticket numbers shortly.";
                break;

            case 'ETICKET_ISSUED':
                $downloadUrl = $this->metadata['download_url'] ?? '#';
                $ticketsList = $booking->tickets->map(function ($t) {
                    return "{$t->passenger?->first_name} {$t->passenger?->last_name}: " . ($t->masked_ticket_number ?: $t->ticket_number);
                })->implode(', ');

                $title = "{$demoPrefix}E-Ticket Issued - Your Itinerary & Receipt [{$booking->reference}]";
                $body = "Dear Traveller, your e-ticket has been successfully issued for booking {$booking->reference} (Airline PNR: {$pnr}). E-Tickets: [{$ticketsList}]. Securely download your verified travel itinerary receipt: {$downloadUrl}";
                break;

            case 'ACTION_REQUIRED':
            default:
                $reason = $this->metadata['reason'] ?? 'Schedule confirmation required';
                $title = "{$demoPrefix}Action Required Regarding Flight Reservation [{$booking->reference}]";
                $body = "Dear Traveller, action is required for booking {$booking->reference}: {$reason}. Please contact FLY 24/7 customer support at support@fly.com.bd.";
                break;
        }

        return [$title, $body];
    }
}
