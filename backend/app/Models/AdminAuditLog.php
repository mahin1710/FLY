<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AdminAuditLog extends Model
{
    use HasFactory;

    public $timestamps = false;

    // IMMUTABLE COMPLIANCE AUDIT LOG - NO SOFT DELETES

    protected $fillable = [
        'user_id',
        'action',
        'target_type',
        'target_id',
        'reason',
        'ip_address',
        'user_agent',
        'before_state',
        'after_state',
        'created_at',
    ];

    protected $casts = [
        'before_state' => 'array',
        'after_state'  => 'array',
        'created_at'   => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
