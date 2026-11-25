# FLY — Finalized System Architecture

**Based On:** `PROJECT_AUDIT.md` and `IMPLEMENTATION_ROADMAP.md`  
**Phase:** Architecture Finalization & Development Preparation  
**Architectural Style:** Modular Monolith (Python Flask + Jinja2 + Vanilla JS + PostgreSQL/SQLite)

---

## 1. Architectural Decision & Stack Preservation

Per [PROJECT_AUDIT.md](file:///c:/Users/mahed/Desktop/FLY/PROJECT_AUDIT.md), the active runtime served by `start.bat` (`python app.py`) is **Python Flask + Jinja2 + Vanilla JavaScript + CSS3**, backed by a relational SQLite database (`database/flight_booking.db`) during local development. Meanwhile, `.env.example` already defines `DATABASE_URL=postgresql://...` for production deployment.

Rather than introducing a separate frontend framework (React/Next.js) or splitting into microservices, FLY finalizes on a **Single Modular Monolith**:

| Layer | Technology Choice | Responsibility |
| :--- | :--- | :--- |
| **Presentation (Server-Rendered Shell)** | **Jinja2 Templates** (`templates/base.html` + `templates/pages/*.html` + `templates/components/*.html`) | Unified fixed header, active route indicator, SEO metadata, SSR page shells, reusable UI macros |
| **Client Interactivity** | **Modular Vanilla JS (ES6)** (`static/js/*.js`) + **Custom CSS3** (`static/css/style.css`, `static/css/admin.css`) | Airport autocomplete, live search filtering, aircraft seat map interaction, hold countdown timers, Fetch API integration, dark/light theme |
| **Application & API Core** | **Python 3.12 + Flask (`>=3.0.0`)** structured via Flask Blueprints & Domain Services | Route rendering, JSON REST APIs, `scrypt` authentication, RBAC & airline tenant guard decorators, atomic transactions |
| **Database Authority** | **PostgreSQL 16+** (Production Target via `DATABASE_URL`) / **SQLite WAL** (Local Dev fallback) | Single source of truth for seats, holds, bookings, tickets, accounts, airlines, and audit logs |
| **Decommissioned Stacks** | `Skynet-master/` (Node/Express) & `backend/` (Laravel/PHP) | Excluded from active runtime; scheduled for archival/removal in Sprint 1 cleanup |

---

## 2. High-Level System Topology

```text
+-------------------------------------------------------------------------+
|                    CLIENT BROWSER (HTML5 / CSS3 / Vanilla JS)           |
|  - Shared Shell: shell.js (fixed header, account dropdown, theme)       |
|  - Modules: flight_search_widget.js, flight_results_controller.js,      |
|    checkout_controller.js, my_bookings.js, manage_booking.js,           |
|    admin_console.js                                                     |
+------------------------------------+------------------------------------+
                                     | HTTPS / JSON + Bearer Token / Cookie
+------------------------------------v------------------------------------+
|                 PYTHON FLASK MODULAR MONOLITH (app.py)                  |
|                                                                         |
|  +-------------------------------------------------------------------+  |
|  | 1. Web & API Transport Layer (Flask Blueprints)                   |  |
|  |   - pages_bp        (/, /flights/*, /booking/*, /my-bookings,     |  |
|  |                      /manage-booking, /support, /login, /admin)   |  |
|  |   - auth_bp         (/api/auth/*, /logout)                        |  |
|  |   - catalog_bp      (/api/airports/*, /api/flights/*)             |  |
|  |   - booking_bp      (/api/bookings/*, /api/reservations/*)        |  |
|  |   - airline_bp      (/api/airline/* - strict airlineId isolation) |  |
|  |   - admin_bp        (/api/admin/* - role-gated operations)        |  |
|  +---------------------------------+---------------------------------+  |
|                                    |                                    |
|  +---------------------------------v---------------------------------+  |
|  | 2. Centralized Security & Middleware Layer                        |  |
|  |   - @require_auth, @require_roles(...), @require_airline_scope    |  |
|  |   - Cache-Control headers, CSRF/Origin checks, rate limiting      |  |
|  +---------------------------------+---------------------------------+  |
|                                    |                                    |
|  +---------------------------------v---------------------------------+  |
|  | 3. Domain Business Services (Pure Python, DB-Transaction Aware)   |  |
|  |   - AuthService       (scrypt hashing, session lifecycle, RBAC)   |  |
|  |   - FlightService     (search, enrichment, stops, baggage rules)  |  |
|  |   - PricingService    (single-source fare & tax calculation)      |  |
|  |   - SeatLockService   (15-min atomic seat holds & expiry sweep)   |  |
|  |   - BookingService    (state machine, PNR lookup, cancellation)   |  |
|  |   - TicketingService  (PNR + 13-digit e-ticket issuance)          |  |
|  |   - AdminService      (tenant-scoped CRUD, refunds, audit log)    |  |
|  +---------------------------------+---------------------------------+  |
|                                    |                                    |
|  +---------------------------------v---------------------------------+  |
|  | 4. Data Access / Repository Layer (db.py)                         |  |
|  |   - Unified connection/cursor abstraction supporting PostgreSQL   |  |
|  |     (psycopg pool via DATABASE_URL) and SQLite WAL (local dev)    |  |
|  +---------------------------------+---------------------------------+  |
+------------------------------------|------------------------------------+
                                     | Atomic Transactions (SERIALIZABLE /
                                     | SELECT FOR UPDATE / BEGIN IMMEDIATE)
+------------------------------------v------------------------------------+
|           RELATIONAL DATABASE (PostgreSQL 16+ / SQLite WAL)             |
|   accounts | auth_sessions | airLines | airports | flights | seats      |
|   bookings | booking_passengers | reservations | tickets |              |
|   refund_requests | payment_methods_masked | favorites | audit_logs     |
+-------------------------------------------------------------------------+
```

---

## 3. Clean Target Backend Structure

During implementation, `app.py` (currently 1,551 lines) and `database.py` (753 lines) will be cleanly modularized without breaking existing entrypoint imports (`python app.py` and `start.bat` remain intact):

```text
c:\Users\mahed\Desktop\FLY\
├── app.py                          # Application factory & entrypoint (registers Blueprints)
├── config.py                       # Env-driven config (DATABASE_URL, SECRET_KEY, hold TTL)
├── db.py                           # Unified PostgreSQL / SQLite connection & transaction helper
├── database.py                     # Backward-compatible facade delegating to db.py & services/
├── fly/
│   ├── __init__.py
│   ├── middleware/
│   │   ├── auth.py                 # Token extraction, @require_auth, @require_roles
│   │   ├── tenant.py               # @require_airline_scope & booking ownership verification
│   │   └── errors.py               # Standardized JSON & HTML error handlers (400/401/403/404/409/500)
│   ├── routes/
│   │   ├── pages.py                # All Jinja2 HTML page routes
│   │   ├── auth.py                 # /api/auth/login, register, logout, me, profile, /logout
│   │   ├── catalog.py              # /api/airports/*, /api/flights/*, /api/airlines/*/logo
│   │   ├── bookings.py             # /api/bookings/validate, hold, confirm, cancel, lookup, <ref>
│   │   ├── reservations.py         # /api/reservations/my, /api/reservations/ticket/<ref>
│   │   ├── account.py              # /api/cards (masked only), /api/favorites
│   │   └── admin.py                # /api/airline/* (tenant-scoped) & /api/admin/* (RBAC-gated)
│   └── services/
│       ├── auth_service.py         # scrypt hash/verify, legacy hash upgrade, registration
│       ├── flight_service.py       # Dynamic search queries, enrichment, airline flight CRUD
│       ├── pricing_service.py      # Authoritative fare breakdown & revalidation
│       ├── seat_service.py         # Seat map availability & atomic hold/release engine
│       ├── booking_service.py      # Booking lifecycle state machine & PNR+surname verification
│       ├── ticket_service.py       # PNR + 13-digit IATA e-ticket issuance & boarding pass data
│       └── audit_service.py        # Immutable admin_audit_logs writer
```

---

## 4. Clean Target Frontend Structure

All pages inherit `templates/base.html` and communicate strictly with live Flask REST APIs via a shared client API helper (`static/js/api_client.js`) — eliminating fixture-only pages and `sessionStorage`-only checkout mocks.

```text
templates/
├── base.html                       # Single shared global fixed header, mobile drawer, theme script
├── 404.html                        # Branded 404 recovery view
├── components/
│   ├── card.html                   # Reusable summary/offer card macro
│   ├── demo_notice.html            # Environment/sandbox banner macro
│   ├── empty_state.html            # Consistent empty/no-results macro
│   ├── error_banner.html           # Standardized API error & retry banner macro
│   ├── form_field.html             # Accessible labelled form inputs
│   ├── loading_state.html          # Skeleton loading macro
│   ├── page_heading.html           # Unified page header macro
│   └── stepper.html                # 6-step circular booking progress indicator
└── pages/
    ├── home.html                   # Hero + search widget + curated routes
    ├── flight_search.html          # Live GET /api/flights results + dynamic filters
    ├── offer_details.html          # Live GET /api/flights/<id> + fare breakdown
    ├── travellers.html             # Multi-passenger + contact input (persisted to booking draft)
    ├── extras.html                 # Real aircraft seat map (/api/flights/<id>/seats) + baggage/meals
    ├── review.html                 # Live POST /api/bookings/validate + POST /api/bookings/hold
    ├── payment.html                # Real backend countdown + POST /api/bookings/confirm
    ├── payment_result.html         # Server-verified payment outcome redirect view
    ├── booking_status.html         # Live boarding pass & PNR/e-ticket view
    ├── my_bookings.html            # Authenticated user bookings via GET /api/reservations/my
    ├── manage_booking.html         # Public PNR + Last Name lookup via POST /api/bookings/lookup
    ├── support.html                # Help desk, baggage/refund policy, FAQs
    ├── auth.html                   # Unified Sign In / Register / Profile Management portal
    └── admin_operations.html       # Auth-protected Airline & Operations Admin Console

static/
├── css/
│   ├── style.css                   # Master responsive design system (light/dark tokens)
│   └── admin.css                   # Admin console styles
├── js/
│   ├── api_client.js               # Centralized Fetch wrapper (Bearer token, 401 handler, error normalization)
│   ├── shell.js                    # Fixed header dropdown, theme toggle, mobile drawer, logout
│   ├── flight_search_widget.js     # Home airport autocomplete & search parameter builder
│   ├── flight_results_controller.js# Live /api/flights querying, filtering, sorting
│   ├── checkout_store.js           # Client state synced with server booking reference & fare validation
│   ├── seat_selection.js           # Reusable interactive seat-map component embedded in extras.html
│   ├── my_bookings.js              # Dynamic my-bookings hydration, countdowns, cancel/resume actions
│   ├── manage_booking.js           # PNR + surname verification & self-service actions
│   ├── auth_portal.js              # Login, registration & profile editing controller
│   └── admin_console.js            # Live RBAC-gated admin dashboard, flight CRUD, booking/refund actions
└── images/                         # Pruned to actively referenced assets only
```

### Files Scheduled for Decommissioning (Sprint 1)
- Duplicate / dead scripts: `static/js/main.js` (duplicate of `app.js`), `static/js/payment.js` (bound to unused root templates), `static/js/flight_fixtures.js` (retired once live API search is wired).
- Duplicate root templates: `templates/my_bookings.html`, `templates/payment.html`, `templates/seat_selection.html`, `templates/index.html` (after retiring `/spa` and `/seat-selection` redirects).
- Unused images (`8` files in `static/images/`): `duke.ico`, `fly_icon.png`, `fly_logo.png`, `fly_logo_dark.svg`, `fly_logo_light.png`, `fly_logo_light.svg`, `SkynetLogo.ico`, `SkynetLogo.png`.
- Legacy parallel folders: `Skynet-master/` and `backend/` (to be archived/removed outside the active runtime once Netlify config is updated or retired).

---

## 5. Core Architectural Invariants

1. **Database Is the Single Source of Seat Truth:** Client `sessionStorage` or UI radio buttons never determine seat availability. Only rows in `reservations` with active status (`PENDING_PAYMENT`, `HELD`, `CONFIRMED`) count as unavailable.
2. **Authoritative Server Pricing:** `PricingService` calculates every fare, tax, surcharge, and luggage charge server-side. Client totals are only checked via `expectedFare` to alert users if inventory prices shifted (`409` / `FARE_CHANGED`).
3. **Strict Airline Tenant Isolation:** Every query executed for an `AIRLINE_ADMIN` is filtered server-side by `WHERE f.id_airline = user.airline_id` derived strictly from the validated `auth_sessions` token — never from client-supplied `airlineId` query/body fields.
4. **Centralized Business Logic:** Fare math, hold expiration sweeps, PNR lookup, and cancellation rules reside once in `fly/services/*` so web routes, admin routes, and automated tests execute identical logic.
