<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class Airline extends Model
{
    use HasFactory;

    protected $fillable = [
        'ulid',
        'iata_code',
        'icao_code',
        'name',
        'logo_symbol',
        'country_code',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    protected static function booted(): void
    {
        static::creating(function (Airline $airline) {
            if (empty($airline->ulid)) {
                $airline->ulid = (string) Str::ulid();
            }
        });
    }

    public function marketingSegments(): HasMany
    {
        return $this->hasMany(BookingSegment::class, 'marketing_airline_id');
    }

    public function operatingSegments(): HasMany
    {
        return $this->hasMany(BookingSegment::class, 'operating_airline_id');
    }

    public function tickets(): HasMany
    {
        return $this->hasMany(Ticket::class, 'issuing_carrier_id');
    }
}
