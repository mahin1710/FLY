<?php

namespace App\DTOs;

class ProviderTicketDTO
{
    public function __construct(
        public readonly string $providerCode,
        public readonly ?string $ticketNumber, // e.g. 13-digit standard e-ticket number like 098-1234567890
        public readonly string $passengerName,
        public readonly string $status, // 'ISSUED', 'VOIDED', 'REFUNDED', 'TICKETING_PENDING'
        public readonly ?string $issuedAt,
        public readonly array $coupons = [],
        public readonly ?string $documentType = 'ELECTRONIC_TICKET',
        public readonly ?string $disclaimer = 'Sandbox ticket – not valid for live passenger boarding'
    ) {}

    public function toArray(): array
    {
        return [
            'provider_code' => $this->providerCode,
            'ticket_number' => $this->ticketNumber,
            'passenger_name'=> $this->passengerName,
            'status'        => $this->status,
            'issued_at'     => $this->issuedAt,
            'coupons'       => $this->coupons,
            'document_type' => $this->documentType,
            'disclaimer'    => $this->disclaimer,
        ];
    }
}
