# FLY — Security, Authentication & Airline Isolation Design

**Based On:** `PROJECT_AUDIT.md` (Sections 2.9, 3, 4)  
**Target Stack:** Python Flask + `scrypt` + Session Tokens + SQLite/PostgreSQL

---

## 1. Threat Model & Audited Gaps Addressed

| Vulnerability Found in Audit | Risk | Mitigation Architecture |
| :--- | :--- | :--- |
| `/admin` & `/api/v1/admin/*` unauthenticated (`app.py:1455-1517`) | **Critical** | Protect all admin routes & APIs with `@require_auth` + `@require_roles('AIRLINE_ADMIN', 'SUPER_ADMIN')`; remove public role simulator |
| IDOR on `GET /api/reservations/ticket/<id>` (`app.py:1271-1293`) | **Critical** | Enforce `booking.id_account == user.id` (passengers) or `flight.id_airline == user.airlineId` (airline admins) |
| Cross-airline admin access in `api_get_booking`, `api_cancel_booking`, `confirm_payment_atomic` | **High** | Add `AIRLINE_ADMIN` ownership check comparing booking's `flight.id_airline` against `user['airlineId']` |
| `1,979` legacy non-`scrypt` passwords in `accounts` (`database.py:75-76`) | **High** | Migrate all legacy passwords to `scrypt` hashes (`n=16384, r=8, p=1`), remove plaintext fallback |
| `978` airline-linked accounts (`id_airline IS NOT NULL`) tagged as `PASSENGER` | **High** | Clean up legacy fixture roles via DB migration script so airline accounts have explicit roles or disabled state |
| Raw `cardNumber` & `CVV` stored in `creditCards` (`app.py:1298-1330`) | **High** | Migrate to `saved_cards` storing masked `last4` + brand + gateway token only; purge `CVV` column |
| Unauthenticated `accountId` favorite probing (`app.py:765-770`) | **Low** | Ignore client `accountId` query param; derive favorite checks strictly from `get_current_user()` |
| Hardcoded fallback `app.secret_key` (`app.py:25`) | **Medium** | Require `SECRET_KEY` / `FLY_SECRET_KEY` env var in production; fail startup if default used when `FLASK_ENV=production` |

---

## 2. Authentication & Password Security Design

### 2.1 Password Storage & Legacy Migration
- **Hashing Standard:** `hashlib.scrypt` with 16-byte cryptographic random salt (`secrets.token_hex(16)`), `n=16384, r=8, p=1, dklen=64`, stored as `scrypt:<salt>:<hex_digest>`.
- **Legacy Cleanup:** Run a one-time migration on `accounts` where `password NOT LIKE 'scrypt:%'` to hash legacy values (or lock inactive seed accounts) and remove plaintext equality fallback from `verify_password()` (`database.py:75-76`).
- **Registration Validation:** `POST /api/auth/register` enforces minimum password length (`>= 8`), hashes with `scrypt`, and hardcodes `role = 'PASSENGER'` (ignoring any `role` or `airlineId` supplied in JSON).

### 2.2 Session & Token Lifecycle
- **Token Issuance:** On login/register, generate `secrets.token_hex(32)` (256-bit entropy) stored in `auth_sessions` with `created_at`, `expires_at` (`+7 days`), `ip_address`, and `user_agent`.
- **Transport:** Accepted via `Authorization: Bearer <token>` header for API calls, plus `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production HTTPS) so SSR routes (`/admin`, `/my-bookings`, `/profile`) can verify identity server-side.
- **Termination (`/logout` & `/api/auth/logout`):**
  1. Deletes session row from `auth_sessions`.
  2. Clears Flask session and sets expired `auth_token` / `session` cookies.
  3. Sends `Cache-Control: no-cache, no-store, must-revalidate, private`, `Pragma: no-cache`, `Expires: 0`.
  4. Frontend `window.flyLogout()` clears `fly_token`, `fly_user`, and `fly_checkout_state_v1`, then redirects via `window.location.replace('/login')`.

---

## 3. Role-Based Access Control (RBAC) Matrix

Roles are strictly validated server-side from `auth_sessions` joined with `accounts`:

| Capability / Resource | `GUEST` | `PASSENGER` | `AIRLINE_ADMIN` | `SUPER_ADMIN` |
| :--- | :---: | :---: | :---: | :---: |
| Search airports, flights, fare breakdown, seat map | Yes | Yes | Yes | Yes |
| Public PNR + Last Name lookup (`POST /api/bookings/lookup`) | Yes (matched only) | Yes (matched only) | Yes | Yes |
| Hold seats (`POST /api/bookings/hold`) & confirm payment | No (`401`) | Yes (own only) | Own airline only | Yes |
| View/Cancel booking & view boarding pass (`/api/reservations/ticket/*`) | No (`401`) | **Own bookings only** | **Own airline flights only** | Yes |
| Submit refund request | No (`401`) | **Own confirmed only** | No | Yes |
| Manage saved cards & favorites | No (`401`) | **Own account only** | **Own account only** | Yes |
| View airline KPIs, flights & bookings (`/api/airline/*`, `/api/admin/all-bookings`) | No (`401`) | No (`403`) | **Own `airlineId` only** | All airlines |
| Create/Update/Cancel flights (`POST/PUT/DELETE /api/airline/flights`) | No (`401`) | No (`403`) | **Own `airlineId` only** | Yes |
| Approve/Reject refunds (`/api/admin/refunds/*/decision`) | No (`401`) | No (`403`) | **Own `airlineId` only** | Yes |
| View cross-airline platform metrics & audit logs | No (`401`) | No (`403`) | Own airline only | Yes |

### Decorator Enforcement Pattern (`fly/middleware/auth.py`)
```python
@require_auth
def protected_view(): ...

@require_roles('AIRLINE_ADMIN', 'SUPER_ADMIN')
def admin_view(): ...
```
- Missing/expired token -> `401 UNAUTHORIZED`.
- Valid token lacking required role -> `403 FORBIDDEN`.

---

## 4. Airline-Level Tenant Data Isolation Rules

Airline tenant isolation is enforced **server-side in both middleware and SQL queries**:

1. **Zero Trust on Client Parameters:** Endpoints (`/api/airline/flights`, `/api/airline/stats`, `/api/admin/all-bookings`, `/api/admin/refunds`) **always read `user['airlineId']` from the verified session**. Any `?airlineId=` parameter differing from `user['airlineId']` immediately returns `403 FORBIDDEN` (and logs an unauthorized access attempt).
2. **Booking & Ticket Scope Helper (`verify_booking_access(booking, user)`):**
   - Join `bookings -> flights` to obtain `booking_airline_id = flight.id_airline` (and `return_flight.id_airline` if round-trip).
   - If `user['role'] == 'PASSENGER'`: require `booking['id_account'] == user['id']`.
   - If `user['role'] == 'AIRLINE_ADMIN'`: require `booking_airline_id == user['airlineId']`.
   - If `user['role'] == 'SUPER_ADMIN'`: allow with audit trail.
   - Otherwise: return `403 FORBIDDEN`.
3. **Database Constraint:** `CHECK (role <> 'AIRLINE_ADMIN' OR id_airline IS NOT NULL)` guarantees no airline admin account exists unbound to an airline.

---

## 5. PII, PCI-DSS & Client Storage Rules

1. **No Sensitive Data in `localStorage`:** Only `fly_token` (or HttpOnly cookie), non-sensitive display metadata (`username`, `displayName`, `role`), and `fly_theme` reside in `localStorage`. Passport numbers, NIDs, and card digits are **never** written to `localStorage`.
2. **Masked Outputs:** Public PNR lookup (`POST /api/bookings/lookup`) masks passport numbers (`****6543`) and card numbers (`**** 1111`).
3. **No CVV Persistence:** `saved_cards` never accepts or persists CVV/CVC values; legacy `creditCards.CVV` data is dropped in Phase 1 migration.

---

## 6. HTTP Security Headers, Rate Limiting & Audit Logging

- **Response Headers (`@app.after_request`):**
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- **Rate Limiting:** Throttle `/api/auth/login`, `/api/auth/register`, and `/api/bookings/lookup` (e.g., max 10 failed attempts / 5 min per IP) to prevent credential stuffing and PNR enumeration.
- **Immutable Audit Trail (`admin_audit_logs`):** Every airline flight creation/edit/cancellation, refund approval/rejection, and manual booking override records `actor_id`, `actor_role`, `airline_id`, `action`, `entity_type`, `entity_id`, mandatory `reason`, `ip_address`, and `created_at`.
