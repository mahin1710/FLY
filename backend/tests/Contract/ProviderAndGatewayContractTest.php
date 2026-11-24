<?php

namespace Tests\Contract;

use App\DTOs\BaggageAllowanceDTO;
use App\DTOs\FareConditionsDTO;
use App\DTOs\FlightOfferDTO;
use App\DTOs\FlightSegmentDTO;
use App\DTOs\PriceBreakdownDTO;
use App\DTOs\ProviderReservationDTO;
use App\DTOs\ProviderTicketDTO;
use App\Services\Payments\Adapters\SimulatedGatewayAdapter;
use App\Services\Payments\Adapters\SslCommerzAdapter;
use App\Services\Payments\DTOs\PaymentVerificationDTO;
use App\Services\Providers\Support\Exceptions\ProviderApiException;
use App\Services\Providers\Support\Exceptions\ProviderAuthenticationException;
use App\Services\Providers\Support\Exceptions\ProviderCircuitOpenException;
use App\Services\Providers\Support\Exceptions\ProviderException;
use Tests\TestCase;

class ProviderAndGatewayContractTest extends TestCase
{
    /**
     * TEST-CONTRACT-001: Provider Normalized Offer DTO Schema and Invariants.
     */
    public function test_flight_offer_normalized_dto_contract(): void
    {
        $segment = FlightSegmentDTO::fromArray([
            'carrier_code'          => 'BG',
            'carrier_name'          => 'Biman Bangladesh Airlines',
            'flight_number'         => 'BG-001',
            'origin'                => ['code' => 'DAC', 'name' => 'Hazrat Shahjalal Int'],
            'destination'           => ['code' => 'DXB', 'name' => 'Dubai International'],
            'departure_time_utc'    => '2026-12-01T10:00:00Z',
            'departure_local_time'  => '2026-12-01T16:00:00',
            'arrival_time_utc'      => '2026-12-01T13:30:00Z',
            'arrival_local_time'    => '2026-12-01T17:30:00',
            'duration_minutes'      => 210,
            'cabin_class'           => 'Economy',
        ]);

        $priceBreakdown = new PriceBreakdownDTO(
            currency: 'BDT',
            baseAmount: 35000.00,
            taxAmount: 8500.00,
            feeAmount: 1500.00,
            totalAmount: 45000.00
        );

        $fareConditions = new FareConditionsDTO(
            refundable: true,
            refundableWithFee: false,
            changeable: true,
            cancellationFee: 3000.00,
            changeFee: 1500.00,
            fareFamily: 'ECONOMY_FLEX'
        );

        $offer = new FlightOfferDTO(
            uuid: 'OFFER-CONTRACT-001',
            providerCode: 'MOCK',
            providerOfferRef: 'PROV-REF-001',
            segments: [$segment],
            baggage: new BaggageAllowanceDTO(cabinPieces: 1, cabinWeightKg: 7, checkedPieces: 2, checkedWeightKg: 23),
            fareConditions: $fareConditions,
            priceBreakdown: $priceBreakdown,
            supportedExtras: [],
            isRefundable: true,
            isBookable: true,
            expiresAt: '2026-12-01T11:00:00Z'
        );

        $array = $offer->toArray();

        $this->assertSame('OFFER-CONTRACT-001', $array['uuid']);
        $this->assertSame('MOCK', $array['provider_code']);
        $this->assertSame(45000.00, $array['price_breakdown']['total_amount']);
        $this->assertSame('DAC', $array['segments'][0]['origin']['code']);
        $this->assertSame('DXB', $array['segments'][0]['destination']['code']);
        $this->assertTrue($array['fare_conditions']['refundable']);

        // Roundtrip reconstruction
        $reconstructed = FlightOfferDTO::fromArray($array);
        $this->assertSame($offer->uuid, $reconstructed->uuid);
        $this->assertSame($offer->priceBreakdown->totalAmount, $reconstructed->priceBreakdown->totalAmount);
    }

    /**
     * TEST-CONTRACT-002: Provider Reservation & Ticket Issue Result DTO Contracts.
     */
    public function test_reservation_and_ticket_issue_result_dto_contracts(): void
    {
        $resResult = new ProviderReservationDTO(
            providerCode: 'MOCK',
            providerBookingRef: 'PROV-CONTRACT-XYZ',
            pnr: 'XYZ123',
            status: 'CONFIRMED',
            ticketingRequiredBy: '2026-12-01T23:59:59Z',
            isTicketed: false,
            rawProviderStatus: 'CONFIRMED',
            currency: 'BDT',
            totalPrice: 45000.00,
            passengers: [],
            segments: []
        );

        $this->assertSame('CONFIRMED', $resResult->status);
        $this->assertSame('XYZ123', $resResult->pnr);
        $this->assertSame('PROV-CONTRACT-XYZ', $resResult->providerBookingRef);

        $ticketResult = new ProviderTicketDTO(
            providerCode: 'MOCK',
            ticketNumber: '077-1234567890',
            passengerName: 'Mahin Rahman',
            status: 'ISSUED',
            issuedAt: '2026-12-01T12:00:00Z',
            coupons: [],
            documentType: 'ELECTRONIC_TICKET',
            disclaimer: 'Sandbox ticket',
            tickets: [
                ['passenger_id' => 1, 'ticket_number' => '077-1234567890', 'status' => 'ISSUED'],
            ]
        );

        $this->assertSame('ISSUED', $ticketResult->status);
        $this->assertCount(1, $ticketResult->tickets);
        $this->assertSame('077-1234567890', $ticketResult->tickets[0]['ticket_number']);
    }

    /**
     * TEST-CONTRACT-003: Payment Webhook Signature Contract Verification.
     * Verifies that simulated gateway validates HMAC-SHA256 signature and rejects tampering.
     */
    public function test_payment_webhook_signature_contract_validation(): void
    {
        $adapter = new SimulatedGatewayAdapter();
        $secretKey = config('services.payment.simulated.secret_key', 'simulated_secret_key_12345');

        $tranId = 'TXN-CONTRACT-001';
        $amount = 15000.00;
        $currency = 'BDT';

        // Valid signature calculation: HMAC-SHA256(tranId:amount:currency, secretKey)
        $validSign = hash_hmac('sha256', "{$tranId}:{$amount}:{$currency}", $secretKey);

        $validPayload = [
            'tran_id'     => $tranId,
            'val_id'      => 'VAL-SIM-001',
            'amount'      => (string) $amount,
            'currency'    => $currency,
            'status'      => 'VALID',
            'verify_sign' => $validSign,
        ];

        $verifiedDTO = $adapter->validateCallback($validPayload);
        $this->assertTrue($verifiedDTO->isVerified);
        $this->assertSame('CAPTURED', $verifiedDTO->status);
        $this->assertSame($tranId, $verifiedDTO->gatewayTransactionId);

        // Tampered signature
        $tamperedPayload = $validPayload;
        $tamperedPayload['verify_sign'] = 'forged_invalid_signature_hash';

        $rejectedDTO = $adapter->validateCallback($tamperedPayload);
        $this->assertFalse($rejectedDTO->isVerified);
        $this->assertSame('FAILED', $rejectedDTO->status);
        $this->assertStringContainsString('Invalid cryptographic', $rejectedDTO->failureReason);
    }

    /**
     * TEST-CONTRACT-004: Gateway Transaction Response Mapping to Normalized DTO.
     */
    public function test_gateway_response_mapping_to_payment_verification_dto(): void
    {
        $adapter = new SimulatedGatewayAdapter();
        $verification = $adapter->queryTransaction('TXN-QUERY-12345');

        $this->assertInstanceOf(PaymentVerificationDTO::class, $verification);
        $this->assertTrue($verification->isVerified);
        $this->assertSame('CAPTURED', $verification->status);
        $this->assertSame('TXN-QUERY-12345', $verification->gatewayTransactionId);
        $this->assertNotNull($verification->bankTransactionId);
        $this->assertSame('BDT', $verification->currency);
    }

    /**
     * TEST-CONTRACT-005: Provider Error Normalization Contract.
     * Verifies HTTP error codes are correctly mapped to typed Provider Exceptions.
     */
    public function test_provider_error_normalization_contract(): void
    {
        $apiEx = new ProviderApiException(
            'Downstream supplier 400 Bad Request',
            400,
            'AMADEUS',
            'INVALID_ROUTE',
            ['detail' => 'Requested sector not operated by carrier']
        );
        $this->assertSame(400, $apiEx->getCode());
        $this->assertSame('INVALID_ROUTE', $apiEx->getProviderErrorCode());

        $authEx = new ProviderAuthenticationException('Supplier OAuth token expired', 401);
        $this->assertSame(401, $authEx->getCode());

        $circuitEx = new ProviderCircuitOpenException('Circuit breaker is OPEN for Amadeus provider', 503);
        $this->assertSame(503, $circuitEx->getCode());
    }
}
