# Project File Structure: FLY Flight Ticketing Platform

**Project Name:** FLY (`Fly`)  
**Maintained By:** `mahin1710`  
**Current Directory:** `c:\Users\mahed\Desktop\FLY`  
**Last Updated:** November 25, 2026

---

## 1. Directory Tree & Purpose Overview

```
FLY/
│
├── app.py                              # Primary Python Flask web application & API routing
├── database.py                         # Concurrency-safe SQLite access layer & atomic locking
├── start.bat                           # 1-Click Windows execution script for Flask server
├── package.json                        # Node.js project manifest for test runners & tooling
├── requirements.txt                    # Python environment dependencies (Flask >= 3.0.0)
├── auto_pusher.js                      # 20-minute automated Git synchronization daemon
├── auto_push_state.json                # State persistence file for auto_pusher
├── auto_push.log                       # Execution log for background auto_pusher daemon
├── .env.example                        # Root environment configuration template
├── deploy_netlify.bat                  # Netlify deployment trigger script
├── netlify.toml                        # Netlify routing and build configuration
│
├── database/                           # Active Database Storage
│   └── flight_booking.db               # Master SQLite database (11 MB, 40k+ records)
│
├── templates/                          # Semantic HTML5 / Jinja2 Templates
│   ├── base.html                       # Global base layout (head, nav, footer, toasts)
│   ├── 404.html                        # Branded 404 error template
│   ├── index.html                      # Legacy SPA container
│   ├── my_bookings.html                # Booking history template
│   ├── payment.html                    # Payment checkout template
│   ├── seat_selection.html             # Seat map template
│   ├── components/                     # Modular Reusable Jinja Components
│   │   ├── breadcrumb.html             # Accessible breadcrumb trail
│   │   ├── card.html                   # Card container
│   │   ├── demo_notice.html            # Honest demo / sandbox warning banner
│   │   ├── empty_state.html            # Accessible empty state indicator
│   │   ├── error_banner.html           # Inline form error alert
│   │   ├── form_field.html             # Accessible input wrapper with label & error
│   │   ├── loading_state.html          # Skeleton loading placeholder
│   │   ├── page_heading.html           # Page heading & eyebrow title
│   │   └── stepper.html                # 6-step responsive checkout progress stepper
│   └── pages/                          # Dedicated Multi-Page Views
│       ├── admin_operations.html       # 12-module operational admin console
│       ├── auth.html                   # Authentication & sample accounts quick-fill
│       ├── booking_status.html         # Digital boarding pass, status stepper & e-ticket
│       ├── extras.html                 # Seat map, catering, luggage & insurance
│       ├── flight_search.html          # Search widget & dynamic comparison cards
│       ├── home.html                   # Flight search homepage
│       ├── manage_booking.html         # Guest PNR lookup & cancellation/refund
│       ├── my_bookings.html            # Authenticated traveler journeys list
│       ├── offer_details.html          # Offer segments & baggage rules view
│       ├── payment.html                # Hosted checkout sandbox & hold countdown
│       ├── payment_result.html         # Verification result (captured, cancel, failed)
│       ├── review.html                 # 15-min price lock review & legal terms
│       ├── support.html                # 24/7 helpline channels & FAQ accordion
│       └── travellers.html             # Route-aware passenger & document forms
│
├── static/                             # Client-Side Assets
│   ├── css/                            # Master Stylesheets
│   │   ├── style.css                   # Responsive design system & WCAG 2.1 AA rules
│   │   └── admin.css                   # Operations console high-density layout
│   └── js/                             # Modular JavaScript Controllers
│       ├── admin_console.js            # Operations dashboard controller
│       ├── app.js                      # Client router
│       ├── checkout_store.js           # In-memory booking store & validation engine
│       ├── flight_fixtures.js          # Simulated route data
│       ├── flight_models.js            # DTO models (FlightOffer, Segment, Passenger)
│       ├── flight_results_controller.js# Results rendering, filtering & sorting
│       ├── flight_search_widget.js     # Autocomplete, swap button & multi-city
│       ├── main.js                     # Global modal handlers & event listeners
│       ├── payment.js                  # Payment submission formatting
│       ├── seat_selection.js           # Aircraft cabin seat grid
│       └── shell.js                    # Navbar, mobile drawer & theme toggle
│
├── backend/                            # Enterprise Laravel 11/12 API Engine
│   ├── artisan                         # Laravel CLI tool
│   ├── composer.json                   # PHP package manifest (Laravel 11, DomPDF, Sanctum)
│   ├── phpunit.xml                     # Test suite configuration
│   ├── app/                            # Domain Architecture
│   │   ├── DTOs/                       # 11 Normalized Provider-Independent DTOs
│   │   ├── Http/Controllers/Api/V1/    # Controllers (Flight, Booking, Payment, Admin)
│   │   ├── Models/                     # 22 Eloquent Domain Models
│   │   ├── Services/                   # Hexagonal Services (State Machine, Adapters)
│   │   └── Jobs/                       # Async reconciliation queue workers
│   ├── database/                       # Migrations & SQLite database
│   │   ├── database.sqlite             # Test database
│   │   └── migrations/                 # 23 schema migrations
│   └── tests/                          # 164 Automated Tests (100% Passing)
│
├── documentation/                      # Master Documentation Repository
│   ├── ARCHITECTURE.md                 # System architecture overview
│   ├── BASELINE_TEST_REPORT.md         # Baseline test execution evidence
│   ├── CODEBASE_CLEANUP_REPORT.md      # Renaming and cleanup report
│   ├── DEVELOPMENT_GUIDE.md            # Developer setup and contribution guide
│   ├── ENVIRONMENT_SETUP.md            # Local and staging environment setup
│   ├── FEATURE_INVENTORY.md            # Feature and interactive control audit
│   ├── FILE_INVENTORY.md               # Directory and file inventory
│   ├── FILE_STRUCTURE.md               # This document
│   ├── IMPLEMENTATION_PLAN.md          # Phased engineering roadmap
│   ├── PROJECT_AUDIT.md                # Comprehensive technical audit
│   ├── RENAME_AND_CLEANUP_PLAN.md      # Project renaming plan
│   └── SYSTEM_ARCHITECTURE.md          # Modular monolith technical spec
│
├── tests/                              # Global Test Suite Runners
│   └── ui_accessibility_and_responsive.test.js # WCAG 2.1 AA & Responsive test suite
│
├── Skynet-master/                      # Preserved Legacy Foundation (Historical Archive)
│   ├── README.txt                      # Historical documentation
│   ├── package.json                    # Historical manifest
│   ├── start.bat                       # Historical batch file
│   └── Skynet-master/web/              # Legacy Node.js prototype
│
└── Root Test Scripts:                  # Standalone Verification Scripts
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
