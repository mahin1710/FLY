<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

class FlightOffer extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'uuid',
        'flight_search_id',
        'provider_code',
        'provider_offer_ref',
        'fare_family',
        'is_refundable',
        'is_bookable',
        'currency',
        'base_amount',
        'tax_amount',
        'fee_amount',
        'total_amount',
        'stops_count',
        'duration_minutes',
        'expires_at',
        'raw_payload',
    ];

    protected $casts = [
        'is_refundable'    => 'boolean',
        'is_bookable'      => 'boolean',
        'base_amount'      => 'decimal:2',
        'tax_amount'       => 'decimal:2',
        'fee_amount'       => 'decimal:2',
        'total_amount'     => 'decimal:2',
        'stops_count'      => 'integer',
        'duration_minutes' => 'integer',
        'expires_at'       => 'datetime',
        'raw_payload'      => 'array',
    ];

    protected static function booted(): void
    {
        static::creating(function (FlightOffer $offer) {
            if (empty($offer->uuid)) {
                $offer->uuid = (string) Str::uuid();
            }
        });
    }

    public function search(): BelongsTo
    {
        return $this->belongsTo(FlightSearch::class, 'flight_search_id');
    }

    public function priceSnapshot(): HasOne
    {
        return $this->hasOne(BookingPriceSnapshot::class);
    }
}
