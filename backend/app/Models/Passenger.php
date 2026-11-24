<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Str;

class Passenger extends Model
{
    use HasFactory;

    protected $fillable = [
        'ulid',
        'booking_id',
        'type',
        'title',
        'first_name',
        'last_name',
        'date_of_birth',
        'gender',
        'nationality',
        'wheelchair_required',
    ];

    protected $casts = [
        'date_of_birth'       => 'date',
        'wheelchair_required' => 'boolean',
    ];

    protected static function booted(): void
    {
        static::creating(function (Passenger $pax) {
            if (empty($pax->ulid)) {
                $pax->ulid = (string) Str::ulid();
            }
        });
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function document(): HasOne
    {
        return $this->hasOne(PassengerDocument::class);
    }

    public function ticket(): HasOne
    {
        return $this->hasOne(Ticket::class);
    }

    public function ancillaries(): HasMany
    {
        return $this->hasMany(AncillaryItem::class);
    }

    public function getFullNameAttribute(): string
    {
        return trim("{$this->title} {$this->first_name} {$this->last_name}");
    }
}
