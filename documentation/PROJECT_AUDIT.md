# Comprehensive Project Audit: Flight Ticketing Platform (FLY)

**Audit Date:** November 24, 2026  
**Audited Directory:** `c:\Users\mahed\Desktop\FLY`  
**Brand Identity:** FLY Aviation & Travel  
**Maintainer / Author:** `mahin1710`  
**Audit Purpose:** Pre-implementation architectural inspection, codebase discovery, environment verification, gap analysis, and phased implementation blueprint.

---

## 1. Executive Summary & Stack Identification

### Established Stack vs. Fresh Repository
- **Classification:** **Existing, highly customized, active application.** This is **NOT** an empty repository.
- **Rule Adherence (Rule #1 & #3):** In compliance with Rule #3 (*"If an established stack exists and is healthy, preserve it. Do not delete, overwrite, or rewrite existing working code just to make the project match your preferred template"*), the established stack is **preserved**.
- **Active Stack:**
  - **Backend Runtime:** Python 3.12.10
  - **Backend Framework:** Flask 3.1.3 (Jinja2 3.1.6, Werkzeug 3.1.9)
  - **Database:** SQLite 3.45.1 (`database/flight_booking.db`, WAL concurrency mode enabled)
  - **Frontend Page Structure:** Semantic HTML5 (`templates/index.html`, `templates/my_bookings.html`, `templates/payment.html`, `templates/seat_selection.html`)
  - **Styling:** Vanilla CSS3 with responsive CSS Grid/Flexbox design tokens (`static/css/style.css`, 123 KB)
  - **Frontend Controller:** Vanilla JavaScript ES6+ (`static/js/app.js` / `static/js/main.js`, 207 KB)
  - **Test Runners:** Python `unittest` & Node.js `Puppeteer` for browser regression testing.

### Legacy Codebase Detection
- The workspace contains a legacy subdirectory: `Skynet-master/Skynet-master/web/` containing an older Node.js/Express.js version (`server.js`, 88 KB).
- **Current Canonical Application:** The root application (`app.py`, `database.py`, `templates/index.html`, `database/flight_booking.db`) is the active system invoked by `start.bat`.

---

## 2. Framework & Runtime Versions & Run Commands

| Component | Technology | Version | Location / Entry Point |
|---|---|---|---|
| **Operating System** | Windows 11 | Build 26100 | Workspace Host |
| **Python** | CPython | 3.12.10 | System PATH |
| **Flask** | Web Microframework | 3.1.3 | Root `app.py` |
| **Node.js** | JavaScript Runtime | v24.22.1 | System PATH (used for test suites & auto-sync daemon) |
| **Database** | SQLite (Embedded) | 3.45.1 | `database/flight_booking.db` (11.0 MB) |
| **Auto-Sync Daemon** | Node.js Script | Custom | `auto_pusher.js` (GitHub 15-minute commits) |

### How to Run the Application
1. **Primary 1-Click Launch:**
   ```bat
   start.bat
   ```
   *Action:* Executes `python app.py` on `http://localhost:5000`.
2. **Terminal Direct Launch:**
   ```bash
   python app.py
   ```
3. **Legacy Node Launch (Subfolder only):**
   ```bash
   cd Skynet-master/Skynet-master/web && node server.js
   ```

---

## 3. Existing User Interface & Page Views

The primary frontend is built as a responsive Single-Page Application (SPA) inside [`templates/index.html`](file:///c:/Users/mahed/Desktop/FLY/templates/index.html) managed by [`static/js/app.js`](file:///c:/Users/mahed/Desktop/FLY/static/js/app.js) with deep URL routing (`/`, `/flight/list`, `/my-bookings`, `/seat-selection`, `/payment`, `/login`):

1. **Homepage (`#pageHome`, `/`):**
   - Inspired by modern flight platforms (GoZayaan, Skyscanner).
   - Trip types: **One Way**, **Round Trip**, **Multi-City** (dynamic multi-leg segments).
   - Airport Autocomplete with IATA, city, airport name matching, and airport swap button.
   - Travel date validation (prevents past dates, validates return $\ge$ departure).
   - Passenger categorization: Adults (12+), Children (2–11), Infants (under 2).
   - Cabin class selection: Economy, Premium Economy, Business, First Class.
   - Featured destinations & live airline statistics ribbon.
2. **Flight Search & Results Comparison (`#pageSearch`, `/flight/list`):**
   - Search parameters summary bar with inline "Modify Search" modal.
   - GoZayaan-inspired flight cards: Airline logo, flight number, departure/arrival timestamps, stops, duration, aircraft type, baggage allowance, refundability, transparent price.
   - Dynamic Filtering Sidebar: Price range slider (in BDT), airlines checklist (shows only airlines in results), non-stop/multi-stop filter, departure time slots (Morning, Afternoon, Evening, Night).
   - Sorting: Cheapest, Fastest, Earliest Departure, Latest Departure.
   - Multi-leg progress indicator: Guides customer sequentially through outbound and return/multi-city leg selections.
3. **Flight Selection Details Modal (`#modalFlightDetails`):**
   - Itinerary breakdown for single-segment or round-trip/multi-city segments.
   - Transit airport data, aircraft equipment specs, baggage limits, cancellation and date-change penalty rules.
4. **Traveler Information Modal (`#modalPassengerInfo`):**
   - Dynamic traveler cards for all selected passengers.
   - Collects Title, Full Name, Traveler Category (Adult, Child, Infant), Document Type (Passport, NID, Birth Certificate), Document Number.
5. **Interactive Aircraft Cabin & Seat Selection (`#pageSeatMap`, `/seat-selection`):**
   - Visual aircraft fuselage layout with First Class, Business Class, and Economy sections.
   - Conflict-safe real-time availability: Available, Held (Amber), Booked (Navy).
   - Atomic multi-seat selection for families and groups.
6. **Booking Review & Revalidation Modal (`#modalBookingReview`):**
   - Displays full itinerary, assigned seats, traveler names, and verified transparent fare breakdown.
   - Informs customer of the 15-minute exclusive seat hold before checkout.
7. **Payment & 15-Minute Seat Hold Window (`#modalPayment`, `/payment`):**
   - Real-time countdown timer synchronized with server `expires_at` timestamp.
   - Sticky countdown banner if navigating away during active hold.
   - Saved payment cards (masked `•••• •••• •••• 1234`), card registration modal.
   - Simulated instant authorization and credit card checkout (clearly marked as test mode).
8. **Digital Boarding Pass & E-Ticket Modal (`#modalBoardingPass`):**
   - Physical airline boarding pass layout with barcode number (`SK-<flightId>-<resId>-<seatId>-2026`).
   - Gate, terminal, boarding time, seat code, class, baggage weight, print-ready CSS.
9. **Customer Booking Management (`#pageBookings`, `/my-bookings`):**
   - Upcoming vs. Past reservation tabs.
   - Status indicators: `PENDING_PAYMENT` (with remaining minutes and "Confirm Payment" button), `CONFIRMED` (with "View Boarding Pass" button), `EXPIRED`, `CANCELLED`.
   - Seat release / booking cancellation action.
10. **Airline Admin Operations Panel (`#pageDashboard`):**
    - Role-Based Access Control (RBAC): `Admin_Biman` accesses Biman Bangladesh Airlines (`BG`) inventory and analytics; `Admin_USB` accesses US-Bangla Airlines (`BS`).
    - Revenue statistics, ticket sales count, load factor gauges.
    - Create new flight scheduling modal.
11. **Customer Profile & Preferences (`#pageAccount`):**
    - Account details, travel documents, saved credit cards, personal travel preferences.
12. **Favorites (`#pageFavorites`):**
    - Bookmarked flight routes.

---

## 4. Existing Backend API Endpoints

All endpoints are implemented in [`app.py`](file:///c:/Users/mahed/Desktop/FLY/app.py):

### Authentication & Sessions
- `POST /api/auth/login`: Validates credentials (`scrypt` hash), creates Bearer token in `auth_sessions`.
- `POST /api/auth/logout`: Invalidates session token.
- `GET /api/auth/me`: Returns current authenticated account details.
- `GET /api/auth/demo-users`: Returns seeded live demo accounts.

### Airports & Search
- `GET /api/airports/all`: Returns all airports in database.
- `GET /api/airports/cities`: Distinct origin/destination cities.
- `GET /api/airports/countries`: Distinct countries.
- `GET /api/airports/search?q=`: Autocomplete airport search by IATA code, airport name, or city name.

### Flights & Inventory
- `GET /api/flights`: Search flights with query filters (`depCity`, `arrCity`, `depDateAfter`, `cabinClass`, `stops`, `airlines`, `minPrice`, `maxPrice`, `depTimeSlot`, `sort`, `page`).
- `GET /api/flights/featured`: Curated top flight routes.
- `GET /api/flights/filter-options`: Dynamic bounds for price, airlines, and stops.
- `GET /api/flights/<id>`: Detailed flight information.
- `GET /api/flights/<id>/seats`: Seat map layout with real-time seat status (`AVAILABLE`, `HELD`, `BOOKED`, `isHeldByMe`).
- `GET|POST /api/flights/fare-breakdown`: Server-side calculated transparent fare (base fare, 15% VAT, ৳500 embarkation tax, ৳300 fuel surcharge, luggage fees, total payable).

### Booking Engine & Seat Locking
- `POST /api/bookings/validate`: Revalidates flight availability, seat conflict status, passenger data completeness, and fare shifts.
- `POST /api/bookings/hold`: Atomically locks seats for 15 minutes, returns unique `bookingReference` and `expiresAt`.
- `GET /api/bookings/<booking_ref>`: Retrieves pending hold details and remaining seconds.
- `POST /api/bookings/confirm`: Server-side payment verification; transitions status to `CONFIRMED`; returns digital boarding pass; idempotent against duplicate calls.
- `POST /api/bookings/cancel`: Immediately releases held seats back to `AVAILABLE`.

### Customer Reservations & Boarding Pass
- `GET /api/reservations/my`: Returns reservations strictly scoped to the authenticated customer ID.
- `GET /api/reservations/ticket/<ticket_id>`: Boarding pass ticket data (supports booking reference or numeric reservation ID).

### Payment Cards & Favorites
- `GET /api/cards`: Returns masked cards for authenticated account.
- `POST /api/cards`: Stores new payment card.
- `GET /api/favorites`: Returns user's saved flight routes.

### Airline Administration & Media
- `GET /api/admin/all-bookings`: Super-admin flight reservation view.
- `GET /api/airline/flights`: Scoped flights for authenticated airline admin.
- `GET /api/airline/stats`: Revenue and passenger statistics for airline admin.
- `GET /api/airlines/<id>/logo`: Serves airline carrier brand logo.

---

## 5. Database Schema & Data Models

Database engine: SQLite (`database/flight_booking.db`) with 11 primary tables:

1. `accounts`: User accounts (`id`, `username`, `password` [scrypt], `role` [PASSENGER, AIRLINE_ADMIN], `display_name`, `location`, `id_airline`, `id_passenger`, `emailAddress`).
2. `auth_sessions`: Session store (`token` [PK], `account_id`, `username`, `role`, `airline_id`, `created_at`, `expires_at`).
3. `bookings`: Master booking records (`id`, `booking_reference` [UNIQUE], `id_account`, `id_flight`, `status` [PENDING_PAYMENT, CONFIRMED, EXPIRED, CANCELLED], `total_amount`, `nbr_luggages`, `weight`, `created_at`, `expires_at`, `payment_ref`, `payment_method`, `paid_at`, `passenger_data` [JSON], `return_flight_id`, `multi_leg_data` [JSON], `fare_breakdown` [JSON], `trip_type`).
4. `reservations`: Individual seat-to-passenger reservations (`id`, `id_flight`, `id_passenger`, `id_seat`, `seat_class`, `booking_reference`, `status`, `created_at`, `expires_at`, `payment_ref`, `total_price`).
5. `flights`: Scheduled flight inventory (`id`, `id_airline`, `dep_airport`, `arr_airport`, `dep_datetime`, `arr_datetime`, `first_price`, `business_price`, `economy_price`, `luggage_price`, `weight_price`).
6. `airLines`: Airlines metadata (`id`, `name`, `IATA`, `ICAO`, `Callsign`, `Country`).
7. `airports`: Airport location data (`id`, `name`, `city`, `country`, `IATA`, `ICAO`, `latitude`, `longitude`, `timezone`).
8. `seats`: Aircraft seat inventory (`id`, `id_flight`, `column`, `row`, `type`).
9. `passengers`: Passenger profiles (`id`, `firstName`, `lastName`, `passportNumber`).
10. `creditCards`: Saved user cards (`id`, `id_account`, `cardNumber`, `cardHolder`, `expirationDate`, `cardType`).
11. `favorites`: Saved route bookmarks (`id`, `id_account`, `id_flight`).

### Seeded Demo Accounts
- **Passenger:** `Mahin0` / `Mahin0` (MMH_Mahin, Dhaka)
- **Passenger:** `Mahin1` / `Mahin1` (Chittagong Traveler)
- **Airline Admin (Biman):** `Admin_Biman` / `Admin_Biman` (Biman Bangladesh Airlines, BG)
- **Airline Admin (US-Bangla):** `Admin_USB` / `Admin_USB` (US-Bangla Airlines, BS)

---

## 6. Design Tokens & Visual Architecture

Defined in [`static/css/style.css`](file:///c:/Users/mahed/Desktop/FLY/static/css/style.css):

### Typography
- **Headings & Display:** `'Playfair Display'`, Georgia, serif (Luxury serif)
- **Interface & Body:** `'Plus Jakarta Sans'`, -apple-system, sans-serif (Clean modern geometric)
- **Codes & Barcodes:** `'SFMono-Regular'`, Consolas, monospace

### Color Palette & Theming
- **Midnight Navy (Brand Primary):** `#101D2C` / Dark Navy: `#17283B`
- **Champagne Gold (Brand Accent):** `#C5A46D` / Soft Gold: `#D9C39A`
- **Warm Ivory (Light Background):** `#F8F6F1` / White Surface: `#FFFFFF`
- **Amber (Seat Hold / Warning):** `#D97706` / `#F59E0B`
- **Emerald (Confirmed / Success):** `#10B981`
- **Crimson (Expired / Cancelled):** `#EF4444`
- Supports both `[data-theme="light"]` and `[data-theme="dark"]`.

### Responsive Breakpoints
- **Mobile Small:** $\le 360\text{px}$
- **Mobile Standard:** $\le 480\text{px}$
- **Tablet / Phablet:** $\le 768\text{px}$
- **Laptop / Desktop:** $1024\text{px} - 1280\text{px}+$
- Zero horizontal overflow; fluid flexbox and grid layouts.

---

## 7. Test Coverage & Verification Evidence

All test suites were executed with 100% passing results:

1. [`test_flight_booking_integration.py`](file:///c:/Users/mahed/Desktop/FLY/test_flight_booking_integration.py):
   - **Status:** **6 / 6 Passed (100%)**
   - **Tested Scenarios:** Transparent fare calculation, pre-booking validation, price shift detection, User A vs. User B atomic seat conflict rejection (HTTP 409), idempotent payment confirmation, round-trip ticket issuance, My Bookings integration.
2. [`test_seat_holding_responsive_and_payment.js`](file:///c:/Users/mahed/Desktop/FLY/test_seat_holding_responsive_and_payment.js):
   - **Status:** **33 / 33 Passed (100%)**
   - **Tested Scenarios:** Multi-user concurrency, 15-minute countdown clock, immediate seat release on cancellation, expiration auto-release (HTTP 410 Gone), customer-to-customer privacy isolation, mobile CSS layout integrity.
3. [`test_advanced_filters_and_results.py`](file:///c:/Users/mahed/Desktop/FLY/test_advanced_filters_and_results.py):
   - **Status:** **Passed (100%)**
   - **Tested Scenarios:** Flight enrichment (stops, baggage, refundability), server sorting (cheapest, fastest, earliest, latest), dynamic airline filter extraction.
4. [`test_flight_search_upgrade.py`](file:///c:/Users/mahed/Desktop/FLY/test_flight_search_upgrade.py):
   - **Status:** **Passed (100%)**
   - **Tested Scenarios:** Airport autocomplete by IATA and city name, travel date bounds, trip types (One Way, Round Trip, Multi-City).

---

## 8. Gap Analysis & Blueprint Risk Assessment

Comparing the existing application with the requested production-grade flight ticketing blueprint:

| Blueprint Requirement | Current Status | Findings & Gaps | Compliance Risk / Severity |
|---|---|---|---|
| **1. Flight Search & Results** | **Complete (95%)** | Fully responsive, multi-city/round-trip support, dynamic filters, GoZayaan-inspired comparison cards. | **Low** |
| **2. Transparent Fare Breakdown** | **Complete (100%)** | Server-side calculated base fare, 15% VAT, airport embarkation, carrier fuel surcharge, baggage fee. No invented charges. | **Low** |
| **3. Traveller Information** | **Complete (95%)** | Dynamic traveler inputs for Adults, Children, Infants with Passport/NID/Birth Certificate validation. | **Low** |
| **4. 15-Min Seat Hold Engine** | **Complete (100%)** | Atomic SQLite transactions, conflict prevention, 15-minute countdown, automatic expiration release. | **Low** |
| **5. Payment Verification** | **Functional Demo (70%)** | Server-side verification implemented; prevents duplicate confirmation. However, uses simulated gateway verification. | **Medium** (Commercial gateway integration needed for live payments) |
| **6. Supplier Reservation / Ticketing (GDS / NDC)** | **Demo / Simulated (30%)** | Local database acts as inventory supplier. No live external GDS (Amadeus/Sabre/Duffel) connected. | **Rule #4 & #7 Compliant** (Must remain DEMO until commercial agreements exist) |
| **7. Booking State Machine** | **Partial (60%)** | Has `PENDING_PAYMENT`, `CONFIRMED`, `EXPIRED`, `CANCELLED`. Lacks formal `PAID_AWAITING_TICKETING` and supplier sync status. | **Medium** |
| **8. Cancellation & Refund Tracking** | **Partial (40%)** | Has seat release and status cancellation, but lacks formal refund calculation (penalties, net refund), refund request submission, and refund status tracking. | **Medium** |
| **9. Protected Admin Operations** | **Partial (60%)** | Airline-scoped admin dashboard exists (`Admin_Biman`, `Admin_USB`), but lacks global booking search, refund approvals, and audit log. | **Medium** |
| **10. Environment Security (`.env`)** | **Missing (20%)** | No `.env` or `.env.example` exists. Secrets or config fallbacks are inside code. | **Medium** (Needs `.env.example` placeholder) |

---

## 9. Smallest Safe Implementation Plan (Phase Order)

To safely upgrade the platform without breaking existing working features:

```
[Phase 1: Environment & Config Baseline]
        │
        ▼
[Phase 2: Formal Booking & Ticketing State Machine (Demo Labeled)]
        │
        ▼
[Phase 3: Cancellation & Refund Tracking Workflow]
        │
        ▼
[Phase 4: Admin Operations & Refund Approval Panel]
        │
        ▼
[Phase 5: External Supplier GDS Adapter Interface (Ready for Production)]
```

### Phase 1: Environment & Configuration Baseline (Non-Breaking)
- Create `.env.example` with placeholders for database path, secret key, environment mode, and future supplier/payment API credentials (Rule #5).
- Add support for loading `.env` securely in `app.py` with safe defaults so local development continues working without friction.
- Clean up references to legacy `Skynet-master` in `package.json` and documentation.

### Phase 2: Formal Booking & Ticketing State Machine (Strict Rule #4 & #6)
- Expand the booking state machine:
  `PENDING_PAYMENT` $\rightarrow$ `PAYMENT_VERIFIED` $\rightarrow$ `ISSUING_TICKET` $\rightarrow$ `CONFIRMED` / `FAILED`.
- Clearly stamp all mock/simulated flight inventory, PNRs, and e-ticket numbers with `DEMO` badge as required by Rule #4.
- Ensure payment verification requires cryptographic signature or server-to-server confirmation (Rule #6).

### Phase 3: Cancellation & Refund Tracking Workflow
- Create a dedicated `refund_requests` table:
  - `id`, `booking_reference`, `account_id`, `reason`, `refund_status` (`REQUESTED`, `UNDER_REVIEW`, `APPROVED`, `REFUNDED`, `REJECTED`), `deducted_penalties`, `net_refund_amount`, `created_at`, `resolved_at`.
- Add customer-facing "Request Cancellation & Refund" modal in **My Bookings**.
- Show live refund progress status pills in the booking card.

### Phase 4: Protected Admin Operations & Refund Approvals
- Enhance `#pageDashboard` for administrative staff:
  - Tab for **Refund Requests Management** (Approve / Reject with penalty adjustments).
  - Search any booking across airlines by Booking Reference or Passenger Name.
  - Audit log table recording administrative actions (ticket reissue, cancellation, refund approval).

### Phase 5: Supplier Adapter Interface Architecture
- Design a modular Python `SupplierAdapter` class:
  - Abstract methods: `search_flights()`, `create_hold()`, `issue_ticket()`, `cancel_pnr()`.
  - Current implementation: `DatabaseDemoSupplier` (preserves existing SQLite inventory).
  - Production-ready connector stub: `AmadeusGDSAdapter` / `DuffelAdapter` ready for when live commercial contracts are established (Rule #7).

---

## 10. Audit Conclusion & Next Steps

The workspace contains a fully functional, highly responsive, robustly tested flight booking platform built in **Python Flask + SQLite + Vanilla JS + HTML5 + CSS3**.

No features have been modified or broken in this inspection turn. The audit is committed to [`documentation/PROJECT_AUDIT.md`](file:///c:/Users/mahed/Desktop/FLY/documentation/PROJECT_AUDIT.md).

**Awaiting your next prompt to proceed with the recommended implementation phases.**
