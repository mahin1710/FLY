# Master Implementation Plan: Production-Grade FLY Ticketing Platform

**Audit Date:** November 25, 2026  
**Audited Directory:** `c:\Users\mahed\Desktop\FLY`  
**Prerequisite:** Full completion and approval of `PROMPT 01 — COMPLETE EXISTING PROJECT AUDIT AND TECHNICAL DISCOVERY`.  
**Implementation Rule:** Proceed phase-by-phase. No premature renaming or destructive deletion. Verify every milestone against automated tests.

---

## 1. Executive Implementation Strategy

The audit established that the repository contains two highly functional, complementary software assets:
1. **Frontend Presentation & Rapid Prototyping Layer (Flask + Jinja2):** Contains human-friendly, responsive, WCAG 2.1 AA compliant templates, checkout stores, and interactive widgets.
2. **Enterprise API & Orchestration Engine (Laravel 11):** Contains strict state machines, DTOs, payment gateway adapters (SSLCOMMERZ & Sandbox), GDS provider interfaces, and 164 passing automated tests.

The goal of the implementation roadmap is to **unify these two layers seamlessly**, bridge real supplier and payment credentials as they become commercially available, and safely retire legacy Skynet artifacts without downtime or regressions.

---

## 2. Phased Implementation Roadmap

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Environment Baseline & Runtime Bridge              │
│ - Unify API proxy between Flask UI and Laravel API          │
│ - Formalize .env configurations                             │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: Live Payment Gateway Onboarding (SSLCOMMERZ)        │
│ - Connect approved SSLCOMMERZ sandbox/live credentials      │
│ - Verify server-to-server IPN webhook & HMAC signatures     │
│ - Test idempotent ledger & reconciliation jobs               │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 3: Commercial Supplier GDS / Aggregator Integration   │
│ - Connect approved Amadeus / Sabre / Consolidator API       │
│ - Bind normalized FlightOfferDTO & revalidation pipeline     │
│ - Implement pending ticketing manual escalation queue       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 4: Production Document & Notification Infrastructure  │
│ - Private S3/Cloud Storage signed download links for e-tickets│
│ - Asynchronous customer SMS/Email notifications (Twilio/SES)│
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 5: Controlled Renaming, Directory Pruning & Launch    │
│ - Safely archive and remove obsolete Skynet-master folders  │
│ - Final branding sync to "FLY" across all manifests         │
│ - Production deployment verification                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Phase Breakdown & Milestones

### Phase 1: Environment Baseline & Runtime Bridge
- **Objective:** Establish seamless communication between the client-facing UI and the enterprise backend API.
- **Tasks:**
  1. Configure `app.py` proxy routes (`/api/v1/*`) to forward requests directly to the Laravel backend service when running simultaneously.
  2. Maintain local SQLite fallback in `database.py` for offline / zero-dependency development.
  3. Validate environment configuration variables in `.env` against `.env.example`.
- **Exit Gate:** All 14 UI routes and Laravel API endpoints exchange data without HTTP 500 errors.

### Phase 2: Live Payment Gateway Onboarding (SSLCOMMERZ)
- **Objective:** Enable real financial transactions using Bangladesh-first payment gateway standards.
- **Tasks:**
  1. Input approved merchant Store ID and Store Password into secure environment storage.
  2. Verify hosted checkout session creation (`gw/init`) for BDT transactions.
  3. Wire server-to-server IPN webhook endpoint (`/api/v1/payments/ipn`) with transaction validation API calls.
  4. Test payment idempotency (duplicate webhook calls must not double-credit bookings).
  5. Validate that return URL remains UX-only and never acts as proof of payment.
- **Exit Gate:** Successful end-to-end sandbox transaction with verified IPN reconciliation and financial ledger recording.

### Phase 3: Commercial Flight Supplier Integration (GDS / Consolidator)
- **Objective:** Connect authoritative airline inventory for real booking reservation and ticket issuance.
- **Tasks:**
  1. Configure Amadeus GDS or Sabre Bangladesh Consolidator API credentials.
  2. Implement authoritative PNR creation and ticket retrieval in `TicketingService.php`.
  3. If supplier does not support automatic instant issuance, automatically route to `TicketingQueue` for manual ticketing desk fulfillment.
  4. Enforce separate PNR locator and e-ticket number fields.
  5. Strictly guard ticket status transition: Status becomes `ISSUED` only upon supplier-confirmed response.
- **Exit Gate:** End-to-end search $\rightarrow$ offer $\rightarrow$ reprice $\rightarrow$ hold $\rightarrow$ payment $\rightarrow$ ticketing workflow passes with authoritative supplier payload.

### Phase 4: Production Document Generation & Notifications
- **Objective:** Secure, private document delivery and multi-channel customer alerts.
- **Tasks:**
  1. Generate branded PDF e-tickets using `DocumentService.php` (DomPDF).
  2. Store generated documents in private storage; generate short-lived signed URLs (15-minute expiration) for downloads.
  3. Mark all demo documents with prominent staging watermark until live mode is engaged.
  4. Dispatch asynchronous email/SMS notifications via queue workers (`SendCustomerNotificationJob.php`).
- **Exit Gate:** Customer receives confirmed e-ticket download link via email/SMS upon verified issuance.

### Phase 5: Controlled Renaming, Directory Pruning & Production Gate
- **Objective:** Final codebase cleanup and brand transition from `skynet-master` to `Fly`.
- **Tasks:**
  1. Update `package.json` root name to `"fly-aviation"`.
  2. Safely archive and remove the legacy `Skynet-master/` subdirectory.
  3. Consolidate loose root test scripts (`test_*.js`, `test_*.py`) into organized subfolders inside `tests/`.
  4. Run complete regression suite (PHPUnit, UI accessibility, end-to-end user journeys).
  5. Execute production readiness audit.
- **Exit Gate:** 100% test pass rate on clean, streamlined repository structure with zero legacy Skynet remnants.

---

## 4. Risk Matrix & Mitigation Strategies

| Risk | Severity | Mitigation Strategy |
| :--- | :--- | :--- |
| **Premature Deletion of Legacy Files** | High | Strictly prohibited during audit. Phased quarantine protocol in Phase 5 only after full test verification. |
| **Supplier API Downtime or Timeout** | High | Circuit breaker (`ProviderCircuitBreaker.php`) and automated fallback to manual ticketing queue (`OperationsQueueService.php`). |
| **Payment Webhook Replay Attack** | Critical | Idempotent transaction database lock (`IdempotencyRecord.php`) and server-side gateway transaction verification API call. |
| **Customer Data Exposure (IDOR)** | Critical | Strict object-level access control on every booking endpoint; passport numbers masked (`A098****`). |
| **Seat Booking Concurrency Race Condition** | High | SQLite `BEGIN IMMEDIATE` atomic locking and Redis distributed locks during seat hold. |
