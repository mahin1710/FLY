# FLY — Flight Booking & Reservation System (Bangladesh Edition)

[![Brand](https://img.shields.io/badge/Brand-FLY-blue.svg)]()
[![Author](https://img.shields.io/badge/Author-mahin1710-blue.svg)](https://github.com/mahin1710)
[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-green.svg)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/SQLite-WAL--Mode-yellow.svg)](https://sqlite.org/)
[![Security](https://img.shields.io/badge/Privacy-Strict%20Customer%20Isolation-brightgreen.svg)]()
[![Status](https://img.shields.io/badge/Status-Active%20%26%20Conflict--Free-brightgreen.svg)]()

> **Official Brand:** **FLY**  
> **Project Author & Maintainer:** **mahin1710**

---

## ✈️ Overview

**FLY** is an international-grade flight booking platform built with modern architecture, strict customer-to-customer data privacy, airline-isolated RBAC, and a conflict-free temporary seat reservation engine.

### 🛡️ Customer Privacy & Data Security
- **Strict Customer Isolation**: Every passenger account is strictly isolated. One passenger can NEVER view, access, modify, cancel, or download another passenger's bookings, boarding passes, or profile.
- **Backend-Enforced Authorization**: All booking, ticket, profile, favorites, and card endpoints validate the authenticated session ID. Frontend tampering of account IDs in URLs or request payloads is strictly rejected with `HTTP 403 Forbidden` or `HTTP 401 Unauthorized`.
- **Payment Privacy**: Raw card numbers and CVVs are never exposed; cards are displayed securely with masked digits (`•••• •••• •••• 1234`).
- **Tenant Isolation**: Biman Bangladesh Airlines (`BG`) administrators can only manage Biman flights and ticket inventory; US-Bangla Airlines (`BS`) administrators can only manage US-Bangla flights and inventory. Passengers are strictly prevented from accessing any administration APIs.

### ⏱️ Conflict-Free Seat Engine (15-Minute Payment Window)
- **Multi-Seat Atomic Selection**: Reserve multiple seats in a single atomic transaction. Either all seats are locked or none are reserved.
- **15-Minute Hold Countdown**: Real-time server-synchronized countdown timer with automatic seat release upon timeout.
- **SQLite WAL Concurrency**: High-concurrency serialized transactions eliminate race conditions and double-bookings.

---

## 👥 Seeded Live Demo Accounts

| Role | Username | Password | Display Name / Organization | Permissions |
|---|---|---|---|---|
| **Passenger** | `Mahin0` | `Mahin0` | `MMH_Mahin` (Dhaka, BD) | Search flights, multi-seat reservation, personal booking history, private boarding pass |
| **Airline Admin** | `Admin_Biman` | `Admin_Biman` | Biman Bangladesh Airlines | Fleet management, BG flights, ticket sales & revenue analytics |
| **Airline Admin** | `Admin_USB` | `Admin_USB` | US-Bangla Airlines | Fleet management, BS flights, ticket sales & revenue analytics |
| **Passenger** | `Mahin1` | `Mahin1` | Chittagong Traveler | Search flights, book tickets, private boarding pass access |

---

## 🚀 Quick Start

### 1. 1-Click Launch
Double-click `start.bat` in the project root.

### 2. Manual Terminal Launch
```bash
# From project root
npm start
```
Or directly:
```bash
cd Skynet-master/Skynet-master/web
node server.js
```

Then visit:
- **Web App:** [http://localhost:5000](http://localhost:5000)
- **Dedicated Login:** [http://localhost:5000/login](http://localhost:5000/login)

---

## 🛠️ Laravel REST API Backend (`/backend`)

The backend REST API foundation is built with modern, modular **Laravel 13** and **PHP 8.3** featuring:
- **API Versioning:** Strict `/api/v1` route prefixing.
- **Consistent Response Envelope:** Standardized `success`, `message`, `data`, `errors`, and `meta` (correlation tracking).
- **Request Correlation IDs:** `X-Correlation-ID` header injection across every request and response.
- **Stateless Token Authentication:** Powered by **Laravel Sanctum** personal access tokens with scoped abilities (`customer:access`, `admin:access`).
- **Role-Based Authorization:** Backend authorization policies (`AdminPolicy`) and middleware (`role:admin,super_admin`).
- **Defense-in-Depth Security:** Strict CORS, rate limiting (10 attempts/min on auth), and HTTP security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`).
- **Database & Cache Readiness:** Configured for **PostgreSQL** and **Redis** (cache, session, and async queues) with an embedded SQLite driver for zero-dependency local testing.
- **Diagnostic Health Check:** `GET /api/v1/health` probes app runtime, database connectivity, cache write/read, and queue driver without leaking internal secrets.
- **OpenAPI 3.1 Documentation:** Interactive schema specification available at `GET /api/v1/docs`.

### Exact Technology & Package Versions
- **PHP:** `8.3.36` (cli)
- **Laravel Framework:** `13.43.0`
- **Laravel Sanctum:** `4.5.0`
- **PHPUnit:** `12.5.45`

### Backend Local Setup & Commands

```bash
# 1. Navigate to the backend directory
cd backend

# 2. Install PHP Composer dependencies (if not already installed)
composer install

# 3. Environment configuration
# Copy template and generate application encryption key
cp .env.example .env
php artisan key:generate

# 4. Run database migrations (creates users, personal_access_tokens, cache, jobs tables)
php artisan migrate

# 5. Run automated test suite (19 tests, 137 assertions)
php artisan test
# Or with detailed test names:
php artisan test --testdox

# 6. Start the local Laravel API server
php artisan serve --port=8000
```

### Core API Endpoints Reference

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Public | Subsystem diagnostics (app, database, cache, queue) |
| `GET` | `/api/v1/docs` | Public | OpenAPI 3.1 specification schema |
| `POST` | `/api/v1/auth/register` | Public (Rate Limited) | Customer registration & Sanctum token issue |
| `POST` | `/api/v1/auth/login` | Public (Rate Limited) | Customer / Admin authentication |
| `GET` | `/api/v1/auth/me` | Bearer Token | Authenticated user profile and token abilities |
| `POST` | `/api/v1/auth/logout` | Bearer Token | Revokes current Sanctum access token |
| `GET` | `/api/v1/admin/overview` | Admin Token (`role:admin`) | System operational statistics & metrics |
| `GET` | `/api/v1/admin/users` | Admin Token (`role:admin`) | Paginated user directory |

---

## 👨‍💻 Author & Credits

- **Author:** `mahin1710`
- **Official Brand:** FLY Aviation & Travel
- **License:** ISC
