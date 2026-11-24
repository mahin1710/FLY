<?php

namespace App\Services\Security;

use App\Models\Booking;
use Illuminate\Support\Str;
use RuntimeException;

class GuestSessionService
{
    protected string $secret;

    public function __construct()
    {
        $this->secret = (string) config('app.key', 'base64:fallback_secret_key_1234567890123456');
    }

    /**
     * Validate guest credentials with secondary verification and anti-enumeration.
     * Never reveals whether an email, PNR, or reference specifically exists.
     */
    public function verifyAndIssueToken(string $reference, ?string $lastName, ?string $email): array
    {
        $booking = Booking::with('passengers')
            ->where(function ($q) use ($reference) {
                $q->where('reference', $reference)
                  ->orWhere('provider_booking_reference', $reference);
            })->first();

        $isValid = false;

        if ($booking) {
            if (!empty($lastName)) {
                foreach ($booking->passengers as $p) {
                    if (strcasecmp((string) $p->last_name, trim($lastName)) === 0) {
                        $isValid = true;
                        break;
                    }
                }
            } elseif (!empty($email)) {
                if (strcasecmp((string) $booking->contact_email, trim($email)) === 0) {
                    $isValid = true;
                }
            }
        }

        // Anti-enumeration: Return identical generic message whether PNR exists or factor failed
        if (!$isValid || !$booking) {
            throw new RuntimeException('Booking reference or passenger verification details could not be validated.', 422);
        }

        $expiresAt = now()->addMinutes(30)->timestamp;
        $payload = [
            'booking_ulid' => $booking->ulid,
            'expires_at'   => $expiresAt,
            'issued_at'    => now()->timestamp,
            'nonce'        => Str::random(16),
        ];

        $tokenString = base64_encode(json_encode($payload));
        $signature = hash_hmac('sha256', $tokenString, $this->secret);
        $guestToken = "{$tokenString}.{$signature}";

        return [
            'guest_token'  => $guestToken,
            'expires_at'   => date('c', $expiresAt),
            'booking_ulid' => $booking->ulid,
            'reference'    => $booking->reference,
        ];
    }

    /**
     * Validate guest token and return associated booking ULID.
     * Throws 403 on invalid signature, throws 401 on expired token.
     */
    public function validateToken(string $guestToken): string
    {
        $parts = explode('.', $guestToken);
        if (count($parts) !== 2) {
            throw new RuntimeException('Invalid guest authorization token format.', 403);
        }

        [$tokenString, $signature] = $parts;
        $expectedSign = hash_hmac('sha256', $tokenString, $this->secret);

        if (!hash_equals($expectedSign, $signature)) {
            throw new RuntimeException('Guest authorization token signature verification failed.', 403);
        }

        $payload = json_decode(base64_decode($tokenString), true);
        if (!is_array($payload) || empty($payload['booking_ulid']) || empty($payload['expires_at'])) {
            throw new RuntimeException('Malformed guest token payload.', 403);
        }

        if (now()->timestamp > (int) $payload['expires_at']) {
            throw new RuntimeException('Guest authorization session has expired. Please verify booking again.', 401);
        }

        return (string) $payload['booking_ulid'];
    }
}
