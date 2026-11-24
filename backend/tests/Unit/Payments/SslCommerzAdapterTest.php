<?php

namespace Tests\Unit\Payments;

use App\Models\Booking;
use App\Models\Payment;
use App\Services\Payments\Adapters\SslCommerzAdapter;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;
use RuntimeException;

class SslCommerzAdapterTest extends TestCase
{
    protected SslCommerzAdapter $adapter;

    protected function setUp(): void
    {
        parent::setUp();

        $this->adapter = new SslCommerzAdapter(
            storeId: 'test_store_123',
            storePassword: 'test_password_456',
            isSandbox: true,
            baseUrl: 'https://sandbox.sslcommerz.com',
            timeoutSeconds: 5.0
        );
    }

    public function test_initiate_payment_sends_correct_form_params_and_returns_session_dto(): void
    {
        Http::fake([
            'https://sandbox.sslcommerz.com/gwprocess/v4/api.php' => Http::response([
                'status'         => 'SUCCESS',
                'failedreason'   => '',
                'sessionkey'     => 'SESSION_ABC_12345',
                'GatewayPageURL' => 'https://sandbox.sslcommerz.com/EasyCheckOut/testcheckout12345',
            ], 200),
        ]);

        $booking = new Booking([
            'ulid'                 => '01TESTBOOKING000000000001',
            'reference'            => 'BK-SSL-001',
            'total_amount'         => 5100.00,
            'currency'             => 'BDT',
            'contact_email'        => 'traveler@fly.com',
            'contact_phone'        => '1711223344',
            'contact_country_code' => '+880',
        ]);

        $session = $this->adapter->initiatePayment($booking, 'TXN-20261124-999');

        $this->assertEquals('SSLCOMMERZ', $session->gatewayCode);
        $this->assertEquals('TXN-20261124-999', $session->gatewayTransactionId);
        $this->assertEquals('SESSION_ABC_12345', $session->sessionKey);
        $this->assertEquals('https://sandbox.sslcommerz.com/EasyCheckOut/testcheckout12345', $session->redirectUrl);
        $this->assertEquals(5100.00, $session->amount);
        $this->assertEquals('BDT', $session->currency);
    }

    public function test_validate_callback_queries_order_validation_api(): void
    {
        Http::fake([
            'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php*' => Http::response([
                'status'       => 'VALID',
                'tran_date'    => '2026-11-24 12:00:00',
                'tran_id'      => 'TXN-20261124-999',
                'val_id'       => 'VAL_99998888',
                'amount'       => '5100.00',
                'currency'     => 'BDT',
                'bank_tran_id' => 'BANK_TXN_7777',
                'card_type'    => 'VISA-CityBank',
                'card_no'      => '411111XXXXXX1111',
                'card_issuer'  => 'City Bank PLC',
            ], 200),
        ]);

        $verification = $this->adapter->validateCallback([
            'val_id'   => 'VAL_99998888',
            'tran_id'  => 'TXN-20261124-999',
            'amount'   => '5100.00',
            'currency' => 'BDT',
            'status'   => 'VALID',
        ]);

        $this->assertTrue($verification->isVerified);
        $this->assertEquals('CAPTURED', $verification->status);
        $this->assertEquals('TXN-20261124-999', $verification->gatewayTransactionId);
        $this->assertEquals('BANK_TXN_7777', $verification->bankTransactionId);
        $this->assertEquals('VAL_99998888', $verification->validationId);
        $this->assertEquals(5100.00, $verification->amount);
        $this->assertEquals('BDT', $verification->currency);
        $this->assertEquals('1111', $verification->cardLastFour);
    }

    public function test_query_transaction_checks_merchant_transaction_validation_api(): void
    {
        Http::fake([
            'https://sandbox.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php*' => Http::response([
                'APIConnect' => 'DONE',
                'no_of_trans_found' => 1,
                'element' => [
                    [
                        'status'       => 'VALID',
                        'tran_id'      => 'TXN-QUERY-123',
                        'val_id'       => 'VAL_QUERY_456',
                        'amount'       => '5100.00',
                        'currency'     => 'BDT',
                        'bank_tran_id' => 'BANK_QUERY_999',
                        'card_type'    => 'Mastercard',
                        'card_no'      => '542418XXXXXX4242',
                    ],
                ],
            ], 200),
        ]);

        $verification = $this->adapter->queryTransaction('TXN-QUERY-123');

        $this->assertTrue($verification->isVerified);
        $this->assertEquals('CAPTURED', $verification->status);
        $this->assertEquals('TXN-QUERY-123', $verification->gatewayTransactionId);
        $this->assertEquals('4242', $verification->cardLastFour);
    }

    public function test_adapter_throws_when_unconfigured(): void
    {
        $unconfiguredAdapter = new SslCommerzAdapter(
            storeId: null,
            storePassword: null
        );

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('SSLCOMMERZ credentials');

        $booking = new Booking();
        $unconfiguredAdapter->initiatePayment($booking, 'TXN-FAIL');
    }
}
