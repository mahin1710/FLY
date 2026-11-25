# FLY Flight Ticketing System — Implementation Roadmap

This roadmap turns the findings in [PROJECT_AUDIT.md](file:///c:/Users/mahed/Desktop/FLY/PROJECT_AUDIT.md) into structured, verifiable engineering phases using the existing **Python Flask + Jinja2 + Vanilla JS + SQLite** architecture.

---

## Phase 1: Database Hardening, Concurrency & Security Fixes
**Goal:** Eliminate double-booking race conditions, enforce strict tenant/customer isolation, and lock down exposed admin and card endpoints.

- **1.1 Fix Seat Hold Index & Transaction Isolation (`database.py`)**
  - Rebuild `idx_active_seat_reservation` on `reservations (id_flight, id_seat) WHERE status IN ('PENDING_PAYMENT', 'HELD', 'CONFIRMED')`.
  - Use `BEGIN IMMEDIATE` inside `hold_seats_atomic()` and `confirm_payment_atomic()` so concurrent requests serialize cleanly.
  - Deduplicate `seat_ids` on input and validate against `'PENDING_PAYMENT'` holds in `/api/bookings/validate`.
  - Fix `bookedCount` subquery in `app.py:777` to count `status IN ('CONFIRMED', 'PENDING_PAYMENT')` (excluding expired holds).
- **1.2 Add Missing Indexes & Schema Extensions (`database.py`)**
  - Add indexes: `flights(dep_airport, arr_airport, dep_datetime)`, `flights(id_airline)`, `airports(IATA)`, `airports(city)`, `bookings(id_flight)`, and `UNIQUE(id_account, id_flight)` on `favorites`.
  - Add `pnr_code`, `cancelled_at`, `cancellation_reason` to `bookings` and create `tickets` and `admin_audit_logs` tables in `database/flight_booking.db`.
- **1.3 Enforce Auth, RBAC & Cross-Airline Isolation (`app.py`)**
  - Lock down `/api/v1/admin/*` and `/admin` with authentication + role validation (`AIRLINE_ADMIN` / `SUPER_ADMIN`). Remove public `adminRoleSelect` role simulation in production flow.
  - Enforce ownership (`booking.id_account == user.id`) on `/api/reservations/ticket/<id>`, and enforce `flight.id_airline == user.airlineId` for `AIRLINE_ADMIN` on `api_get_booking`, `api_cancel_booking`, and `confirm_payment_atomic`.
  - Fix `datetime.strptime` ISO parsing in `api_get_booking` and `api_my_reservations` by reusing a shared safe parser.
- **1.4 Password & Payment Data Hygiene (`database.py`, `app.py`)**
  - Upgrade legacy plaintext passwords on login/migration to `scrypt:` hashes and assign proper roles or separate legacy fixture rows cleanly.
  - Stop storing raw `CVV` or unmasked `cardNumber` in `creditCards` (store masked last-4 + brand only).

---

## Phase 2: Complete Authentication, Registration & Profile Flows
**Goal:** Make `/login`, `/register`, `/profile`, and `/logout` real end-to-end features.

- **2.1 Backend Endpoints (`app.py`, `database.py`)**
  - Implement `POST /api/auth/register` (username/email uniqueness validation, `scrypt` password hashing, `passengers` + `accounts` creation inside a transaction, session token issuance).
  - Implement `GET/PUT /api/auth/profile` (update display name, location, passenger details, password change with current-password verification).
- **2.2 Auth & Profile UI (`templates/pages/auth.html`, `static/js/shell.js`)**
  - Fix the broken `"AirlineAdmin"` quick-fill button (`auth.html:39`) to use `Admin_Biman` / `Admin_USB`.
  - Render tabbed/dedicated views on `/login`, `/register`, and `/profile` so signing up and updating user details work seamlessly.

---

## Phase 3: Wire Frontend Search & Checkout to Live Backend APIs
**Goal:** Replace fixture-only and `sessionStorage`-only checkout flows with real SQLite-backed search, seat maps, atomic holds, and payments.

- **3.1 Live Flight Search (`templates/pages/flight_search.html`, `static/js/flight_results_controller.js`)**
  - Fetch real flights from `GET /api/flights` and filter bounds from `GET /api/flights/filter-options` while preserving all sorting/filter UX.
  - Pass real `flightId` and search parameters to `/flights/offer/<flight_id>`.
- **3.2 Real Offer Details & Dynamic Fare Revalidation (`templates/pages/offer_details.html`, `templates/pages/review.html`)**
  - Load real flight + fare breakdown via `GET /api/flights/<id>` and `GET/POST /api/flights/fare-breakdown`.
  - Wire `/booking/review` to `POST /api/bookings/validate` (revalidating live availability and price) and `POST /api/bookings/hold` (creating the 15-minute atomic hold in SQLite).
- **3.3 Interactive Seat Selection & Multi-Leg Support (`templates/pages/extras.html`, `database.py`)**
  - Fix stepper `current_step` on `extras.html` and replace hardcoded `12A/12B/1A` radios with the live aircraft seat map backed by `GET /api/flights/<id>/seats`.
  - Support seat selection/holds on return flights (`return_flight_id`) for round-trip bookings.
- **3.4 Real Payment Confirmation & Ticket Issuance (`templates/pages/payment.html`, `templates/pages/booking_status.html`)**
  - Drive countdown timer from backend `expires_at` (`GET /api/bookings/<ref>`).
  - Submit payment via `POST /api/bookings/confirm` to transition SQLite records to `CONFIRMED`, generate a unique 6-character PNR + 13-digit e-ticket reference, and display live boarding pass data from `GET /api/reservations/ticket/<ref>`.
  - Remove or gate QA simulation bars (`booking_status.html`, `review.html`) behind explicit debug flags.

---

## Phase 4: Real My Bookings, Manage Booking (PNR) & Admin Console
**Goal:** Connect all post-booking and administrative portals to real SQLite records.

- **4.1 My Bookings (`templates/pages/my_bookings.html`)**
  - Fetch authenticated bookings from `GET /api/reservations/my`, display active holds with live countdowns (`Complete Payment` / `Release Seats`), and confirmed trips (`View Boarding Pass` / `Cancel`).
- **4.2 Public PNR Retrieval & Self-Service (`templates/pages/manage_booking.html`, `app.py`)**
  - Add `POST /api/bookings/lookup` verifying `(bookingReference OR pnr_code) + passengerLastName`.
  - Wire `manage_booking.html` form dynamically instead of hardcoded `/booking/status/BK-DAC-7788`, supporting ticket view, seat/baggage summary, and cancellation/refund requests.
- **4.3 Airline Admin & Operations Portal (`templates/pages/admin_operations.html`, `static/js/admin_console.js`, `app.py`)**
  - Connect `/admin` to live Flask APIs (`/api/admin/all-bookings`, `/api/airline/flights`, `/api/airline/stats`) plus new airline-scoped CRUD endpoints for adding/editing flights and managing refunds/cancellations, removing hardcoded mock data and dead Laravel proxy calls.

---

## Phase 5: Codebase Cleanup & Legacy Decommissioning
**Goal:** Remove verified duplication and dead files safely after Phases 1–4 pass end-to-end verification.

- Remove or archive duplicate/unused scripts (`static/js/main.js`, `static/js/payment.js`), unused root templates (`templates/my_bookings.html`, `templates/payment.html`, legacy `templates/index.html` / `seat_selection.html` if retired), unused component files (`card.html`, `error_banner.html`, `loading_state.html`), and 8 unreferenced images in `static/images/`.
- Decide retention/archival of `Skynet-master/` and `backend/` (and update `netlify.toml` / `package.json` if Netlify deployment is migrated or retired).

---

## Phase 6: Comprehensive QA, Security & Regression Verification
**Goal:** Verify full-system correctness, concurrency safety, and responsiveness.

- Add and run automated tests covering:
  1. Concurrent double-booking / race condition stress tests against `hold_seats_atomic()` (`BEGIN IMMEDIATE` + fixed unique index).
  2. Cross-airline admin isolation & IDOR protection tests on `/api/bookings/*`, `/api/reservations/ticket/*`, and `/api/admin/*`.
  3. End-to-end journey test: Register/Login -> Search -> Offer -> Travellers -> Extras/Seat Map -> Review/Hold -> Payment Confirm -> Ticket/Boarding Pass -> PNR Manage Booking -> Cancel.
  4. Existing UI accessibility & responsive suite (`tests/ui_accessibility_and_responsive.test.js`) across desktop, tablet, and mobile viewports.
