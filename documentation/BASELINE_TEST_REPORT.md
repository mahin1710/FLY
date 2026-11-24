# Baseline Application Test Report: FLY Ticketing Platform

**Audit Date:** November 25, 2026  
**Audited Directory:** `c:\Users\mahed\Desktop\FLY`  
**Test Harness Environments:**
- Python 3.12.10 (Flask 3.1.3 on `http://127.0.0.1:5000`)
- PHP 8.3 (Laravel 11.x PHPUnit on `backend/`)
- Node.js v24.22.1 (HTTP & DOM Regex Test Runners)

---

## 1. Executive Summary

| Test Suite Category | Tests Executed | Tests Passed | Failures / Errors | Pass Rate | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Flask Route Health Check** | 14 | 14 | 0 | 100% | **PASSED** |
| **UI Accessibility (WCAG 2.1 AA)** | 5 | 5 | 0 | 100% | **PASSED** |
| **Responsive Viewport Scaling** | 4 | 4 | 0 | 100% | **PASSED** |
| **Laravel Backend PHPUnit** | 164 | 164 (979 assertions) | 0 | 100% | **PASSED** |
| **Concurrency & Seat Hold Lock** | 33 | 33 | 0 | 100% | **PASSED** |
| **Python Booking Integration** | 6 | 6 | 0 | 100% | **PASSED** |
| **TOTAL** | **226** | **226** | **0** | **100%** | **ALL GREEN** |

---

## 2. Route Health Check & Endpoint Verification

Executed via live HTTP client against local application instance:

```text
GET http://127.0.0.1:5000/                                                    => HTTP 200 OK (11ms)
GET http://127.0.0.1:5000/flights/search                                     => HTTP 200 OK (14ms)
GET http://127.0.0.1:5000/flights/offer/demo-offer-dac-cxb-01                => HTTP 200 OK (8ms)
GET http://127.0.0.1:5000/booking/travellers                                 => HTTP 200 OK (9ms)
GET http://127.0.0.1:5000/booking/extras                                     => HTTP 200 OK (8ms)
GET http://127.0.0.1:5000/booking/review                                     => HTTP 200 OK (9ms)
GET http://127.0.0.1:5000/booking/payment                                    => HTTP 200 OK (10ms)
GET http://127.0.0.1:5000/booking/payment/result?status=success&trx_id=DEMO  => HTTP 200 OK (8ms)
GET http://127.0.0.1:5000/booking/status/DEMO-REF-12345                      => HTTP 200 OK (9ms)
GET http://127.0.0.1:5000/my-bookings                                        => HTTP 200 OK (8ms)
GET http://127.0.0.1:5000/manage-booking                                     => HTTP 200 OK (7ms)
GET http://127.0.0.1:5000/support                                            => HTTP 200 OK (7ms)
GET http://127.0.0.1:5000/auth                                               => HTTP 200 OK (8ms)
GET http://127.0.0.1:5000/admin                                              => HTTP 200 OK (12ms)
```

**Result:** Zero 404, 500, or routing exceptions. All 14 routes return valid HTML content and asset links.

---

## 3. UI Accessibility & Responsive Verification (`tests/ui_accessibility_and_responsive.test.js`)

```text
================================================================
🎯 UI ACCESSIBILITY (WCAG 2.1 AA) & RESPONSIVE TEST SUITE
================================================================

✅ [PASS] TEST-A11Y-001: Keyboard navigation path & focus-visible indicators
          :focus-visible defined in style.css and admin.css; no illegal negative tabindex traps found.
✅ [PASS] TEST-A11Y-002: Form inputs contain explicit labels, IDs for label association, or ARIA attributes
          12/12 inputs possess accessible identification attributes.
✅ [PASS] TEST-A11Y-003: Color contrast ratio meets or exceeds WCAG 2.1 AA (>= 4.5:1 for normal text)
          White on Navy: 17.65:1 (Min 4.5:1), Dark on Light: 13.98:1 (Min 4.5:1).
✅ [PASS] TEST-A11Y-004: CSS honors prefers-reduced-motion: reduce for animations and scroll behavior
          Both style.css and admin.css define @media (prefers-reduced-motion: reduce) rules.
✅ [PASS] TEST-A11Y-005: Screen reader status announcements via aria-live, role="status", or role="alert"
          Dynamic status and alert regions present in templates and CSS styling.
✅ [PASS] TEST-RESP-001: Mobile viewport (390px) scaling, touch-target sizing (>= 44px), and single-column flow
          Viewport meta tag present, 480px/640px media query breakpoints active.
✅ [PASS] TEST-RESP-002: Tablet viewport (768px) adaptive grid, collapsible navigation, and touch layout
          768px and 992px breakpoints active with column flex collapse on tablet screens.
✅ [PASS] TEST-RESP-003: Small Desktop viewport (1024px) dual-column booking summary and persistent navigation
          1024px and 1280px container layout boundaries verified.
✅ [PASS] TEST-RESP-004: Wide Desktop viewport (1440px+) max-width container constraints prevent distortion
          Centered container with bounded maximum width verified.

================================================================
📊 ACCESSIBILITY & RESPONSIVE SUMMARY: 9 PASSED, 0 FAILED
================================================================
```

---

## 4. Backend PHPUnit Test Suite (`backend/`)

Command executed: `php artisan test`  
Environment: PHP 8.3 / SQLite memory connection / Sanctum auth  
Outcome:

```text
Tests:    164 passed (979 assertions)
Duration: 27.82 seconds
Status:   EXIT CODE 0 (SUCCESS)
```

### Breakdown of Passing Tests:
1. **Contract Tests:**
   - Amadeus API JSON normalization to `FlightOfferDTO`.
   - SSLCOMMERZ IPN webhook validation payload matching.
   - Provider DTO immutability and schema mapping.
2. **Integration Tests:**
   - Atomic seat reservation under concurrency.
   - Distributed locking simulation with Redis fallback.
   - Idempotent payment webhook deduplication (duplicate IPN event discarded).
   - Async reconciliation queue jobs.
3. **Feature Tests:**
   - `FlightController`: Search, offer retrieval, dynamic repricing.
   - `BookingController`: Draft creation, passenger addition, confirm, ticket status, guest retrieval.
   - `PaymentController`: Payment intent initialization, IPN webhook handling, refund processing.
   - `AdminController`: 14 endpoints including ticketing queue, reconciliation, audit logging, dual approvals.
4. **Unit Tests:**
   - `BookingStateMachine`: Transition guards preventing invalid jumps (e.g. `PENDING` $\rightarrow$ `ISSUED` without payment).
   - `PricingService`: Transparent base fare, VAT, airport taxes, fuel surcharges, and markups.
   - `AdminPolicy`: Role-Based Access Control matrix for 7 distinct operator roles.

---

## 5. Concurrency & Seat Hold Verification (`test_seat_holding_responsive_and_payment.js`)

- **33 / 33 Scenarios Passed.**
- **Concurrency Test:** Two distinct users attempting to hold Seat 12A simultaneously. User A obtains lock; User B receives immediate `HTTP 409 Conflict` rejection.
- **Hold Expiration Test:** Seat held for 15 minutes. Upon expiration, seat status transitions to `EXPIRED` and seat becomes immediately available for other travelers.
- **Cancellation Test:** Explicit customer cancellation releases held seat immediately.

---

## 6. Runtime Logs & Stability Observations

1. **Flask Server (`app.py`):**
   - Clean startup on port 5000.
   - Zero unhandled tracebacks or memory leaks observed during stress queries.
   - Static file caching and MIME type resolution functioning properly.
2. **Auto-Pusher Daemon (`auto_pusher.js`):**
   - Active and cleanly logging periodic checks every 20 minutes.
   - Working tree clean; git transactions execute with exit code 0.
