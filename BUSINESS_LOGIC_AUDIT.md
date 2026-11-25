# FLY — Business Logic Audit Report

**Phase:** 6 — Airline Ticketing Domain Logic Verification  

---

## 1. Flight Management & Constraints
- **Airport & Timestamp Validation:** `POST /api/airline/flights` rejects `depIATA == arrIATA` (`400`) and validates `arr_datetime > dep_datetime` (`400`), normalizing datetime strings cleanly to SQLite's `'YYYY-MM-DD HH:MM'` CHECK format ([fly/routes/admin.py](file:///c:/Users/mahed/Desktop/FLY/fly/routes/admin.py)).
- **Schedule Conflict Prevention:** `POST /api/airline/flights` checks matching `(id_airline, flight_number, dep_datetime)` on active flights and rejects duplicates with `409 Conflict` (`SCHEDULE_CONFLICT`).
- **Confirmed Booking Mutation Guard:** `PUT /api/airline/flights/<id>` blocks cancelling or changing departure times of flights that have existing `CONFIRMED` seat reservations unless `force: true` is supplied (`409 CONFIRMED_BOOKINGS_EXIST`).

## 2. Authoritative Fare, Promo & Discount Rules
- **Backend Fare Breakdown:** `calculate_fare_breakdown()` enforces cabin class fares (`Economy`, `Business`, `First`, `Premium`), passenger multipliers (Adult 100%, Child 75%, Infant 10%), VAT (15%), airport taxes, airline charges, configurable baggage fees, add-ons, and promo discounts.
- **Negative Fare & Discount Protection:** Numeric luggage/meal/seat upgrade inputs are clamped to `>= 0`; final payable amount is floored at `max(0, round(subtotal - discount))`; `PERCENT` promos validate `1..90%` max cap inside admin creation; `confirm_payment_atomic` atomically guards promo usage (`used_count < usage_limit AND is_active = 1`).

## 3. Configurable Baggage Policies
- Seeded configurable rules per airline & route scope in `baggage_policies`:
  - **DOMESTIC (`depCountry == 'Bangladesh' and arrCountry == 'Bangladesh'`):** `23 kg` checked (`1` piece) + `7 kg` cabin (extra kg/piece fees configurable via Admin Settings `PUT /api/admin/settings`).
  - **INTERNATIONAL:** `40 kg` checked (`2` pieces) + `7 kg` cabin.
- Displayed dynamically on Flight Search cards, Seat Selection banner, Official E-Ticket, and PDF downloads.

## 4. Passenger & Cancellation Rules
- **Infant Accompaniment Rule:** `infants <= adults` enforced across both `/api/flights/fare-breakdown` and `database.hold_seats_atomic` (`test_12` passing).
- **Cancellation & Refund Calculation:** Verified by `test_workflow_4` (`>=24h` 85% refund, `>=6h` 50%, `<6h` 0%), releasing ONLY reservations tied to the cancelled `booking_reference`, updating `tickets.status = 'CANCELLED'`, and logging an audit entry.
