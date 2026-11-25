# FLY Implementation Progress Tracker

**Project:** FLY — Complete Airline Flight Booking & Ticket Management System  
**Active Runtime Stack Verified:** Python 3.12 + Flask 3.1.3 + Jinja2 3.1.6 + HTML5/CSS3/Vanilla JS + SQLite (WAL)  
**Environment Note (PostgreSQL Blocker):** Inspected local Windows environment — PostgreSQL server (`psql`, port `5432`, `C:\Program Files\PostgreSQL`, Docker) and Node `pg`/`express`/`bcrypt` packages are NOT installed locally. Per Part 2 & Part 19 rules, we preserve the working Python Flask + SQLite runtime as the active local execution engine (with full `BEGIN IMMEDIATE` + partial unique index ACID concurrency guarantees), ship complete PostgreSQL DDL migrations (`database/migrations/001_postgres_schema.sql`) + dual-driver `db.py` readiness, and document the PostgreSQL live-server gap transparently without faking PostgreSQL test runs.

---

## Sprint Tracking

| Sprint | Task | Status | Notes |
| :--- | :--- | :--- | :--- |
| Pre-Sprint | Environment, PostgreSQL & stack verification | COMPLETED | Flask 3.1.3 + SQLite verified; PostgreSQL server absent locally (`BLOCKED` for live PG run, DDL ready) |
| Sprint 1 | Modular `fly/` architecture (`config.py`, `db.py`, `middleware/`, `services/`, `routes/`) | IN PROGRESS | Creating clean separation of routes, services, auth/RBAC, tenant guards |
| Sprint 1 | Database schema migrations (locks, tickets, PNR, saved_travelers, baggage, promos, audit_logs) + seed data (`DAC/CXB/CGP/ZYL/DXB`) | NOT STARTED | Preserve existing `database/flight_booking.db` data |
| Sprint 1 | Legacy account password hashing (`scrypt`) & role normalization | NOT STARTED | Upgrade 1,979 non-scrypt accounts + clean 978 airline roles |
| Sprint 1 | Auth routes & UI (`/login`, `/register`, `/profile`, `/logout`) without exposed demo creds | NOT STARTED | Add `/api/auth/register` & `/api/auth/profile` |
| Sprint 1 | Codebase cleanup (unused images, duplicate JS/templates, legacy dirs) | NOT STARTED | Verify zero references before removal |
| Sprint 2 | Airline/Flight management & live `/flights` search + filters | NOT STARTED | Wire `flight_results_controller.js` to `/api/flights` |
| Sprint 3 | Aircraft seat map (`/flights/<id>/seats`), 10-min atomic locks, 2-min extend, expiry cron, 20-thread concurrency test | NOT STARTED | `BEGIN IMMEDIATE` + sorted seat locking + `idx_active_seat_reservation` |
| Sprint 4 | `/checkout` workflow, saved travelers, baggage policies, promo (`FLY10`), mock payment (success/fail/timeout) + idempotency | NOT STARTED | Server-authoritative fare & idempotency key |
| Sprint 5 | `/ticket/<pnr>` with QR verification & PDF download + `/my-bookings` dashboard + cancellation/refunds | NOT STARTED | Pure-Python PDF + QR verification token |
| Sprint 6 | `/admin/*` multi-page operations console, flight CRUD, inventory inspector, audit logs, airline data isolation | NOT STARTED | Strictly scoped to `user.airlineId` |
| Sprint 7 | Independent R&D (`RND_REVIEW.md`), comprehensive security/concurrency/UI QA, `FINAL_PROJECT_REPORT.md` & `README.md` | NOT STARTED | Must run and verify real tests |
