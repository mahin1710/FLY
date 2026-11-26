# FLY — Final QR E-Ticket & Realistic Refund Implementation Report

**Project:** FLY Flight Booking & Ticket Management System  
**Date:** 2026-11-26  

---

## 1. Implemented Architecture & Deliverables

### Part A–E: Secure QR Ticketing & LAN Mobile Verification
- **Database Extensions (`database.py`):** Extended `tickets`, added `ticket_segments`, `ticket_qr_tokens` (storing salted HMAC-SHA256 hashes + nonces only, zero raw tokens in DB), `ticket_scan_logs`, and `notification_outbox`.
- **QR & PDF Engine (`fly/services/qr_service.py`, `fly/services/pdf_service.py`):**
  - Strictly gates QR issuance on `ISSUED` ticket status (`DEFER_ISSUANCE` / `TICKETING_PENDING` blocks QR until confirmed).
  - Generates per-passenger tickets and distinct high-entropy verification tokens.
  - Embeds crisp, `zxingcpp`-verified ISO-18004 QR bitmaps (`FlateDecode` RGB XObject) inside A4 `%PDF-1.4` e-tickets (`/api/tickets/<ref>/pdf`) and provides 380px PNG (`/api/tickets/<ref>/qr.png`) + vector SVG.
- **LAN Configuration (`config.py`, `.env.example`, `app.py`):**
  - Binds `0.0.0.0:5000`, auto-detects non-loopback LAN IPv4 (`http://<LAN_IP>:5000`) when `QR_VERIFY_BASE_URL` is unset in development, rejects `localhost`/`127.0.0.1` in QR payloads, enforces HTTPS in production, enables private LAN CORS origins cleanly in dev, and documents setup in `documentation/LOCAL_NETWORK_QR_SETUP.md`.
- **Public Verification UI & Atomic Staff Check-In (`templates/pages/ticket_verify.html`):**
  - Distinguishes `VALID — TICKET ISSUED`, `CANCELLED — NOT VALID FOR TRAVEL`, `REFUNDED — TICKET NOT VALID FOR TRAVEL`, pending states (`Ticketing Pending`, `Cancellation Pending`, `Refund Pending`, `Under Review`), `PARTIALLY_USED`/`USED`, and `INVALID TICKET`, plus explicit unreachable network error handling.
  - Protects staff check-in via `BEGIN IMMEDIATE` atomic conditional updates to block multi-device duplicate consumption.

### Part F–N: Realistic Airline Cancellation, Refund Engine & Admin Management
- **Database Extensions (`database.py`):** Added `fee_policies` (versioned policies pinned per booking), `fare_rules` (airline & fare-family tariffs), `cancellations`, `cancellation_items`, `refund_quotes`, `refund_quote_items`, `refunds`, `refund_transactions`, `refund_status_history`, `supplier_refund_references`, `manual_refund_approvals`, and append-only `financial_ledger_entries`.
- **Engine (`fly/services/cancellation_refund_service.py`):**
  - Implements exact `Decimal` minor-unit calculations across `VOLUNTARY`, `AIRLINE_INITIATED`, `SCHEDULE_CHANGE`, `PARTIAL` (per-passenger & per-segment), `NO_SHOW`, `BEFORE_ISSUANCE`, and `TICKETING_FAILURE`.
  - Enforces 15-minute quote expiry (`409 QUOTE_EXPIRED`), explicit customer confirmation (`CONFIRMATION_REQUIRED`), idempotent submission protection, separated Card/bKash/Nagad/Bank adapters, independent cancellation/refund tracking, dual-approval + settlement evidence verification (`EVIDENCE_REQUIRED`), and automatic QR token revocation upon supplier cancellation/refund.
- **Customer & Admin UIs:**
  - Dedicated Refund Preview & Confirmation (`templates/pages/refund_preview.html`, `static/js/refund_preview.js`).
  - Customer 7-Stage Refund Tracking (`templates/pages/refund_tracking.html`, `static/js/refund_tracking.js`).
  - Admin Refund Dashboard, Search/Filters, Detail Inspector, Reconcile & Manual Dual-Approval Settlement, Aging/Financial Reports, Fee Policy Versioning, and QR Scan History (`templates/pages/admin_operations.html`, `static/js/admin_console.js`).

---

## 2. External Provider & Environment Dependencies (Honest Status)
- **Payment Gateways (SSLCommerz / bKash / Nagad Live APIs):** Active integration defaults to `PAYMENT_GATEWAY_ACTIVE=SIMULATED` with separate adapter modules. Live merchant credentials (`SSLCOMMERZ_STORE_ID`, `BKASH_APP_KEY`, `NAGAD_MERCHANT_ID`) are empty placeholders in `.env.example`; unconfigured live gateways safely route to manual review / reconciliation rather than fabricating external bank API approvals.
- **Airline GDS / BSP Live Feeds (Amadeus / Duffel):** Active provider defaults to `DEMO_LOCAL` with controlled supplier scenario testing (`SUPPLIER_OK`, `SUPPLIER_FAIL`, `SUPPLIER_MANUAL_REVIEW`, `BSP_AGENCY`). Real live PNR cancellation/EDIFACT calls require live GDS credentials.
- **Transactional SMTP/SMS:** Notifications are logged reliably to `notification_outbox` (`DISPATCHED_LOCAL_OUTBOX`); external email/SMS dispatch activates when `SMTP_*` / `SMS_*` credentials are provided.
