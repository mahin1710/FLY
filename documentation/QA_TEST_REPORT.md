# FLY — Quality Assurance Test Report

**Updated:** 2026-11-26  
**Server Target:** `python app.py` (`http://0.0.0.0:5000`, LAN `http://192.168.1.119:5000`)  

---

## 1. Automated Python Suite (`python -m unittest discover -s tests -p "test_*.py" -v`)

- **Total Executed:** **39 Tests**
- **Result:** **39 / 39 PASSED (`OK`) in `12.489s`**

### Suite Breakdown
1. **QR Ticketing, Cryptography, PDF Readability, LAN Verification & Staff Check-In (`tests/e2e/test_qr_ticketing_and_lan_verify.py` — 3 suites OK):**
   - `test_01_deferred_issuance_withholds_qr_until_confirmed`: Verified payment capture with `DEFER_ISSUANCE` creates `TICKETING_PENDING` with `qrSvg=None`, `verificationToken=None`, `/qr.png -> 409`; confirming issuance (`POST /api/tickets/<ref>/issue-deferred`) generates non-localhost LAN QR URL.
   - `test_02_multi_passenger_separate_qr_pdf_decode_lan_and_checkin`: Verified 2 passengers receive separate tickets + distinct high-entropy QR tokens; `ticket_qr_tokens` stores only salted hashes (zero raw token leaks); `/qr.png` AND `/pdf` embedded lossless FlateDecode QR decoded pixel-for-pixel via `zxing-cpp`; LAN URL verified (`VALID — TICKET ISSUED`, masked name, zero passport/card exposure); duplicate public scans increment counter cleanly without consuming check-in; guessable PNR rejected `404 INVALID TICKET`; 8 concurrent staff check-in attempts resulted in strictly 1 `200` + 7 `409`; cancellation immediately revoked QR (`CANCELLED — NOT VALID FOR TRAVEL`).
2. **Realistic Cancellation, Refund Calculation, Adapters, Dual Control & Reports (`tests/e2e/test_cancellation_refund_system.py` — 4 multi-scenario suites OK):**
   - `test_01_quote_expiry_reject_explicit_confirm_and_supplier_failure`: Verified explicit `customerConfirmed=True` requirement, rejecting quote leaves ticket intact, expired quote (`409 QUOTE_EXPIRED`), and supplier cancellation failure (`502`) preserves ticket validity.
   - `test_02_non_refundable_saver_airline_cancel_no_show_and_partial_cancel`: Verified per-passenger partial cancellation revokes ONLY cancelled passenger QR while keeping sibling ticket `VALID — TICKET ISSUED`; duplicate confirmation blocked; gateway reconciliation (`SETTLED`) completes 7-stage customer refund timeline; compared non-refundable `SAVER` vs `AIRLINE_INITIATED` (0 penalty/0 fee) vs `NO_SHOW` (manual review flagged).
   - `test_03_manual_bank_dual_approval_evidence_reconciliation_and_reports`: Verified `BANK_TRANSFER` / high-value payout enforces distinct dual approvers (`409 DUAL_APPROVAL_SAME_USER`), rejects silent settlement without `transferReference` + `evidenceRef` (`400 EVIDENCE_REQUIRED`), marks ticket `REFUNDED — TICKET NOT VALID FOR TRAVEL` after verified settlement, and populates Admin KPIs, search, details/ledger, and disbursement reports.
   - `test_04_bkash_nagad_gateway_failure_wrong_amount_and_fee_policy_isolation`: Verified bKash initiation (`GATEWAY_PROCESSING`), Nagad gateway failure (`FAILED`), settlement discrepancy routing (`RECONCILIATION_REQUIRED`), and versioned `fee_policies` pinning (publishing a newer policy preserves historical booking's `FLY-POL-V1` BDT 350 fee).
3. **Concurrency & DB Stress (`tests/concurrency/test_concurrent_seat_locks.py` — 4 tests OK):** 50 concurrent threads -> 1 win, 49 conflicts (`0.985s`), atomic multi-seat rollback, expiry cleanup, 10-thread payment idempotency.
4. **Search Expansion, Dates, Travellers, Hotels & Cars (`tests/e2e/test_search_expansion_and_controls.py` — 8 tests OK).**
5. **E2E Booking Journeys & Admin Workflows (`test_full_booking_journey.py`, `test_five_master_workflows.py` — 5 tests OK).**
6. **Security, RBAC, Airline Isolation & Business Logic (`test_security_rbac_isolation.py` — 12 tests OK).**
7. **UI Routes, Assets & CSS (`test_ui_assets_and_pages.py` — 3 tests OK, including `/admin/refunds`, `/refunds/track`, and homepage hero layout checks).**

---

## 2. Node Behavioral & JS Syntax Verification

- **`static/js/*.js` Syntax Check (`node --check`):** All JavaScript modules (including `refund_preview.js`, `refund_tracking.js`, `admin_console.js`, `my_bookings.js`, `manage_booking.js`) parsed cleanly with exit code 0.
- **`node tests/ui/test_search_widget_behavior.js`:** **PASSED (`ALL FlightSearchWidget BEHAVIORAL ASSERTIONS PASSED!`)**.

---

## 3. Honest External Dependencies & Environment Notes

- **Live External Airlines (GDS) & Payment Gateways (SSLCommerz / bKash / Nagad):** Real live airline issuance, PNR cancellation, and live money movement were **not** executed against third-party production merchant accounts (`PAYMENT_GATEWAY_ACTIVE=SIMULATED`, `FLIGHT_PROVIDER_ACTIVE=DEMO_LOCAL`). Production credentials remain placeholders in `.env.example`; unconfigured live adapters route to `APPROVAL_PENDING` / `RECONCILIATION_REQUIRED` rather than faking external approvals.
- **Physical Phone Camera Hardware Scan:** LAN URL resolution (`http://192.168.1.119:5000`), CORS access, PNG/PDF QR image extraction, and `zxing-cpp` barcode decoding succeeded via automated test requests against the `0.0.0.0:5000` server. Physical handheld camera testing over Wi-Fi follows `documentation/LOCAL_NETWORK_QR_SETUP.md`.
- **PostgreSQL & Chrome DevTools:** Runtime executed on SQLite WAL (`database/flight_booking.db`); `DevToolsActivePort` inactive on host Chrome profile during automation.
