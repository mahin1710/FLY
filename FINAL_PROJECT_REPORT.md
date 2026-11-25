# FLY Flight Booking & Ticket Management System — Final Project Report

**Author:** `mahin1710`  
**Audit & Verification Completion:** 2026-11-26  
**Active Server:** `python app.py` (`http://localhost:5000`)  

---

## 1. Project Overview & Main Objectives
FLY is a full-stack airline ticketing, seat-reservation, e-ticket generation, and airline operations management platform built to enforce **strict database-level double-booking prevention** across concurrent booking attempts while providing realistic workflows for passengers and airline administrators.

---

## 2. Implemented Architecture, Database Design & API Structure
- **Modular Backend ([app.py](file:///c:/Users/mahed/Desktop/FLY/app.py), [config.py](file:///c:/Users/mahed/Desktop/FLY/config.py)):** Separated into `pages_bp`, `auth_bp`, `catalog_bp`, `bookings_bp`, and `admin_bp` under `fly/routes/`, backed by [fly/middleware/auth.py](file:///c:/Users/mahed/Desktop/FLY/fly/middleware/auth.py) and [fly/services/pdf_service.py](file:///c:/Users/mahed/Desktop/FLY/fly/services/pdf_service.py).
- **Database Engine ([database.py](file:///c:/Users/mahed/Desktop/FLY/database.py)):**
  - Active runtime uses SQLite WAL (`journal_mode=WAL`, `foreign_keys=ON`, `BEGIN IMMEDIATE`) and partial unique index `idx_active_seat_reservation` (`WHERE status IN ('PENDING_PAYMENT','HELD','LOCKED','CONFIRMED')`).
  - Target PostgreSQL 16+ schema & repeatable seed assets delivered in [001_postgres_schema.sql](file:///c:/Users/mahed/Desktop/FLY/database/migrations/001_postgres_schema.sql) and [seed_postgres.sql](file:///c:/Users/mahed/Desktop/FLY/database/seeds/seed_postgres.sql).
- **User Roles:** `PASSENGER`, `AIRLINE_ADMIN` (strictly scoped to `id_airline`), and `SYSTEM_ADMIN`.
- **Booking Lifecycle & Concurrency Control:** Search -> Seat Select -> Atomic Hold (`10 min` TTL, sorted seat-ID lock acquisition) -> Lock Extension (`+2 min` max `1` time) -> Authoritative Fare & Promo Re-calculation (`PUT /api/bookings/<ref>/details`) -> Idempotent Payment (`payments.idempotency_key UNIQUE`) -> 6-char PNR + Verification QR SVG + `%PDF-1.4` Boarding Pass -> Policy Cancellation & Refund.

---

## 3. Master Audit, R&D & QA Evidence Summary

| Report / Phase | Summary of Findings & Observed Verification |
| :--- | :--- |
| [FINAL_CODEBASE_AUDIT.md](file:///c:/Users/mahed/Desktop/FLY/FINAL_CODEBASE_AUDIT.md) | Audited all modules, DB counts, FKs, indexes; logged all stale artifacts and bugs fixed in Phases 2–10. |
| [SYSTEM_INTEGRATION_REPORT.md](file:///c:/Users/mahed/Desktop/FLY/SYSTEM_INTEGRATION_REPORT.md) | Verified live frontend-to-backend integration across homepage, search, seats, checkout, tickets, passenger portal, and admin console. |
| [FINAL_RND_REVIEW.md](file:///c:/Users/mahed/Desktop/FLY/FINAL_RND_REVIEW.md) | Evaluated all 17 airline reservation R&D domains; added promo quota race guard, infant validation & exception sanitization. |
| [CONCURRENCY_STRESS_TEST_REPORT.md](file:///c:/Users/mahed/Desktop/FLY/CONCURRENCY_STRESS_TEST_REPORT.md) | **50-thread simultaneous contention** on Seat `A1`: **`1` win, `49` `409 Conflict`, `0` unexpected (`0.851s`)**; overlapping multi-seat rollback (`[A, Shared]` vs `[Shared, C]`), expired hold rejection, and 10-thread payment idempotency all passed. |
| [SECURITY_AUDIT_REPORT.md](file:///c:/Users/mahed/Desktop/FLY/SECURITY_AUDIT_REPORT.md) | 12/12 automated security/RBAC/isolation/SQLi/IDOR checks passed; zero demo credentials on `/login`; `.gitignore`/`.env.example` tightened. |
| [BUSINESS_LOGIC_AUDIT.md](file:///c:/Users/mahed/Desktop/FLY/BUSINESS_LOGIC_AUDIT.md) | Enforced `arr > dep`, duplicate schedule rejection (`409`), confirmed booking flight-mutation guard (`409`), promo rules, and `23 kg`/`40 kg` configurable baggage policies. |
| [UI_UX_QA_REPORT.md](file:///c:/Users/mahed/Desktop/FLY/UI_UX_QA_REPORT.md) | All 19 HTML routes & referenced static assets verified `200 OK`; added `:focus-visible` accessibility & reduced-motion support. |
| [END_TO_END_TEST_REPORT.md](file:///c:/Users/mahed/Desktop/FLY/END_TO_END_TEST_REPORT.md) | `python -m unittest discover -s tests -p "test_*.py" -v` -> **23 / 23 tests passed in 7.220s (`OK`)**. |
| [FINAL_DATABASE_VERIFICATION.md](file:///c:/Users/mahed/Desktop/FLY/FINAL_DATABASE_VERIFICATION.md) | Purged 61 QA accounts/3 test flights/2 promos cleanly; `PRAGMA integrity_check = ok`, `foreign_key_check = []`, `0` anomalies. |

---

## 4. Truthful Final Acceptance Checklist

- [x] **Passenger Features:** Live flight search, airport autocomplete, filters/sorting, real-time seat map, 10-min seat locking & countdown, extend lock, connected checkout, promo codes, simulated payment modes, unique PNR, QR verification, `%PDF-1.4` download, booking history, cancellation & refunds — **Verified (`23 / 23` tests passing)**.
- [x] **SQLite ACID Concurrency & Integrity:** `BEGIN IMMEDIATE` transactions, ascending deadlock-safe seat locking, partial unique reservation index, multi-seat rollback, payment idempotency, 50-thread stress test (`1` win / `49` conflicts) — **Verified (`OK`)**.
- [ ] **Live PostgreSQL `SELECT FOR UPDATE` Execution:** **BLOCKED by local host environment** (`psql`, port `5432`, and Docker absent locally). Equivalent SQL DDL (`001_postgres_schema.sql`) & seeds (`seed_postgres.sql`) prepared and audited cleanly.
- [x] **Administration:** Dashboard KPIs, flight CRUD with `arr > dep` & duplicate schedule checks, confirmed booking mutation guard, seat inventory, bookings & refund moderation, audit logs, baggage/promo config, airline tenant isolation — **Verified**.
- [x] **Code Quality, Cleanup & Security:** Obsolete prototypes/folders removed (`Skynet-master/`, `backend/`, `netlify/`, `documentation/`, `screenshots/`), zero exception/credential leaks, `PRAGMA integrity_check=ok` — **Verified**.
