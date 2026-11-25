# FLY — Cleaned Project File Structure

**Phase:** 10 — Project Cleanup & Final File Organization  

---

```text
c:\Users\mahed\Desktop\FLY\
├── app.py                              # Flask entrypoint, Blueprint registration, security headers, 30s sweep daemon
├── config.py                           # Centralized environment & policy configuration
├── database.py                         # SQLite WAL transaction engine, locking, fare, promo & PNR/ticket operations
├── requirements.txt                    # Python dependency specification (Flask>=3.0.0)
├── package.json                        # Clean npm script aliases (start, test)
├── start.bat                           # Local Windows launcher (opens localhost:5000 & runs app.py)
├── auto_pusher.js                      # Background GitHub sync utility
├── .env.example                        # Safe environment template (no real secrets)
├── .gitignore                          # Excludes .env, SQLite WAL journals, pycache, node_modules, logs
│
├── fly/                                # Modular Backend Package
│   ├── __init__.py
│   ├── middleware/
│   │   ├── __init__.py
│   │   └── auth.py                     # Session auth, IP rate limiting, RBAC & airline scope enforcement
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── admin.py                    # Airline-isolated KPIs, Flight CRUD, Bookings, Inventory, Audits, Settings, Promos
│   │   ├── auth.py                     # Login, Register, Profile update, Logout
│   │   ├── bookings.py                 # Seat hold, Lock extend, Checkout details, Confirm pay, Cancel/Refund, PNR & PDF/QR
│   │   ├── catalog.py                  # Airports, Popular routes, Search, Filter options, Seat map, SSE stream, Promos
│   │   └── pages.py                    # Public, Passenger & Admin Jinja page routes
│   └── services/
│       ├── __init__.py
│       └── pdf_service.py              # Pure-Python %PDF-1.4 e-ticket generator & QR verification SVG builder
│
├── database/
│   ├── flight_booking.db               # Active SQLite WAL relational database (cleaned QA residue)
│   ├── migrations/
│   │   └── 001_postgres_schema.sql     # Target PostgreSQL 16+ schema DDL
│   └── seeds/
│       └── seed_postgres.sql           # Repeatable PostgreSQL seed data
│
├── templates/
│   ├── base.html                       # Unified responsive shell (header, drawer, footer, light/dark toggle)
│   ├── 404.html                        # Not found page
│   ├── components/                     # Shared Jinja macros (breadcrumb, empty_state, page_heading, stepper)
│   └── pages/                          # Active pages (home, flight_search, seat_map, checkout, ticket, ticket_verify,
│                                       #   booking_status, my_bookings, manage_booking, support, payment_result, auth, admin_operations)
│
├── static/
│   ├── css/                            # style.css, admin.css
│   ├── images/                         # Verified active visuals (ProfilePicture.png, default_logo.png, favicon.png, fly_icon.svg, hero_airport_sunset.jpg)
│   └── js/                             # api_client.js, shell.js, app.js, flight_search_widget.js, flight_results_controller.js,
│                                       #   seat_selection.js, checkout_portal.js, auth_portal.js, my_bookings.js, manage_booking.js, admin_console.js
│
└── tests/                              # Organized Automated QA Test Suites (23 tests passing)
    ├── concurrency/test_concurrent_seat_locks.py
    ├── integration/test_security_rbac_isolation.py
    ├── e2e/test_full_booking_journey.py
    ├── e2e/test_five_master_workflows.py
    └── ui/test_ui_assets_and_pages.py
```

## Removed Obsolete Items
- `Skynet-master/` & `backend/` legacy prototypes
- `netlify/`, `netlify.toml`, `deploy_netlify.bat` dead Express/serverless wrappers
- `documentation/` (23 stale pre-refactor files) & `screenshots/` (15 stale screenshots)
- Unused `templates/components/form_field.html`, `templates/components/card.html`, `error_banner.html`, `loading_state.html`, `demo_notice.html`
- Dead step/fixture modules (`travellers.html`, `extras.html`, `review.html`, `payment.html`, `offer_details.html`, `checkout_store.js`, `flight_fixtures.js`, `flight_models.js`) & unused images
