# Comprehensive Project Audit: Flight Ticketing Platform (FLY)

**Audit Date:** November 25, 2026  
**Audited Directory:** `c:\Users\mahed\Desktop\FLY`  
**Current Repository Name:** `skynet-master` (Target Brand: `FLY Aviation & Travel`)  
**Auditor:** Senior Software Architect, Full-Stack Developer & Security Auditor  
**Audit Scope:** Complete technical, architectural, functional, security, and UI/UX audit of the existing codebase.  
**Strict Restriction:** Audit-only phase. No files renamed, moved, deleted, or business logic modified during this audit.

---

## 1. Executive Summary & Stack Identification

### Codebase Classification
The workspace contains an **established, multi-tier, dual-runtime application** with substantial business logic, robust relational databases, and a comprehensive automated test harness.

The repository exhibits an evolutionary structure consisting of three distinct layers:
1. **Primary Web Presentation & Local Server (Active):** Python Flask 3.1.3 + Jinja2 Templates + Vanilla CSS3 Design System + Vanilla JS modular controllers + SQLite 3 (`database/flight_booking.db`).
2. **Enterprise API & Orchestration Engine (Active Backend):** Laravel 11/12 (PHP 8.3+) with Hexagonal Architecture, DTOs, Sanctum auth, State Machine, Payment Gateway adapters (Simulated & SSLCOMMERZ), and automated PHPUnit suites (164 tests).
3. **Legacy Foundation (Historical Artifact):** Original JavaFX desktop application and intermediate Node.js/Express.js server (`Skynet-master/Skynet-master/web/server.js`) from which flight database seeds originated.

---

## 2. Technology Stack & Runtime Matrix

| Subsystem | Technology / Runtime | Version | Entry Point / Path | Active Role |
| :--- | :--- | :--- | :--- | :--- |
| **Web Server & UI Gateway** | Python Flask (CPython) | 3.1.3 (Python 3.12.10) | `app.py` (Port 5000) | Serves Jinja templates, public UI, local JSON endpoints |
| **API Backend** | PHP / Laravel Framework | Laravel 11.x (PHP 8.3+) | `backend/artisan` (Port 8000) | Enterprise booking state machine, payment adapters, queuing |
| **Database (Primary SQLite)** | SQLite 3 | 3.45.1 | `database/flight_booking.db` | 11 tables, 40,057 reservations, 993 flights, 5,928 airports |
| **Database (Laravel SQLite/PG)** | SQLite / PostgreSQL | 3.45.1 / 16+ | `backend/database/database.sqlite` | 23 tables, relational ledger, price snapshots, DTO events |
| **Database (Legacy)** | SQLite 3 | 3.45.1 | `Skynet-master/web/database.db` | Duplicate legacy database |
| **Frontend Templates** | Jinja2 / Semantic HTML5 | 3.1.6 | `templates/` & `templates/pages/` | Server-rendered pages with client-side reactive DOM |
| **Styling & Design Tokens** | Pure CSS3 (Tokens, Grid, Flex) | CSS3 Level 4 | `static/css/style.css`, `admin.css` | Midnight Navy / Warm Ivory / Gold, WCAG 2.1 AA compliant |
| **Client Controllers** | Vanilla JavaScript (ES6+) | Modern ECMAScript | `static/js/*.js` | Shell, search widget, checkout store, admin console |
| **Auto-Sync Daemon** | Node.js | v24.22.1 | `auto_pusher.js` | 20-minute automated Git repository synchronization |
| **Test Runners** | PHPUnit, Node.js HTTP, Python unittest | PHPUnit 12.x, Node 24 | `backend/tests/`, `tests/*.js` | 164 PHPUnit tests + 9 UI accessibility/responsive tests |

---

## 3. Existing Module & Architecture Inventory

### Module 1: Flight Search & Discovery Engine
- **Frontend:** `templates/pages/flight_search.html`, `static/js/flight_search_widget.js`, `static/js/flight_results_controller.js`.
- **Backend:** `app.py` (`/api/airports/search`, `/api/flights`, `/api/flights/filter-options`), Laravel `FlightController.php` (`v1/flights/search`).
- **Capabilities:**
  - One-Way, Round-Trip, and Multi-City search.
  - Airport autocomplete matching IATA code, city name, and airport title (5,928 global airports indexed).
  - Date picker validation (prevents past dates, enforces return $\ge$ departure).
  - Passenger counts (Adults 12+, Children 2–11, Infants < 2) with maximum capacity limits.
  - Cabin selection: Economy, Premium Economy, Business, First Class.
  - Dynamic result filtering: Airline checklist, non-stop / multi-stop toggle, departure time slots, interactive price slider in BDT.
  - Sorting: Cheapest, Fastest, Earliest Departure, Latest Departure.

### Module 2: Flight Offer Details & Revalidation
- **Frontend:** `templates/pages/offer_details.html`, `static/js/checkout_store.js`.
- **Backend:** `app.py` (`/api/flights/<id>`, `/api/flights/fare-breakdown`), Laravel `FlightController.php` (`v1/flights/offers/{uuid}`, `/reprice`).
- **Capabilities:**
  - Detailed flight segments (marketing carrier, operating carrier, aircraft type Boeing 737/777/A320, departure/arrival terminals).
  - Baggage allowance display (checked luggage weight in kg and cabin hand luggage).
  - Fare rules transparency: Cancellation and date change penalties stated in BDT.
  - Sticky itemized fare summary: Base fare, 15% VAT, airport embarkation tax, carrier fuel surcharge, advance seat hold.

### Module 3: Passenger Information & Document Validation
- **Frontend:** `templates/pages/travellers.html`, `static/js/checkout_store.js`.
- **Backend:** `app.py` (`/api/bookings/validate`), Laravel `BookingController.php` (`v1/bookings/{ulid}/passengers`).
- **Capabilities:**
  - Dynamic traveler cards generated for each adult, child, and infant.
  - Route-aware validation: Automatically detects whether route is Domestic (Bangladesh) or International.
  - Document requirements: Domestic allows NID, Birth Certificate, or Passport; International strictly enforces Passport with minimum 6 months validity.
  - Primary contact coordinates: Validated email address and telephone with international dialing codes (+880, +1, +44, +971).
  - Privacy guarantee: Stored exclusively in tab-scoped browser memory (`CheckoutStore`), never in unencrypted persistent storage.

### Module 4: Extras & Ancillary Services
- **Frontend:** `templates/pages/extras.html`, `static/js/seat_selection.js`.
- **Backend:** `app.py` (`/api/flights/<id>/seats`), Laravel `AncillaryItem.php`.
- **Capabilities:**
  - Interactive aircraft seat map with cabin tiering (First, Business, Economy) and live availability status (Available, Held, Booked).
  - Inflight meal selection (Standard Snack, Kacchi Biryani Platter, Vegetarian Thali, Fruit Platter).
  - Extra baggage add-ons (+5 kg, +10 kg, +15 kg, +20 kg with transparent pricing).
  - Travel insurance protection toggle with CAAB medical coverage details.

### Module 5: 15-Minute Seat Hold & Pre-Payment Revalidation
- **Frontend:** `templates/pages/review.html`, `static/js/checkout_store.js`.
- **Backend:** `app.py` (`/api/bookings/hold`, `/api/bookings/validate`), Laravel `BookingOrchestrator.php`, `BookingLockManager.php`.
- **Capabilities:**
  - Atomic seat locking for 15 minutes via transaction guards.
  - Dynamic price change revalidation: Detects airline fare bucket expiration and displays explicit fare difference alert banner with customer acceptance checkbox.
  - Mandatory booking acknowledgments: Name matching government documentation and airline carriage conditions.

### Module 6: Payment Checkout & Gateway Sandbox
- **Frontend:** `templates/pages/payment.html`, `templates/pages/payment_result.html`.
- **Backend:** `app.py` (`/api/bookings/confirm`), Laravel `PaymentController.php`, `Services/Payments/Adapters/SslCommerzAdapter.php`, `SimulatedGatewayAdapter.php`.
- **Capabilities:**
  - Hosted checkout simulator with zero raw PAN/CVV card handling.
  - Payment options: Instant Verification (Fast-Path Demo Sandbox), bKash Mobile Wallet Simulator, Card Gateway Simulator.
  - Real-time hold countdown timer (14:30).
  - Return URL security boundary: Explains clearly that client redirects are UX navigation only, and final ticketing requires server-to-server IPN confirmation.

### Module 7: Confirmation, Digital Boarding Pass & Ticketing
- **Frontend:** `templates/pages/booking_status.html`.
- **Backend:** `app.py` (`/api/reservations/ticket/<id>`), Laravel `TicketingService.php`, `DocumentService.php` (DomPDF).
- **Capabilities:**
  - Status stepper: Confirmed $\rightarrow$ Ticketing Queued $\rightarrow$ Issued.
  - Distinct fields: Booking Reference / PNR locator (`BK-DAC-7788`) and E-Ticket Number (`098-4491029102-DEMO`).
  - Boarding pass with barcode identifier, seat assignment, baggage allowance, and gate departure details.
  - Secure PDF e-ticket download endpoint.

### Module 8: Customer Self-Service & Booking Retrieval
- **Frontend:** `templates/pages/manage_booking.html`, `templates/pages/my_bookings.html`.
- **Backend:** `app.py` (`/api/reservations/my`, `/api/bookings/cancel`), Laravel `BookingController.php` (`guestRetrieve`, `requestServicing`, `getRefundQuote`).
- **Capabilities:**
  - Authenticated booking list with upcoming vs. past tabs.
  - Secure guest retrieval: Requires Booking Reference + Passenger Last Name, rate-limited against brute-force enumeration.
  - Servicing requests: Date change request and cancellation with transparent airline penalty quote breakdown.

### Module 9: Protected Operations Console (Admin Panel)
- **Frontend:** `templates/pages/admin_operations.html`, `static/css/admin.css`, `static/js/admin_console.js`.
- **Backend:** `app.py` (`/api/v1/admin/*`), Laravel `AdminController.php` (14 operational endpoints).
- **Capabilities:**
  - 7 Role-Based Access Control profiles: Super Administrator, Operations Admin, Ticketing Agent, Finance Admin, Support Agent, Pricing Manager, Content Manager.
  - Modules: Operations Dashboard, Bookings, Ticketing Queue, Payments & Exceptions, Refunds & Servicing, Masked Customers, Providers, Pricing Rules, Content Banners, Users & Roles, Financial Reports, Dual Approvals.
  - Mandatory audit reason modal: Operators must provide operational justification for high-impact actions (reconcile, force-ticket, disburse refund).
  - High-density data tables with responsive horizontal scrolling containers (`.admin-table-container`).

---

## 4. Backend and Database Audit

### SQLite Database (`database/flight_booking.db`)
- **Size:** 11.0 MB
- **Tables:** 11 primary tables (`accounts`, `auth_sessions`, `bookings`, `reservations`, `flights`, `airLines`, `airports`, `seats`, `passengers`, `creditCards`, `favorites`).
- **Key Records:**
  - `airports`: 5,928 rows
  - `airLines`: 978 rows
  - `flights`: 993 rows
  - `reservations`: 40,057 rows
  - `accounts`: 1,983 rows
  - `bookings`: 258 rows
- **Transactions & Concurrency:** Concurrency is protected using atomic SQLite immediate transactions (`BEGIN IMMEDIATE`) inside `database.py` during seat reservation (`hold_seats_atomic`) and payment confirmation (`confirm_payment_atomic`). Expired holds are pruned periodically via `cleanup_expired_holds()`.

### Laravel Enterprise Database (`backend/database/database.sqlite`)
- **Migrations:** 23 executed migration files.
- **Relational Integrity:**
  - Strict separation of `bookings`, `booking_segments`, `passengers`, `passenger_documents`, `payments`, `payment_events`, `tickets`, `ancillary_items`, `servicing_requests`, `refunds`, `financial_ledger_entries`, `idempotency_records`, `admin_audit_logs`.
  - Foreign key constraints enforced on all relationships.
  - Indexed fields on `booking_reference`, `provider_locator`, `ticket_number`, `status`, `expires_at`, `created_at`.

### Missing or Risky Database Patterns Identified:
1. **Duplicate SQLite Files:** `database/flight_booking.db` (root) and `Skynet-master/Skynet-master/web/database.db` contain identical table schemas and row counts (40,057 reservations). The legacy copy in `Skynet-master` is redundant.
2. **Dual Model Layer:** `app.py` uses raw SQL queries via `sqlite3.Row` helper functions, whereas `backend/app/Models` uses Eloquent ORM. In a unified architecture, both should share a singular database engine or contract.

---

## 5. Flight & Payment Integration Audit

### Flight Suppliers / GDS Integration
- **Current Active State:** `DEMO_LOCAL` / `MockFlightProvider`.
- **Amadeus Adapter:** Implemented in `backend/app/Services/Providers/Amadeus/AmadeusAdapter.php` and `AmadeusMapper.php` with full OAuth2 client credentials grant, flight offers search, and reprice mappings. Uses sandbox placeholder credentials in `.env.example`.
- **Circuit Breaker:** Implemented in `ProviderCircuitBreaker.php` (tracks consecutive failures, opens circuit after threshold, allows half-open probes).
- **Commercial Status:** Neither live Amadeus IATA credentials nor Sabre Bangladesh API keys are configured. The application honestly badges all live searches with `"Simulated Schedule"` and `"Demo Quote"`.

### Payment Gateways
- **Current Active State:** `SimulatedGatewayAdapter` and `SslCommerzAdapter`.
- **SSLCOMMERZ Integration:** Implemented in `backend/app/Services/Payments/Adapters/SslCommerzAdapter.php`:
  - Hosted checkout session creation (`gw/init`).
  - Server-side IPN validation (`validator/api/merchantTransIDvalidationAPI.php`).
  - Amount, currency, and transaction ID matching.
  - Zero PAN/CVV storage: Cards never touch merchant servers.
- **Commercial Status:** Sandbox placeholder credentials configured in `.env.example`. Live merchant store ID and store password are required before production launch.

---

## 6. UI/UX & Responsive Layout Audit

### Responsive Viewport Verification:
1. **Wide Desktop (1440px+):** Centered max-width containers (`max-width: 1280px`), generous whitespace, 7-column flight search grid.
2. **Desktop / Laptop (1024px - 1280px):** Two-column split between main booking forms and sticky fare breakdown aside cards.
3. **Tablet (768px - 1024px):**
   - Flight search grid collapses from 7 columns into a structured 3-row layout (Origin/Destination row, Date row, Travelers/CTA row).
   - Admin KPI cards stack into 2 columns.
   - High-density admin tables scroll horizontally inside `.admin-table-container` with smooth iOS momentum touch.
4. **Mobile (390px - 480px):**
   - Single-column flow with full-width action buttons (50px tap target height).
   - Origin and Destination stacked full width with centered circular swap button (`aspect-ratio: 1; flex-shrink: 0;`).
   - Departure and Return dates sit side-by-side in 2 columns (saving vertical scroll).
   - Active stepper item reveals descriptive label (e.g. `Step 3: Travellers`) while inactive steps remain compact numbered circles.
   - Zero horizontal page overflow; text wraps gracefully (`overflow-wrap: break-word; min-width: 0;`).

### Visual Consistency & Polish:
- **Icons:** 100% clean, monochrome SVG vectors throughout. No amateur emojis in UI controls or alerts.
- **Surfaces:** Solid, high-contrast surface tokens (`var(--bg-surface)`) replace blurry glassmorphism filters.
- **Copy:** Natural sentence case with polite, humanized error messages and transparent fee breakdowns.

---

## 7. Security and Performance Observations

### Security:
- **Authentication:** Passwords hashed with `scrypt` (Flask) and `bcrypt` (Laravel).
- **Session Security:** Cryptographically strong session tokens stored in `auth_sessions` / Laravel Sanctum.
- **Authorization & IDOR Protection:** Bookings in `/api/reservations/my` and Laravel `BookingController` are scoped strictly to the authenticated `account_id`. Guest retrieval requires secondary verification (last name) and is rate-limited.
- **Data Protection:** Passport numbers and credit card numbers are masked (`•••• 1234`, `A098****`) in all viewports and responses.
- **Zero Raw Card Storage:** Complies with PCI-DSS Level 1 standards by delegating checkout to hosted gateway adapters.

### Performance:
- **Database Indexing:** Indexed on foreign keys and search columns (`dep_airport`, `arr_airport`, `booking_reference`).
- **Assets:** Lightweight vanilla CSS (123 KB) and vanilla JS without bulky client frameworks.
- **Response Times:** Local Flask routes serve in under 15ms.

---

## 8. Baseline Audit Summary & Recommendations

| Item | Assessment | Recommendation |
| :--- | :--- | :--- |
| **Search & Booking UX** | Production Quality | Maintain existing responsive UI and checkout store |
| **State Machine** | Fully Defined | Leverage Laravel `BookingStateMachine` for transition guards |
| **Payment Gateways** | Sandbox Ready | Keep sandbox mode until live SSLCOMMERZ credentials exist |
| **Supplier GDS** | Sandbox / Simulated | Keep demo badges until commercial consolidator agreements are finalized |
| **Legacy Codebase** | Inactive | Safely isolate `Skynet-master` until future renaming phase |
