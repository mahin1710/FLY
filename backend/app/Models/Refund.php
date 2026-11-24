<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class Refund extends Model
{
    use HasFactory;

    // IMMUTABLE FINANCIAL RECORD - NO SOFT DELETES

    protected $fillable = [
        'ulid',
        'booking_id',
        'payment_id',
        'servicing_request_id',
        'refund_reference',
        'currency',
        'gross_amount',
        'airline_penalty_fee',
        'service_cancellation_fee',
        'net_refund_amount',
        'status',
        'settled_at',
        'processed_by_user_id',
    ];

    protected $casts = [
        'gross_amount'             => 'decimal:2',
        'airline_penalty_fee'      => 'decimal:2',
        'service_cancellation_fee' => 'decimal:2',
        'net_refund_amount'        => 'decimal:2',
        'settled_at'               => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (Refund $refund) {
            if (empty($refund->ulid)) {
                $refund->ulid = (string) Str::ulid();
            }
            if (empty($refund->refund_reference)) {
                $refund->refund_reference = 'REF-' . date('Y') . '-' . strtoupper(Str::random(6));
            }
        });
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function payment(): BelongsTo
    {
        return $this->belongsTo(Payment::class);
    }

    public function servicingRequest(): BelongsTo
    {
        return $this->belongsTo(ServicingRequest::class);
    }

    public function processedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'processed_by_user_id');
    }

    public function ledgerEntries(): HasMany
    {
        return $this->hasMany(FinancialLedgerEntry::class);
    }
}
