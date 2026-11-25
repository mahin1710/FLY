# FLY Flight Ticketing System — Complete Codebase Audit

**Audit Date:** 2026-11-26  
**Workspace Root:** `c:\Users\mahed\Desktop\FLY`  
**Audit Scope:** Full-stack inspection of frontend templates/scripts, Python Flask backend, SQLite databases, legacy directories (`Skynet-master/`, `backend/`), Netlify wrapper, assets, and dependencies.  
**Audit Rule Compliance:** Read-only audit; zero existing source files modified or deleted.

---

## 1. Existing Architecture & Technology Stack

The active runtime application served by `start.bat` (`python app.py` on port `5000`) is a **Python Flask monolith** using **Jinja2 server-rendered pages**, **Vanilla JavaScript**, **custom CSS3**, and **SQLite** (WAL mode).

However, the repository currently contains **three co-existing stacks** from earlier iterations:

| Layer / Stack | Location | Actual Technologies | Current Runtime Role |
| :--- | :--- | :--- | :--- |
| **Primary Web App & API (Active)** | `app.py` (1,551 lines), `database.py` (753 lines), `templates/`, `static/` | Python 3, Flask (`>=3.0.0`), Jinja2, SQLite (`database/flight_booking.db`, 10.56 MB), Vanilla JS, CSS3 | **Active runtime** served on `http://localhost:5000` |
| **Legacy Prototype & Netlify Target** | `Skynet-master/Skynet-master/web/`, `netlify/functions/api.js`, `netlify.toml` | Node.js, Express (`^5.3.0`), `serverless-http`, `cors`, SQLite (`database.db`, 10.56 MB) | **Unused locally**, but still targeted by `netlify.toml` & `netlify/functions/api.js` |
| **Unconnected Admin/API Subsystem** | `backend/`, `backend/database/database.sqlite` (0.75 MB, 42 tables) | PHP / Laravel, Composer, Vite | **Not running locally** (`app.py:1471` tries proxying `/api/v1/admin/*` to `127.0.0.1:8000` and falls back to `backend/database/database.sqlite` or static JSON) |

### Architecture Suitability Verdict
- **Keep Python Flask + Jinja2 + Vanilla JS + SQLite** as the unified platform core. It already handles server-side routing, `scrypt` authentication, airport/flight queries, fare breakdown, seat map queries, atomic holds, and boarding-pass generation cleanly without framework overhead.
- **Root Architectural Problem:** The frontend multi-page checkout & management flow (`templates/pages/*.html` + `checkout_store.js` + `flight_results_controller.js`) was built around client-side fixtures and `sessionStorage`, leaving the real Flask + SQLite booking/reservation APIs mostly disconnected from the UI.

---

## 2. Complete Feature Inventory

### 2.1 Fully Working Features
1. **Global Shell, Fixed Header, Theme & Navigation** (`templates/base.html`, `static/css/style.css`, `static/js/shell.js`)
   - Fixed 3-area header across all `templates/pages/*.html`, automatic active route indicator via Jinja2 `request.path`, mobile drawer with focus trap, `localStorage` dark/light mode toggle (`fly_theme`) without FOUC, and right-side account dropdown.
2. **Airport Search & Autocomplete API** (`app.py:350-418`, `static/js/flight_search_widget.js`)
   - Real SQLite lookup across 5,928 airports (`GET /api/airports/search`) prioritizing Bangladesh hubs and major international gateways.
3. **Authentication API (`scrypt` + Bearer Tokens)** (`app.py:204-345`, `database.py:48-76, 178-207`)
   - `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `GET /logout`, `GET /api/auth/demo-users`. Issues 7-day tokens stored in `auth_sessions` (`172` rows) and clears cookies/cache headers on `/logout`.
4. **Backend Flight Search, Enrichment & Fare Breakdown APIs** (`app.py:423-886`, `database.py:311-425`)
   - `GET /api/flights`, `GET /api/flights/<id>`, `GET /api/flights/featured`, `GET /api/flights/filter-options`, `GET/POST /api/flights/fare-breakdown` query 993 flights and 978 airlines cleanly.
5. **Backend Seat Map & Expiration Engine** (`database.py:212-309`, `app.py:830-845`)
   - `GET /api/flights/<id>/seats` and `cleanup_expired_holds()` release expired `PENDING_PAYMENT` holds automatically.

### 2.2 Partially Working Features
1. **Login / Auth Portal** (`templates/pages/auth.html`)
   - Passenger login (`Mahin0`, `Mahin1`) works against `/api/auth/login` and redirects to `/my-bookings`.
   - **Broken button:** The "Airline Admin" quick-fill button (`auth.html:39`) fills `AirlineAdmin` / `AirlineAdmin`, which does **not** exist in `database.py:183-188` (actual seeded admins are `Admin_Biman` and `Admin_USB`).
   - `/register` and `/profile` routes (`app.py:163-169`) render the same `auth.html` login screen — registration and profile editing are unimplemented.
2. **Seat Selection & Hold Flow** (`templates/seat_selection.html`, `static/js/seat_selection.js`)
   - Only reachable at legacy `/seat-selection` and hits real `/api/flights/<id>/seats` and `/api/bookings/hold`, but uses its own duplicated header (`seat_selection.html:10-24`) instead of `base.html`, hardcodes `flightId = 1` unless passed, and is bypassed by the active `/booking/extras` page.
3. **Admin Operations Console** (`templates/pages/admin_operations.html`, `static/js/admin_console.js`, `app.py:1455-1517`)
   - UI renders 12 operational modules, role matrix, and modals, and fetches `GET /api/v1/admin/dashboard`. All detail tables (bookings, ticketing queue, refunds, users, approvals, pricing, banners) fall back to hardcoded client-side mock arrays, and it never queries `/api/admin/all-bookings` or `/api/airline/flights`.
4. **Homepage Search Widget** (`templates/pages/home.html`, `static/js/flight_search_widget.js`, `static/js/app.js`)
   - Loads both `app.js` (5,191 lines) and `flight_search_widget.js` (1,003 lines). Autocomplete and redirect to `/flights/search?...` work, while Hotels / Experiences / Car Rental tabs open partner informational modals.

### 2.3 Broken / Disconnected Features
1. **Flight Search Results Page** (`templates/pages/flight_search.html`, `static/js/flight_results_controller.js`)
   - Completely disconnected from `GET /api/flights`. `loadOffers()` (`flight_results_controller.js:110-123`) only queries static `DEMO_OFFERS` from `static/js/flight_fixtures.js`. Searches for routes not in `DEMO_OFFERS` fall back or fail to show real SQLite flights.
2. **Multi-Step Booking Checkout Flow** (`offer_details.html`, `travellers.html`, `extras.html`, `review.html`, `payment.html`, `booking_status.html`, `static/js/checkout_store.js`)
   - Entirely client-side `sessionStorage` (`fly_checkout_state_v1`). Never calls `POST /api/bookings/validate`, `POST /api/bookings/hold`, or `POST /api/bookings/confirm`. Selecting `confirm` calls `store.completeDemoPayment(method)` (`payment.html:236`) without creating any SQLite `bookings` or `reservations` record.
3. **My Bookings Page** (`templates/pages/my_bookings.html`)
   - Renders a single hardcoded HTML card (`BK-DAC-7788`, `Mahin Rahman`, `৳4,950`). Never fetches `GET /api/reservations/my` for the logged-in user and has no dynamic cancel/pay/ticket actions.
4. **Manage Booking (PNR Retrieval)** (`templates/pages/manage_booking.html`)
   - Hardcoded `<form action="/booking/status/BK-DAC-7788" method="GET">` (`manage_booking.html:29`). Ignores user-entered PNR/booking reference and surname; no backend PNR verification endpoint exists.
5. **User Registration & Profile Management** (`app.py:163-169`, `templates/pages/auth.html`)
   - `/register` and `/profile` serve the login form; `POST /api/auth/register` and `GET/PUT /api/auth/profile` do not exist.
6. **Booking Status & Digital Boarding Pass** (`templates/pages/booking_status.html`)
   - Hydrates from `CheckoutStore` (`sessionStorage`) with hardcoded fallback (`BK-DAC-7788`), not `GET /api/bookings/<ref>` or `GET /api/reservations/ticket/<id>`.

### 2.4 Duplicate Features & Code
- `static/js/main.js` (5,181 lines) is an almost exact duplicate of `static/js/app.js` (5,191 lines; sequence similarity ~1.0 on header block) and is unreferenced in any template.
- **Duplicate Booking/Payment/Legacy Views:**
  - `templates/index.html` (`/spa`) duplicates the old single-page application.
  - `templates/my_bookings.html` and `templates/payment.html` duplicate `templates/pages/my_bookings.html` and `templates/pages/payment.html` (`app.py` routes exclusively to `templates/pages/*`).
  - `static/js/payment.js` (240 lines) is only referenced by the unused root `templates/my_bookings.html` and `templates/payment.html`.
- **Duplicate Databases:**
  - `database/flight_booking.db` (10.56 MB — active Flask DB)
  - `Skynet-master/Skynet-master/web/database.db` (10.56 MB — legacy Node/Netlify copy)
  - `backend/database/database.sqlite` (0.75 MB — Laravel SQLite DB)
- **Duplicate Stepper Step Highlight:** `templates/pages/extras.html:22` renders `current_step='travellers'` (identical to `travellers.html:22`) rather than separating Extras/Seat selection cleanly.

### 2.5 Unnecessary Features / Leftover Scaffolding
- `templates/pages/booking_status.html:24-40` exposes a QA "Lifecycle Simulator" bar (`Confirmed`, `Payment Pending`, `Ticket Pending`, `Expired Offer`, `Provider Unavailable 504`, `Booking Failed`) in the customer confirmation screen.
- `templates/pages/review.html:143-159` exposes a "+Simulate Airline Fare Change (+৳300)" QA button directly in the customer checkout UI.
- `templates/pages/admin_operations.html:18-29` exposes a public `<select id="adminRoleSelect">Simulate Access Role</select>` dropdown allowing any visitor to simulate `Super Administrator`.
- `Skynet-master/` nested twice (`Skynet-master/Skynet-master/web/...`) and `backend/` (full PHP/Laravel tree + `vendor/` + `node_modules/`).

### 2.6 Unused Pages & Components
- **Unused Root Templates:** `templates/my_bookings.html` (0 active Flask routes), `templates/payment.html` (0 active Flask routes).
- **Unused Jinja Components (`templates/components/`):**
  - `card.html` (0 template references)
  - `error_banner.html` (0 template references)
  - `loading_state.html` (0 template references)
- **Unused JS Modules (`static/js/`):** `main.js` (0 template references), `payment.js` (only referenced by unused root templates).

### 2.7 Unused Images & Assets (`static/images/`)
Out of 14 files in `static/images/`, **8 have zero references** across `templates/`, `static/css/`, `static/js/`, and `app.py`:
- Unused (8): `duke.ico` (56.3 KB), `fly_icon.png` (0.9 KB), `fly_logo.png` (1.8 KB), `fly_logo_dark.svg` (1.8 KB), `fly_logo_light.png` (1.8 KB), `fly_logo_light.svg` (1.5 KB), `SkynetLogo.ico` (112.4 KB), `SkynetLogo.png` (6.5 KB).
- Referenced (6): `default_logo.png` (13 refs), `favicon.png` (2 refs), `fly_icon.svg` (10 refs), `fly_logo.svg` (1 ref), `hero_airport_sunset.jpg` (1 ref), `ProfilePicture.png` (6 refs).

### 2.8 Unused / Mismatched Dependencies
- Root `package.json` declares `express` (`^5.3.0`), `cors` (`^2.8.6`), and `serverless-http` (`^4.0.0`), none of which are used by the Python Flask app (`app.py`); they exist solely for `netlify/functions/api.js` -> `Skynet-master`.
- Root `requirements.txt` only lists `Flask>=3.0.0` (missing production WSGI server like `gunicorn` / `waitress`, `python-dotenv`, or test runner pinning).
- `backend/composer.json` and `backend/package.json` belong to the inactive Laravel tree.

### 2.9 Security Weaknesses (Verified in Code)
1. **Unauthenticated Admin Console & Proxy Endpoint (`CRITICAL`):**
   - `GET /admin` and `GET /admin/operations` (`app.py:1455-1459`) have no authentication or role validation.
   - `app.py:1461-1517` (`/api/v1/admin/<subpath>`) performs **zero authentication (`get_current_user()`) and zero role authorization**, letting unauthenticated users read operational stats or hit Laravel proxy paths.
2. **IDOR on Ticket Retrieval (`CRITICAL`):**
   - `GET /api/reservations/ticket/<ticket_id>` (`app.py:1271-1293`) checks `get_current_user()` but **never checks booking ownership (`id_account`) or airline scope**. Any authenticated passenger can read any other passenger's ticket/boarding pass.
3. **Cross-Airline Admin Tenant Isolation Bypass (`HIGH`):**
   - `api_get_booking` (`app.py:1078`), `api_cancel_booking` (`app.py:1197`), and `confirm_payment_atomic` (`database.py:610`) only enforce `id_account == user['id']` when `user['role'].upper() == 'PASSENGER'`. An `AIRLINE_ADMIN` from Airline A (`id_airline=371`) can read, confirm, or cancel bookings belonging to Airline B (`id_airline=839`).
4. **Plaintext Passwords for 1,979 Legacy Accounts (`HIGH`):**
   - Out of `1,983` accounts in `database/flight_booking.db`, only **4** use `scrypt:` hashes while **1,979** do not have `scrypt:` prefixes, and `database.py:75-76` (`verify_password`) permits plaintext password comparison.
5. **978 Airline Accounts Tagged as `PASSENGER` (`HIGH`):**
   - `978` rows in `accounts` have `id_airline IS NOT NULL` (`admin_I4`, `admin_BA`, etc.) with `role = 'PASSENGER'`, inconsistent with RBAC rules.
6. **Raw Card Data Columns (`HIGH`):**
   - `creditCards` table stores `cardNumber`, `expirationDate`, and `CVV` in plaintext (`app.py:1298-1330`), and `POST /api/cards` inserts raw card numbers without masking/tokenization.
7. **Hardcoded Fallback Secret Key & Missing CSRF/Rate-Limiting (`MEDIUM`):**
   - `app.py:25` falls back to `'fly_aviation_secret_token_2026_super_secret'`. No rate limiting on `/api/auth/login` or `/api/bookings/hold`.
8. **Cross-User Favorite Probing (`LOW`):**
   - `app.py:675, 765-770` reads `accountId` from query parameters without matching it to the authenticated user, exposing whether another `accountId` favorited a flight.

### 2.10 Missing Core Airline Ticketing Functionality
- **Public PNR + Surname Lookup API:** `GET/POST /api/bookings/lookup` verifying PNR/booking reference + passenger surname safely without leaking unauthorized bookings.
- **User Registration & Profile Update APIs:** `POST /api/auth/register`, `GET/PUT /api/auth/profile`, password change flow.
- **Dedicated E-Ticket / PNR Issuance Model:** Currently `booking_reference` (`BK-<id>-<hex>`) is generated on hold (`database.py:528`), while no separate 6-character PNR or 13-digit ticket number is generated or persisted upon payment confirmation.
- **Refund / Reschedule / Modification Requests:** Only immediate seat cancellation (`POST /api/bookings/cancel`) exists; no refund quote/request tracking or flight rescheduling workflow.
- **Airline Admin Flight & Booking Management UI:** No active UI connected to `POST/PUT/DELETE` flight CRUD or `/api/admin/all-bookings`, `/api/airline/flights`, `/api/airline/stats`.
- **Multi-Leg & Return Flight Seat Reservations:** `hold_seats_atomic()` (`database.py:554-558`) stores `return_flight_id` / `multi_leg_data` metadata on `bookings`, but only reserves `seat_ids` on the outbound `flight_id`! Return/connecting legs do not get seat holds or seat deductions.

---

## 3. Code Bugs & Runtime Defects Found

| Severity | File & Line | Defect Description |
| :--- | :--- | :--- |
| **CRITICAL** | `database.py:557` vs SQLite `idx_active_seat_reservation` | Unique index `idx_active_seat_reservation` filters `WHERE status IN ('HELD', 'CONFIRMED')`, whereas `hold_seats_atomic()` inserts `'PENDING_PAYMENT'`. Thus concurrent holds on the same seat bypass the unique constraint. |
| **CRITICAL** | `database.py:436-467` | `hold_seats_atomic()` uses SQLite's default `DEFERRED` transaction instead of `BEGIN IMMEDIATE`, allowing a read-check-insert race condition between concurrent users booking the same seat. |
| **HIGH** | `app.py:777` | `api_search_flights` counts `bookedCount` using `status IN ('CONFIRMED', 'HELD')`, missing active `'PENDING_PAYMENT'` seat holds. |
| **HIGH** | `app.py:1099`, `app.py:1263` | Direct `datetime.strptime(..., "%Y-%m-%d %H:%M:%S")` without handling ISO strings (`T`, `Z`, fractional seconds) or `try/except`, risking `ValueError` 500 crashes if formats vary. |
| **HIGH** | `templates/pages/manage_booking.html:29` | Form submits `GET /booking/status/BK-DAC-7788` with hardcoded action regardless of user input. |
| **HIGH** | `templates/pages/my_bookings.html:30-77` | Hardcoded static booking card; never calls `GET /api/reservations/my`. |
| **HIGH** | `templates/pages/auth.html:39` | Admin demo button uses invalid username `'AirlineAdmin'` instead of `'Admin_Biman'` or `'Admin_USB'`. |
| **MEDIUM** | `app.py:889-974` & `app.py:1018` | `seatIds` validation in `/api/bookings/validate` checks `status = 'CONFIRMED'` only (ignoring active `PENDING_PAYMENT` holds), and duplicate `seat_ids` in a single payload are not deduplicated. |
| **MEDIUM** | `static/js/flight_results_controller.js:110` | Completely ignores `GET /api/flights`; renders static `flight_fixtures.js` data only. |
| **MEDIUM** | `static/js/checkout_store.js` | Stores and confirms demo bookings purely in `sessionStorage` without calling backend hold/confirm endpoints. |

---

## 4. Database Audit (`database/flight_booking.db`)

### 4.1 Current Table Inventory (10 Tables)
| Table | Rows | Primary Key | Foreign Keys | Existing Indexes | Notes |
| :--- | :---: | :--- | :--- | :--- | :--- |
| `accounts` | 1,983 | `id` | `id_airline -> airLines(id)`, `id_passenger -> passengers(id)` | `sqlite_autoindex_accounts_1` (unique) | 1,979 legacy passwords not `scrypt:` hashed; 978 airline rows have `role='PASSENGER'` |
| `airLines` | 978 | `id` | None | None | Stores airline `name`, `IATA`, `logo` BLOB |
| `airports` | 5,928 | `id` | None | None | Missing indexes on `IATA`, `city`, `country` |
| `auth_sessions` | 172 | `token` | `account_id -> accounts(id) ON DELETE CASCADE` | `idx_sessions_token`, `idx_sessions_account` | Clean session store |
| `bookings` | 258 | `id` | `id_flight -> flights(id) ON DELETE CASCADE`, `id_account -> accounts(id)` | `idx_bookings_account`, `idx_bookings_status_expires`, unique `booking_reference` | Missing `return_flight_id` FK, `pnr_code`, `updated_at`; `CONFIRMED` 79, `EXPIRED` 80, `CANCELLED` 99 |
| `creditCards` | 8 | `id` | `id_account -> accounts(id)` | None | Stores plaintext `cardNumber` and `CVV` |
| `favorites` | 1 | `id` | `id_account -> accounts(id)`, `id_flight -> flights(id)` | None | Missing `UNIQUE(id_account, id_flight)` |
| `flights` | 993 | `id` | `id_airline -> airLines(id)`, `dep_airport -> airports(id)`, `arr_airport -> airports(id)` | None | Missing indexes on `(dep_airport, arr_airport, dep_datetime)` and `id_airline` |
| `passengers` | 1,004 | `id` | None | None | Linked from `accounts.id_passenger`; not linked per-booking/per-ticket |
| `reservations` | 40,057 | `id` | `id_flight -> flights(id)`, `id_seat -> seats(id)`, `id_account -> accounts(id)` | `idx_active_seat_reservation` (`status IN ('HELD','CONFIRMED')`), `idx_res_flight_status`, `idx_res_booking_ref`, `idx_res_status_expires` | `CONFIRMED` 39,828, `EXPIRED` 82, `CANCELLED` 147 |
| `seats` | 120 | `id` | None | None | Global 120-seat template (`row`, `column`, `type`); missing unique `(row, column)` |

*(Note: 11 total tables including `bookings`, `reservations`, `accounts`, `auth_sessions`, `flights`, `airLines`, `airports`, `passengers`, `seats`, `creditCards`, `favorites`.)*

### 4.2 Database Weaknesses Summary
1. **Double-Booking Vulnerability (Index + Transaction Mismatch):**
   - `idx_active_seat_reservation` enforces uniqueness only for `status IN ('HELD', 'CONFIRMED')`, while `database.py` inserts `'PENDING_PAYMENT'`. Fix: recreate index on `WHERE status IN ('PENDING_PAYMENT', 'HELD', 'CONFIRMED')` and wrap `hold_seats_atomic()` / `confirm_payment_atomic()` in `BEGIN IMMEDIATE` transactions.
2. **Missing Query Performance Indexes:**
   - `flights` (993 rows) has **0 indexes** (`dep_airport`, `arr_airport`, `dep_datetime`, `id_airline`).
   - `airports` (5,928 rows) has **0 indexes** (`IATA`, `city`, `country`).
   - `favorites` has no `UNIQUE(id_account, id_flight)`.
   - `bookings` lacks an index on `id_flight` (used by airline admin queries) and FK/index on `return_flight_id`.
3. **Missing Relational Data for Real Airline Ticketing:**
   - No `tickets` table (separate 13-digit e-ticket numbers per passenger/leg) or `pnr_code` column on `bookings`.
   - No `booking_passengers` / normalized traveller records (`passenger_data` is a JSON text blob in `bookings`).
   - No `refund_requests` / `cancellations` or `audit_logs` tables in `flight_booking.db`.
4. **Duplicate Databases Across Repo:**
   - Keeping `database/flight_booking.db`, `Skynet-master/Skynet-master/web/database.db`, and `backend/database/database.sqlite` risks drift and confusion over the source of truth.
5. **Airline Data Isolation Gaps:**
   - `978` legacy airline-linked accounts have `role='PASSENGER'`, and single-booking endpoints (`api_get_booking`, `api_cancel_booking`, `api_get_ticket`) do not verify `booking.airlineId == user.airlineId` for `AIRLINE_ADMIN` callers.

---

## 5. Recommended Final Architecture

```text
+-------------------------------------------------------------------+
|  Browser UI (Jinja2 + Base Shell + Vanilla JS + Custom CSS3)      |
|  - templates/base.html + templates/pages/*.html                   |
|  - Real API-wired JS controllers (search, checkout, bookings,     |
|    manage-booking, auth/profile, airline-admin portal)            |
+---------------------------------+---------------------------------+
                                  | HTTP + JSON + Bearer Auth / Cookie
+---------------------------------v---------------------------------+
|  Python Flask Application Layer (app.py + modular Blueprints)     |
|  - Auth & RBAC Middleware (PASSENGER, AIRLINE_ADMIN, SUPER_ADMIN) |
|  - Flight Search, Fare Engine, Seat Map & Hold APIs               |
|  - Payment Verification, Ticket/PNR Issuance & Self-Service PNR   |
|  - Tenant-Scoped Airline & Operations Admin APIs                  |
+---------------------------------+---------------------------------+
                                  | BEGIN IMMEDIATE + WAL + Indexes
+---------------------------------v---------------------------------+
|  Single Source of Truth: SQLite (`database/flight_booking.db`)    |
|  - Core: accounts, auth_sessions, airLines, airports, flights,    |
|    seats, bookings, reservations                                  |
|  - Additions: tickets, refund_requests, admin_audit_logs          |
+-------------------------------------------------------------------+
```

**Key Architectural Decisions:**
1. **Standardize on Python Flask + Jinja2 + SQLite** as the sole active runtime; stop referencing `backend/` (Laravel) and `Skynet-master/` in live routes (`api_v1_admin_proxy`).
2. **Connect all `templates/pages/*.html` directly to Flask SQLite APIs** instead of static `flight_fixtures.js` or `sessionStorage`-only mocks.
3. **Quarantine / Archive Legacy Code** (`Skynet-master/`, `backend/`, unused root templates, unused `main.js`/`payment.js`, and 8 unused image files) after verifying zero active references.
4. **Follow the phased plan in [IMPLEMENTATION_ROADMAP.md](file:///c:/Users/mahed/Desktop/FLY/IMPLEMENTATION_ROADMAP.md).**
