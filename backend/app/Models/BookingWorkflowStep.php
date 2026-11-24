<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class BookingWorkflowStep extends Model
{
    use HasFactory;

    protected $fillable = [
        'ulid',
        'booking_id',
        'step_name',
        'step_status',
        'attempt_count',
        'max_attempts',
        'correlation_id',
        'idempotency_key',
        'error_code',
        'error_message',
        'context_payload',
        'started_at',
        'completed_at',
    ];

    protected $casts = [
        'attempt_count'   => 'integer',
        'max_attempts'    => 'integer',
        'context_payload' => 'array',
        'started_at'      => 'datetime',
        'completed_at'    => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (BookingWorkflowStep $step) {
            if (empty($step->ulid)) {
                $step->ulid = (string) Str::ulid();
            }
        });
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }
}
