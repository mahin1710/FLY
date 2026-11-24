<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class DualApproval extends Model
{
    use HasFactory;

    protected $fillable = [
        'ulid',
        'action_type',
        'target_type',
        'target_id',
        'requested_payload',
        'reason',
        'requested_by_user_id',
        'approved_by_user_id',
        'status',
        'decision_reason',
        'decided_at',
    ];

    protected $casts = [
        'requested_payload' => 'array',
        'decided_at'        => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (DualApproval $approval) {
            if (empty($approval->ulid)) {
                $approval->ulid = (string) Str::ulid();
            }
        });
    }

    public function requestedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by_user_id');
    }

    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by_user_id');
    }
}
