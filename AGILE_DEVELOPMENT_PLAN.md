# FLY — Agile Development Plan (6 Sprints)

**Based On:** `PROJECT_AUDIT.md`, `SYSTEM_ARCHITECTURE.md`, `DATABASE_DESIGN.md`, `API_SPECIFICATION.md`, `BOOKING_FLOW.md`, `SECURITY_DESIGN.md`  
**Stack:** Python Flask + Jinja2 + Vanilla JS + CSS3 + SQLite (Dev) / PostgreSQL (Prod Target)

---

## Sprint Overview

| Sprint | Focus Area | Primary Outcome |
| :--- | :--- | :--- |
| **Sprint 1** | Foundation, Cleanup & Authentication | Modular backend structure, legacy cleanup, DB security fixes, working Register/Login/Profile/Logout |
| **Sprint 2** | Flight Management & Search | Live `/api/flights` search/filters wired to `flight_search.html` & `offer_details.html` + airline flight CRUD |
| **Sprint 3** | Seat Inventory & Concurrency Control | Fixed double-booking index + `BEGIN IMMEDIATE` / `FOR UPDATE`, real interactive seat map in `extras.html` |
| **Sprint 4** | Booking, Checkout & Ticket Generation | Live 6-step checkout wired to `/validate`, `/hold`, `/confirm`, PNR + 13-digit e-ticket & boarding pass |
| **Sprint 5** | Passenger Dashboard & Admin Management | Real `/my-bookings`, real PNR `/manage-booking` + refunds, live RBAC-protected `/admin` portal |
| **Sprint 6** | Security, Integration, Testing & Final QA | Cross-airline & concurrency tests, E2E journey verification, responsive/A11Y QA, deployment readiness |

---

## Sprint 1: Foundation, Cleanup & Authentication

**Sprint Goal:** Establish clean modular architecture, fix database/password foundations, prune verified dead assets/code, and complete authentication + profile management.

### User Stories & Tasks
1. **Modular Backend Scaffolding (`fly/`)**
   - Create `config.py`, `db.py`, `fly/middleware/auth.py`, `fly/middleware/tenant.py`, `fly/middleware/errors.py`, and split `app.py` routes into Blueprints (`auth`, `catalog`, `bookings`, `reservations`, `account`, `admin`, `pages`) while preserving `python app.py` and `database.py` compatibility.
2. **Safe Cleanup of Unused Artifacts**
   - Remove confirmed dead files (`static/js/main.js`, `static/js/payment.js`, unused root `templates/my_bookings.html`, `templates/payment.html`, unused `templates/components/{card,error_banner,loading_state}.html`, and 8 unreferenced images in `static/images/`).
   - Archive/isolate legacy `Skynet-master/` and `backend/` references out of `app.py`.
3. **Database Foundation & Legacy Credential Hygiene**
   - Upgrade `1,979` legacy non-`scrypt` accounts, normalize the `978` airline-linked accounts with `role='PASSENGER'`, and replace `creditCards` raw CVV storage with masked `saved_cards`.
   - Add missing indexes on `flights`, `airports`, `bookings`, `favorites`.
4. **Complete Auth & Profile Module (`app.py`, `templates/pages/auth.html`)**
   - Fix `"AirlineAdmin"` quick-fill bug (`auth.html:39`) to `Admin_Biman` / `Admin_USB`.
   - Implement `POST /api/auth/register` and `GET/PUT /api/auth/profile`.
   - Build dedicated Register and Profile Management UI views in `templates/pages/auth.html` + `static/js/auth_portal.js`.

**Definition of Done:** Unauthenticated `/admin` blocked; `/register`, `/login`, `/profile`, `/logout` work end-to-end against `database/flight_booking.db`; zero regressions on existing routes.

---

## Sprint 2: Flight Management & Search

**Sprint Goal:** Connect homepage search, search results, and offer review to real SQLite/PostgreSQL flights, and enable airline-scoped flight CRUD.

### User Stories & Tasks
1. **Harden Flight Search & Filter APIs (`fly/routes/catalog.py`, `fly/services/flight_service.py`)**
   - Update `bookedCount` to include active `'PENDING_PAYMENT'` holds (`app.py:777` fix).
   - Support full filter params (`stops`, `maxPrice`, `refundableOnly`, `checkedBaggageOnly`, `depTime`, `arrTime`, pagination) and remove unauthenticated `accountId` probing.
2. **Wire Live Search UI (`templates/pages/flight_search.html`, `static/js/flight_results_controller.js`)**
   - Replace `DEMO_OFFERS` fixture dependency in `flight_results_controller.js` with live `GET /api/flights` and `GET /api/flights/filter-options` calls.
   - Preserve all sorting, filtering, loading skeletons, empty states, and `Edit Search` state restoration.
   - Route `"Select Flight"` directly to `/flights/offer/<real_flight_id>` with search context query params.
3. **Live Offer Details (`templates/pages/offer_details.html`)**
   - Hydrate offer itinerary, airline metadata, baggage rules, and itemized fare breakdown from `GET /api/flights/<id>` and `POST /api/flights/fare-breakdown`.
4. **Airline Flight Schedule CRUD API (`fly/routes/admin.py`)**
   - Implement `POST /api/airline/flights`, `PUT /api/airline/flights/<id>`, `DELETE /api/airline/flights/<id>` strictly scoped to `user['airlineId']`.

**Definition of Done:** Searching routes from `/` renders real database flights on `/flights/search`, filters dynamically, and opens real `/flights/offer/<id>` details.

---

## Sprint 3: Seat Inventory & Concurrency Control

**Sprint Goal:** Guarantee zero double-bookings under concurrent requests and deliver a real aircraft seat-selection experience inside `/booking/extras`.

### User Stories & Tasks
1. **Fix Double-Booking Vulnerability (`database.py` / `fly/services/seat_service.py`)**
   - Rebuild `idx_active_seat_reservation` partial unique index to enforce `WHERE status IN ('PENDING_PAYMENT', 'HELD', 'CONFIRMED')`.
   - Wrap `hold_seats_atomic()` in `BEGIN IMMEDIATE` (SQLite) / `SELECT ... FOR UPDATE` (PostgreSQL).
   - Deduplicate `seatIds`, validate against active `'PENDING_PAYMENT'` holds in `/api/bookings/validate`, and support round-trip `returnSeatIds` atomically in the same transaction.
2. **Real Interactive Seat Map in Extras (`templates/pages/extras.html`, `static/js/seat_selection.js`)**
   - Fix `stepper` active step on `extras.html` (`extras` / `travellers` alignment).
   - Replace hardcoded `12A/12B/1A` radios with live aircraft cabin grid rendered from `GET /api/flights/<id>/seats` showing `AVAILABLE`, `HELD` (mine vs others), and `BOOKED` states.
   - Enforce passenger seat count matching (`adults + children`).

**Definition of Done:** Concurrent hold test (`2` threads requesting the same seat simultaneously) results in exactly `1` HTTP `201` hold and `1` HTTP `409 SEAT_UNAVAILABLE`; expired holds auto-release after 15 minutes.

---

## Sprint 4: Booking, Checkout & Ticket Generation

**Sprint Goal:** Replace client-only `CheckoutStore` simulations with live backend holds, fare revalidation, payment confirmation, PNR assignment, and e-ticket issuance.

### User Stories & Tasks
1. **Checkout Store Synchronization (`static/js/checkout_store.js`, `templates/pages/travellers.html`, `templates/pages/review.html`)**
   - Persist traveller details to `sessionStorage` without leaking PII to `localStorage`.
   - On `/booking/review`, execute `POST /api/bookings/validate` (alerting user on `FARE_CHANGED`) and `POST /api/bookings/hold` on submission to lock seats in SQLite and store `bookingReference`.
   - Require sign-in (with seamless return URL redirect) before `POST /api/bookings/hold`.
2. **Real Payment Checkout & Idempotent Confirmation (`templates/pages/payment.html`, `templates/pages/payment_result.html`)**
   - Fetch real booking & live `secondsRemaining` from `GET /api/bookings/<ref>`.
   - Submit `POST /api/bookings/confirm` to atomically transition `bookings` & `reservations` to `'CONFIRMED'`, generate a unique 6-char `pnr_code` and 13-digit e-ticket rows in `tickets`, and redirect to `/booking/status/<ref>`.
3. **Live Boarding Pass & Ticket Retrieval (`templates/pages/booking_status.html`, `fly/services/ticket_service.py`)**
   - Hydrate `/booking/status/<ref>` from `GET /api/reservations/ticket/<ref>` displaying real PNR, e-ticket number(s), passenger names, flight legs, seat codes, and print action.
   - Gate/remove QA simulation panels (`booking_status.html`, `review.html`) from standard customer view.

**Definition of Done:** A full checkout creates real rows in `bookings`, `booking_passengers`, `reservations`, and `tickets`, and renders an accurate printable boarding pass.

---

## Sprint 5: Passenger Dashboard & Admin Management

**Sprint Goal:** Connect `/my-bookings`, `/manage-booking`, and `/admin` to live SQLite/PostgreSQL data with strict customer and airline isolation.

### User Stories & Tasks
1. **Dynamic My Bookings Dashboard (`templates/pages/my_bookings.html`, `static/js/my_bookings.js`)**
   - Replace hardcoded `BK-DAC-7788` card with live `GET /api/reservations/my` rendering:
     - Active `PENDING_PAYMENT` holds with live countdowns + **Complete Payment** / **Release Seats** (`POST /api/bookings/cancel`).
     - `CONFIRMED` bookings with **View Boarding Pass** & **Request Cancellation/Refund**.
     - `EXPIRED` / `CANCELLED` history.
2. **Real PNR Self-Service Lookup (`templates/pages/manage_booking.html`, `static/js/manage_booking.js`, `fly/routes/bookings.py`)**
   - Implement `POST /api/bookings/lookup` matching `reference/PNR + passenger lastName`.
   - Replace hardcoded `action="/booking/status/BK-DAC-7788"` form with live lookup results, ticket access, and refund request submission (`POST /api/bookings/<ref>/refund-request`).
3. **Live Airline Admin & Operations Portal (`templates/pages/admin_operations.html`, `static/js/admin_console.js`, `fly/routes/admin.py`)**
   - Remove public `adminRoleSelect` role simulation and enforce server-side `@require_roles('AIRLINE_ADMIN', 'SUPER_ADMIN')`.
   - Wire dashboard KPIs, flight schedule CRUD, tenant-scoped bookings (`/api/admin/all-bookings`), refund approval/rejection (`/api/admin/refunds/*`), and `admin_audit_logs` viewer to real SQLite/PostgreSQL endpoints.

**Definition of Done:** Passengers only see their own trips; guests can look up trips only with exact PNR + surname; `Admin_Biman` only sees/manages `BG` flights, bookings, and refunds, while `Admin_USB` only sees/manages `BS`.

---

## Sprint 6: Security, Integration, Testing & Final QA

**Sprint Goal:** Prove end-to-end correctness, security boundaries, concurrency safety, PostgreSQL readiness, and cross-viewport responsiveness.

### Verification & Hardening Tasks
1. **Security & Isolation Regression Suite**
   - Automated tests verifying `401`/`403` on unauthenticated `/admin` & `/api/v1/admin/*`, IDOR rejection on `/api/reservations/ticket/<other_ref>`, and cross-airline isolation (`Admin_USB` denied access to `Admin_Biman` bookings/flights/refunds).
   - Verify no raw `CVV` stored and no PII/passport leaked in `localStorage`.
2. **Concurrency & Expiration Stress Test**
   - Automated multi-threaded/async test racing concurrent `POST /api/bookings/hold` requests on the same seat + verifying automatic release after `expires_at`.
3. **End-to-End Integration Journey Test**
   - Register -> Login -> Search -> Offer -> Travellers -> Extras/Seat Map -> Review/Validate/Hold -> Payment Confirm -> Boarding Pass -> My Bookings -> PNR Lookup -> Refund Request -> Airline Admin Approval -> Logout.
4. **PostgreSQL DDL Verification & Production Config Check**
   - Validate schema DDL from `DATABASE_DESIGN.md` against PostgreSQL (when `DATABASE_URL` is configured) and ensure `requirements.txt`, `.env.example`, and `start.bat` align cleanly.
5. **UI/UX, Accessibility & Visual QA**
   - Run `node tests/ui_accessibility_and_responsive.test.js` and verify desktop (`1440px`), tablet (`768px`), and mobile (`390px`) views across light and dark modes with zero console errors or horizontal overflow.

**Definition of Done:** 100% pass across concurrency, security/RBAC, E2E booking, and accessibility/responsive test suites.
