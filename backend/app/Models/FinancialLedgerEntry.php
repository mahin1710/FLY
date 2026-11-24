<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class FinancialLedgerEntry extends Model
{
    use HasFactory;

    public $timestamps = false;

    // IMMUTABLE DOUBLE-ENTRY AUDIT FINANCIAL LEDGER - NO SOFT DELETES

    protected $fillable = [
        'ulid',
        'booking_id',
        'payment_id',
        'refund_id',
        'entry_type',
        'debit_amount',
        'credit_amount',
        'currency',
        'description',
        'account_code',
        'recorded_at',
        'created_at',
    ];

    protected $casts = [
        'debit_amount'  => 'decimal:2',
        'credit_amount' => 'decimal:2',
        'recorded_at'   => 'datetime',
        'created_at'    => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (FinancialLedgerEntry $entry) {
            if (empty($entry->ulid)) {
                $entry->ulid = (string) Str::ulid();
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

    public function refund(): BelongsTo
    {
        return $this->belongsTo(Refund::class);
    }
}
