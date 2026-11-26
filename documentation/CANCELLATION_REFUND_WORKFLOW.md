# FLY — Cancellation & Refund Management Workflow Specification

**Modules:** `fly/services/cancellation_refund_service.py`, `fly/routes/bookings.py`, `fly/routes/admin.py`, `templates/pages/refund_preview.html`, `templates/pages/refund_tracking.html`, `templates/pages/admin_operations.html`

---

## 1. Cancellation Workflows (Part F)
Cancellations are accessible from **My Bookings** (`/my-bookings`), **Booking Details** (`/booking/status/<ref>`), **Manage Booking** (`/manage-booking`), and the **E-Ticket View** (`/ticket/<pnr>`). Ownership and airline-tenant access checks block unauthorized cancellations (`403 Forbidden`).

Supported `cancellationType` workflows:
1. **`VOLUNTARY`**: Inspects fare rules (`fare_rules` table keyed by `id_airline` + `fare_family`), departure window, coupon usage (`OPEN` / `PARTIALLY_USED` / `USED`), and booking-pinned `fee_policy_version`.
2. **`AIRLINE_INITIATED` & `SCHEDULE_CHANGE`**: Waives ordinary voluntary penalties (`0`) and waived FLY cancellation fees; queries alternative active flights on the same route for customer rebooking visibility.
3. **`PARTIAL`**: Validates `partial_cancel_allowed` and `split_pnr_required` rules; accepts `selectedTicketIds` or `selectedSegmentIds`, prorates base fare/tax via exact `Decimal` ratios, revokes QR tokens **only** on cancelled tickets/segments while leaving active passengers/segments intact (`PARTIALLY_CANCELLED`).
4. **`NO_SHOW`**: Triggered automatically when departure has passed or explicitly indicated (`simulateNoShow`); applies `fare_rules.no_show_fee_minor`, checks unused tax refundability, flags `manualReviewRecommended`, and never auto-approves full refunds.
5. **`BEFORE_ISSUANCE` & `TICKETING_FAILURE`**: Releases unpaid `PENDING_PAYMENT` seat holds with zero charge, or recovers paid `TICKETING_PENDING` bookings with waived FLY fees.

---

## 2. Refund Calculation & Versioned Fee Policy (Part G)
- All monetary quantities use exact integer minor units (`paisa = BDT * 100`) converted with `decimal.Decimal(..., ROUND_HALF_UP)` (zero IEEE-754 floating-point drift).
- Historical fee protection: Bookings store `fee_policy_version` at creation. Publishing a newer policy (`POST /api/admin/fee-policies`) creates a new version (`FLY-POL-V2`, etc.) without silently rewriting historical bookings.
- Quotes are persisted immutably in `refund_quotes` + `refund_quote_items` with a 15-minute TTL (`expires_at`).

---

## 3. Customer Preview, Explicit Confirmation & Status Tracking (Parts H, J, K)
- Opening `/cancel-booking/<ref>` never cancels a booking. The customer reviews original payment, airline penalty, non-refundable taxes, refundable taxes, disclosed FLY service fee, and destination before checking explicit confirmation.
- Expired quotes return `409 QUOTE_EXPIRED` requiring quote revalidation before submission. Rejecting a quote (`POST /api/refund-quotes/<ref>/reject`) keeps the itinerary active.
- Cancellation state (`REQUESTED` -> `QUOTE_READY` -> `SUPPLIER_CANCEL_PENDING` -> `CANCELLED_BY_SUPPLIER` / `MANUAL_REVIEW` / `FAILED`) and refund payment state (`NOT_ELIGIBLE` / `APPROVAL_PENDING` / `SUBMITTED_TO_SUPPLIER` / `SUPPLIER_APPROVED` / `GATEWAY_REFUND_PENDING` / `GATEWAY_PROCESSING` / `PARTIALLY_REFUNDED` / `REFUNDED` / `FAILED` / `RECONCILIATION_REQUIRED`) are stored independently.
- **No Premature Completion:** Supplier acceptance or gateway initiation never immediately marks a refund `REFUNDED` unless authoritative settlement confirms.

---

## 4. Payment Adapters, Manual Dual Control & Ledger Integrity (Parts I, L, M, N)
- Separated adapters in `cancellation_refund_service.py`:
  - `CardGatewayRefundAdapter` (SSLCommerz/Card route; honors configured sandbox/live creds or routes to `RECONCILIATION_REQUIRED` when live creds absent).
  - `BkashRefundAdapter` & `NagadRefundAdapter` (use original merchant reference in sandbox or route to controlled `APPROVAL_PENDING` manual review when live credentials are unconfigured).
  - `ManualSettlementRefundAdapter` (Bank Transfer / Cash / BSP): enforces **Dual Approval** (`APPROVE` + `DUAL_APPROVE` by two distinct authorized administrators for bank/cash/high-value `>= BDT 50,000`) and requires both `transferReference` and `evidenceRef` settlement proof before `SETTLE` marks `REFUNDED`.
- Append-only double-entry `financial_ledger_entries` track `PAYMENT_CAPTURE`, `REFUND_LIABILITY`, `AIRLINE_PENALTY`, `FLY_SERVICE_FEE`, `GATEWAY_REFUND_OUTFLOW`, and `MANUAL_SETTLEMENT_OUTFLOW`.
- Admin Refund Management Console (`/admin/refunds`) provides KPIs, multi-field search/filtering, detail inspector, settlement reconciliation, manual approval actions, and financial/aging reports.
