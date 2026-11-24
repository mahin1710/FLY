# Architecture Overview: FLY Flight Ticketing Platform

**Project Brand:** FLY Aviation & Travel  
**Author / Engineering Maintainer:** `mahin1710`  
**Architecture Style:** Modular Monolith with Decoupled Service Adapters  
**Primary Tech Stack:** Python Flask (Presentation Gateway) + Laravel 11 (Domain Engine) + SQLite/PostgreSQL (Data Persistence)

---

## 1. Architectural Principles

1. **Strict Customer-to-Customer Isolation:** Every passenger booking, boarding pass, profile, and payment card is strictly scoped to the authenticated session account ID. Object-level access control (IDOR prevention) is enforced on all endpoints.
2. **Atomic 15-Minute Seat Hold Window:** High-concurrency seat reservation engine utilizing immediate database transactions (`BEGIN IMMEDIATE` in SQLite and distributed Redis locks in Laravel) to prevent seat double-booking.
3. **Hexagonal Provider Integration:** All external suppliers (GDS like Amadeus/Sabre, NDC aggregators, and payment gateways like SSLCOMMERZ) connect through normalized interface adapters (`FlightProviderInterface`, `PaymentGatewayInterface`).
4. **Authoritative Ticketing State Machine:** Ticket status transitions to `ISSUED` only upon supplier-confirmed response; payment verification requires server-to-server IPN webhook validation with HMAC check.
5. **Zero Raw Card Storage:** Strict PCI-DSS Level 1 compliance; credit card data is handled exclusively in hosted sandbox checkout environments.

---

## 2. Core Subsystems

```
┌─────────────────────────────────────────────────────────────┐
│ Presentation Layer (HTML5, Jinja2, Responsive CSS3 Tokens)  │
│ [Search Widget] [Offer Details] [Passenger Form] [Seat Map] │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Python Flask Gateway (`app.py`, Port 5000)                  │
│ [Template Rendering] [In-Memory Session] [Local REST APIs] │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Enterprise Domain Engine (Laravel 11, `backend/`, Port 8000)│
│ [BookingStateMachine] [PricingService] [TicketingService]   │
│ [PaymentGatewayAdapters] [ProviderCircuitBreaker]           │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Persistence & Cache Layer                                   │
│ [Primary SQLite `flight_booking.db` / PostgreSQL 16+]       │
│ [Redis Cache & Queue Workers]                               │
└─────────────────────────────────────────────────────────────┘
```

For complete technical specifications, see [`documentation/SYSTEM_ARCHITECTURE.md`](file:///c:/Users/mahed/Desktop/FLY/documentation/SYSTEM_ARCHITECTURE.md) and [`documentation/DATABASE_ERD.md`](file:///c:/Users/mahed/Desktop/FLY/documentation/DATABASE_ERD.md).
