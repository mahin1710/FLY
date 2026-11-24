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
        'ticket_number',
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
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function passenger(): BelongsTo
    {
        return $this->belongsTo(Passenger::class);
    }

    public function issuingCarrier(): BelongsTo
    {
        return $this->belongsTo(Airline::class, 'issuing_carrier_id');
    }
}
