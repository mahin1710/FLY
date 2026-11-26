# FLY — Quality Assurance Test Report

**Updated:** 2026-11-26  
**Server Target:** `python app.py` (`http://127.0.0.1:5000`)  

---

## 1. Automated Python Suite (`python -m unittest discover -s tests -p "test_*.py" -v`)

- **Total Executed:** **31 Tests**
- **Result:** **31 / 31 PASSED (`OK`) in `7.715s`**

### Suite Breakdown
1. **Concurrency & DB Stress (`tests/concurrency/test_concurrent_seat_locks.py` — 4 tests OK):**
   - `test_01_fifty_simultaneous_holds_same_seat`: **50** simultaneous threads targeting Seat `A1` -> **`1` win (`201`), `49` conflicts (`409`), `0` unexpected in `1.243s`**.
   - `test_02_overlapping_multiseat_atomicity`: Concurrent `[A, Shared]` vs `[Shared, C]` -> 1 full lock, 1 full rollback.
   - `test_03_expired_lock_lifecycle_and_rejection`: Expired hold rejects payment & extension (`410`), releases cleanly.
   - `test_04_concurrent_payment_idempotency`: 10 simultaneous confirms produce strictly 1 payment & 1 ticket.
2. **Search Expansion, Dates, Travellers, Hotels & Cars (`tests/e2e/test_search_expansion_and_controls.py` — 8 tests OK):**
   - `test_01`: Homepage trip order `One Way -> Round Trip -> Multi City`, no homepage `#travellersField`, Hotels & Car Rentals forms present.
   - `test_02`: `Dhaka` (`DAC`) & `Dubai` (`DXB`) autocomplete + One Way live search returns active flights.
   - `test_03`: Round trip valid/invalid (`return < departure` returns `400 INVALID_RETURN_DATE`).
   - `test_04`: Past departure date rejected with `400 PAST_DATE_REJECTED` (`Asia/Dhaka` timezone boundary).
   - `test_05`: Travellers selection (`Adults`, `Children`, `Infants`) on `/flights/<id>/seats` + fare recalculation + multi-passenger `hold` check.
   - `test_06`: Hotel search past check-in / check-out validation (`400`) & honest unconfigured provider (`PROVIDER_NOT_CONFIGURED`).
   - `test_07`: Car Rental underage driver (`<21`) & same-day time validation (`400`) & honest unconfigured provider (`PROVIDER_NOT_CONFIGURED`).
   - `test_08`: All **8** local `.webp` destination cards load `200 OK`.
3. **E2E Booking Journeys & Admin Workflows (`test_full_booking_journey.py`, `test_five_master_workflows.py` — 5 tests OK).**
4. **Security, RBAC, Airline Isolation & Business Logic (`test_security_rbac_isolation.py` — 12 tests OK).**
5. **UI Routes, Assets & CSS (`test_ui_assets_and_pages.py` — 2 tests OK).**

---

## 2. Node Behavioral & JS Syntax Verification

- **`static/js/*.js` Syntax Check (`node --check`):** All JS modules parsed with zero syntax errors.
- **`node tests/ui/test_search_widget_behavior.js`:** **PASSED (`ALL FlightSearchWidget BEHAVIORAL ASSERTIONS PASSED!`)** — verified `oneway` default, `Dhaka (DAC)` -> `Dubai (DXB)` future navigation URL, automatic `isSubmitting` reset, past-date rejection, same-airport rejection, round-trip return-date check, and Multi-City leg additions.

---

## 3. Environment Blockers Recorded Honestly

- **Live PostgreSQL Server:** `psql`, port `5432`, and Docker are absent locally; ACID suites ran against SQLite WAL while PostgreSQL DDL (`001_postgres_schema.sql`) is delivered ready.
- **Chrome DevTools UI Automation:** `DevToolsActivePort` inactive on host Chrome profile; headless JS behavior & live HTTP routes tested directly instead.
