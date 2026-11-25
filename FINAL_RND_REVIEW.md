# FLY — Final Flight Reservation System R&D Review

**Phase:** 3 — Advanced Flight Reservation R&D  
**Date:** 2026-11-26  

---

## 1. Evaluation Across 17 Core Reservation Engineering Pillars

1. **Airline Reservation Lifecycle (`HOLD -> CONFIRMED / EXPIRED / CANCELLED / REFUNDED`):**
   Explicit state transitions enforced at the DB layer (`bookings.status` and `reservations.status` updated inside single ACID transactions).
2. **Temporary Inventory Reservation:**
   Holds use `Config.SEAT_LOCK_MINUTES = 10` (env-configurable) with a maximum of `1` controlled `2-minute` extension (`MAX_LOCK_EXTENSIONS = 1`).
3. **PostgreSQL Row-Level Locking & `SELECT FOR UPDATE` (Target Design):**
   Target schema [001_postgres_schema.sql](file:///c:/Users/mahed/Desktop/FLY/database/migrations/001_postgres_schema.sql) defines relational seats, active status checks, and partial unique indexes compatible with `SELECT ... FROM seats ... FOR UPDATE` ordering. *Environment Gap:* Live PostgreSQL execution is blocked locally because `psql`, port `5432`, and Docker are absent on the host.
4. **ACID Transactions & Transaction Isolation (Active SQLite WAL Runtime):**
   `database.hold_seats_atomic`, `extend_lock_atomic`, and `confirm_payment_atomic` run with `isolation_level=None` + explicit `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`, giving strict serialized write isolation across threads without phantom seat reads.
5. **Deadlock Prevention:**
   Every seat list passed to `hold_seats_atomic` is normalized and sorted ascending (`sorted_seats = sorted({int(s) for s in seat_ids})`) prior to lock acquisition, eliminating cyclic A-then-B / B-then-A lock ordering deadlocks.
6. **Atomic Multi-Seat Reservation:**
   All outbound (and return, if round-trip) seats are validated before inserting any `reservations` row; any unavailable seat triggers full transaction rollback (`409 Conflict`, zero partial seat holds).
7. **Reservation Expiration (Dual Active + Lazy Sweep):**
   Both a `30s` background sweep thread (`_start_lock_expiry_scheduler`) and lazy expiry checks inside `hold_seats_atomic`, `api_flight_seats`, and `confirm_payment_atomic` guarantee expired holds never block inventory or confirm after TTL.
8. **Database Unique Constraints:**
   Partial unique index `idx_active_seat_reservation` enforces `UNIQUE(id_flight, id_seat) WHERE status IN ('PENDING_PAYMENT', 'HELD', 'LOCKED', 'CONFIRMED')` as the final relational safety net.
9. **Idempotent Checkout & Payment Retry Handling:**
   `payments.idempotency_key` carries a `UNIQUE NOT NULL` database constraint. Duplicate confirmation requests with the same key return idempotent confirmation; duplicate retries with new keys after capture return `alreadyConfirmed: True` cleanly without duplicate charges or tickets. Failure (`SIMULATE_FAILURE`) and timeout (`SIMULATE_TIMEOUT`) immediately release seat reservations.
10. **Booking Cancellation & Refund Processing:**
    Tiered cancellation policy (>=24h: 85% refund, >=6h: 50%, <6h: 0%) updates `bookings`, `reservations`, `tickets`, and creates an auditable `refund_requests` record scoped strictly to `id_account` and `id_airline`.
11. **PNR Generation, Ticket Verification & Passenger Data Protection:**
    6-char collision-checked PNR + `997-XXXXXXXXXX` ticket number + URL-safe cryptographic `verification_token` embedded in SVG QR codes. QR verification exposes only itinerary/validity metadata—never passport numbers, passwords, or payment credentials.

---

## 2. Engineering Improvements Applied During R&D

- **Atomic Promo Quota Enforcement:** Guarded `UPDATE promo_codes SET used_count = used_count + 1 WHERE UPPER(code) = ? AND used_count < usage_limit AND is_active = 1` inside `confirm_payment_atomic`.
- **Airline Infant-Adult Safety Constraint:** Enforced `infants <= adults` cleanly on server-side hold & fare breakdown endpoints.
- **Exception Sanitization:** Removed raw SQL/Python exception text leaks (`{e}`, `{ie}`) from API JSON responses so internal database structure is never disclosed on error paths.
