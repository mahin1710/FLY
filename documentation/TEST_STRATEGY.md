# Test Strategy & Quality Assurance Architecture

**Project Brand:** FLY Aviation & Travel  
**Author / Engineering Maintainer:** `mahin1710`  
**Document Version:** 1.0.0  
**Quality Target:** 100% Test Pass Rate, Zero Concurrency Collisions, Zero Viewport Regressions

---

## 1. Quality Assurance Philosophy

In flight ticketing, software failures directly impact customer travel plans and carrier revenue. A double-booked seat or lost payment record is a catastrophic defect. Consequently, our test strategy employs **multilayer verification** spanning unit calculations, integration endpoints, headless browser user flows, and high-concurrency race condition simulations.

---

## 2. The 5-Tier Testing Pyramid

```
                      ┌─────────────────────────┐
                      │    5. Disaster Tests    │  Recovery & Chaos
                      ├─────────────────────────┤
                   ┌──┴─────────────────────────┴──┐
                   │   4. Concurrency / Race Tests │  Atomic Locks & Collisions
                ┌──┴───────────────────────────────┴──┐
                │    3. End-to-End & UI Regression     │  Puppeteer Viewports & Workflows
             ┌──┴─────────────────────────────────────┴──┐
             │       2. Integration & API Security       │  RBAC, Idempotency, Data Validation
          ┌──┴───────────────────────────────────────────┴──┐
          │             1. Unit & Domain Logic              │  Fare Math, Taxes, State Rules
          └─────────────────────────────────────────────────┘
```

### Tier 1: Unit & Domain Logic Tests
- **Objective:** Verify pure calculations and algorithmic logic isolated from network I/O.
- **Coverage:**
  - Fare breakdown formula: $\text{Base} + \text{VAT (15\%)} + \text{Embarkation (৳500)} + \text{Fuel (৳300)} + \text{Baggage}$.
  - Passenger age discount multipliers (Child $75\%$, Infant $10\%$).
  - Date format parsing, leap year validation, timezone conversions.
  - Password hashing and verification via `scrypt`.
  - State machine transition rules.

### Tier 2: Integration & API Security Tests
- **Existing Suite:** [`test_flight_booking_integration.py`](file:///c:/Users/mahed/Desktop/FLY/test_flight_booking_integration.py)
- **Coverage:**
  - `/api/flights/fare-breakdown` transparent output check.
  - `/api/bookings/validate` passenger document validation and price drift notification.
  - User A vs. User B seat conflict rejection (HTTP 409 Conflict).
  - Idempotent payment confirmation (duplicate calls return confirmed ticket safely).
  - Tenant-isolated retrieval via `/api/reservations/my` and `/api/reservations/ticket/<ref>`.
  - Auth token session creation, validation, and revocation.

### Tier 3: End-to-End & UI Regression Tests
- **Existing Suite:** [`test_seat_holding_responsive_and_payment.js`](file:///c:/Users/mahed/Desktop/FLY/test_seat_holding_responsive_and_payment.js)
- **Technology:** Node.js + Puppeteer (Chrome DevTools Automation).
- **Coverage:**
  - Complete user flow: Search $\rightarrow$ Results Filter $\rightarrow$ Select Flight $\rightarrow$ Enter Passenger $\rightarrow$ Hold Seats $\rightarrow$ Review $\rightarrow$ Payment $\rightarrow$ Boarding Pass.
  - Responsive screen fits: Viewport tests at 360px (Small Mobile), 480px (Standard Mobile), 768px (Tablet), and 1280px (Desktop).
  - Verification of zero horizontal scrollbar and visible call-to-action buttons.
  - Live countdown clock animation and sticky hold banner.

### Tier 4: Concurrency & Race Condition Tests
- **Coverage:**
  - Multiple automated worker threads simultaneously attempting to lock the exact same seat on the same flight.
  - Verifying that exactly **one** worker succeeds (HTTP 201) and all other concurrent workers receive HTTP 409 Conflict.
  - Immediate seat release on cancellation restoring availability.
  - Automatic expiration reaper transitioning status from `PENDING_PAYMENT` to `EXPIRED` at 15 minutes.

### Tier 5: Disaster & Recovery Workflows
- **Coverage:**
  - Simulated payment gateway webhook arriving after hold expiration (verifying automatic full refund trigger).
  - Supplier API timeout during ticket issuance (verifying `QUEUED_FOR_ISSUANCE` recovery queue).
  - Database reconnect and WAL journal recovery during unexpected server restarts.

---

## 3. Test Inventory & Execution Commands

| Test Suite File | Framework / Runner | Target Area | Current Status |
|---|---|---|---|
| [`test_flight_booking_integration.py`](file:///c:/Users/mahed/Desktop/FLY/test_flight_booking_integration.py) | Python `unittest` | Booking flow, fare math, conflict hold, payment | **6 / 6 Passed (100%)** |
| [`test_seat_holding_responsive_and_payment.js`](file:///c:/Users/mahed/Desktop/FLY/test_seat_holding_responsive_and_payment.js) | Node.js + Puppeteer | 15-min countdown, responsive CSS, privacy | **33 / 33 Passed (100%)** |
| [`test_advanced_filters_and_results.py`](file:///c:/Users/mahed/Desktop/FLY/test_advanced_filters_and_results.py) | Python `requests` | Flight filters, GoZayaan comparison cards, sorting | **Passed (100%)** |
| [`test_flight_search_upgrade.py`](file:///c:/Users/mahed/Desktop/FLY/test_flight_search_upgrade.py) | Python `requests` | Airport autocomplete, date pickers, multi-city | **Passed (100%)** |

### Execution Commands
```powershell
# 1. Run all Python integration and search test suites
python test_flight_booking_integration.py
python test_advanced_filters_and_results.py
python test_flight_search_upgrade.py

# 2. Run Puppeteer E2E & concurrency test suite
node test_seat_holding_responsive_and_payment.js
```

---

## 4. Pre-Deployment Quality Checklist

Before promoting any new deployment to production, the following pipeline gates must be verified:
- [ ] All 4 test suites execute with zero failures.
- [ ] No secrets or API credentials present in Git diff.
- [ ] Database schema migrations run with zero data loss.
- [ ] Responsive UI verified on mobile (360px) and desktop (1280px).
- [ ] SQLite WAL mode active and write performance verified.
