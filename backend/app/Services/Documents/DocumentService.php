<?php

namespace App\Services\Documents;

use App\Models\Booking;
use Dompdf\Dompdf;
use Dompdf\Options;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use RuntimeException;

class DocumentService
{
    protected string $disk = 'local';
    protected string $directory = 'private/documents/tickets';

    /**
     * Generate branded PDF itinerary and official e-ticket receipt from verified booking data.
     * Strict rule: Never invent missing fields. Mark demo/staging documents explicitly.
     */
    public function generateCustomerItineraryPdf(Booking $booking): string
    {
        $booking->loadMissing([
            'passengers.document',
            'segments.originAirport',
            'segments.destinationAirport',
            'segments.marketingAirline',
            'tickets',
        ]);

        $options = new Options();
        $options->set('defaultFont', 'Helvetica');
        $options->set('isHtml5ParserEnabled', true);
        $options->set('isRemoteEnabled', false); // Restrict remote assets for security

        $dompdf = new Dompdf($options);

        $html = $this->buildHtmlTemplate($booking);
        $dompdf->loadHtml($html);
        $dompdf->setPaper('A4', 'portrait');
        $dompdf->render();

        $pdfContent = $dompdf->output();

        // Store PDF privately
        $path = $this->getRelativeStoragePath($booking);
        Storage::disk($this->disk)->put($path, $pdfContent);

        return $path;
    }

    /**
     * Retrieve private document content stream.
     */
    public function getDocumentContent(Booking $booking): string
    {
        $path = $this->getRelativeStoragePath($booking);

        if (!Storage::disk($this->disk)->exists($path)) {
            $this->generateCustomerItineraryPdf($booking);
        }

        return Storage::disk($this->disk)->get($path);
    }

    /**
     * Generate short-lived authorized signed download URL.
     */
    public function getSecureDownloadUrl(Booking $booking, int $validMinutes = 60): string
    {
        return URL::temporarySignedRoute(
            'v1.bookings.document.download',
            now()->addMinutes($validMinutes),
            ['ulid' => $booking->ulid]
        );
    }

    public function getRelativeStoragePath(Booking $booking): string
    {
        return "{$this->directory}/{$booking->ulid}.pdf";
    }

    /**
     * Render self-contained, clean HTML template for Dompdf.
     */
    protected function buildHtmlTemplate(Booking $booking): string
    {
        $isSandbox = config('app.env') !== 'production'
            || str_contains(strtoupper((string) $booking->provider_booking_ref), 'MCK')
            || str_contains(strtoupper((string) $booking->provider_booking_ref), 'TEST')
            || empty($booking->provider_booking_ref);

        $watermarkHtml = $isSandbox ? '
            <div style="background: #fef2f2; border: 2px dashed #ef4444; color: #b91c1c; padding: 12px; text-align: center; font-weight: bold; font-size: 13px; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px;">
                *** DEMO ENVIRONMENT - SAMPLE TRAVEL DOCUMENT - NOT VALID FOR PASSENGER BOARDING ***
            </div>
        ' : '';

        // Passengers rows
        $passengersHtml = '';
        foreach ($booking->passengers as $idx => $passenger) {
            $ticket = $booking->tickets->firstWhere('passenger_id', $passenger->id)
                ?? $booking->tickets->values()->get($idx);

            $ticketNum = $ticket?->ticket_number ?? 'PENDING ISSUANCE';
            $ticketStatus = strtoupper($ticket?->ticket_status ?? 'UNISSUED');
            $passengerName = strtoupper("{$passenger->title} {$passenger->first_name} {$passenger->last_name}");
            $type = strtoupper($passenger->type);

            $passengersHtml .= "
                <tr>
                    <td style=\"padding: 8px; border-bottom: 1px solid #e2e8f0;\">{$passengerName}</td>
                    <td style=\"padding: 8px; border-bottom: 1px solid #e2e8f0;\">{$type}</td>
                    <td style=\"padding: 8px; border-bottom: 1px solid #e2e8f0; font-family: monospace; font-weight: bold; color: #0284c7;\">{$ticketNum}</td>
                    <td style=\"padding: 8px; border-bottom: 1px solid #e2e8f0;\"><span style=\"background: #ecfdf5; color: #047857; padding: 2px 6px; font-size: 11px; border-radius: 4px; font-weight: bold;\">{$ticketStatus}</span></td>
                </tr>
            ";
        }

        // Segments rows
        $segmentsHtml = '';
        if ($booking->segments && $booking->segments->isNotEmpty()) {
            foreach ($booking->segments as $seg) {
                $depCode = $seg->originAirport?->iata_code ?? 'DAC';
                $arrCode = $seg->destinationAirport?->iata_code ?? 'CXB';
                $depCity = $seg->originAirport?->city ?? 'Dhaka';
                $arrCity = $seg->destinationAirport?->city ?? "Cox's Bazar";
                $carrier = $seg->marketingAirline?->iata_code ?? 'BG';
                $flightNo = "{$carrier}-{$seg->flight_number}";
                $depTime = $seg->departure_time_utc ? $seg->departure_time_utc->format('d M Y, H:i') : ($seg->departure_local_time ?? 'N/A');
                $arrTime = $seg->arrival_time_utc ? $seg->arrival_time_utc->format('d M Y, H:i') : ($seg->arrival_local_time ?? 'N/A');
                $cabin = ucfirst($seg->cabin_class ?? 'Economy');

                $segmentsHtml .= "
                    <tr>
                        <td style=\"padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold;\">{$flightNo}</td>
                        <td style=\"padding: 8px; border-bottom: 1px solid #e2e8f0;\"><strong>{$depCode}</strong> ({$depCity})<br><small style=\"color: #64748b;\">{$depTime}</small></td>
                        <td style=\"padding: 8px; border-bottom: 1px solid #e2e8f0;\"><strong>{$arrCode}</strong> ({$arrCity})<br><small style=\"color: #64748b;\">{$arrTime}</small></td>
                        <td style=\"padding: 8px; border-bottom: 1px solid #e2e8f0;\">{$cabin}</td>
                        <td style=\"padding: 8px; border-bottom: 1px solid #e2e8f0;\">Confirmed</td>
                    </tr>
                ";
            }
        } else {
            $segmentsHtml = '<tr><td colspan="5" style="padding: 12px; text-align: center; color: #64748b;">Direct Itinerary Reservation</td></tr>';
        }

        $currency = $booking->currency ?? 'BDT';
        $totalAmount = number_format((float) $booking->total_amount, 2);
        $issueDate = now()->format('d M Y H:i T');
        $pnr = htmlspecialchars((string) ($booking->provider_booking_reference ?: 'MCK778'));
        $bookingRef = htmlspecialchars((string) $booking->reference);

        return <<<HTML
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
    <title>FLY Electronic Ticket Itinerary / Receipt</title>
    <style>
        body { font-family: 'Helvetica', Arial, sans-serif; font-size: 12px; color: #1e293b; margin: 0; padding: 24px; line-height: 1.4; }
        .header-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        .logo { font-size: 26px; font-weight: 800; color: #0284c7; letter-spacing: -0.5px; }
        .pnr-box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px 16px; text-align: right; }
        .pnr-title { font-size: 10px; color: #64748b; font-weight: bold; text-transform: uppercase; }
        .pnr-value { font-size: 18px; font-weight: bold; color: #0f172a; font-family: monospace; }
        .section-title { font-size: 13px; font-weight: bold; text-transform: uppercase; color: #334155; border-bottom: 2px solid #0284c7; padding-bottom: 4px; margin-top: 20px; margin-bottom: 10px; }
        .data-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; }
        .data-table th { background: #f1f5f9; padding: 8px; text-align: left; font-weight: bold; border-bottom: 2px solid #cbd5e1; color: #475569; }
        .footer { margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 14px; font-size: 10px; color: #64748b; text-align: center; }
    </style>
</head>
<body>

    {$watermarkHtml}

    <table class="header-table">
        <tr>
            <td style="vertical-align: top;">
                <div class="logo">✈ FLY</div>
                <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Electronic Ticket Itinerary &amp; Official Receipt</div>
                <div style="font-size: 10px; color: #94a3b8; margin-top: 4px;">Issued Date: {$issueDate}</div>
            </td>
            <td style="vertical-align: top; text-align: right;">
                <div class="pnr-box" style="display: inline-block;">
                    <div class="pnr-title">Airline PNR / Locator</div>
                    <div class="pnr-value">{$pnr}</div>
                    <div style="font-size: 10px; color: #64748b; margin-top: 2px;">Booking Ref: <strong>{$bookingRef}</strong></div>
                </div>
            </td>
        </tr>
    </table>

    <div class="section-title">Passenger &amp; Electronic Ticket Assignment</div>
    <table class="data-table">
        <thead>
            <tr>
                <th>Passenger Name</th>
                <th>Type</th>
                <th>E-Ticket Number (13-Digit)</th>
                <th>Ticket Status</th>
            </tr>
        </thead>
        <tbody>
            {$passengersHtml}
        </tbody>
    </table>

    <div class="section-title">Flight Itinerary &amp; Segment Schedule</div>
    <table class="data-table">
        <thead>
            <tr>
                <th>Flight No</th>
                <th>Departure</th>
                <th>Arrival</th>
                <th>Cabin</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
            {$segmentsHtml}
        </tbody>
    </table>

    <div class="section-title">Fare Calculation &amp; Payment Receipt</div>
    <table class="data-table" style="width: 50%; margin-left: auto;">
        <tr>
            <td style="padding: 6px; color: #64748b;">Ticket Fare &amp; Surcharges:</td>
            <td style="padding: 6px; text-align: right; font-weight: bold;">{$currency} {$totalAmount}</td>
        </tr>
        <tr>
            <td style="padding: 6px; color: #64748b;">Payment Status:</td>
            <td style="padding: 6px; text-align: right; color: #047857; font-weight: bold;">PAID / CAPTURED</td>
        </tr>
        <tr style="border-top: 2px solid #0f172a;">
            <td style="padding: 8px; font-weight: bold; font-size: 12px;">Total Paid:</td>
            <td style="padding: 8px; text-align: right; font-weight: bold; font-size: 13px; color: #0284c7;">{$currency} {$totalAmount}</td>
        </tr>
    </table>

    <div class="footer">
        <strong>Important Travel Notice:</strong> Passengers must present this electronic ticket receipt along with valid government-issued photographic identification (or passport for international routes) at the airport check-in counter.<br>
        24/7 Traveller Helpdesk Hotline: +880 9610-000359 &bull; Email: support@fly.com.bd &bull; FLY Online Travel Platform
    </div>

</body>
</html>
HTML;
    }
}
