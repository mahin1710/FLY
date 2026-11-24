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
        'case_number',
        'booking_id',
        'user_id',
        'actor_type',
        'actor_id',
        'request_type',
        'servicing_capability',
        'status',
        'is_approved_by_customer',
        'customer_approved_at',
        'fare_rule_snapshot',
        'supplier_case_id',
        'supplier_response',
        'financial_effects',
        'affected_passenger_ids',
        'affected_segment_ids',
        'customer_remarks',
        'agent_notes',
        'assigned_agent_id',
    ];

    protected $casts = [
        'is_approved_by_customer' => 'boolean',
        'customer_approved_at'    => 'datetime',
        'fare_rule_snapshot'      => 'array',
        'supplier_response'       => 'array',
        'financial_effects'       => 'array',
        'affected_passenger_ids'  => 'array',
        'affected_segment_ids'    => 'array',
    ];

    protected static function booted(): void
    {
        static::creating(function (ServicingRequest $req) {
            if (empty($req->ulid)) {
                $req->ulid = (string) Str::ulid();
            }
            if (empty($req->case_number)) {
                $req->case_number = 'CASE-' . date('Ymd') . '-' . strtoupper(Str::random(6));
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
