# External Flight Provider Integration Guide

**Platform:** FLY Aviation & Travel Booking System  
**Selected Primary Provider:** Amadeus for Developers (Self-Service REST API)  
**Document Version:** 1.0.0  
**Compliance Directive:** **Do not claim a provider can issue tickets until verified. Never display sandbox data as live bookable inventory.**

---

## 1. Provider Selection & Architectural Rationale

Following the evaluation in [`documentation/PROVIDER_DECISIONS.md`](file:///c:/Users/mahed/Desktop/FLY/documentation/PROVIDER_DECISIONS.md), **Amadeus for Developers** was selected as the reference external provider for the integration framework:

1. **Standardized REST JSON:** Uses clean JSON envelopes and standard HTTP status codes rather than legacy EDIFACT/SOAP XML.
2. **Global GDS Inventory:** Sourced from 400+ airlines with multi-leg connecting routes and standardized PNR management.
3. **Developer Sandbox:** Provides zero-fee test environments for search, reprice, and order creation.

---

## 2. API Specifications & Endpoints

| Capability | Official Endpoint | HTTP Method | API Version | Sandbox Availability |
| :--- | :--- | :---: | :---: | :---: |
| **OAuth2 Token** | `/v1/security/oauth2/token` | `POST` | `v1` | **Full** (Client Credentials Grant) |
| **Flight Offers Search** | `/v2/shopping/flight-offers` | `POST` | `v2` | **Full** (Synthetic routes & test carriers) |
| **Flight Offers Pricing** | `/v1/shopping/flight-offers/pricing` | `POST` | `v1` | **Full** (Fare bucket revalidation) |
| **Flight Create Orders** | `/v1/booking/flight-orders` | `POST` | `v1` | **Creates PNR in `TICKETING_PENDING`** |
| **Flight Order Retrieval** | `/v1/booking/flight-orders/{id}` | `GET` | `v1` | **Full** (Retrieves test reservation) |
| **Flight Order Cancel** | `/v1/booking/flight-orders/{id}` | `DELETE` | `v1` | **Full** (Cancels active test order) |

---

## 3. Workflow & Ticketing Operational Reality

### Critical Aviation Ticketing Truth
> [!IMPORTANT]
> **Creating a Booking Order $\neq$ Issuing an E-Ticket.**
> In Amadeus Self-Service (and standard airline GDS protocols), calling `/v1/booking/flight-orders` creates a confirmed airline PNR reservation. However, **Amadeus Self-Service does not possess ticketing authority or merchant of record capabilities**. It outputs reservations in status `TICKETING_PENDING`.

### FLY Platform End-to-End Flow
```
 ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
 │    Search    │ ──> │   Reprice    │ ──> │ Order Draft  │ ──> │ Customer Pay │
 │   /v2/search │     │  /v1/pricing │     │  /v1/orders  │     │ Gateway Hold │
 └──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                                                                       │
                                                                       ▼
                                                              ┌────────────────┐
                                                              │ Status:        │
                                                              │ TICKETING_     │
                                                              │ PENDING        │
                                                              └────────────────┘
                                                                       │
                                           ┌───────────────────────────┴───────────────────────────┐
                                           ▼                                                       ▼
                                ┌──────────────────────┐                                ┌──────────────────────┐
                                │ Consolidator API     │                                │ Manual Operations    │
                                │ Direct BSP Issuance  │                                │ Back-Office Queue    │
                                └──────────────────────┘                                └──────────────────────┘
                                           │                                                       │
                                           └───────────────────────────┬───────────────────────────┘
                                                                       ▼
                                                              ┌────────────────┐
                                                              │ Status:        │
                                                              │ TICKETED       │
                                                              │ 13-digit eTkt  │
                                                              └────────────────┘
```

When a booking reaches payment completion, the FLY platform transitions `booking_status` to `confirmed`, `payment_status` to `captured`, and holds `ticket_status` as `queued_for_issuance` (`TICKETING_PENDING`). An operational servicing ticket is dispatched to the consolidator API or manual back-office queue. **A fake 13-digit e-ticket number is NEVER generated.**

---

## 4. Integration Framework & Resilience Architecture

The external provider framework in [`backend/app/Services/Providers/Support/`](file:///c:/Users/mahed/Desktop/FLY/backend/app/Services/Providers/Support/) enforces production-grade resilience:

### 1. Resilient HTTP Client (`ProviderHttpClient`)
- **Connect Timeout:** 5.0 seconds.
- **Request Timeout:** 15.0 seconds.
- **Safe Retries:** Automatic retries (up to 2 times with exponential backoff and jitter) are strictly limited to **idempotent read operations (`GET`)** on 429/502/503/504 responses. **Non-idempotent order creation (`POST /flight-orders`) is NEVER automatically retried** to prevent duplicate PNR generation.
- **Correlation ID Tracking:** Injects incoming `X-Correlation-ID` header into all outbound provider requests.

### 2. Provider Circuit Breaker (`ProviderCircuitBreaker`)
- Implements state machine: `CLOSED` $\leftrightarrow$ `OPEN` $\leftrightarrow$ `HALF_OPEN`.
- **Threshold:** 5 consecutive upstream failures trips the circuit to `OPEN` for 60 seconds.
- **Fast Fail:** Requests during `OPEN` state throw `ProviderCircuitOpenException` (HTTP 503) immediately without waiting for timeouts.

### 3. PII & Secret Redaction (`DataSanitizer`)
All calls recorded in the `provider_calls` database table undergo recursive sanitization:
- `Authorization` and `client_secret` $\to$ `[REDACTED]`.
- `document_number` and passport numbers $\to$ masked as `BD******66`.
- Payment cards $\to$ masked as `41************11`.
- CVV/CVC $\to$ `****`.

---

## 5. Missing Prerequisites Checklist (To Enable Live Sandbox)

Because credentials are not yet supplied in the environment, the adapter operates in skeleton/contract mode. To activate live Amadeus sandbox requests, complete the following prerequisites:

```markdown
- [ ] 1. Amadeus Developer Account
      - Register at https://developers.amadeus.com
      - Create a workspace application named "FLY Aviation Sandbox"

- [ ] 2. Environment Variables Configuration
      - Populate the following in backend/.env:
        AMADEUS_CLIENT_ID=your_api_key_here
        AMADEUS_CLIENT_SECRET=your_api_secret_here
        AMADEUS_ENVIRONMENT=test
        AMADEUS_BASE_URL=https://test.api.amadeus.com
        AMADEUS_TIMEOUT=15.0

- [ ] 3. Switch Provider Binding in AppServiceProvider
      - Change the binding in backend/app/Providers/AppServiceProvider.php:
        $this->app->bind(FlightProviderInterface::class, AmadeusAdapter::class);

- [ ] 4. Consolidator / Host Agency Agreement (For Live E-Tickets)
      - Execute B2B partner contract (Flyhub, Sabre Bangladesh, or TBO)
      - Configure webhook endpoint for ticketing issuance callbacks
```

---

## 6. Contract Test Suite Verification

The provider integration framework is covered by automated unit and feature tests in [`backend/tests/Unit/Providers/AmadeusContractTest.php`](file:///c:/Users/mahed/Desktop/FLY/backend/tests/Unit/Providers/AmadeusContractTest.php) and [`backend/tests/Feature/Providers/ProviderFrameworkTest.php`](file:///c:/Users/mahed/Desktop/FLY/backend/tests/Feature/Providers/ProviderFrameworkTest.php):

- `AmadeusContractTest::test_amadeus_mapper_transforms_raw_offer_to_normalized_dto` (passes)
- `AmadeusContractTest::test_amadeus_mapper_transforms_raw_order_to_normalized_reservation_dto` (passes)
- `AmadeusContractTest::test_parse_iso_duration_converts_correctly_to_minutes` (passes)
- `ProviderFrameworkTest::test_amadeus_adapter_throws_configuration_exception_when_credentials_are_absent` (passes)
- `ProviderFrameworkTest::test_data_sanitizer_redacts_credentials_tokens_and_passenger_sensitive_data` (passes)
- `ProviderFrameworkTest::test_circuit_breaker_trips_to_open_after_failure_threshold_reached` (passes)
- `ProviderFrameworkTest::test_circuit_breaker_resets_on_success` (passes)
- `ProviderFrameworkTest::test_provider_http_client_records_sanitized_audit_call_in_database` (passes)
- `ProviderFrameworkTest::test_mock_provider_supports_full_lifecycle` (passes)
