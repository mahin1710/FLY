<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

class Booking extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'ulid',
        'reference',
        'user_id',
        'booking_price_snapshot_id',
        'booking_status',
        'payment_status',
        'ticket_status',
        'servicing_status',
        'hold_expires_at',
        'ticketing_deadline_at',
        'currency',
        'total_amount',
        'contact_email',
        'contact_phone',
        'contact_country_code',
        'airline_pnr',
        'provider_booking_ref',
        'provider_booking_reference',
        'remarks',
        'requires_manual_review',
        'manual_review_reason',
    ];

    protected $casts = [
        'hold_expires_at'        => 'datetime',
        'ticketing_deadline_at'  => 'datetime',
        'total_amount'           => 'decimal:2',
        'requires_manual_review' => 'boolean',
    ];

    protected $hidden = [
        // Protect provider internal references from leaking to public serialization
        'provider_booking_ref',
        'provider_booking_reference',
    ];

    public function getProviderBookingReferenceAttribute(): ?string
    {
        return $this->attributes['provider_booking_ref'] ?? null;
    }

    public function setProviderBookingReferenceAttribute(?string $value): void
    {
        $this->attributes['provider_booking_ref'] = $value;
    }

    protected static function booted(): void
    {
        static::creating(function (Booking $booking) {
            if (empty($booking->ulid)) {
                $booking->ulid = (string) Str::ulid();
            }
            if (empty($booking->reference)) {
                $booking->reference = 'FLY-' . date('Y') . '-' . strtoupper(Str::random(6));
            }
        });
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function priceSnapshot(): BelongsTo
    {
        return $this->belongsTo(BookingPriceSnapshot::class, 'booking_price_snapshot_id');
    }

    public function segments(): HasMany
    {
        return $this->hasMany(BookingSegment::class)->orderBy('segment_order');
    }

    public function passengers(): HasMany
    {
        return $this->hasMany(Passenger::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }

    public function tickets(): HasMany
    {
        return $this->hasMany(Ticket::class);
    }

    public function ancillaries(): HasMany
    {
        return $this->hasMany(AncillaryItem::class);
    }

    public function servicingRequests(): HasMany
    {
        return $this->hasMany(ServicingRequest::class);
    }

    public function refunds(): HasMany
    {
        return $this->hasMany(Refund::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(BookingEvent::class)->orderBy('id', 'desc');
    }

    public function ledgerEntries(): HasMany
    {
        return $this->hasMany(FinancialLedgerEntry::class);
    }

    public function workflowSteps(): HasMany
    {
        return $this->hasMany(BookingWorkflowStep::class)->orderBy('id', 'asc');
    }
}
