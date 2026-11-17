# Skynet — Flight Booking & Reservation System (Bangladesh Edition)

[![Author](https://img.shields.io/badge/Author-mahin1710-blue.svg)](https://github.com/mahin1710)
[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-green.svg)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/SQLite-WAL--Mode-yellow.svg)](https://sqlite.org/)
[![Status](https://img.shields.io/badge/Status-Active%20%26%20Conflict--Free-brightgreen.svg)]()

> **Project Author & Maintainer:** **mahin1710**

---

## ✈️ Overview

**Skynet** is an advanced flight booking system designed with a clean, minimal airline-grade interface and high-concurrency seat reservation engine.

### Key Capabilities
- **Conflict-Free Seat Booking Engine**:
  - Multi-seat atomic selection and locking.
  - Strict **15-minute temporary reservation hold** with real-time countdown timer.
  - Auto-release worker releasing expired reservations without blocking active traffic.
  - 100% concurrency-safe with SQLite WAL mode and serialized transactions.
- **Dedicated Authentication & RBAC**:
  - Secure `/login` and `/logout` flows.
  - Server-side session invalidation with token revocation.
  - Role-Based Access Control enforcing tenant isolation between passenger data, Biman Bangladesh Airlines (`BG`), and US-Bangla Airlines (`BS`).
- **Interactive UI**:
  - Real-time seat map with distinctive status indicators (Available, Temporarily Held, Confirmed Booked).
  - One-click demo account switcher for rapid review and testing.
  - Digital boarding pass generator with printable A4 formatting.

---

## 👥 Seeded Demo Accounts

| Role | Username | Password | Display Name / Organization | Permissions |
|---|---|---|---|---|
| **Passenger** | `Mahin0` | `Mahin0` | `MMH_Mahin` (Dhaka, BD) | Search flights, multi-seat reservation, personal bookings |
| **Airline Admin** | `Admin_Biman` | `Admin_Biman` | Biman Bangladesh Airlines | Fleet management, BG flights, ticket sales & revenue analytics |
| **Airline Admin** | `Admin_USB` | `Admin_USB` | US-Bangla Airlines | Fleet management, BS flights, ticket sales & revenue analytics |
| **Passenger** | `Mahin1` | `Mahin1` | Chittagong Traveler | Search flights, book tickets, boarding pass access |

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
- **Project:** Skynet Flight Booking System
- **License:** ISC
