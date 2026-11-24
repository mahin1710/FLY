<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class SupplierSettlement extends Model
{
    use HasFactory;

    // IMMUTABLE SUPPLIER SETTLEMENT AUDIT - NO SOFT DELETES

    protected $fillable = [
        'ulid',
        'booking_id',
        'airline_id',
        'provider_name',
        'supplier_invoice_ref',
        'settlement_currency',
        'settlement_amount',
        'settlement_status',
        'settled_at',
    ];

    protected $casts = [
        'settlement_amount' => 'decimal:2',
        'settled_at'        => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (SupplierSettlement $settlement) {
            if (empty($settlement->ulid)) {
                $settlement->ulid = (string) Str::ulid();
            }
        });
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function airline(): BelongsTo
    {
        return $this->belongsTo(Airline::class);
    }
}
