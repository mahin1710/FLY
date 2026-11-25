# FLY — REST API Specification

**Base URL:** `/api`  
**Content-Type:** `application/json`  
**Authentication:** `Authorization: Bearer <token>` (or `auth_token` HttpOnly cookie) validated against `auth_sessions`  
**Error Envelope Standard:**
```json
{
  "error": "Human-readable description",
  "code": "MACHINE_READABLE_CODE",
  "details": {}
}
```

> **Status Tags:**  
> - `[EXISTING]` — Endpoint already exists in `app.py` (may need security/validation hardening as noted).  
> - `[HARDENED]` — Existing endpoint modified in implementation sprints for RBAC, isolation, or schema alignment.  
> - `[NEW]` — Endpoint to be added during implementation sprints.

---

## 1. Authentication & User Profile (`/api/auth/*`, `/logout`)

### 1.1 `POST /api/auth/login` `[EXISTING]`
Authenticates passenger or airline admin using `scrypt` verification (`database.py:54-76`).
- **Auth:** Public
- **Request:** `{ "username": "Mahin0", "password": "..." }`
- **Response `200`:**
  ```json
  {
    "success": true,
    "token": "<48-char-hex>",
    "user": {
      "id": 2076,
      "username": "Mahin0",
      "role": "PASSENGER",
      "displayName": "MMH_Mahin",
      "email": "mahin0@flight.bd",
      "location": "Dhaka, Bangladesh",
      "airlineId": null
    }
  }
  ```
- **Errors:** `400` missing credentials, `401` invalid username/password, `429` rate limit exceeded (target).

### 1.2 `POST /api/auth/register` `[NEW]`
Creates a new passenger account (`passengers` + `accounts` in one transaction) and issues a session token.
- **Auth:** Public (`role` is always forced server-side to `'PASSENGER'`; admin roles cannot be self-registered)
- **Request:**
  ```json
  {
    "username": "traveler_dhaka",
    "password": "StrongPassword123",
    "email": "user@example.com",
    "firstName": "Amina",
    "lastName": "Rahman",
    "location": "Dhaka, Bangladesh"
  }
  ```
- **Response `201`:** Same shape as `/api/auth/login`.
- **Errors:** `400` validation failure, `409` username or email already taken.

### 1.3 `POST /api/auth/logout` & `GET/POST /logout` `[EXISTING]`
Invalidates token in `auth_sessions`, clears cookies (`auth_token`, `session`), emits `Cache-Control: no-cache, no-store, must-revalidate, private`.
- **Auth:** Optional / Session

### 1.4 `GET /api/auth/me` `[EXISTING]` & `PUT /api/auth/profile` `[NEW]`
- `GET /api/auth/me`: Returns `{ "authenticated": true, "user": { ... } }` or `401`.
- `PUT /api/auth/profile`: Updates `displayName`, `email`, `location`, `firstName`, `lastName`, and optionally rotates password (requires `currentPassword`). Never allows changing `role` or `airlineId`.

### 1.5 `GET /api/auth/demo-users` `[EXISTING]`
Returns the 4 non-privileged metadata entries for demo accounts (`Mahin0`, `Admin_Biman`, `Admin_USB`, `Mahin1`) without passwords. Should be disabled when `FLASK_ENV=production`.

---

## 2. Airports & Flight Catalog (`/api/airports/*`, `/api/flights/*`)

### 2.1 `GET /api/airports/search?q=<query>` `[EXISTING]`
Returns top 15 matching airports across `airports` (5,928 rows), prioritizing Bangladesh airports and exact IATA matches.
- **Auth:** Public
- **Also Available:** `GET /api/airports`, `GET /api/airports/all`, `GET /api/airports/cities`, `GET /api/airports/countries`.

### 2.2 `GET /api/flights` `[HARDENED]`
Searches SQLite/PostgreSQL `flights` with live `bookedCount` (counting `'CONFIRMED'` and active non-expired `'PENDING_PAYMENT'`/`'HELD'` seats).
- **Auth:** Public (Note: remove unauthenticated `accountId` favorite probing; derive `isFavorite` solely from `get_current_user()`).
- **Query Params:** `from` / `depCity`, `to` / `arrCity`, `departure` / `dateAfter`, `return` / `dateBefore`, `cabinClass`, `airlineId`, `stops`, `maxPrice`, `refundableOnly`, `checkedBaggageOnly`, `sortBy` (`closestDate`, `priceAsc`, `priceDesc`, `fastest`, `earliestDep`, `earliestArr`), `limit` (max 100), `offset`.
- **Response `200`:**
  ```json
  {
    "total": 42,
    "limit": 12,
    "offset": 0,
    "flights": [
      {
        "id": 1,
        "flightNumber": "BG-101",
        "airlineId": 839,
        "airlineName": "Biman Bangladesh Airlines",
        "airlineIATA": "BG",
        "depIATA": "DAC",
        "depCity": "Dhaka",
        "arrIATA": "CXB",
        "arrCity": "Cox's Bazar",
        "dep_datetime": "2026-12-01 10:30:00",
        "arr_datetime": "2026-12-01 11:25:00",
        "durationMinutes": 55,
        "durationFormatted": "55m",
        "stops": 0,
        "stopsLabel": "Non-stop",
        "economy_price": 4200,
        "business_price": 9500,
        "first_price": 15000,
        "availableSeats": 114,
        "totalSeats": 120,
        "checkedBaggage": "20 kg",
        "cabinBaggage": "7 kg",
        "refundability": "Refundable"
      }
    ]
  }
  ```

### 2.3 `GET /api/flights/filter-options` `[EXISTING]` & `GET /api/flights/featured` `[EXISTING]`
Returns dynamic min/max price bounds, matching airlines with flight counts, stops, time slots, baggage, and refund policy options.

### 2.4 `GET /api/flights/<int:flight_id>` `[EXISTING]`
Returns full enriched flight metadata or `404`.

### 2.5 `GET /api/flights/<int:flight_id>/seats` `[EXISTING]`
Runs `cleanup_expired_holds()`, queries `seats` (120 seats) merged with active `reservations`, and returns:
```json
{
  "flightId": 1,
  "seats": [
    {
      "id": 1,
      "code": "A1",
      "column": "A",
      "row": 1,
      "type": "first",
      "status": "AVAILABLE",
      "isHeldByMe": false,
      "bookingReference": null
    }
  ]
}
```

### 2.6 `GET/POST /api/flights/fare-breakdown` `[EXISTING]`
Authoritative fare computation (`baseFare`, `taxes`, `airlineCharges`, `serviceCharges`, `luggageFee`, `discounts`, `totalPayable`) across one or more flight IDs, cabin class, and passenger counts (`adults`, `children`, `infants`).

---

## 3. Booking Validation, Atomic Hold, Payment & Tickets (`/api/bookings/*`, `/api/reservations/*`)

### 3.1 `POST /api/bookings/validate` `[HARDENED]`
Pre-hold verification of passenger fields, flight existence, real-time seat conflict status (checking `CONFIRMED` **and** non-expired `PENDING_PAYMENT`/`HELD`), and fare revalidation against `expectedTotal`.
- **Auth:** Public / Authenticated
- **Response `200`:** `{ "valid": true, "currentFare": { ... } }` or `{ "valid": false, "priceChanged": true, "code": "FARE_CHANGED", "currentFare": { ... } }`.
- **Errors:** `400 INVALID_PASSENGER_DATA`, `404 FLIGHT_NOT_FOUND`, `409 SEAT_UNAVAILABLE`.

### 3.2 `POST /api/bookings/hold` `[HARDENED]`
Atomically reserves selected seat(s) for **15 minutes** inside `BEGIN IMMEDIATE` (SQLite) / `SELECT ... FOR UPDATE` (PostgreSQL). Supports return-leg `returnSeatIds` for round-trip flights.
- **Auth:** `@require_auth` (`401 UNAUTHORIZED` if missing)
- **Request:**
  ```json
  {
    "flightId": 1,
    "returnFlightId": null,
    "seatIds": [45],
    "returnSeatIds": [],
    "cabinClass": "Economy",
    "tripType": "one_way",
    "nbrLuggages": 1,
    "weight": 20,
    "expectedFare": 5280,
    "contact": { "email": "user@example.com", "phone": "+8801700000000" },
    "passengerData": [
      {
        "type": "adult",
        "title": "MR",
        "firstName": "Mahin",
        "lastName": "Rahman",
        "dob": "1998-05-15",
        "nationality": "BD",
        "idType": "passport",
        "passportNumber": "A09876543"
      }
    ]
  }
  ```
- **Response `201`:**
  ```json
  {
    "success": true,
    "status": "PENDING_PAYMENT",
    "bookingReference": "BK-1-A1B2C3D4-E5F6",
    "expiresAt": "2026-11-26 01:00:00",
    "secondsRemaining": 900,
    "totalAmount": 5280,
    "seatCodes": ["C8"],
    "fareBreakdown": { ... }
  }
  ```
- **Errors:** `400` invalid input / `FARE_CHANGED`, `401` unauthenticated, `409 SEAT_UNAVAILABLE`.

### 3.3 `POST /api/bookings/confirm` `[HARDENED]`
Idempotent payment confirmation within the 15-minute hold window. Generates `pnr_code` (6-char uppercase) and inserts e-ticket row(s) in `tickets`.
- **Auth:** `@require_auth` (owner passenger or airline-scoped admin only)
- **Request:** `{ "bookingReference": "BK-1-A1B2C3D4-E5F6", "paymentMethod": "BKASH_SANDBOX", "transactionRef": "TXN-123" }`
- **Response `200`:** `{ "success": true, "status": "CONFIRMED", "bookingReference": "...", "pnrCode": "FLY8K2", "paymentRef": "...", "ticket": { ... } }`
- **Errors:** `403 FORBIDDEN`, `404 NOT_FOUND`, `410 RESERVATION_EXPIRED`.

### 3.4 `POST /api/bookings/cancel` `[HARDENED]`
Cancels a `PENDING_PAYMENT` or eligible `CONFIRMED` booking and releases its seats.
- **Auth:** `@require_auth` (enforces `booking.id_account == user.id` for `PASSENGER`, `flight.id_airline == user.airlineId` for `AIRLINE_ADMIN`).

### 3.5 `POST /api/bookings/lookup` `[NEW]`
Public self-service retrieval for `Manage Booking` (`/manage-booking`).
- **Auth:** Public, validated by matching **both** `bookingReference` (or `pnrCode`) **and** passenger `lastName` (case-insensitive).
- **Request:** `{ "reference": "BK-1-A1B2C3D4-E5F6", "lastName": "Rahman" }`
- **Response `200`:** Sanitized itinerary, status, seats, baggage, and ticket summary (masks passport numbers).
- **Errors:** `404` if reference+surname do not match (uniform error prevents enumeration).

### 3.6 `POST /api/bookings/<string:booking_ref>/refund-request` `[NEW]`
Submits a customer cancellation/refund request into `refund_requests` for confirmed tickets.
- **Auth:** `@require_auth` (booking owner only).

### 3.7 `GET /api/bookings/<string:booking_ref>` `[HARDENED]` & `GET /api/reservations/my` `[EXISTING]` & `GET /api/reservations/ticket/<string:ticket_id>` `[HARDENED]`
- All enforce ownership (`PASSENGER`) or strict airline scope (`AIRLINE_ADMIN`: `flight.id_airline == user.airlineId`). Fixes the IDOR on `/api/reservations/ticket/<ticket_id>`.

---

## 4. Saved Cards & Favorites (`/api/cards`, `/api/favorites`)

### 4.1 `GET / POST / DELETE /api/cards` `[HARDENED]`
- Stores **only** `cardHolder`, `cardBrand`, `last4`, `expMonth`, `expYear` (never full PAN or CVV).

### 4.2 `GET / POST / DELETE /api/favorites` `[HARDENED]`
- `GET /api/favorites`: Lists flights favorited by authenticated user (`user['id']`).
- `POST /api/favorites/<int:flight_id>` / `DELETE /api/favorites/<int:flight_id>` `[NEW]`: Toggles favorite cleanly.

---

## 5. Airline Portal & Operations Admin APIs (`/api/airline/*`, `/api/admin/*`)

All admin endpoints require `@require_auth` + `@require_roles('AIRLINE_ADMIN', 'SUPER_ADMIN')`. Client-supplied `airlineId` overrides are forbidden for `AIRLINE_ADMIN`.

| Endpoint | Status | Role Scope | Purpose |
| :--- | :--- | :--- | :--- |
| `GET /api/airline/stats` | `[EXISTING]` | `AIRLINE_ADMIN` | Total flights, confirmed bookings, revenue scoped to `user.airlineId` |
| `GET /api/airline/flights` | `[EXISTING]` | `AIRLINE_ADMIN` | Lists airline's own flights with booked seat counts |
| `POST /api/airline/flights` | `[NEW]` | `AIRLINE_ADMIN` | Schedules a new flight strictly for `user.airlineId` |
| `PUT / DELETE /api/airline/flights/<id>` | `[NEW]` | `AIRLINE_ADMIN` | Updates fares/times or cancels a flight (verifies ownership of `flight.id_airline`) |
| `GET /api/admin/all-bookings` | `[EXISTING]` | `AIRLINE_ADMIN`, `SUPER_ADMIN` | Bookings scoped to `user.airlineId` (or all airlines for `SUPER_ADMIN`) |
| `GET /api/admin/refunds` | `[NEW]` | `AIRLINE_ADMIN`, `SUPER_ADMIN` | Lists pending/processed refund requests in scope |
| `POST /api/admin/refunds/<id>/decision` | `[NEW]` | `AIRLINE_ADMIN`, `SUPER_ADMIN` | Approves/rejects refund with mandatory reason logged to `admin_audit_logs` |
| `GET /api/admin/dashboard` | `[HARDENED]` | `AIRLINE_ADMIN`, `SUPER_ADMIN` | Replaces unauthenticated `/api/v1/admin/*` proxy with real SQLite/PostgreSQL operational KPIs |
