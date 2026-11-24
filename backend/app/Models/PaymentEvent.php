<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PaymentEvent extends Model
{
    use HasFactory;

    public $timestamps = false;

    // IMMUTABLE AUDIT STREAM - NO SOFT DELETES

    protected $fillable = [
        'payment_id',
        'event_type',
        'status_from',
        'status_to',
        'payload',
        'recorded_at',
        'created_at',
    ];

    protected $casts = [
        'payload'     => 'array',
        'recorded_at' => 'datetime',
        'created_at'  => 'datetime',
    ];

    public function payment(): BelongsTo
    {
        return $this->belongsTo(Payment::class);
    }
}
