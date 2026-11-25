# FLY Implementation Progress Tracker

**Methodology:** Incremental Agile Sprints (Sprints 1–7)  
**Active Runtime Stack:** Python 3.12 + Flask 3.1.3 + Jinja2 3.1.6 + SQLite WAL (with PostgreSQL DDL `001_postgres_schema.sql` shipped for Postgres deployment)  
**Last Verified:** 2026-11-26  

---

| Sprint | Scope | Status | Verification Summary |
| :--- | :--- | :--- | :--- |
| **Sprint 1** | Foundation, DB migration, modular `fly/` Blueprints, Auth UI (`auth.html`, `auth_portal.js`, `api_client.js`), legacy cleanup (`Skynet-master/`, `backend/`, unused assets/scripts) | **DONE** | Legacy password hashes upgraded (`0` remaining non-scrypt); clean `/login`, `/register`, `/profile`; no demo credentials displayed |
| **Sprint 2** | Homepage & Live Flight Search (`flight_search.html`, `flight_results_controller.js`, `GET /api/flights`, filters, sorting, expandable itinerary & baggage rules) | **DONE** | Live database queries verified on `/api/flights` & `/api/flights/popular-routes`; fixture files removed |
| **Sprint 3** | Interactive Aircraft Seat Map (`seat_map.html`, `seat_selection.js`, SSE + 5s polling, color legend, Extra Legroom/Exit fees, atomic multi-seat 10-min hold) | **DONE** | 20-thread concurrency barrage (`1` winner, `19` HTTP `409 Conflict`), multi-seat rollback & auto-expiry verified |
| **Sprint 4** | Connected Checkout, Promo Codes & Mock Payment (`checkout.html`, `checkout_portal.js`, `PUT /api/bookings/<ref>/details`, 10-min countdown + 2-min extend lock, `FLY10` / `DHAKA500`, idempotency) | **DONE** | Server-side fare recalculation, promo discounts, tamper rejection, failure/timeout rollback & idempotent replay verified |
| **Sprint 5** | Official E-Ticket, QR SVG, Pure-Python PDF, Public Verification, Passenger Dashboard & Guest PNR Lookup (`ticket.html`, `ticket_verify.html`, `my_bookings.html`, `manage_booking.html`) | **DONE** | `%PDF-1.4` generation, QR verification endpoint, guest PNR lookup & cancellation refunds verified |
| **Sprint 6** | Role-Guarded Airline Admin Console (`admin_operations.html`, `admin_console.js`, Flights CRUD, Bookings/Refund Queue, Live Seat Inventory Inspector, Concurrency Audit Logs, Baggage/Promo Settings) | **DONE** | RBAC + cross-airline tenant isolation verified (`403 FORBIDDEN` on unauthorized airline access) |
| **Sprint 7** | R&D Audit (`RND_REVIEW.md`), Automated Test Suites (`tests/concurrency`, `tests/integration`, `tests/e2e`, `tests/ui`), Cleanup & Final Report | **DONE** | `python -m unittest discover -s tests -p "test_*.py" -v`: **13 / 13 OK (3.613s)**; Live PostgreSQL execution blocked by host missing PostgreSQL/Docker |
