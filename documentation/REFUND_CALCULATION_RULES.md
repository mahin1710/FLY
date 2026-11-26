# FLY — Authoritative Refund Calculation Rules & Fee Policy Specification

**Service:** `fly/services/cancellation_refund_service.py`  
**Tables:** `fare_rules`, `fee_policies`, `refund_quotes`, `refund_quote_items`, `financial_ledger_entries`

---

## 1. Numeric Precision & Currency Rules
- All currency values are stored as exact integer minor units (**paisa = BDT × 100**) and converted via Python `decimal.Decimal` with `ROUND_HALF_UP`. Floating-point arithmetic is never used for money calculations or ledger entries.
- Refunds never exceed the verified `CAPTURED` payment amount minus any prior non-failed refunds (`remaining_paid_minor`).

---

## 2. Fare-Rule & Scenario Matrix (`fare_rules`)
Penalties and tax refundability depend on `(id_airline, fare_family)` and cancellation scenario—never a single global fixed percentage:

| Scenario | Airline Penalty | Unused Taxes | FLY Cancel Service Fee |
| :--- | :--- | :--- | :--- |
| `VOLUNTARY` (Refundable fare) | From `fare_rules.voluntary_cancel_fee_minor` | Per `tax_refundable_pct` | Pinned booking policy (`FLY-POL-V1` = BDT 350) |
| `VOLUNTARY` (`SAVER` Non-refundable) | Retained (`baseFare - discount`) | Unused government/airport taxes eligible | Capped so customer refund never negative |
| `AIRLINE_INITIATED` / `SCHEDULE_CHANGE` | **BDT 0** (Waived) | **100%** Refundable | **BDT 0** (Waived by policy) |
| `TICKETING_FAILURE` / `BEFORE_ISSUANCE` (Paid) | **BDT 0** (Waived) | **100%** Refundable | **BDT 0** (Waived) |
| `PARTIAL` (Passengers or open segments) | `Decimal` exact ratio (`portion_num / portion_den`) | Proportionate | Proportional / disclosed policy |
| `NO_SHOW` | From `fare_rules.no_show_fee_minor` + `manualReviewRecommended` | Unused govt taxes per rule | Applicable disclosed fee |

---

## 3. Double-Deduction & Hidden-Fee Prevention
- Supplier penalty charges are never deducted twice; carrier penalties, non-refundable taxes/ancillaries, and disclosed FLY fees appear as separate itemized lines in `refund_quote_items` with an explicit `authority_source`.
- **Historical Version Pinning:** Every booking saves `bookings.fee_policy_version` at creation (`hold_seats_atomic`). Publishing new admin fee policies (`POST /api/admin/fee-policies`) creates new versions without mutating historical bookings.
- **Quote TTL & Revalidation:** Quotes remain valid for `REFUND_QUOTE_TTL_MINUTES` (15 minutes). Confirming an expired quote returns `409 QUOTE_EXPIRED`, requiring customer re-quotation.
