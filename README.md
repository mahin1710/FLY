# FLY — Modern Flight Booking & Reservation Platform

[![Brand](https://img.shields.io/badge/Brand-FLY-blue.svg)]()
[![Author](https://img.shields.io/badge/Author-mahin1710-blue.svg)](https://github.com/mahin1710)
[![Python](https://img.shields.io/badge/Python-3.12%2B-blue.svg)](https://python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.1.3-green.svg)](https://palletsprojects.com/p/flask/)
[![Laravel](https://img.shields.io/badge/Laravel-11.x-red.svg)](https://laravel.com/)
[![Database](https://img.shields.io/badge/SQLite-WAL--Mode-yellow.svg)](https://sqlite.org/)
[![Accessibility](https://img.shields.io/badge/WCAG-2.1%20AA-brightgreen.svg)]()
[![Tests](https://img.shields.io/badge/Tests-164%20Passing-brightgreen.svg)]()

> **Official Brand:** **FLY** (`FLY Aviation & Travel`)  
> **Maintainer & Author:** **mahin1710**  
> **Repository:** [https://github.com/mahin1710/FLY.git](https://github.com/mahin1710/FLY.git)

---

## ✈️ Overview

**FLY** is a professional, human-friendly flight booking platform built with modern responsive architecture, strict customer-to-customer data privacy, route-aware passenger document validation, and an atomic 15-minute conflict-free seat reservation engine.

### Key Features
- **Modern Flight Search:** Autocomplete across 5,928 airports, One-Way, Round-Trip, and Multi-City support, travel date bounds, dynamic airline filters, and interactive BDT price slider.
- **Atomic 15-Minute Seat Hold:** Concurrency-safe seat reservation engine preventing double-bookings; real-time server-synchronized countdown timer with automatic seat release upon timeout.
- **Route-Aware Travel Document Validation:** Enforces CAAB & IATA guidelines (NID/Birth Certificate/Passport for domestic Bangladesh routes; valid Passport with $\ge$ 6 months validity for international routes).
- **Interactive Seat Map & Ancillaries:** Visual aircraft cabin layout with First Class, Business Class, and Economy sections, inflight meal choices, extra baggage, and travel insurance.
- **Transparent Fare Breakdown:** Server-calculated itemized airfare, 15% VAT, airport embarkation fees, fuel surcharges, and baggage fees with zero hidden markups.
- **Hosted Payment Checkout (Sandbox):** Fast-Path Instant Verification, bKash Mobile Wallet Simulator, and 3D-Secure 2.0 Card Simulator with zero raw card data storage.
- **Protected Operations Console (Admin):** 12-module operational dashboard with 7 least-privilege RBAC profiles, KPI metrics, ticketing queues, payment reconciliation, and audit logs.

---

## 🚀 Quick Start (Local Setup)

### 1. 1-Click Launch (Windows)
Double-click `start.bat` in the project root. The application will start immediately on `http://localhost:5000`.

### 2. Manual Terminal Launch
```bash
# 1. Install Python dependencies
pip install -r requirements.txt

# 2. Start Python Flask server
python app.py
```
Open your browser and navigate to: **`http://localhost:5000`**

---

## 🧪 Running Automated Test Suites

### 1. UI Accessibility & Responsive Viewport Test Suite:
```bash
node tests/ui_accessibility_and_responsive.test.js
```
*Result:* 9 / 9 Passed (WCAG 2.1 AA compliant, 390px to 1440px viewports verified).

### 2. Backend Enterprise Test Suite (Laravel Engine):
```bash
cd backend
php artisan test
```
*Result:* 164 / 164 Passed (979 assertions, 0 failures).

---

## 📚 Master Documentation Index

Complete project specifications are located in [`documentation/`](documentation/):

- [`documentation/PROJECT_AUDIT.md`](documentation/PROJECT_AUDIT.md) — Comprehensive technical and architectural audit.
- [`documentation/FEATURE_INVENTORY.md`](documentation/FEATURE_INVENTORY.md) — Complete 87-point interactive feature and control inventory.
- [`documentation/FILE_INVENTORY.md`](documentation/FILE_INVENTORY.md) — Full file manifest and dependency analysis.
- [`documentation/FILE_STRUCTURE.md`](documentation/FILE_STRUCTURE.md) — Annotated project directory tree.
- [`documentation/CODEBASE_CLEANUP_REPORT.md`](documentation/CODEBASE_CLEANUP_REPORT.md) — Safe renaming and codebase cleanup audit report.
- [`documentation/ENVIRONMENT_SETUP.md`](documentation/ENVIRONMENT_SETUP.md) — Detailed environment setup guide.
- [`documentation/DEVELOPMENT_GUIDE.md`](documentation/DEVELOPMENT_GUIDE.md) — Coding standards, guidelines, and test instructions.
- [`documentation/ARCHITECTURE.md`](documentation/ARCHITECTURE.md) — System architecture overview.
- [`documentation/BASELINE_TEST_REPORT.md`](documentation/BASELINE_TEST_REPORT.md) — Full baseline test execution results.
- [`documentation/IMPLEMENTATION_PLAN.md`](documentation/IMPLEMENTATION_PLAN.md) — Phased production engineering roadmap.
