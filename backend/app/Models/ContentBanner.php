<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class ContentBanner extends Model
{
    use HasFactory;

    protected $fillable = [
        'ulid',
        'title',
        'subtitle',
        'destination_code',
        'banner_type',
        'image_url',
        'action_url',
        'indicative_price',
        'currency',
        'starts_at',
        'expires_at',
        'is_active',
        'created_by_user_id',
    ];

    protected $casts = [
        'indicative_price' => 'decimal:2',
        'starts_at'        => 'datetime',
        'expires_at'       => 'datetime',
        'is_active'        => 'boolean',
    ];

    protected static function booted(): void
    {
        static::creating(function (ContentBanner $banner) {
            if (empty($banner->ulid)) {
                $banner->ulid = (string) Str::ulid();
            }
        });
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }
}
