# Environment Setup Guide: FLY Flight Ticketing Platform

**Project Brand:** FLY Aviation & Travel  
**Target Environment:** Local Developer Sandbox / Staging / Production  
**Maintainer:** `mahin1710`

---

## 1. Prerequisites

- **Python:** 3.12+ (CPython)
- **PHP:** 8.3+ with `pdo_sqlite`, `pdo_pgsql`, `mbstring`, `openssl`, `tokenizer`, `xml`, `ctype`, `json`, `curl` extensions
- **Node.js:** v20+ or v24+ (for test runners and auto-sync daemon)
- **Composer:** 2.x+ (PHP dependency manager)
- **Database:** SQLite 3 (included) or PostgreSQL 16+ (production)

---

## 2. Quick Local Setup (Python Flask Web Edition)

1. **Clone & Open Project:**
   ```bash
   cd c:\Users\mahed\Desktop\FLY
   ```

2. **Configure Environment:**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

3. **Install Python Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **1-Click Launch (Windows):**
   Double-click `start.bat` or run:
   ```bash
   python app.py
   ```
   The application is live at: `http://localhost:5000`

---

## 3. Backend API Setup (Laravel 11 Enterprise Engine)

1. **Navigate to Backend Directory:**
   ```bash
   cd backend
   ```

2. **Configure Environment:**
   Copy `backend/.env.example` to `backend/.env`:
   ```bash
   cp .env.example .env
   ```

3. **Install Dependencies:**
   ```bash
   composer install
   ```

4. **Generate Application Key:**
   ```bash
   php artisan key:generate
   ```

5. **Run Database Migrations:**
   ```bash
   php artisan migrate
   ```

6. **Execute Automated Test Suite:**
   ```bash
   php artisan test
   ```
   *Expected Outcome:* 164 passing tests (979 assertions).

---

## 4. Environment Variables Reference

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `FLASK_APP` | `app.py` | Python entry point |
| `PORT` | `5000` | Local web server port |
| `DATABASE_PATH` | `database/flight_booking.db` | Primary SQLite database path |
| `FLIGHT_PROVIDER_ACTIVE` | `DEMO_LOCAL` | Active supplier adapter (`DEMO_LOCAL` \| `AMADEUS_GDS`) |
| `FLIGHT_PROVIDER_SANDBOX_MODE` | `True` | Forces mock / sandbox isolation |
| `SSLCOMMERZ_STORE_ID` | `sandbox_store_id` | Payment gateway store ID |
| `SSLCOMMERZ_IS_SANDBOX` | `True` | Sandbox checkout toggle |
