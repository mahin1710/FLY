# FLY — Concurrency & Database Stress Test Report

**Phase:** 4 — Advanced Database & Concurrency Stress Testing  
**Test Suite:** [test_concurrent_seat_locks.py](file:///c:/Users/mahed/Desktop/FLY/tests/concurrency/test_concurrent_seat_locks.py)  
**Target Server:** Live Flask (`http://127.0.0.1:5000`) backed by SQLite WAL (`BEGIN IMMEDIATE`)  

---

## 1. Environment Scope Note
- **PostgreSQL Live Stress Execution:** `BLOCKED` on this Windows host because PostgreSQL (`psql`, port `5432`) and Docker are not installed. Production PostgreSQL schema [001_postgres_schema.sql](file:///c:/Users/mahed/Desktop/FLY/database/migrations/001_postgres_schema.sql) defines the corresponding partial unique index & row constraints.
- **Live Active Database Stress Execution:** Executed cleanly against the running Flask API and SQLite WAL database engine (`PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, `BEGIN IMMEDIATE`).

---

## 2. Observed Test Results

### A. Single Seat 50-Thread Concurrency Barrage (`test_01_fifty_simultaneous_holds_same_seat`)
- **Setup:** 50 independent passenger accounts + 50 independent Bearer `auth_sessions` tokens hitting `POST /api/bookings/hold` via `ThreadPoolExecutor(max_workers=50)` for identical flight (`#976`) and seat (`A1`).
- **Observed Result:**
  - Total Attempts: **50**
  - Successful Reservations (`201 Created`): **1**
  - Controlled Rejections (`409 Conflict`, `SEAT_UNAVAILABLE`): **49**
  - Unexpected Failures: **0**
  - Execution Duration: **0.851s**
  - Active reservation rows in SQLite for `(flight_id=976, seat=A1)`: **1**

### B. Multi-Seat Overlapping Atomicity (`test_02_overlapping_multiseat_atomicity`)
- **Setup:** Two concurrent requests: Request 1 requests `[seat_A, seat_shared]`; Request 2 requests `[seat_shared, seat_C]`.
- **Observed Result (`ok`):** Strictly **1** succeeds (`201 Created`) and **1** receives `409 Conflict` with full transaction rollback. Verified via `GET /api/flights/976/seats` that the loser's non-shared seat stayed `AVAILABLE` (zero partial holds).

### C. Expired Lock Lifecycle (`test_03_expired_lock_lifecycle_and_rejection`)
- **Observed Result (`ok`):**
  - Expired lock extension via `POST /api/bookings/<ref>/extend-lock` rejected with `410 GONE` (`RESERVATION_EXPIRED`).
  - Expired checkout confirmation via `POST /api/bookings/confirm` rejected with `410 GONE`.
  - Repeated `database.cleanup_expired_holds()` calls proved idempotent.
  - A second passenger subsequently acquired the released seat with `201 Created`.

### D. Concurrent Payment Idempotency (`test_04_concurrent_payment_idempotency`)
- **Setup:** 10 simultaneous `POST /api/bookings/confirm` requests on one held booking (6 using identical `idempotencyKey`, 4 using distinct keys).
- **Observed Result (`ok`):** Strictly **1** `CAPTURED` row in `payments`, strictly **1** issued row in `tickets`, and strictly **1** PNR generated across all responses.
