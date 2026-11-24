# Codebase Cleanup & Safe Renaming Report: Skynet $\rightarrow$ FLY

**Execution Date:** November 25, 2026  
**Audited Directory:** `c:\Users\mahed\Desktop\FLY`  
**Engineer / Architect:** Senior Software Architect & DevOps Engineer  
**Objective:** Prompt 02 — Safe Project Renaming, Codebase Cleanup, and Professional File Organization.

---

## 1. Project Renaming Summary

- **Root Project Name:** Formally updated to **FLY** (`Fly` / `FLY Aviation & Travel`).
- **Filesystem Directory:** The project directory is confirmed as `c:\Users\mahed\Desktop\FLY`.
- **Package Manifest:** `package.json` at root was updated from `"fly-flight-booking-system"` $\rightarrow$ `"fly"`, with scripts pointing directly to `python app.py` and `node tests/ui_accessibility_and_responsive.test.js`.
- **Startup Script:** `start.bat` updated with title `FLY Flight Booking System - Python Flask Edition`.
- **Database Access Decoupling:** `database.py` candidate path list decoupled from `Skynet-master/` by removing candidate 3; default path confirmed as `database/flight_booking.db` (11.0 MB active SQLite database).
- **Auto-Sync Daemon:** `auto_pusher.js` updated to identify as `FLY Automated Git Synchronization Daemon` running on a 20-minute periodic sync interval to `https://github.com/mahin1710/FLY.git`.
- **Client Session Storage:** `static/js/main.js` and `static/js/app.js` updated with dual keys (`fly_active_booking` and `skynet_active_booking`) for backward and forward compatibility.

---

## 2. Inventory of References Updated

| File | Old Reference | New Reference | Reason |
| :--- | :--- | :--- | :--- |
| **`package.json`** | `"name": "fly-flight-booking-system"` | `"name": "fly"` | Standardized project naming |
| **`package.json`** | `"start": "node Skynet-master/web/server.js"` | `"start": "python app.py"` | Points to canonical Flask application |
| **`database.py`** | `os.path.join(..., 'Skynet-master', ...)` | *Removed* | Decoupled database loading from legacy folder |
| **`auto_pusher.js`** | `* Skynet Automated Git Synchronization` | `* FLY Automated Git Synchronization` | Correct daemon branding & log headers |
| **`test_seat_holding_responsive_and_payment.js`** | Hardcoded `Skynet-master/web/database.db` | Canonical `database/flight_booking.db` with fallback | Ensures test resilience against directory changes |
| **`README.md`** | `# FLY — Flight Booking (Bangladesh Edition)` | `# FLY — Modern Flight Booking Platform` | Updated setup, documentation index & test guide |

---

## 3. Preservation & Deletion Safety Decision

### Files Intentionally Preserved:
1. **`database/flight_booking.db` (11 MB):** Canonical master dataset containing 40,057 reservations, 993 flights, 5,928 airports, and 978 airlines.
2. **`templates/` & `static/`:** Complete Jinja2 templates, CSS3 design system tokens, and Vanilla JS controllers.
3. **`backend/` (Laravel API):** Full enterprise architecture, state machine, DTOs, payment adapters, and 164 passing tests.
4. **`Skynet-master/` (Preserved Legacy Archive):**
   - *Audit finding:* 4 legacy test scripts (`test_clean_login_page.js`, `test_complete_auth_rbac.js`, etc.) inspect files inside `Skynet-master/Skynet-master/web/`.
   - *Decision:* Rather than executing a destructive deletion that risks breaking test runners or files open in the developer's editor, `Skynet-master/` is intentionally preserved as a historical legacy archive. Its runtime coupling has been severed in `package.json`, `database.py`, and `auto_pusher.js`.
5. **Root Test Scripts (`test_*.py`, `test_*.js`):** Intentionally preserved to maintain continuous verification integrity.

---

## 4. Dependencies Preserved & Managed

### Python (`requirements.txt`):
- `Flask>=3.0.0` preserved. Zero unnecessary bloat.

### PHP (`backend/composer.json`):
- `laravel/framework: ^13.17`, `laravel/sanctum: ^4.0`, `dompdf/dompdf: ^3.1`, `phpunit/phpunit: ^12.5.12` preserved.

### Node.js (`package.json`):
- `cors`, `express`, `serverless-http` preserved for local testing utilities.

---

## 5. Verification After Renaming and Cleanup

Following all path decoupling and reference updates:
1. **Flask Server:** Verified running actively on `http://127.0.0.1:5000` (**Status: 200 OK**).
2. **14 Core Routes:** All 14 routes return `HTTP 200 OK` (0 routing errors, 0 template errors).
3. **UI Accessibility & Responsive Suite:** `node tests/ui_accessibility_and_responsive.test.js` passed **9/9 tests (0 failures)**.
4. **Laravel Backend PHPUnit:** `php artisan test` passed **164/164 tests (979 assertions, 0 failures)**.
5. **Git Repository:** Clean working tree, auto-sync daemon running on 20-minute cycle.

---

## 6. Conclusion
The safe project renaming to **FLY**, path decoupling, and documentation reorganization have been successfully achieved with zero regression and zero broken tests.
