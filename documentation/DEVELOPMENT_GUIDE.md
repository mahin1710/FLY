# Developer Guide: FLY Flight Ticketing Platform

**Project Brand:** FLY Aviation & Travel  
**Maintainer:** `mahin1710`  
**Purpose:** Developer onboarding, coding standards, test execution, and architecture conventions.

---

## 1. Project Overview & Workflow

FLY operates as a modular monolith providing a complete flight discovery, multi-leg booking, atomic seat holding, hosted payment checkout, and digital ticketing experience.

### Key Working Directories
- `templates/pages/`: Server-rendered HTML templates using Jinja2 inheritance (`base.html`).
- `static/css/style.css`: Master CSS design system. All styling rules must adhere to the Midnight Navy (`#101D2C`), Warm Ivory (`#F8FAFC`), and Sky Blue / Gold palette.
- `static/js/`: Client-side controllers. State is managed via `checkout_store.js` using in-memory tab-scoped storage.
- `backend/app/`: Enterprise backend business logic, DTOs, and state machine transitions.

---

## 2. Coding Standards & Guidelines

1. **Zero Raw PAN/CVV Card Storage:** Never log, store, or receive raw credit/debit card numbers in frontend or backend databases. Always delegate card processing to hosted gateway adapters.
2. **Responsive CSS Design:**
   - Always enforce `min-width: 0;` on flex children containing text.
   - Always enforce `aspect-ratio: 1; flex-shrink: 0;` on circular controls (swap buttons, indicator badges).
   - Ensure tables are wrapped inside `.table-responsive` or `.admin-table-container`.
3. **WCAG 2.1 AA Accessibility:**
   - All interactive buttons and inputs must possess explicit labels or `aria-label` attributes.
   - Form inputs must feature visible focus indicators (`:focus-visible`).
   - Normal text must satisfy minimum 4.5:1 color contrast ratio.
4. **State Machine Guards:**
   - Do not transition booking status directly to `CONFIRMED` or `ISSUED` without verified payment confirmation and supplier issuance result.

---

## 3. Running Test Suites

### 1. UI Accessibility & Responsive Viewport Test Suite:
```bash
node tests/ui_accessibility_and_responsive.test.js
```
*Expected Result:* 9 passed, 0 failed.

### 2. Backend Enterprise Test Suite:
```bash
cd backend
php artisan test
```
*Expected Result:* 164 passed, 0 failed.

### 3. Route Health Check:
```bash
python -c "
import urllib.request
urls = ['/', '/flights/search', '/booking/travellers', '/booking/extras', '/booking/review', '/booking/payment', '/my-bookings', '/admin']
for u in urls:
    res = urllib.request.urlopen('http://localhost:5000' + u)
    print(f'{u:30} => {res.status}')
"
```
*Expected Result:* All routes return HTTP 200 OK.
