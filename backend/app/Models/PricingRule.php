<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

class PricingRule extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'ulid',
        'name',
        'route_type',
        'airline_code',
        'markup_type',
        'markup_value',
        'service_fee',
        'currency',
        'starts_at',
        'expires_at',
        'is_active',
        'status',
        'created_by_user_id',
        'approved_by_user_id',
    ];

    protected $casts = [
        'markup_value' => 'decimal:2',
        'service_fee'  => 'decimal:2',
        'starts_at'    => 'datetime',
        'expires_at'   => 'datetime',
        'is_active'    => 'boolean',
    ];

    protected static function booted(): void
    {
        static::creating(function (PricingRule $rule) {
            if (empty($rule->ulid)) {
                $rule->ulid = (string) Str::ulid();
            }
        });
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by_user_id');
    }
}
