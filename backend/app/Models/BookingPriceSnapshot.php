<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Str;

class BookingPriceSnapshot extends Model
{
    use HasFactory;

    public $timestamps = false;

    protected $fillable = [
        'ulid',
        'flight_offer_id',
        'currency',
        'base_fare',
        'taxes',
        'airline_fees',
        'service_fees',
        'ancillaries_total',
        'discounts_total',
        'grand_total',
        'breakdown_payload',
        'created_at',
    ];

    protected $casts = [
        'base_fare'          => 'decimal:2',
        'taxes'              => 'decimal:2',
        'airline_fees'       => 'decimal:2',
        'service_fees'       => 'decimal:2',
        'ancillaries_total'  => 'decimal:2',
        'discounts_total'    => 'decimal:2',
        'grand_total'        => 'decimal:2',
        'breakdown_payload'  => 'array',
        'created_at'         => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (BookingPriceSnapshot $snapshot) {
            if (empty($snapshot->ulid)) {
                $snapshot->ulid = (string) Str::ulid();
            }
        });
    }

    public function offer(): BelongsTo
    {
        return $this->belongsTo(FlightOffer::class, 'flight_offer_id');
    }

    public function booking(): HasOne
    {
        return $this->hasOne(Booking::class);
    }
}
