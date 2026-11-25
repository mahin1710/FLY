# FLY — Flight Booking & Ticket Management System

A full-stack airline reservation, atomic seat-locking, ticketing, and airline operations management platform built with modular Python Flask Blueprints, SQLite WAL ACID transactions (plus target PostgreSQL 16+ schema), HTML5, CSS3, and Vanilla JavaScript.

---

## Core Features

1. **Double-Booking Prevention:** Server-side `BEGIN IMMEDIATE` write locks + partial unique active-reservation index (`idx_active_seat_reservation`), ascending seat-ID ordering (deadlock prevention), `10-minute` seat hold TTL with `1` controlled `2-minute` extension, and `30s` background auto-expiry worker.
2. **Passenger Booking Flow:** Live airport autocomplete -> flight search & multi-filter sorting -> interactive cabin seat map (`SSE` + `5s` polling) -> passenger details & add-ons -> promo code engine (`FLY10`, `DHAKA500`) -> idempotent payment gateway (`SIMULATE_SUCCESS`, `SIMULATE_FAILURE`, `SIMULATE_TIMEOUT`) -> 6-character PNR, embedded QR verification SVG & downloadable `%PDF-1.4` e-ticket.
3. **Passenger Self-Service Portal:** Trip KPI dashboard, active checkout resumption, policy-calculated cancellations/refunds, guest PNR lookup (`/manage-booking`), public ticket verification (`/ticket/verify/<token>`), and saved travelers.
4. **Tenant-Isolated Airline Operations Console (`/admin`):** Strict RBAC (`AIRLINE_ADMIN`, `SYSTEM_ADMIN`), schedule conflict & confirmed-booking mutation guards, live seat inventory inspector, refund queue approvals, configurable domestic (`23 kg`) & international (`40 kg`) baggage policies, promo CRUD, and audit logs.

---

## Architecture & Directory Structure

See [PROJECT_STRUCTURE.md](file:///c:/Users/mahed/Desktop/FLY/PROJECT_STRUCTURE.md) for the complete annotated file tree covering `fly/` (`middleware`, `routes`, `services`), `database/` (`migrations`, `seeds`), `templates/`, `static/`, and `tests/`.

---

## Prerequisites & Setup

- **Python:** `3.12+` with `Flask>=3.0.0` (`pip install -r requirements.txt`)
- **Optional Production PostgreSQL (`16+`):** Migrations and repeatable seeds are ready in [001_postgres_schema.sql](file:///c:/Users/mahed/Desktop/FLY/database/migrations/001_postgres_schema.sql) and [seed_postgres.sql](file:///c:/Users/mahed/Desktop/FLY/database/seeds/seed_postgres.sql) (`psql -d fly_db -f ...`). Local development runs automatically out-of-the-box on SQLite WAL (`database/flight_booking.db`).

### Environment Variables
Copy [.env.example](file:///c:/Users/mahed/Desktop/FLY/.env.example) to `.env` for custom environments (`FLY_SECRET_KEY`, `SEAT_LOCK_MINUTES=10`, `SEAT_EXTENSION_MINUTES=2`, `LOCK_SWEEP_INTERVAL_SECONDS=30`, `ALLOWED_ORIGINS`).

---

## Running & Testing Locally

Start the application server:
```bash
python app.py
```
Or double-click [start.bat](file:///c:/Users/mahed/Desktop/FLY/start.bat) on Windows to start the server and open `http://localhost:5000`.

With the server running on `http://127.0.0.1:5000`, execute the complete QA & 50-thread concurrency test suite:
```bash
python -m unittest discover -s tests -p "test_*.py" -v
```

---

## Known Limitations

- **PostgreSQL Live Runtime (`BLOCKED` on local evaluation machine):** `psql`, PostgreSQL port `5432`, and Docker are not installed on this Windows host; live runtime & stress tests ran against SQLite WAL (`BEGIN IMMEDIATE`), while PostgreSQL schema DDL & seeds are delivered for PostgreSQL deployment.
- **Simulated Payments & GDS:** Payment processing and flight inventory operate on internal database schedules and gateway simulation scenarios without live card charges or external GDS connections.
- **Headless Browser DOM Driver:** No `puppeteer`/`playwright` binary is installed locally; live HTML routes, asset HTTP `200` integrity, and responsive CSS rules are covered via [test_ui_assets_and_pages.py](file:///c:/Users/mahed/Desktop/FLY/tests/ui/test_ui_assets_and_pages.py).
