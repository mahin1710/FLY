# FLY — QA Report: QR E-Ticket & Cancellation / Refund System

**Updated:** 2026-11-26  
**Server Target:** `python app.py` (`0.0.0.0:5000`, LAN `http://192.168.1.119:5000`)  

---

## 1. Execution Summary
- **Command:** `python -m unittest discover -s tests -p "test_*.py" -v`
- **Result:** **39 / 39 PASSED (`OK`) in `12.489s`**
- **JS Syntax & Behavioral Check:** `node tests/ui/test_search_widget_behavior.js` + `node --check static/js/*.js` — **PASSED**

---

## 2. QR E-Ticket Verification & LAN Scanning Scenarios Tested
1. **Strict Issuance Gate (`test_01_deferred_issuance_withholds_qr_until_confirmed`):** Paid `TICKETING_PENDING` bookings withhold active QRs (`qrSvg=None`, `/qr.png -> 409`) until issuance confirms (`POST /api/tickets/<ref>/issue-deferred`).
2. **Multi-Passenger Token Separation & Cryptography (`test_02`):** Separate passengers receive distinct ticket numbers and HMAC-SHA256 derived QR tokens; `ticket_qr_tokens` stores only salted digests (`token_hash`).
3. **PDF & PNG QR Readability (`test_02`):** `/api/tickets/<ref>/qr.png` and lossless FlateDecode RGB `/Image` XObjects inside `/api/tickets/<ref>/pdf` decoded pixel-for-pixel via `zxing-cpp` against the non-localhost LAN URL (`http://192.168.1.119:5000/ticket/verify/...`).
4. **LAN Public Scan & Read-Only Separation (`test_02`):** Public mobile scan returns `VALID — TICKET ISSUED` with masked passenger name, `"FLY Record Verification"` authority label, and zero passport/card exposure. Repeat public scans increment `publicScanCount` without changing `checkin_status`. Guessable PNRs return `404 INVALID TICKET`.
5. **Atomic Staff Check-In & Voiding (`test_02`, `test_03`):** 8 parallel staff check-in attempts resulted in strictly `1 x 200` and `7 x 409 ALREADY_CHECKED_IN`. Staff voiding (`POST /api/staff/tickets/verify/<token>/void`) revokes tokens and displays `VOID — TICKET INVALID FOR TRAVEL`. Cancellation displays `NOT VALID FOR TRAVEL`.

---

## 3. Realistic Cancellation & Refund Scenarios Tested
1. **Quote Expiry, Decline & Supplier Failure (`test_01`):** Rejecting quotes keeps tickets intact; `customerConfirmed=False` returns `400 CONFIRMATION_REQUIRED`; expired quotes return `409 QUOTE_EXPIRED`; supplier failure (`SUPPLIER_FAIL`) returns `502` without falsely cancelling tickets.
2. **Partial Passenger Cancellation, Saved Rules & No-Show (`test_02`):** Cancelling 1 passenger on a 2-passenger ticket revokes only that passenger's QR while keeping the sibling QR valid; duplicate confirmation blocked; non-refundable `SAVER` refunds unused taxes while `AIRLINE_INITIATED` waives penalty and FLY fees; `NO_SHOW` applies carrier penalty and sets `manualReviewRecommended`.
3. **9-Stage Tracking, My Refunds & Gateway Adapters (`test_02`, `test_04`):** bKash returns `GATEWAY_PROCESSING`; Nagad `GATEWAY_FAIL` records `FAILED`; mismatched settlement amount routes to `RECONCILIATION_REQUIRED`; verified reconciliation advances to `REFUNDED`, completes all 9 stages on `/api/refunds/track/<ref>`, and appears in `GET /api/refunds/my`.
4. **Versioned Fee Policy Isolation (`test_04`):** Publishing a temporary fee change preserves historical booking's purchase-time `FLY-POL-V1` BDT 350 fee.
5. **Bank Transfer Dual Approval & Evidence (`test_03`):** Enforces two distinct admin approvers (`409 DUAL_APPROVAL_SAME_USER`), requires `transferReference` + `evidenceRef` (`400 EVIDENCE_REQUIRED`), settles to `REFUNDED — TICKET NOT VALID FOR TRAVEL`, records append-only `financial_ledger_entries`, and updates Admin KPIs & disbursement reports.

---

## 4. Untested / External Items Recorded Honestly
- Live external third-party merchant API calls (SSLCommerz live/sandbox merchant panel, bKash live app credentials, Nagad live merchant API, real airline GDS/NDC ticketing) require merchant/GDS production credentials and were exercised via backend adapters and sandbox/mock fixtures only.
- Handheld smartphone camera scan should be verified visually by pointing a mobile phone on the same LAN Wi-Fi at `http://192.168.1.119:5000` (with Windows Private Firewall port `5000` permitted).
