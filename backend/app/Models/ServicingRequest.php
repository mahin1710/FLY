<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Str;

class ServicingRequest extends Model
{
    use HasFactory;

    protected $fillable = [
        'ulid',
        'booking_id',
        'user_id',
        'request_type',
        'status',
        'customer_remarks',
        'agent_notes',
        'assigned_agent_id',
    ];

    protected static function booted(): void
    {
        static::creating(function (ServicingRequest $req) {
            if (empty($req->ulid)) {
                $req->ulid = (string) Str::ulid();
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

    public function assignedAgent(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_agent_id');
    }

    public function refund(): HasOne
    {
        return $this->hasOne(Refund::class);
    }
}
