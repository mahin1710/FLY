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

## 👨‍💻 Author & Credits

- **Author:** `mahin1710`
- **Official Brand:** FLY Aviation & Travel
- **License:** ISC
