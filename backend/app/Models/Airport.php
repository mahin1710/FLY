<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class Airport extends Model
{
    use HasFactory;

    protected $fillable = [
        'ulid',
        'iata_code',
        'icao_code',
        'name',
        'city',
        'country_code',
        'timezone',
        'latitude',
        'longitude',
        'is_active',
    ];

    protected $casts = [
        'latitude'  => 'decimal:7',
        'longitude' => 'decimal:7',
        'is_active' => 'boolean',
    ];

    protected static function booted(): void
    {
        static::creating(function (Airport $airport) {
            if (empty($airport->ulid)) {
                $airport->ulid = (string) Str::ulid();
            }
        });
    }

    public function departingSegments(): HasMany
    {
        return $this->hasMany(BookingSegment::class, 'origin_airport_id');
    }

    public function arrivingSegments(): HasMany
    {
        return $this->hasMany(BookingSegment::class, 'destination_airport_id');
    }
}
