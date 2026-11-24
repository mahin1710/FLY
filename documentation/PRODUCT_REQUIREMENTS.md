# Product Requirements Document (PRD): Flight Ticketing Platform

**Project Brand:** FLY Aviation & Travel  
**Author / Engineering Maintainer:** `mahin1710`  
**Document Version:** 1.0.0  
**Status:** Approved Architectural Baseline  
**Target Environment:** Web (Desktop, Laptop, Tablet, Mobile)

---

## 1. Product Vision & Goals

The FLY Flight Ticketing Platform is an international-grade flight booking engine designed to deliver a transparent, intuitive, and reliable flight reservation experience. Taking functional inspiration from leading regional and global travel platforms (such as GoZayaan, Skyscanner, and Google Flights), the platform eliminates hidden fees, provides transparent fare breakdowns, prevents double-booking through an atomic 15-minute conflict-safe seat engine, and guarantees strict customer privacy.

### Key Success Metrics
1. **Zero Double-Bookings:** 100% conflict prevention on concurrent seat reservations via atomic locks.
2. **Transparent Pricing:** 0% price drift between search, review, and checkout; transparent itemization of base fares, taxes (15% VAT + embarkation fee), and airline fuel charges.
3. **Responsive Screen Fit:** 100% viewport compliance across mobile ($\le 360\text{px}$, $\le 480\text{px}$), tablet ($\le 768\text{px}$), and desktop ($\ge 1024\text{px}$) with zero horizontal scrolling.
4. **Data Privacy & Isolation:** 100% authorization isolation between individual customer accounts and between competing airline administrators.

---

## 2. User Personas

| Persona | Role | Primary Objective | Key Pain Points to Solve |
|---|---|---|---|
| **P1: Leisure Traveler** | Retail Customer | Search flights between cities, compare options by price/duration, book for family with transparent pricing. | Hidden service fees, complicated booking steps, lost seats while entering passenger info. |
| **P2: Business Traveler** | Retail Customer | Quick booking on specific airlines/times, rapid checkout, access to printable e-ticket & boarding pass on mobile. | Cluttered interfaces, slow load times, difficulty viewing booking history. |
| **P3: Airline Administrator** | Carrier Staff | Manage airline-specific schedules, monitor ticket sales, analyze load factors and flight revenues. | Unauthorized cross-airline data leakage, complex scheduling interfaces. |
| **P4: Platform Operations / Super Admin** | Operations Staff | Global booking oversight, manual ticket servicing, refund review & approval, audit log inspection. | Inability to track payment-to-ticketing mismatches, lack of refund decision logs. |

---

## 3. Scope Definition: MVP vs. Later Phases

```
┌─────────────────────────────────────────────────────────────┐
│                          MVP SCOPE                          │
│  - One-Way, Round-Trip, Multi-City Search                   │
│  - Airport Autocomplete (IATA, City, Airport Name)          │
│  - GoZayaan-inspired Results, Filters & Sorting             │
│  - Transparent Fare Breakdown (Base, VAT, Airport, Fuel)    │
│  - Dynamic Traveler Form (Adults, Children, Infants)        │
│  - Visual Cabin Seat Map & Atomic 15-Minute Hold Engine     │
│  - Simulated Server-Side Payment & Idempotent Confirmation  │
│  - Digital Boarding Pass & Printable E-Ticket Generation    │
│  - Customer My Bookings (Upcoming / Past / Cancel Hold)     │
│  - Airline Admin Dashboard (Biman BG & US-Bangla BS)        │
│  - Local Database Inventory with Mock Provider Adapter      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                         LATER SCOPE                         │
│  - Live GDS/NDC Supplier Integration (Amadeus / Sabre)      │
│  - Commercial Payment Gateways (SSLCommerz, bKash, Stripe)  │
│  - Automated Cancellation & Penalty Refund Engine           │
│  - Automated SMS/WhatsApp Notification Gateway              │
│  - Frequent Flyer / Loyalty Rewards Engine                  │
│  - Multi-Currency Conversion & International Tax Rules      │
│  - Hotel & Airport Transfer Add-on Packages                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Functional Requirements

### 4.1. Flight Search & Exploration
- **FR-1.1 Trip Types:** Support One-Way, Round-Trip, and Multi-City journeys (up to 4 sequential segments).
- **FR-1.2 Airport Autocomplete:** Real-time search by 3-letter IATA code (e.g., `DAC`, `CXB`, `CGP`), city name, or full airport name. Display matching city, airport name, and IATA badge.
- **FR-1.3 Airport Swap:** One-click button to exchange origin and destination inputs.
- **FR-1.4 Travel Dates:** Date pickers preventing selection of past dates. For round-trips, return date must be $\ge$ departure date. For multi-city, leg $n$ date must be $\ge$ leg $n-1$ date.
- **FR-1.5 Passenger Selection:** Dynamic counters for Adults (12+ years, min 1), Children (2–11 years), and Infants (under 2 years). Total passenger count dynamically displayed.
- **FR-1.6 Cabin Class:** Support Economy, Premium Economy, Business, and First Class selection.

### 4.2. Results, Comparison & Filtering
- **FR-2.1 Search Summary Header:** Displays route, departure/return dates, passenger count, and cabin class with inline "Modify Search" modal.
- **FR-2.2 Flight Card Information:** Airline logo, airline name, flight number, departure airport & time, arrival airport & time, duration, stop count, transit city (if connecting), aircraft type, cabin class, baggage allowance, refundability tag, and total fare.
- **FR-2.3 Dynamic Filtering Sidebar:**
  - *Price Range:* Dual slider in BDT updating results dynamically.
  - *Airlines Filter:* Checkbox list showing **only** airlines present in current search results.
  - *Stops Filter:* Non-stop, 1 stop, 2+ stops.
  - *Departure Time Filter:* Morning (06:00–12:00), Afternoon (12:00–18:00), Evening (18:00–24:00), Night (00:00–06:00).
- **FR-2.4 Sorting Engine:** Cheapest, Fastest (minimum flight duration), Earliest Departure, Latest Departure.
- **FR-2.5 Multi-Leg Selection Progress:** For Round Trips and Multi-City, an active progress banner guides the customer to select outbound and return flights in sequential order before compiling the itinerary.

### 4.3. Flight Details & Fare Breakdown
- **FR-3.1 Flight Details Modal:** Full itinerary breakdown, baggage allowance, fare rules, and cancellation/date-change policy.
- **FR-3.2 Transparent Fare Calculation:** Server-side deterministic calculation:
  $$\text{Total Payable} = \text{Base Fare} + \text{Taxes (15\% VAT + Embarkation)} + \text{Fuel Surcharges} + \text{Baggage Fees} - \text{Discounts}$$
  Zero hidden fees or invented charges.

### 4.4. Traveler Information & Seat Selection
- **FR-4.1 Passenger Forms:** Collects Title (Mr, Ms, Mrs), First & Last Name, Traveler Type (Adult, Child, Infant), Document Type (Passport, NID, Birth Certificate), Document Number.
- **FR-4.2 Aircraft Seat Map:** Interactive visual fuselage map rendering available, held (amber), and booked (dark) seats across First, Business, and Economy cabins.
- **FR-4.3 Conflict-Free 15-Minute Seat Hold:** Atomically locks selected seats for 15 minutes. Competing users attempting to hold the same seat receive HTTP 409 Conflict.
- **FR-4.4 Sticky Countdown Banner:** Persistent banner showing booking reference and live countdown timer if customer navigates across tabs during hold.

### 4.5. Booking Review, Payment & Ticketing
- **FR-5.1 Pre-Booking Revalidation:** Endpoint `/api/bookings/validate` checks flight existence, seat availability, passenger document completeness, and price drift before checkout.
- **FR-5.2 Price Change Alert:** If fare changed, alerts user with old vs. new price and requires acknowledgment before locking seats.
- **FR-5.3 Payment Checkout:** 15-minute countdown clock, recap summary, saved cards with masked numbers (`•••• 1234`), simulated card verification.
- **FR-5.4 Idempotent Payment Confirmation:** Re-submitting payment for an already confirmed booking returns existing ticket data without duplicate charges.
- **FR-5.5 Digital Boarding Pass:** Generates printable e-ticket with barcode, passenger name, seat number, gate, terminal, and flight schedule.

### 4.6. Customer Account & Servicing
- **FR-6.1 My Bookings Dashboard:** Categorized into Upcoming and Past flights. Displays booking reference, status (`PENDING_PAYMENT`, `CONFIRMED`, `EXPIRED`, `CANCELLED`), and seats.
- **FR-6.2 Hold Resumption:** Customers can resume pending holds directly from My Bookings within the 15-minute window.
- **FR-6.3 Booking Cancellation:** Customer can release held seats or submit cancellation request.

### 4.7. Admin Operations & RBAC
- **FR-7.1 Role-Based Access Control:** Strict isolation between `PASSENGER` and `AIRLINE_ADMIN`.
- **FR-7.2 Airline Dashboard:** Airline admins can only view and manage flights belonging to their assigned airline ID. Access to revenue stats, load factor, and booking counts.

---

## 5. Non-Functional Requirements (NFRs)

| Category | Requirement | Target Metric / Standard |
|---|---|---|
| **Performance** | API response time | Flight search $\le 400\text{ms}$; Seat hold $\le 150\text{ms}$; Fare breakdown $\le 100\text{ms}$. |
| **Concurrency** | Race-condition prevention | Serialized database transactions (SQLite WAL mode / PostgreSQL row-level locks). 100% elimination of double-seat allocation. |
| **Availability** | Server uptime | 99.9% uptime target for booking APIs. |
| **Usability / Responsive** | Screen compatibility | Responsive design across 360px mobile to 4K desktop. Zero horizontal scrolling. Minimum touch target $44 \times 44\text{px}$. |
| **Security** | Data protection | Strict customer isolation (HTTP 401/403). `scrypt` password hashing. Card numbers masked. Zero secrets in frontend. |
| **Compliance** | Industry standards | IATA airport/airline code compliance; ISO 8601 timestamps; KaTeX math formatting. |

---

## 6. Acceptance Criteria (Sample Scenarios)

### Scenario 1: Airport Autocomplete & Search Validation
- **Given** the customer is on the homepage search section,
- **When** the customer types "dac" into the origin input,
- **Then** the dropdown displays "Hazrat Shahjalal International Airport, Dhaka (DAC)".
- **When** the customer selects Dhaka (DAC) and attempts to select Dhaka (DAC) as the destination,
- **Then** the system alerts "Origin and destination cannot be identical" and prevents form submission.

### Scenario 2: Concurrent Seat Reservation Conflict
- **Given** Seat 12A on Flight BG-185 is AVAILABLE,
- **When** Customer A selects Seat 12A and clicks "Hold Selected Seats",
- **Then** Customer A's session receives HTTP 201 Created with a 15-minute hold.
- **When** Customer B attempts to hold Seat 12A simultaneously,
- **Then** Customer B's request is rejected with HTTP 409 Conflict (`SEAT_UNAVAILABLE`).
- **And** Customer B's seat map marks 12A as "HELD" by another user.

### Scenario 3: Transparent Fare Drift Alert
- **Given** Customer A selected a flight at ৳4,500 base fare,
- **When** the backend fare updates to ৳5,000 before Customer A confirms payment,
- **Then** `/api/bookings/validate` returns `valid: false, priceChanged: true`,
- **And** the UI alerts: "Flight fare has changed from ৳4,500 to ৳5,000. Please review the updated fare before proceeding."

---

## 7. Assumptions & Exclusions

### Assumptions
1. **Currency:** Primary currency is Bangladeshi Taka (BDT, ৳). Multi-currency support is architected for later integration.
2. **Passenger Rules:** Follows standard IATA age conventions: Infants under 2 years do not occupy a separate aircraft seat; Children 2–11 require a seat; Adults 12+ require an adult ticket.
3. **Inventory State:** In development/MVP mode, inventory is maintained locally and labeled `DEMO` until verified commercial provider access is granted.

### Exclusions
1. **Direct Airline Charter:** Private aircraft charter bookings are out of scope.
2. **Loyalty / Miles Redemption Engine:** Earning or spending airline loyalty points is excluded from MVP.
3. **Complex Interline Bag-Drop:** Multi-carrier interline baggage agreement transfers across unallied carriers are excluded from automated ticketing in MVP.

---

## 8. Open Decisions `[OPEN DECISION]`

1. `[OPEN DECISION: COMMERCIAL-01]` **IATA BSP Accreditation vs. Host Agency:** Does the platform operate under its own IATA BSP accreditation, or will ticketing be routed through an accredited host agency / consolidator (e.g., Sabre Bangladesh, Flyhub, ShareTrip)?
2. `[OPEN DECISION: LEGAL-02]` **Cancellation & Refund Penalty Policy:** What is the exact cancellation penalty percentage schedule (e.g., >24h before departure: 10% penalty; <24h: 25% penalty; <4h: non-refundable)?
3. `[OPEN DECISION: PAYMENT-03]` **Payment Gateway Integration:** Which licensed payment aggregator will be selected for production live BDT payments (SSLCommerz, bKash Merchant API, PortWallet, or direct acquiring bank)?
4. `[OPEN DECISION: REGULATORY-04]` **Civil Aviation Authority of Bangladesh (CAAB) Compliance:** Does the platform require direct CAAB digital OTA registration licensing before issuing live commercial tickets?
