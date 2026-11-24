# Project Renaming & Safe Cleanup Plan: Skynet $\rightarrow$ FLY

**Audit Date:** November 25, 2026  
**Audited Directory:** `c:\Users\mahed\Desktop\FLY`  
**Current Name:** `skynet-master`  
**Target Name:** `Fly` / `FLY Aviation`  
**Scope:** Identification of all naming occurrences, dependencies, duplicates, obsolete artifacts, and a safe phased transition plan.  
**Strict Restriction:** This is an audit and planning document only. No files will be renamed, deleted, or relocated during this phase.

---

## 1. Audit of Current Project Naming References

### 1.1 Folder & File Names Containing `Skynet`
1. `c:\Users\mahed\Desktop\FLY\Skynet-master\`
2. `c:\Users\mahed\Desktop\FLY\Skynet-master\Skynet-master\`
3. `c:\Users\mahed\Desktop\FLY\Skynet-master\README.txt`
4. `c:\Users\mahed\Desktop\FLY\Skynet-master\start.bat`
5. `c:\Users\mahed\Desktop\FLY\Skynet-master\package.json`
6. `c:\Users\mahed\Desktop\FLY\Skynet-master\Skynet-master\README.txt`
7. `c:\Users\mahed\Desktop\FLY\Skynet-master\Skynet-master\web\`
8. `c:\Users\mahed\Desktop\FLY\Skynet-master\Skynet-master\web\public\images\SkynetLogo.png`
9. `c:\Users\mahed\Desktop\FLY\Skynet-master\Skynet-master\web\public\images\SkynetLogo.ico`

### 1.2 In-Code References to `Skynet`
1. **`package.json` (Root):**
   - `"main": "Skynet-master/web/server.js"`
   - `"scripts": { "start": "node Skynet-master/web/server.js" }`
2. **`auto_pusher.js`:**
   - JSDoc comment: `* Skynet Automated Git Synchronization Daemon`
   - Initial stage targets reference `Skynet-master/Skynet-master/web/...`
3. **`database.py`:**
   - Fallback database paths checking `Skynet-master/web/database.db` if root database is absent.
4. **`start.bat`:**
   - Contains comments referencing legacy Skynet startup options.

---

## 2. Confirmed Duplicate Files

| Item | Canonical Location (Keep) | Duplicate Location (Safe to Remove Later) | Verification |
| :--- | :--- | :--- | :--- |
| **SQLite Database** | `database/flight_booking.db` | `Skynet-master/Skynet-master/web/database.db` | Identical 11 tables, 40,057 reservations, 5,928 airports. |
| **Brand Logos** | `static/images/` | `Skynet-master/Skynet-master/web/public/images/` | Duplicate logo assets (`fly_logo.png`, `fly_icon.png`). |
| **Documentation** | `README.md` & `documentation/` | `Skynet-master/README.txt` & `Skynet-master/Skynet-master/README.txt` | Outdated historical READMEs. |
| **Batch Launchers** | `start.bat` (Root) | `Skynet-master/start.bat` & `Skynet-master/Skynet-master/start.bat` | Redundant nested launch files. |

---

## 3. Confirmed Unused or Obsolete Files

1. **`Skynet-master/Skynet-master/web/server.js`:**
   - 88 KB Express.js implementation superseded by Python Flask (`app.py`) and Laravel API (`backend/`).
   - Not called during primary application startup via `start.bat` (`python app.py`).
2. **`Skynet-master/Skynet-master/web/node_modules/`:**
   - Obsolete dependencies for the legacy Express prototype.
3. **`Skynet-master/package.json` & `Skynet-master/Skynet-master/package.json`:**
   - Redundant package manifests.

---

## 4. Files That MUST Be Preserved

1. **Root Application Core:**
   - `app.py`: Primary web application serving all multi-page Jinja routes, airport search, seat reservation, and admin proxy.
   - `database.py`: Concurrency-safe atomic transaction manager (`BEGIN IMMEDIATE`) for seat holding and payment confirmation.
   - `database/flight_booking.db`: Master SQLite dataset with 40k+ records.
   - `requirements.txt`: Python dependencies.
   - `.env.example`: Master environment configuration template.
2. **Frontend Layer:**
   - `templates/` (all files in `templates/pages/` and `templates/components/`).
   - `static/css/style.css`: Complete responsive design tokens and overflow containment rules.
   - `static/css/admin.css`: High-density operational styles and table scroll containers.
   - `static/js/`: All modular controllers (`shell.js`, `flight_search_widget.js`, `flight_results_controller.js`, `checkout_store.js`, `admin_console.js`, `seat_selection.js`, `flight_models.js`, `flight_fixtures.js`).
3. **Enterprise Backend Engine (`backend/`):**
   - `backend/app/`: All DTOs, State Machine, Payment Adapters, GDS Providers, Orchestration, and Models.
   - `backend/routes/api.php`: 30+ enterprise REST API routes.
   - `backend/database/migrations/`: 23 schema migrations.
   - `backend/tests/`: Complete automated test suite (164 tests).
   - `backend/composer.json` & `composer.lock`.
4. **Automation & Documentation:**
   - `auto_pusher.js`: Background Git synchronization daemon.
   - `documentation/`: Master system documentation and audits.

---

## 5. Files Whose Deletion is Unsafe or Uncertain

1. **Root Test Scripts (`test_*.py`, `test_*.js`, `verify_*.js`):**
   - *Status:* Unsafe to delete without consolidation.
   - *Action:* Keep in place for current phase; consolidate into `tests/` directory during a future dedicated refactoring pass.
2. **`package.json` (Root):**
   - *Status:* Unsafe to delete immediately because root test runners (`node tests/...`) rely on local Node runtime.
   - *Action:* Update project name to `"name": "fly-aviation"`, remove references to `Skynet-master/web/server.js`, and keep test dependencies.

---

## 6. Recommended Final Project Structure (Future Implementation)

```
FLY/
├── .env.example
├── .env
├── app.py                             # Python Web & Gateway
├── database.py                        # Database Helper & Atomic Locking
├── requirements.txt                   # Python Dependencies
├── package.json                       # Test Runner & Tooling Manifest
├── start.bat                          # 1-Click Startup
├── database/
│   └── flight_booking.db              # Master SQLite Database
├── templates/
│   ├── base.html
│   ├── components/
│   └── pages/
├── static/
│   ├── css/
│   ├── js/
│   └── images/
├── backend/                           # Enterprise Laravel API
│   ├── app/
│   ├── config/
│   ├── database/
│   ├── routes/
│   └── tests/
├── documentation/                     # Master Documentation
└── tests/                             # Consolidated Test Harness
    ├── unit/
    ├── integration/
    ├── e2e/
    └── a11y_responsive/
```

---

## 7. Migration Sequence (When Approved for Future Phase)

1. **Step 1: Path & Reference Decoupling:**
   - Update `package.json` (root) scripts to remove references to `Skynet-master/web/server.js`.
   - Update `auto_pusher.js` to remove references to `Skynet-master/`.
   - Update `database.py` fallback path to reference root `database/flight_booking.db` only.
2. **Step 2: Quarantine & Archive:**
   - Move `Skynet-master/` into an archived zip or staging folder outside active repository indexing.
3. **Step 3: Verification Run:**
   - Execute test suites (`python app.py`, `node tests/ui_accessibility_and_responsive.test.js`, `php artisan test`) to confirm zero breakage.
4. **Step 4: Permanent Pruning:**
   - Remove obsolete `Skynet-master/` after clean test verification.
