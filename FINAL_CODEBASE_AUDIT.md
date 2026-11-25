# FLY — Final Codebase & System Reinspection Audit

**Audit Date:** 2026-11-26  
**Workspace:** `c:\Users\mahed\Desktop\FLY`  
**Audit Scope:** Full-stack source verification across HTML templates, static JS/CSS assets, Python Flask blueprints, configuration, database engine, PostgreSQL migrations/seeds, and workspace hygiene.

---

## 1. Verified Runtime Architecture vs. Legacy Artifacts

| Layer | Active Production Modules | Verified Issues / Legacy Residue Found |
| :--- | :--- | :--- |
| **Backend Entry & Config** | `app.py`, `config.py` | Clean Flask Blueprint setup (`pages_bp`, `auth_bp`, `catalog_bp`, `bookings_bp`, `admin_bp`), `30s` lock expiry thread, security headers. `.env.example` still contains stale var names (`SEAT_HOLD_DURATION_MINUTES=15`, `CORS_ALLOWED_ORIGINS`); `.gitignore` lacks explicit `.env`. |
| **Database Engine** | `database.py`, `database/flight_booking.db`, `database/migrations/001_postgres_schema.sql`, `database/seeds/seed_postgres.sql` | SQLite WAL + `BEGIN IMMEDIATE` + `PRAGMA foreign_keys=ON` + `idx_active_seat_reservation` active. **PostgreSQL host status:** `psql`, port `5432`, and Docker are absent locally (live Postgres blocked by host environment). DB contains 59 leftover QA test accounts (`concur_*`, `e2e_*`). |
| **Business Logic Gaps Found** | `fly/routes/admin.py`, `fly/routes/bookings.py`, `fly/routes/catalog.py`, `database.py` | 1. `POST/PUT /api/airline/flights` lacks `arr_datetime > dep_datetime` and duplicate schedule conflict validation.<br>2. `PUT /api/airline/flights/<id>` allows cancelling/rescheduling flights with confirmed bookings without warning/guard.<br>3. Missing admin promo code CRUD endpoints (`POST/PUT /api/admin/promos`) in UI/backend.<br>4. Raw exception messages (`f"...: {e}"`) leaked in `bookings.py` 500 responses.<br>5. Unvalidated `int(...)` query/JSON casts in `catalog.py` & `bookings.py` can trigger HTTP `500` on malformed strings.<br>6. Promo redemption lacks atomic `used_count < usage_limit` check inside `confirm_payment_atomic`. |
| **Frontend Templates & JS** | `templates/base.html`, `templates/pages/*.html`, `static/js/*.js` | Core flows (`auth_portal.js`, `flight_results_controller.js`, `seat_selection.js`, `checkout_portal.js`, `ticket.html`, `my_bookings.js`, `manage_booking.js`, `admin_console.js`) wired cleanly to backend APIs via `api_client.js`.<br>**Issues found:** `home.html` quick-tags/cards hardcode `Bangkok (BKK)` and `Singapore (SIN)` with zero active DB flights and depend on legacy 209 KB `static/js/app.js`; unused `templates/components/form_field.html` (`0` refs). |
| **Orphaned Legacy Files / Bloat** | Root / subfolders | Unused `documentation/` (23 stale pre-refactor files), `screenshots/` (15 stale PNGs including deleted routes), `netlify/` (`api.js` requires deleted `Skynet-master/`), `netlify.toml`, `deploy_netlify.bat`, and unused Express/serverless deps in `package.json`. |

---

## 2. Database Schema & Integrity Baseline (Observed via Python Inspection)

- `airLines`: 978 | `airports`: 5,928 | `flights`: 1,005 | `seats`: 120 | `accounts`: 2,043 (59 temporary QA accounts to clean in Phase 12)
- `bookings`: 285 | `reservations`: 40,084 | `payments`: 14 | `tickets`: 9 | `refund_requests`: 9 | `baggage_policies`: 7 | `promo_codes`: 2 | `audit_logs`: 102
- Duplicate active seat locks (`CONFIRMED`, `PENDING_PAYMENT`, `HELD`, `LOCKED`): **`0`**
- Orphan reservations missing booking reference: **`0`**
- Confirmed bookings missing seat reservations: **`0`**
- Duplicate PNR codes: **`0`**
- Invalid flights (`dep_airport == arr_airport` or `arr_datetime <= dep_datetime`): **`0`**
