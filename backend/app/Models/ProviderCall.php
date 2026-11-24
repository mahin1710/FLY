<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class ProviderCall extends Model
{
    use HasFactory;

    public $timestamps = false;

    // NEVER STORES DECRYPTED API SECRETS OR PASSWORDS

    protected $fillable = [
        'ulid',
        'provider_name',
        'endpoint',
        'http_method',
        'status_code',
        'duration_ms',
        'request_payload',
        'response_payload',
        'is_error',
        'error_message',
        'created_at',
    ];

    protected $casts = [
        'request_payload'  => 'array',
        'response_payload' => 'array',
        'is_error'         => 'boolean',
        'status_code'      => 'integer',
        'duration_ms'      => 'integer',
        'created_at'       => 'datetime',
    ];

    protected $hidden = [
        // Protect raw payload
        'request_payload',
        'response_payload',
    ];

    protected static function booted(): void
    {
        static::creating(function (ProviderCall $call) {
            if (empty($call->ulid)) {
                $call->ulid = (string) Str::ulid();
            }
        });
    }
}
