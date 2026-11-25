# FLY — Independent R&D Architectural, Security & Concurrency Review

**System Evaluated:** FLY Flight Booking & Ticket Management System  
**Repository:** `c:\Users\mahed\Desktop\FLY`  
**Review Scope:** Backend Modularity, Concurrency & Double-Booking Prevention, Security & Tenant Isolation, Frontend Integration, Cleanup & Environment Constraints  

---

## 1. Executive Assessment

The FLY codebase has been transformed from an exploratory single-file prototype (`app.py` monolith + fixture-backed demo pages + disconnected `sessionStorage` checkout) into a modular full-stack airline ticketing system backed by relational ACID seat locking.

### Core Strengths Verified
1. **Strict Double-Booking Prevention:** `database.hold_seats_atomic` opens an immediate write lock (`BEGIN IMMEDIATE`) in SQLite WAL mode, verifies active seat holds against expiration (`expires_at`), writes reservation rows constrained by partial unique index `idx_active_seat_reservation`, and rolls back atomically if any seat in a multi-seat selection fails.
2. **Authoritative Server-Side Pricing:** Client-submitted `fare`, `totalAmount`, or bogus promo values cannot dictate charges; `calculate_fare_breakdown()` recomputes base fares, taxes, configurable baggage policies (`23 kg` domestic / `40 kg` international), add-ons, and promo discounts (`FLY10`, `DHAKA500`) inside the transaction boundary.
3. **End-to-End Ticket Lifecycle:** Includes 10-minute seat locks, single controlled 2-minute lock extension (`MAX_LOCK_EXTENSIONS = 1`), background lock expiry sweep (`30s` scheduler), idempotent simulated payment modes (`SIMULATE_SUCCESS`, `SIMULATE_FAILURE`, `SIMULATE_TIMEOUT`), 6-character PNR generation, embedded SVG QR verification tokens, and pure-Python `%PDF-1.4` e-ticket downloads.
4. **Role & Airline Tenant Isolation:** `fly/middleware/auth.py` and `fly/routes/admin.py` bind `AIRLINE_ADMIN` strictly to `user['airlineId']`. Cross-airline query overrides and cross-passenger IDOR requests are rejected with `403 FORBIDDEN`.
5. **Clean Login Surface:** All hardcoded sample credential hints and auto-fill demo buttons have been removed from `/login`.

---

## 2. Database & Stack Reality vs. Target PostgreSQL Specification

| Component | Target Deliverable | Local Runtime State | Status |
| :--- | :--- | :--- | :--- |
| Backend | Python Flask + Blueprints (`fly/`) | `Flask 3.1.3` active on port `5000` | Verified Running |
| Schema DDL & Seed | PostgreSQL (`001_postgres_schema.sql`, `seed_postgres.sql`) | Shipped & documented | Prepared |
| Active Database | PostgreSQL (`psql`) / SQLite WAL fallback | PostgreSQL server & Docker not installed on Windows host (`psql` missing, port `5432` closed); running on **SQLite WAL** (`database/flight_booking.db`) | **PostgreSQL Live Exec: BLOCKED** (Env missing) / **SQLite ACID: VERIFIED** |

> **Honest Environment Note:** PostgreSQL execution remains blocked locally solely because no PostgreSQL binary/service or container engine exists on this host. Production deployment to PostgreSQL maps directly via `database/migrations/001_postgres_schema.sql` using `SELECT ... FOR UPDATE` row locks + PostgreSQL partial unique index on active reservations.

---

## 3. Identified Risks & Residual Recommendations

1. **In-Memory Rate Limiter Scope:** `_RATE_BUCKETS` in `fly/middleware/auth.py` stores sliding-window timestamps per process. Scaling beyond a single Flask/Gunicorn worker should move rate-limiting counters to Redis.
2. **WSGI Production Server:** Local execution uses Flask's built-in development server (`python app.py`). Production hosting requires `gunicorn` or `waitress` behind HTTPS/TLS with `SESSION_COOKIE_SECURE = True`.
3. **Payment Gateway Sandbox:** Payments simulate Visa/Mastercard/MFS settlement locally using idempotency keys rather than an external live SSLCommerz/Stripe merchant key.
4. **UI Headless Browser Execution:** No `puppeteer`/`playwright` binaries exist in `node_modules`, so rendered DOM & static assets were verified programmatically via HTTP + HTML/CSS/asset test assertions (`tests/ui/test_ui_assets_and_pages.py`) and interactive live checks.
