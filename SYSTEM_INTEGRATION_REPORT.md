# FLY — System Integration Audit Report

**Phase:** 2 — Complete System Integration Audit  
**Date:** 2026-11-26  

---

## 1. End-to-End Integration Matrix

| Workflow Module | Frontend Trigger / Page | Connected Backend API & DB Tables | Verification Notes & Fixes Applied |
| :--- | :--- | :--- | :--- |
| **Homepage & Search** | `/` (`home.html`, `flight_search_widget.js`) | `GET /api/airports/search`, `GET /api/flights/popular-routes` | Fixed hardcoded `Bangkok (BKK)` / `Singapore (SIN)` quick-tags and cards with zero live inventory -> replaced with live seeded `Saidpur (SPD)` & `Chittagong ➔ Dhaka (DAC)` routes. |
| **Search Results & Filters** | `/flights/search` (`flight_results_controller.js`) | `GET /api/flights`, `GET /api/flights/filter-options` (`flights`, `airLines`, `airports`, `baggage_policies`) | Verified live filtering (stops, airlines, dep/arr window, max price, duration, baggage, refundable) & sorting (`recommended`, `cheapest`, `fastest`). Zero fixture fakes loaded. |
| **Seat Selection & Hold** | `/flights/<id>/seats` (`seat_selection.js`) | `GET /api/flights/<id>/seats`, `GET /api/flights/<id>/seats/stream`, `POST /api/flights/fare-breakdown`, `POST /api/bookings/hold` | Atomic multi-seat hold (`10-min` TTL), live SSE + 5s polling sync, extra-legroom upgrade fees, safe numeric query validation added in `catalog.py`. |
| **Checkout & Payment** | `/checkout?ref=...` (`checkout_portal.js`) | `GET /api/bookings/<ref>`, `POST /api/bookings/<ref>/extend-lock`, `PUT /api/bookings/<ref>/details`, `POST /api/promos/validate`, `POST /api/bookings/confirm` | Verified passenger + add-ons persistence, server-recomputed fare breakdown, promo limit race guard added in `confirm_payment_atomic`, idempotency key capture & failure/timeout rollback. |
| **E-Tickets & PNR** | `/ticket/<pnr>`, `/ticket/verify/<tok>`, `/manage-booking` | `GET /api/reservations/ticket/<pnr>`, `GET /api/tickets/<pnr>/pdf`, `GET /api/tickets/verify/<tok>`, `POST /api/bookings/lookup` | Verified 6-char PNR, embedded QR SVG verification link, pure-Python `%PDF-1.4` download, and guest PNR+email/surname lookup. |
| **Passenger Dashboard** | `/my-bookings`, `/profile` (`my_bookings.js`, `auth_portal.js`) | `GET /api/reservations/my`, `POST /api/bookings/cancel`, `GET/PUT /api/auth/profile`, `GET/POST/DELETE /api/travelers` | Connected trip KPIs, active hold countdown resume, ticket/PDF buttons, refund policy cancellation, and saved travelers CRUD. |
| **Airline Admin Console** | `/admin/*` (`admin_console.js`, `admin_operations.html`) | `GET /api/admin/dashboard`, `GET/POST/PUT/DELETE /api/airline/flights`, `GET /api/admin/all-bookings`, `GET /api/admin/inventory/<id>`, `GET /api/admin/audit-logs`, `GET/PUT /api/admin/settings`, `GET/POST /api/admin/refunds*`, `POST/PUT /api/admin/promos*` | Added `arr > dep` timestamp validation, duplicate schedule conflict detection (`409`), confirmed-booking mutation protection (`409`), and admin promo creation/toggle controls. |
