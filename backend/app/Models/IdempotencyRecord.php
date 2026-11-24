<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class IdempotencyRecord extends Model
{
    use HasFactory;

    protected $fillable = [
        'idempotency_key',
        'scope',
        'user_id',
        'request_hash',
        'response_status_code',
        'response_body',
        'locked_until',
    ];

    protected $casts = [
        'response_body'        => 'array',
        'response_status_code' => 'integer',
        'locked_until'         => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
