<?php

namespace App\DTOs;

class FlightSegmentDTO
{
    public function __construct(
        public readonly string $carrierCode,
        public readonly string $carrierName,
        public readonly ?string $carrierLogo,
        public readonly string $flightNumber,
        public readonly string $marketingCarrier,
        public readonly string $operatingCarrier,
        public readonly string $aircraft,
        public readonly string $cabinClass,
        public readonly ?string $bookingClass,
        public readonly array $origin, // ['code' => 'DAC', 'name' => '...', 'city' => '...', 'terminal' => '1']
        public readonly array $destination, // ['code' => 'CXB', 'name' => '...', 'city' => '...', 'terminal' => null]
        public readonly string $departureTimeUtc,
        public readonly string $departureLocalTime,
        public readonly string $departureTimezone,
        public readonly string $arrivalTimeUtc,
        public readonly string $arrivalLocalTime,
        public readonly string $arrivalTimezone,
        public readonly int $durationMinutes,
        public readonly int $layoverMinutes = 0
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            carrierCode: (string) ($data['carrier_code'] ?? ''),
            carrierName: (string) ($data['carrier_name'] ?? ''),
            carrierLogo: $data['carrier_logo'] ?? null,
            flightNumber: (string) ($data['flight_number'] ?? ''),
            marketingCarrier: (string) ($data['marketing_carrier'] ?? $data['carrier_code'] ?? ''),
            operatingCarrier: (string) ($data['operating_carrier'] ?? $data['carrier_code'] ?? ''),
            aircraft: (string) ($data['aircraft'] ?? 'Boeing 737-800'),
            cabinClass: (string) ($data['cabin_class'] ?? 'Economy'),
            bookingClass: $data['booking_class'] ?? 'Y',
            origin: (array) ($data['origin'] ?? []),
            destination: (array) ($data['destination'] ?? []),
            departureTimeUtc: (string) ($data['departure_time_utc'] ?? ''),
            departureLocalTime: (string) ($data['departure_local_time'] ?? ''),
            departureTimezone: (string) ($data['departure_timezone'] ?? 'UTC'),
            arrivalTimeUtc: (string) ($data['arrival_time_utc'] ?? ''),
            arrivalLocalTime: (string) ($data['arrival_local_time'] ?? ''),
            arrivalTimezone: (string) ($data['arrival_timezone'] ?? 'UTC'),
            durationMinutes: (int) ($data['duration_minutes'] ?? 60),
            layoverMinutes: (int) ($data['layover_minutes'] ?? 0)
        );
    }

    public function toArray(): array
    {
        return [
            'carrier_code'          => $this->carrierCode,
            'carrier_name'          => $this->carrierName,
            'carrier_logo'          => $this->carrierLogo,
            'flight_number'         => $this->flightNumber,
            'marketing_carrier'     => $this->marketingCarrier,
            'operating_carrier'     => $this->operatingCarrier,
            'aircraft'              => $this->aircraft,
            'cabin_class'           => $this->cabinClass,
            'booking_class'         => $this->bookingClass,
            'origin'                => $this->origin,
            'destination'           => $this->destination,
            'departure_time_utc'    => $this->departureTimeUtc,
            'departure_local_time'  => $this->departureLocalTime,
            'departure_timezone'    => $this->departureTimezone,
            'arrival_time_utc'      => $this->arrivalTimeUtc,
            'arrival_local_time'    => $this->arrivalLocalTime,
            'arrival_timezone'      => $this->arrivalTimezone,
            'duration_minutes'      => $this->durationMinutes,
            'layover_minutes'       => $this->layoverMinutes,
        ];
    }
}
