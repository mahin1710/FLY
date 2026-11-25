# FLY — Flight Booking & Ticket Management System

A full-stack airline reservation, atomic seat-locking, ticketing, and airline operations management platform.

## Technology Stack

- **Backend:** Python 3.12, Flask 3.1.3 (Modular Blueprints under `fly/`), Jinja2 3.1.6
- **Frontend:** HTML5, CSS3 (Responsive Light/Dark Design System), Vanilla JavaScript (`static/js/api_client.js` & page controllers)
- **Database:**
  - **Active Local Runtime:** SQLite WAL (`database/flight_booking.db`) with `BEGIN IMMEDIATE` ACID transactions & partial unique reservation index (`idx_active_seat_reservation`)
  - **Production Target Migration:** PostgreSQL DDL & seed scripts included (`database/migrations/001_postgres_schema.sql`, `database/seeds/seed_postgres.sql`)

## Key Features

1. **Strict Double-Booking Prevention:** Database-level atomic multi-seat holds (`10-minute` TTL, 1 controlled `2-minute` extension, `30s` background auto-expiry worker).
2. **Real-Time Cabin Seat Map:** Interactive `A B C | D E F` seat grid (`Available`, `Selected`, `Extra Legroom / Exit`, `Locked`, `Booked`) synchronized via SSE & 5-second polling.
3. **Connected Checkout & Pricing Engine:** Authoritative server-side fare computation with configurable baggage allowances (`23 kg` domestic / `40 kg` international), add-ons, promo validation (`FLY10`, `DHAKA500`), and idempotent payment handling (`SIMULATE_SUCCESS`, `SIMULATE_FAILURE`, `SIMULATE_TIMEOUT`).
4. **E-Tickets, QR Verification & Guest PNR Lookup:** 6-character PNR generation, embedded verification QR SVG, downloadable `%PDF-1.4` boarding pass, public `/ticket/verify/<token>`, and `/manage-booking` lookup.
5. **Airline Operations Console (`/admin`):** Role-guarded dashboard enforcing strict airline tenant isolation (`AIRLINE_ADMIN` vs `SYSTEM_ADMIN`), schedule CRUD, refund queue moderation, live seat inventory viewer, and concurrency/audit logs.

## Running Locally

```bash
python app.py
```

Open `http://127.0.0.1:5000` in your browser.

## Environment Variables (`config.py`)

- `FLY_SECRET_KEY` — Session / HMAC signing secret
- `SEAT_LOCK_MINUTES` — Seat lock window (default `10`)
- `SEAT_EXTENSION_MINUTES` — Controlled extension duration (default `2`)
- `MAX_LOCK_EXTENSIONS` — Maximum extensions per hold (default `1`)
- `LOCK_SWEEP_INTERVAL_SECONDS` — Background auto-expiry interval (default `30`)

## Running Automated QA Tests

Ensure the Flask app is running on `http://127.0.0.1:5000`, then execute:

```bash
python -m unittest discover -s tests -p "test_*.py" -v
```

Suites included under `tests/`:
- `tests/concurrency/` — 20-thread simultaneous lock contention, multi-seat rollback, auto-expiry recovery
- `tests/integration/` — RBAC, cross-airline isolation, IDOR protection, fare tamper rejection, idempotency
- `tests/e2e/` — Full passenger journey through registration, booking, payment, PNR/QR/PDF & cancellation
- `tests/ui/` — All 19 HTML route checks, asset `200 OK` checks, legacy removal & responsive CSS checks
