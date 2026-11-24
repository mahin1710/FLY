<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class PassengerDocument extends Model
{
    use HasFactory;

    protected $fillable = [
        'ulid',
        'passenger_id',
        'document_type',
        'document_number',
        'document_number_masked',
        'issuing_country',
        'expiry_date',
        'date_of_birth',
    ];

    /**
     * Highly sensitive document numbers are encrypted at rest in the database
     * and strictly hidden from JSON serialization.
     */
    protected $casts = [
        'document_number' => 'encrypted',
        'expiry_date'     => 'date',
        'date_of_birth'   => 'date',
    ];

    protected $hidden = [
        'document_number',
    ];

    protected static function booted(): void
    {
        static::creating(function (PassengerDocument $doc) {
            if (empty($doc->ulid)) {
                $doc->ulid = (string) Str::ulid();
            }
            if (empty($doc->document_number_masked) && !empty($doc->document_number)) {
                $clean = preg_replace('/\s+/', '', (string) $doc->document_number);
                $doc->document_number_masked = strlen($clean) > 4
                    ? substr($clean, 0, 4) . '****'
                    : '****';
            }
        });
    }

    public function passenger(): BelongsTo
    {
        return $this->belongsTo(Passenger::class);
    }
}
