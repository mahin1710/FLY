<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class FlightSearch extends Model
{
    use HasFactory;

    protected $fillable = [
        'uuid',
        'user_id',
        'trip_type',
        'cabin_class',
        'adults_count',
        'children_count',
        'infants_count',
        'search_params',
        'ip_address',
    ];

    protected $casts = [
        'search_params'  => 'array',
        'adults_count'   => 'integer',
        'children_count' => 'integer',
        'infants_count'  => 'integer',
    ];

    protected static function booted(): void
    {
        static::creating(function (FlightSearch $search) {
            if (empty($search->uuid)) {
                $search->uuid = (string) Str::uuid();
            }
        });
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function offers(): HasMany
    {
        return $this->hasMany(FlightOffer::class);
    }
}
