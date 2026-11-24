<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class Ticket extends Model
{
    use HasFactory;

    protected $fillable = [
        'ulid',
        'booking_id',
        'passenger_id',
        'booking_segment_id',
        'ticket_number',
        'masked_ticket_number',
        'pnr_reference',
        'ticket_status',
        'issuing_carrier_id',
        'currency',
        'fare_amount',
        'issued_at',
        'validating_airline_code',
        'digital_coupon_data',
    ];

    protected $casts = [
        'fare_amount'         => 'decimal:2',
        'issued_at'           => 'datetime',
        'digital_coupon_data' => 'array',
    ];

    protected static function booted(): void
    {
        static::creating(function (Ticket $ticket) {
            if (empty($ticket->ulid)) {
                $ticket->ulid = (string) Str::ulid();
            }
        });

        static::saving(function (Ticket $ticket) {
            if (!empty($ticket->ticket_number) && empty($ticket->masked_ticket_number)) {
                $ticket->masked_ticket_number = self::maskTicketNumber($ticket->ticket_number);
            }
        });
    }

    /**
     * Securely mask IATA 13-digit ticket number for public display (e.g. 098-******7890).
     */
    public static function maskTicketNumber(?string $ticketNumber): ?string
    {
        if (empty($ticketNumber)) {
            return null;
        }

        $clean = str_replace([' ', '-'], '', $ticketNumber);
        $len = strlen($clean);
        if ($len <= 4) {
            return $ticketNumber;
        }

        $prefix = substr($clean, 0, 3);
        $suffix = substr($clean, -4);
        $maskedLength = max(4, $len - 7);
        $maskedPart = str_repeat('*', $maskedLength);

        return "{$prefix}-{$maskedPart}{$suffix}";
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function passenger(): BelongsTo
    {
        return $this->belongsTo(Passenger::class);
    }

    public function bookingSegment(): BelongsTo
    {
        return $this->belongsTo(BookingSegment::class, 'booking_segment_id');
    }

    public function issuingCarrier(): BelongsTo
    {
        return $this->belongsTo(Airline::class, 'issuing_carrier_id');
    }
}
