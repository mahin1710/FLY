<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Str;

class Payment extends Model
{
    use HasFactory;

    // IMMUTABLE FINANCIAL RECORD - NO SOFT DELETES

    protected $fillable = [
        'ulid',
        'booking_id',
        'user_id',
        'payment_method',
        'gateway_provider',
        'gateway_transaction_id',
        'gateway_reference',
        'currency',
        'amount',
        'status',
        'card_last_four',
        'card_brand',
        'idempotency_key',
        'gateway_response_payload',
        'authorized_at',
        'captured_at',
    ];

    protected $casts = [
        'amount'                   => 'decimal:2',
        'gateway_response_payload' => 'array',
        'authorized_at'            => 'datetime',
        'captured_at'              => 'datetime',
    ];

    protected $hidden = [
        // Protect raw gateway payload from public serialization
        'gateway_response_payload',
    ];

    protected static function booted(): void
    {
        static::creating(function (Payment $payment) {
            if (empty($payment->ulid)) {
                $payment->ulid = (string) Str::ulid();
            }
            if (empty($payment->idempotency_key)) {
                $payment->idempotency_key = (string) Str::uuid();
            }
        });
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(PaymentEvent::class)->orderBy('id', 'asc');
    }

    public function refund(): HasOne
    {
        return $this->hasOne(Refund::class);
    }

    public function ledgerEntries(): HasMany
    {
        return $this->hasMany(FinancialLedgerEntry::class);
    }
}
