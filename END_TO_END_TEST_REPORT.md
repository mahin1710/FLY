# FLY — End-to-End Regression Test Report

**Phase:** 11 — Full End-to-End Regression Testing  
**Command Executed:** `python -m unittest discover -s tests -p "test_*.py" -v`  
**Observed Result:** **23 / 23 tests passed in 7.220s (`OK`)**  

---

## Verified Master Workflows

1. **Workflow 1 — Normal Successful Booking ([test_full_booking_journey.py](file:///c:/Users/mahed/Desktop/FLY/tests/e2e/test_full_booking_journey.py)) — PASS:**
   Registered new passenger -> searched `DAC -> CXB` -> fetched seat inventory -> held seat atomically (`201`) -> extended lock (`+2 min`) -> saved passenger/baggage/meal/insurance + `FLY10` promo -> confirmed simulated payment (`200`) -> retrieved 6-char PNR + SVG QR -> downloaded `%PDF-1.4` e-ticket PDF -> verified QR token publicly -> verified guest PNR lookup -> cancelled cleanly.
2. **Workflow 2 — Failed Payment ([test_five_master_workflows.py](file:///c:/Users/mahed/Desktop/FLY/tests/e2e/test_five_master_workflows.py)) — PASS:**
   `SIMULATE_FAILURE` returned `400 PAYMENT_FAILED`, marked booking `CANCELLED`, and released held seat back to `AVAILABLE`.
3. **Workflow 3 — Payment Timeout & Rebooking ([test_five_master_workflows.py](file:///c:/Users/mahed/Desktop/FLY/tests/e2e/test_five_master_workflows.py)) — PASS:**
   `SIMULATE_TIMEOUT` returned `410 PAYMENT_TIMEOUT` and immediately freed the seat so a second passenger (`Mahin1`) locked it with `201 Created`.
4. **Workflow 4 — Booking Cancellation & Refunds ([test_five_master_workflows.py](file:///c:/Users/mahed/Desktop/FLY/tests/e2e/test_five_master_workflows.py)) — PASS:**
   Confirmed booking checked in history -> cancelled -> positive refund computed by policy -> booking and ticket statuses updated to `CANCELLED` -> seat released back to `AVAILABLE`.
5. **Workflow 5 — Administrator Lifecycle & Isolation ([test_five_master_workflows.py](file:///c:/Users/mahed/Desktop/FLY/tests/e2e/test_five_master_workflows.py)) — PASS:**
   `Admin_Biman` verified dashboard KPIs (`airlineId=839`), created a new flight, updated Economy fare (`4200`) & status (`ON_TIME`), inspected live seat inventory, listed airline bookings, verified `ADMIN_FLIGHT_CREATED` audit log, and confirmed cross-airline `Admin_USB` received `403 FORBIDDEN`.
