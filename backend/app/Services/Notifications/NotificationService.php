<?php

namespace App\Services\Notifications;

use App\Jobs\SendCustomerNotificationJob;
use App\Models\Booking;

class NotificationService
{
    /**
     * Dispatch Booking Confirmed Notification (Payment captured, reservation held, ticket pending).
     */
    public function dispatchBookingConfirmedNotification(Booking $booking): void
    {
        if ($booking->contact_email) {
            SendCustomerNotificationJob::dispatch(
                $booking->id,
                'BOOKING_CONFIRMED',
                'email',
                $booking->contact_email,
                ['reference' => $booking->reference]
            );
        }

        if ($booking->contact_phone) {
            $phone = ($booking->contact_country_code ?: '+880') . $booking->contact_phone;
            SendCustomerNotificationJob::dispatch(
                $booking->id,
                'BOOKING_CONFIRMED',
                'sms',
                $phone,
                ['reference' => $booking->reference]
            );
        }
    }

    /**
     * Dispatch Ticket Pending Notification (Supplier queue / consolidator processing).
     */
    public function dispatchTicketPendingNotification(Booking $booking, array $context = []): void
    {
        if ($booking->contact_email) {
            SendCustomerNotificationJob::dispatch(
                $booking->id,
                'TICKET_PENDING',
                'email',
                $booking->contact_email,
                $context
            );
        }
    }

    /**
     * Dispatch Official E-Ticket Issued Notification with secure download link.
     */
    public function dispatchEticketIssuedNotification(Booking $booking, string $downloadUrl): void
    {
        if ($booking->contact_email) {
            SendCustomerNotificationJob::dispatch(
                $booking->id,
                'ETICKET_ISSUED',
                'email',
                $booking->contact_email,
                ['download_url' => $downloadUrl]
            );
        }

        if ($booking->contact_phone) {
            $phone = ($booking->contact_country_code ?: '+880') . $booking->contact_phone;
            SendCustomerNotificationJob::dispatch(
                $booking->id,
                'ETICKET_ISSUED',
                'sms',
                $phone,
                ['download_url' => $downloadUrl]
            );
        }
    }

    /**
     * Dispatch Action Required Notification (Ticketing exception / manual review).
     */
    public function dispatchActionRequiredNotification(Booking $booking, string $reason): void
    {
        if ($booking->contact_email) {
            SendCustomerNotificationJob::dispatch(
                $booking->id,
                'ACTION_REQUIRED',
                'email',
                $booking->contact_email,
                ['reason' => $reason]
            );
        }
    }
}
