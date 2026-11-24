<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

class Promotion extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'ulid',
        'code',
        'title',
        'description',
        'discount_type',
        'discount_value',
        'currency',
        'min_spend',
        'max_discount',
        'usage_limit',
        'usage_count',
        'starts_at',
        'expires_at',
        'is_active',
    ];

    protected $casts = [
        'discount_value' => 'decimal:2',
        'min_spend'      => 'decimal:2',
        'max_discount'   => 'decimal:2',
        'usage_limit'    => 'integer',
        'usage_count'    => 'integer',
        'starts_at'      => 'datetime',
        'expires_at'     => 'datetime',
        'is_active'      => 'boolean',
    ];

    protected static function booted(): void
    {
        static::creating(function (Promotion $promo) {
            if (empty($promo->ulid)) {
                $promo->ulid = (string) Str::ulid();
            }
        });
    }

    public function isValidNow(): bool
    {
        return $this->is_active &&
            now()->between($this->starts_at, $this->expires_at) &&
            ($this->usage_limit === null || $this->usage_count < $this->usage_limit);
    }
}
