# FLY — Final QR E-Ticket & Realistic Refund Implementation Report

**Project:** FLY Flight Booking & Ticket Management System  
**Date:** 2026-11-26  

---

## 1. QR Generation, Cryptography & LAN Phone Verification
- **Token Security (`fly/services/qr_service.py`):** Per-ticket 144-bit nonce + server-only `Config.QR_TOKEN_PEPPER` HMAC-SHA256 tokens (`only` salted digests stored in `ticket_qr_tokens.token_hash`; zero plaintext tokens, passport numbers, or card data in QR payloads).
- **Issuance & Revocation Gate (`database.py`):** Valid QR tokens are created strictly after confirmed issuance (`ISSUED`) and automatically revoked on `CANCELLED`, `REFUNDED`, `VOID`, or token version rotation while preserving full `ticket_scan_logs` history.
- **PDF Embedding (`fly/services/pdf_service.py`):** Lossless `FlateDecode` RGB ISO-18004 QR XObject embedded in A4 `%PDF-1.4` E-Ticket PDFs (`/api/tickets/<ref>/pdf`), alongside 380px PNG (`/api/tickets/<ref>/qr.png`) and responsive SVG.
- **Local Network Mobile Access (`config.py`, `app.py`, `documentation/LOCAL_NETWORK_QR_SETUP.md`):** Binds `0.0.0.0:5000`, resolves non-localhost `QR_VERIFY_BASE_URL` (auto-detected LAN IPv4 `http://192.168.1.119:5000` or env override in dev; HTTPS required in production), permits configured private LAN origins via CORS in dev, and displays clear mobile verification outcomes (`VALID — TICKET ISSUED`, `VOID`, `CANCELLED`, `CANCELLED (REFUND PENDING)`, `REFUNDED`, pending states, `REVOKED`, `INVALID TICKET`, plus `"FLY Record Verification"` authority disclosure and unreachable network error).
- **Atomic Staff Check-In:** Separated from read-only public scanning; protected by `@require_roles` + `BEGIN IMMEDIATE` conditional `UPDATE` blocking concurrent double check-in (`409 ALREADY_CHECKED_IN`).

---

## 2. Realistic Cancellation, Authoritative Refund Engine & Financial Controls
- **Eligibility & Fare Rules (`fly/services/cancellation_refund_service.py`):** Supports `VOLUNTARY`, `AIRLINE_INITIATED`, `SCHEDULE_CHANGE`, `PARTIAL` (per-passenger & per-segment), `NO_SHOW`, `BEFORE_ISSUANCE`, and `TICKETING_FAILURE` using `fare_rules` tariffs and exact minor-unit (`Decimal`) arithmetic.
- **Fee Policy Governance:** Admin-versioned `fee_policies` (`GET/POST /api/admin/fee-policies`); bookings store `fee_policy_version` at hold creation so future policy edits never retroactively change prior purchases.
- **Customer Preview & 9-Stage Tracking:** Dedicated `/cancel-booking/<ref>` preview (showing itemized breakdown, expiry TTL, irreversible warning, rebooking alternatives, and explicit confirmation) + **My Bookings** integrated refunds list (`GET /api/refunds/my`) and 9-stage timeline tracker (`/refunds/track/<ref>`).
- **Payment Adapters & Settlement Separation:** Official **SSLCommerz** `merchantTransIDvalidationAPI.php` parameter integration (`store_id`, `store_passwd`, `bank_tran_id`, `refund_amount`, `refund_remarks`, `refund_trans_id`, `refe_id`, `verify=True`), **bKash** & **Nagad** honest sandbox/manual review routing, **Manual Bank/Cash** dual-approval (`APPROVE` + distinct `DUAL_APPROVE` + mandatory `transferReference` & `evidenceRef`), append-only `financial_ledger_entries`, and background reconciliation (`_start_lock_expiry_scheduler`).
- **Admin Refund Control Center (`/admin/refunds`):** Dashboard KPIs, search & multi-filter query, deep refund/ledger detail modal, reconciliation & manual settlement controls, aging & airline/payment-method reports.

---

## 3. Verified QA Results & Known External Dependencies
- **Full Automated Test Run (`python -m unittest discover -s tests -p "test_*.py" -v`):** **39 / 39 PASSED (`OK`) in `12.489s`**.
- **JS Checks (`node tests/ui/test_search_widget_behavior.js` + `node --check static/js/*.js`):** **PASSED**.
- **Missing External Credentials / Commercial Dependencies:** Live SSLCommerz (`SSLCOMMERZ_STORE_ID`), bKash (`BKASH_APP_KEY`), Nagad (`NAGAD_MERCHANT_ID`), and external Airline GDS/NDC credentials (`FLIGHT_PROVIDER_ACTIVE=DEMO_LOCAL`) are placeholders in `.env.example`; real money settlement & live airline EDIFACT calls require live merchant/GDS accounts.

---

## 4. Quick Startup & Mobile QR Verification Steps
1. Ensure Windows Firewall allows Private TCP port `5000`.
2. Start server (`python app.py`) — verifies `Server running on http://0.0.0.0:5000` and prints `QR Verify Base URL (development): http://<LAN_IP>:5000`.
3. Connect smartphone to the same Wi-Fi, scan QR on `/ticket/<PNR>` or downloaded PDF, and confirm mobile browser loads the live server verification view.
