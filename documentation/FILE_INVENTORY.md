# Complete File & Dependency Inventory: FLY Ticketing Platform

**Audit Date:** November 25, 2026  
**Audited Repository:** `FLY` (`skynet-master`)  
**Scope:** Complete inventory of all folders, source code files, configuration files, test scripts, assets, dependencies, and legacy remnants.

---

## 1. Directory Tree Architecture

```
FLY (Repository Root)
├── .env.example                                  # Master environment configuration template
├── app.py                                        # Python Flask primary web application & API
├── database.py                                   # SQLite atomic transaction layer & database helper
├── requirements.txt                              # Python runtime dependencies (Flask >= 3.0.0)
├── package.json                                  # Node.js dependencies for test suites & legacy runner
├── auto_pusher.js                                # 20-minute periodic Git auto-sync daemon
├── auto_push_state.json                          # State tracking file for auto_pusher
├── auto_push.log                                 # Execution audit log for Git auto-sync
├── start.bat                                     # 1-Click Windows execution script for Flask
├── deploy_netlify.bat                            # Netlify static deployment trigger
├── netlify.toml                                  # Netlify redirect and build configuration
│
├── database/                                     # Active SQLite Database Directory
│   └── flight_booking.db                         # Primary SQLite database (11.0 MB, 40k+ records)
│
├── templates/                                    # Semantic HTML5 / Jinja2 Templates
│   ├── 404.html                                  # Branded 404 error page
│   ├── base.html                                 # Master base layout (head, nav, footer, modals)
│   ├── index.html                                # Single-page booking container (legacy/hybrid)
│   ├── my_bookings.html                          # Root bookings redirect template
│   ├── payment.html                              # Root payment template
│   ├── seat_selection.html                       # Standalone seat selection view
│   ├── components/                               # Modular Reusable Jinja Components
│   │   ├── breadcrumb.html                       # Accessible navigation breadcrumb
│   │   ├── card.html                             # Standard card component
│   │   ├── demo_notice.html                      # Explicit demo mode notice banner
│   │   ├── empty_state.html                      # Accessible empty state component
│   │   ├── error_banner.html                     # Standard inline error banner
│   │   ├── form_field.html                       # Accessible form input field wrapper
│   │   ├── loading_state.html                    # Loading skeleton container
│   │   ├── page_heading.html                     # Standard page title & eyebrow header
│   │   └── stepper.html                          # 6-step booking checkout stepper
│   └── pages/                                    # Dedicated Multi-Page Views
│       ├── admin_operations.html                 # 12-module operational admin console
│       ├── auth.html                             # Dedicated login & demo accounts quick-fill
│       ├── booking_status.html                   # Booking confirmation, timeline & e-ticket
│       ├── extras.html                           # Seat map, meals, baggage & insurance
│       ├── flight_search.html                    # Search parameters & results comparison
│       ├── home.html                             # Modern flight search homepage
│       ├── manage_booking.html                   # Guest PNR lookup & cancellation/refund
│       ├── my_bookings.html                      # Authenticated customer trips list
│       ├── offer_details.html                    # Single offer itinerary & baggage breakdown
│       ├── payment.html                          # Payment method selection & sandbox hold
│       ├── payment_result.html                   # Payment success, cancel, and decline handler
│       ├── review.html                           # 15-min price lock review & acknowledgments
│       ├── support.html                          # 24/7 passenger care & FAQ accordion
│       └── travellers.html                       # Route-aware passenger & document forms
│
├── static/                                       # Client-Side Assets
│   ├── css/                                      # Stylesheets
│   │   ├── style.css                             # Master responsive design system (123 KB)
│   │   └── admin.css                             # Operations console high-density styles
│   └── js/                                       # Modular Vanilla JavaScript Controllers
│       ├── admin_console.js                      # Operations dashboard & RBAC controller
│       ├── app.js                                # Legacy client SPA router
│       ├── checkout_store.js                     # Tab-scoped in-memory booking store & validation
│       ├── flight_fixtures.js                    # Airline routes and demo mock inventory
│       ├── flight_models.js                      # FlightOffer, Segment, Passenger DTO models
│       ├── flight_results_controller.js          # Search results rendering & live filters
│       ├── flight_search_widget.js               # Autocomplete, swap button & multi-city legs
│       ├── main.js                               # Shell event listeners and modal handlers
│       ├── payment.js                            # Payment submission and card formatters
│       ├── seat_selection.js                     # Interactive cabin seat map engine
│       └── shell.js                              # Navbar, theme toggle & mobile drawer
│
├── backend/                                      # Enterprise Laravel 11/12 API Backend
│   ├── artisan                                   # Laravel CLI executable
│   ├── composer.json                             # PHP dependencies (Laravel 11, DomPDF, Sanctum)
│   ├── phpunit.xml                               # Automated test configuration
│   ├── app/                                      # Domain Architecture
│   │   ├── DTOs/                                 # 11 Normalized Provider-Independent DTOs
│   │   ├── Http/Controllers/Api/V1/              # API Controllers (Flight, Booking, Payment, Admin)
│   │   ├── Models/                               # 22 Eloquent Domain Models
│   │   ├── Services/                             # Core Business Services
│   │   │   ├── Orchestration/                    # Booking state machine, locks, queues
│   │   │   ├── Payments/                         # PaymentGatewayInterface, SSLCOMMERZ, Sandbox
│   │   │   ├── Providers/                        # FlightProviderInterface, Amadeus, Mock
│   │   │   ├── Servicing/                        # Cancellation, refund calculation
│   │   │   └── Ticketing/                        # Authoritative ticketing, DomPDF generation
│   │   └── Jobs/                                 # Async background reconciliation jobs
│   ├── database/                                 # Database migrations & SQLite storage
│   │   ├── database.sqlite                       # Test database
│   │   └── migrations/                           # 23 incremental schema migrations
│   └── tests/                                    # Automated Test Suite (164 passing tests)
│       ├── Unit/                                 # State machine, DTO, pricing unit tests
│       ├── Feature/                              # Controller and API endpoint tests
│       ├── Integration/                          # Concurrency, lock, and transaction tests
│       └── Contract/                             # Payment webhook & provider contract tests
│
├── documentation/                                # Master Documentation Repository
│   ├── PROJECT_AUDIT.md                          # Comprehensive architectural audit
│   ├── FEATURE_INVENTORY.md                      # Feature & interactive element inventory
│   ├── FILE_INVENTORY.md                         # This file
│   ├── RENAME_AND_CLEANUP_PLAN.md                # Project renaming & safe cleanup roadmap
│   ├── BASELINE_TEST_REPORT.md                   # Automated baseline test execution evidence
│   ├── IMPLEMENTATION_PLAN.md                    # Phased implementation roadmap
│   ├── SYSTEM_ARCHITECTURE.md                    # System architecture design document
│   ├── DATABASE_ERD.md                           # Entity Relationship Diagram & schemas
│   ├── BOOKING_STATE_MACHINE.md                  # State transition definitions
│   ├── BOOKING_ORCHESTRATION.md                  # Lock and queue orchestration logic
│   ├── PROVIDER_INTEGRATION_GUIDE.md             # GDS & aggregator integration guide
│   ├── PROVIDER_DECISIONS.md                     # Provider evaluation and decision matrix
│   ├── SECURITY_AND_PRIVACY.md                   # Security protocols & PCI-DSS compliance
│   ├── STAGING_DEPLOYMENT_AND_ROLLBACK.md        # Deployment and rollback protocols
│   ├── TEST_STRATEGY.md                          # Quality assurance strategy
│   ├── PRODUCT_REQUIREMENTS.md                   # Product specification & PRD
│   ├── FINAL_ACCEPTANCE_REPORT.md                # Commercial acceptance checklist
│   └── PRODUCTION_READINESS_AND_COMMERCIAL_GATE.md # Production readiness gate
│
├── tests/                                        # Additional Test Runners
│   └── ui_accessibility_and_responsive.test.js   # WCAG 2.1 AA & Responsive test runner
│
├── Skynet-master/                                # Legacy Subdirectory (Historical Remnants)
│   ├── package.json                              # Legacy root manifest
│   ├── README.txt                                # Historical documentation
│   ├── start.bat                                 # Legacy batch file
│   └── Skynet-master/web/                        # Legacy Node/Express edition
│       ├── server.js                             # Express.js server (88 KB)
│       ├── database.db                           # Legacy duplicate SQLite DB
│       └── public/                               # Legacy web assets
│
└── Test Scripts (Root Level):
    ├── test_advanced_filters_and_results.py
    ├── test_auth_rbac_api.js
    ├── test_checkout_flow.js
    ├── test_clean_login_page.js
    ├── test_complete_auth_rbac.js
    ├── test_customer_privacy_security.js
    ├── test_flight_booking_integration.py
    ├── test_flight_card_layout.js
    ├── test_flight_search_results.js
    ├── test_flight_search_upgrade.py
    ├── test_flight_search_widget_validation.js
    ├── test_seat_holding_responsive_and_payment.js
    ├── verify_all_five_test_cases.py
    ├── verify_homepage_visual_qa.js
    └── verify_public_routes_and_shell.js
```

---

## 2. Dependency Audit & Manifests

### Python Environment (`requirements.txt`)
- `Flask>=3.0.0` (Active: Flask 3.1.3, Jinja2 3.1.6, Werkzeug 3.1.9)
- Native libraries used: `sqlite3`, `json`, `hashlib`, `datetime`, `re`, `os`, `sys`, `unittest`.
- *Assessment:* Very lean, zero bloated third-party dependencies, highly secure.

### PHP / Laravel Environment (`backend/composer.json`)
- `php: ^8.3`
- `laravel/framework: ^13.17`
- `laravel/sanctum: ^4.0` (Token-based API authentication)
- `dompdf/dompdf: ^3.1` (PDF e-ticket and boarding pass document generation)
- `phpunit/phpunit: ^12.5.12` (Automated testing framework)
- *Assessment:* Modern, production-standard, fully locked via `composer.lock`.

### Node.js Environment (`package.json`)
- Root `package.json`:
  - `cors: ^2.8.6`
  - `express: ^5.3.0`
  - `serverless-http: ^4.0.0`
- *Assessment:* Used primarily for legacy Express compatibility and serverless deployment experiments. In the Flask + Laravel runtime, this is not needed for core web serving, but powers test runners.

---

## 3. Redundancy & Legacy Remnants Analysis

| Item | Location | Status | Action in Future Phase |
| :--- | :--- | :--- | :--- |
| **Legacy Database** | `Skynet-master/Skynet-master/web/database.db` | **Duplicate** of `database/flight_booking.db` | Safe to archive/remove after rename phase |
| **Legacy Server** | `Skynet-master/Skynet-master/web/server.js` | **Obsolete** (superseded by Flask & Laravel) | Safe to archive/remove after rename phase |
| **Legacy Manifest** | `Skynet-master/package.json` | **Redundant** | Safe to remove in cleanup phase |
| **Nested Skynet Folder** | `Skynet-master/Skynet-master/` | **Accidental Nesting** | Clean up during project restructuring |
| **Root Test Scripts** | Root `test_*.js` / `test_*.py` (15 files) | **Functional Test Scripts** | Consolidate into dedicated `tests/` directory |
