# FLY Flight Booking & Ticket Management System — Final Project Report

**Project:** FLY Flight Reservation & Ticket Management System  
**Author:** `mahin1710`  
**Workspace:** `c:\Users\mahed\Desktop\FLY`  
**Verification Date:** 2026-11-26  

---

## 1. Executive Summary

FLY has been engineered into a full-stack airline ticketing platform supporting live flight search, interactive cabin seat maps with atomic 10-minute concurrency locks, promotional pricing, idempotent payment processing, official QR-verifiable PDF e-tickets, passenger self-service portals, and strictly isolated airline operations dashboards.

All automated concurrency, security, end-to-end, and UI route/asset tests ran cleanly against the active server (`13 / 13` passing via `python -m unittest discover -s tests -p "test_*.py" -v` in `3.613s`), including a 20-thread simultaneous contention stress test on the same flight seat (`1` winner, `19` `409 Conflict` rejections).

---

## 2. Final Implemented Architecture

- **Backend Entrypoint & Configuration:**
  - `app.py` — Flask Blueprint registration, security/CORS response headers, and `30s` background seat-lock expiry daemon (`_start_lock_expiry_scheduler`).
  - `config.py` — Environment-driven configuration (`SEAT_LOCK_MINUTES=10`, `SEAT_EXTENSION_MINUTES=2`, `MAX_LOCK_EXTENSIONS=1`, `LOCK_SWEEP_INTERVAL_SECONDS=30`, `SESSION_TTL_DAYS`).
- **Modular Blueprints & Services (`fly/`):**
  - `fly/middleware/auth.py` — Session token verification (`auth_sessions`), sliding-window IP rate limiter, `@require_auth`, `@require_roles`, and `verify_booking_access`.
  - `fly/services/pdf_service.py` — Pure-Python `%PDF-1.4` e-ticket generator (`build_ticket_pdf`) and QR verification SVG generator (`generate_qr_svg`).
  - `fly/routes/pages.py` — HTML route separation across Public, Passenger, and Admin consoles, plus clean redirects from legacy step routes to `/checkout`.
  - `fly/routes/auth.py` — Login, passenger registration, profile/password update, and logout.
  - `fly/routes/catalog.py` — Airport autocomplete, popular routes (`GET /api/flights/popular-routes`), flight search (`GET /api/flights`), filter options, live seat map (`GET /api/flights/<id>/seats` & SSE stream), fare breakdown, and promo validation (`FLY10`, `DHAKA500`).
  - `fly/routes/bookings.py` — Atomic seat hold (`POST /api/bookings/hold`), +2 min extension (`POST /api/bookings/<ref>/extend-lock`), checkout detail/addon persistence (`PUT /api/bookings/<ref>/details`), idempotent payment (`POST /api/bookings/confirm`), guest PNR lookup (`POST /api/bookings/lookup`), cancellation/refunds, ticket PDF/QR verification, saved travelers, and masked cards.
  - `fly/routes/admin.py` — Role-guarded & airline-isolated KPIs (`GET /api/admin/dashboard`), flight CRUD (`GET/POST/PUT/DELETE /api/airline/flights`), bookings & refund decisions, live seat inventory inspector, concurrency audit logs, and baggage/promo settings.
- **Database Layer (`database.py` & `database/`):**
  - Active SQLite WAL engine (`database/flight_booking.db`) using `BEGIN IMMEDIATE` write transactions and partial unique index `idx_active_seat_reservation` (`WHERE status IN ('PENDING_PAYMENT','HELD','LOCKED','CONFIRMED')`).
  - PostgreSQL migration & repeatable seed scripts shipped at `database/migrations/001_postgres_schema.sql` and `database/seeds/seed_postgres.sql`.
- **Frontend Modules (`templates/pages/` & `static/js/`):**
  - `api_client.js` (centralized authenticated fetch wrapper), `shell.js` (responsive theme & account header), `auth.html` / `auth_portal.js`, `flight_search.html` / `flight_results_controller.js`, `seat_map.html` / `seat_selection.js`, `checkout.html` / `checkout_portal.js`, `ticket.html`, `ticket_verify.html`, `booking_status.html`, `my_bookings.html` / `my_bookings.js`, `manage_booking.html` / `manage_booking.js`, `admin_operations.html` / `admin_console.js`.

---

## 3. Verification & Test Evidence

### Automated Test Execution (`python -m unittest discover -s tests -p "test_*.py" -v`)
**Result:** `Ran 13 tests in 3.613s — OK`

1. **Concurrency & Double-Booking Suite (`tests/concurrency/test_concurrent_seat_locks.py`):**
   - `test_01_twenty_simultaneous_holds_same_seat` — 20 concurrent threads submitted `POST /api/bookings/hold` for the identical `(flight_id, seat_id)`. Exactly **1** received HTTP `201 Created`; **19** received HTTP `409 Conflict` (`SEAT_UNAVAILABLE`); database confirmed strictly 1 active reservation row.
   - `test_02_atomic_multi_seat_rollback` — Verified multi-seat requests containing one unavailable seat roll back completely so free seats remain `AVAILABLE`.
   - `test_03_expired_lock_auto_releases_seat` — Backdated lock expiry and verified automatic sweep releases the seat for subsequent booking.
2. **Security, RBAC & Isolation Suite (`tests/integration/test_security_rbac_isolation.py`):**
   - Verified `/login` does not leak sample credentials or passwords (`test_01`).
   - Verified unauthenticated requests fail `401` (`test_02`) and passengers hitting admin endpoints fail `403` (`test_03`).
   - Verified cross-airline isolation: `Admin_Biman` attempting to read or mutate `Admin_USB` resources fails `403` (`test_04`).
   - Verified cross-passenger IDOR rejection (`test_05`), server-side rejection of client fare tampering (`test_06`), payment failure/timeout seat release, and payment idempotency replay (`test_07`).
3. **End-to-End Lifecycle (`tests/e2e/test_full_booking_journey.py`):**
   - Verified full flow: Register passenger -> Search `DAC -> CXB` -> Seat inspection -> Hold seat -> Extend lock (+2 min) -> Update passenger info + extras + `FLY10` promo -> Payment confirmation -> Retrieve 6-char PNR + QR SVG -> Download `%PDF-1.4` e-ticket -> Public token verify -> Guest PNR lookup -> Cancellation & seat release.
4. **UI Pages, Static Assets & Responsive Rules (`tests/ui/test_ui_assets_and_pages.py`):**
   - Verified all 19 HTML routes return HTTP `200 OK`, render cleanly with `/js/api_client.js` & `/js/shell.js`, contain zero legacy mock references (`checkout_store.js`, `flight_fixtures.js`, `demo_notice`), resolve all `/js/`, `/css/`, and `/images/` assets with HTTP `200`, and include responsive CSS breakpoints (`@media (max-width:` and `@media print`).

---

## 4. Environment & Known Limitations

- **Live PostgreSQL Execution (`BLOCKED` locally):** `psql`, PostgreSQL service port `5432`, and Docker are not installed on this Windows machine, preventing live PostgreSQL server execution during local QA. All ACID concurrency guarantees were validated directly against SQLite WAL (`BEGIN IMMEDIATE`), while equivalent PostgreSQL schema/locking migrations are provided under `database/migrations/001_postgres_schema.sql`.
- **Headless Browser DOM Rendering:** `node_modules` contains no local `puppeteer`/`playwright` installation; UI availability and asset integrity were verified over live HTTP responses and CSS/HTML inspection (`tests/ui/test_ui_assets_and_pages.py`).
