<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class BookingSegment extends Model
{
    use HasFactory;

    protected $fillable = [
        'ulid',
        'booking_id',
        'segment_order',
        'marketing_airline_id',
        'operating_airline_id',
        'flight_number',
        'aircraft_type',
        'origin_airport_id',
        'destination_airport_id',
        'departure_time_utc',
        'departure_local_time',
        'departure_timezone',
        'arrival_time_utc',
        'arrival_local_time',
        'arrival_timezone',
        'departure_terminal',
        'arrival_terminal',
        'duration_minutes',
        'layover_minutes',
        'cabin_class',
        'booking_class',
        'status',
    ];

    protected $casts = [
        'departure_time_utc' => 'datetime',
        'arrival_time_utc'   => 'datetime',
        'duration_minutes'   => 'integer',
        'layover_minutes'    => 'integer',
        'segment_order'      => 'integer',
    ];

    protected static function booted(): void
    {
        static::creating(function (BookingSegment $segment) {
            if (empty($segment->ulid)) {
                $segment->ulid = (string) Str::ulid();
            }
        });
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function marketingAirline(): BelongsTo
    {
        return $this->belongsTo(Airline::class, 'marketing_airline_id');
    }

    public function operatingAirline(): BelongsTo
    {
        return $this->belongsTo(Airline::class, 'operating_airline_id');
    }

    public function originAirport(): BelongsTo
    {
        return $this->belongsTo(Airport::class, 'origin_airport_id');
    }

    public function destinationAirport(): BelongsTo
    {
        return $this->belongsTo(Airport::class, 'destination_airport_id');
    }

    public function ancillaries(): HasMany
    {
        return $this->hasMany(AncillaryItem::class);
    }
}
