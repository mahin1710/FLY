# FLY — Secure QR E-Ticket Verification System

**Modules:** `fly/services/qr_service.py`, `fly/services/pdf_service.py`, `fly/routes/bookings.py`, `templates/pages/ticket.html`, `templates/pages/ticket_verify.html`, `config.py`

---

## 1. QR Architecture & Strict Issuance Gate
- A valid QR verification credential is created **only after airline/provider ticket issuance confirms** (`issuance_state = 'ISSUED'`).
- Submitting a booking, completing payment with deferred issuance (`DEFER_ISSUANCE` / `TICKETING_PENDING`), or holding a PNR alone **does not** produce an active QR token or PDF QR code until deferred issuance completes via `POST /api/tickets/<booking_ref>/issue-deferred`.
- Each passenger receives a dedicated `tickets` row, dedicated `ticket_segments` itinerary rows, and a distinct `ticket_qr_tokens` record.

## 2. Cryptographic Token Security
- Per-ticket 144-bit random salt (`secrets.token_urlsafe(18)`) stored as `token_nonce`, combined with server-only `Config.QR_TOKEN_PEPPER` (via HMAC-SHA256) to derive a high-entropy 43-character URL-safe verification token (`derive_raw_token`).
- **Database Storage (`ticket_qr_tokens`):** Only the salted HMAC-SHA256 digest (`token_hash`) and `token_version` / `token_nonce` are stored — **raw verification tokens are never persisted in the database** and cannot be forged from a database dump alone.
- Zero PII inside QR codes: QR images encode strictly `<QR_VERIFY_BASE_URL>/ticket/verify/<SECURE_TOKEN>`. Sequential ticket IDs, booking IDs, raw PNRs, passport numbers, and card details are never accepted or embedded.
- Rate limiting protects `GET /api/tickets/verify/<token>` (`QR_VERIFY_RATE_LIMIT` per `QR_VERIFY_RATE_WINDOW` seconds).

## 3. Standard QR Generation & PDF Embedding
- Generated with ISO/IEC 18004 (`qrcode` + `Pillow`, Error Correction `M`, 4-module quiet zone):
  - **Web SVG:** Responsive vector QR displayed on `/ticket/<pnr>`.
  - **High-Resolution PNG:** `GET /api/tickets/<pnr_or_ref>/qr.png` (380x380+ px).
  - **Printable E-Ticket PDF (`build_ticket_pdf`):** Embeds a lossless `/Filter /FlateDecode` `/Image` XObject directly in `%PDF-1.4` alongside instruction `"Scan this QR code to verify your FLY ticket."`, FLY branding, PNR, actual e-ticket number, passenger(s), segments, baggage allowance, support contact, and a notice distinguishing the **Electronic Ticket Receipt** from an airline airport boarding pass.

## 4. Verification Verdicts & Read-Only Public vs Staff Check-In Separation
- **Public Verification (`GET /api/tickets/verify/<token>`):** Read-only, `Cache-Control: no-store`. Never modifies ticket status or consumes flight coupons; allows unlimited repeated scans across devices.
  - `VALID_ISSUED` -> `VALID — TICKET ISSUED` (masked passenger name, airline, flight, route, date, FLY check-in distinction).
  - `CANCELLED` -> `CANCELLED — NOT VALID FOR TRAVEL`.
  - `REFUNDED` -> `REFUNDED — TICKET NOT VALID FOR TRAVEL`.
  - `TICKETING_PENDING` / `CANCELLATION_PENDING` / `REFUND_PENDING` / `UNDER_REVIEW` -> Displays exact pending state; never reports pending tickets as valid.
  - `PARTIALLY_USED` / `USED` -> Distinguishes partially flown vs fully consumed coupons.
  - `INVALID` / `REVOKED` / `EXPIRED` -> `INVALID TICKET` without leaking secrets.
- **Authorized Staff Check-In (`POST /api/staff/tickets/verify/<token>/checkin`):** Restricted to `AIRLINE_ADMIN` (airline-scoped) / `SYSTEM_ADMIN` / `SUPER_ADMIN`. Uses SQLite `BEGIN IMMEDIATE` + atomic conditional `UPDATE ... WHERE checkin_status = 'NOT_CHECKED_IN'` to block concurrent multi-device double check-ins (`409 ALREADY_CHECKED_IN`).
- **Audit Trail:** All public scans and staff check-in attempts are permanently appended to `ticket_scan_logs` and visible in Admin `Audit & QR Logs`.
