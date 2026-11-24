<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BookingEvent extends Model
{
    use HasFactory;

    public $timestamps = false;

    // APPEND-ONLY STATUS TRANSITION AUDIT - NO SOFT DELETES

    protected $fillable = [
        'booking_id',
        'event_name',
        'status_from',
        'status_to',
        'actor_type',
        'actor_id',
        'payload',
        'ip_address',
        'recorded_at',
        'created_at',
    ];

    protected $casts = [
        'payload'     => 'array',
        'recorded_at' => 'datetime',
        'created_at'  => 'datetime',
    ];

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }
}
