<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class AncillaryItem extends Model
{
    use HasFactory;

    protected $fillable = [
        'ulid',
        'booking_id',
        'passenger_id',
        'booking_segment_id',
        'type',
        'item_code',
        'name',
        'currency',
        'unit_price',
        'quantity',
        'total_price',
        'status',
        'details',
    ];

    protected $casts = [
        'unit_price'  => 'decimal:2',
        'total_price' => 'decimal:2',
        'quantity'    => 'integer',
        'details'     => 'array',
    ];

    protected static function booted(): void
    {
        static::creating(function (AncillaryItem $item) {
            if (empty($item->ulid)) {
                $item->ulid = (string) Str::ulid();
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

    public function segment(): BelongsTo
    {
        return $this->belongsTo(BookingSegment::class, 'booking_segment_id');
    }
}
