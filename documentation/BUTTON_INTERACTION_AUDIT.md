# FLY — Complete Button & Interactive Controls Audit

**Audit Method:** Source-handler verification across all templates/scripts, JS DOM behavioral tests (`node tests/ui/test_search_widget_behavior.js`), and live HTTP/API/E2E verification (`python -m unittest discover -s tests -p "test_*.py" -v`).

| Page | Element | Expected Action | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Header (`base.html`)** | FLY Brand Logo | Navigate to `/` | Returns HTTP 200 `/` | **PASS** |
| **Header (`base.html`)** | Flights / Manage Booking / My Bookings / Support / Admin links | Navigate cleanly to matching views; Admin hidden for non-admins | All routes verified HTTP 200; Admin nav visibility controlled by role | **PASS** |
| **Header (`base.html`)** | Dark / Light Theme Toggle | Switch `data-theme` light <-> dark | Verified in `shell.js` | **PASS** |
| **Header (`base.html`)** | Account Dropdown & Sign Out | Open profile/bookings links or Sign Out | Verified via `shell.js` & `api_client.js` | **PASS** |
| **Homepage (`/`)** | Flights / Hotels / Car Rentals Tabs (`#catTabFlights`, `#catTabHotels`, `#catTabCarRental`) | Switch active search panel cleanly | Removed fake partner modal; switches dedicated forms cleanly | **PASS** |
| **Homepage (`/`)** | Trip Type Pills (`One Way`, `Round Trip`, `Multi City`) | Exact order `One Way -> Round Trip -> Multi City`, `One Way` default | DOM order & switching verified via E2E & Node tests | **PASS** |
| **Homepage (`/`)** | From & To Airport Autocomplete (`#homeOriginInput`, `#homeDestInput`) | Query `/api/airports/search`, retain IATA, select via mousedown & keyboard | `/api/airports/search?q=Dhaka` -> `DAC`, `Dubai` -> `DXB`, `mousedown` avoids blur race | **PASS** |
| **Homepage (`/`)** | Swap Button (`#btnSwapHome`) | Swap origin & destination inputs and state | Swaps state & inputs cleanly without stale codes | **PASS** |
| **Homepage (`/`)** | Departure & Return Date Pickers (`#homeDepDate`, `#homeReturnDate`) | Block past dates (`Asia/Dhaka` min), enforce `return >= departure` | Both frontend and `/api/flights` return `400 PAST_DATE_REJECTED` / `INVALID_RETURN_DATE` | **PASS** |
| **Homepage (`/`)** | Search Flights Button (`#btnHomeSearch`) | Validate, call `/api/flights`, navigate to `/flights/search?...` | Fixed frozen `isSubmitting` bug & disabled lock; verified navigation & E2E | **PASS** |
| **Homepage (`/`)** | Add / Remove / Swap Multi-City Leg | Add up to 5 legs, remove down to 2, maintain chronological order | Verified in Node widget tests | **PASS** |
| **Homepage (`/`)** | Search Hotels / Search Cars Buttons | Validate dates/guests/driver age, call `/api/hotels/search` / `/api/cars/search`, navigate | Verified `400` validation & `200 PROVIDER_NOT_CONFIGURED` honest pages | **PASS** |
| **Homepage (`/`)** | Quick Route Tags & Popular Destination Cards (8 cards) | Pre-fill From/To & launch or scroll to search with `.webp` cover images | 8/8 WebP images resolve `200 OK`; handlers bound to `FlightSearchWidget` | **PASS** |
| **Flight Results (`/flights/search`)** | Sort Tabs, Sidebar Filters, Details Accordion, Select Seats | Filter live DB results & open `/flights/<id>/seats` | All filter/sort & DB search flows verified `200 OK` | **PASS** |
| **Travellers & Seats (`/flights/<id>/seats`)** | Select Travellers (`+/-` Adults, Children, Infants), Cabin, Seat Map, Lock Seats | Enforce IATA `infants <= adults`, revalidate fare, lock atomically `POST /api/bookings/hold` | Verified in `test_05` (`+24` total 2A+1C+1I breakdown & atomic lock) | **PASS** |
| **Checkout (`/checkout`)** | `+2 Min Extend`, Promo Apply (`FLY10`), Payment Method & Complete Payment | Update passenger details, discount & confirm idempotently | Verified end-to-end with PNR, QR SVG & PDF download | **PASS** |
| **Ticket (`/ticket/<pnr>`)** | Print E-Ticket, Download PDF, Verify Pass | Render QR, stream `%PDF-1.4`, open `/ticket/verify/<token>` | Verified in E2E suite | **PASS** |
| **My Bookings & Profile** | Trip Filters, Resume Checkout, Cancel/Refund, Save/Delete Travelers | Manage bookings & passenger directory via DB APIs | Verified in E2E & RBAC integration tests | **PASS** |
| **Manage Booking (`/manage-booking`)** | Find Reservation (`POST /api/bookings/lookup`) | PNR + Email/Surname lookup + PDF download | Verified in E2E suite | **PASS** |
| **Admin Console (`/admin/*`)** | Tabs, Create/Update Flight, Status Dropdown, Refund Decision, Settings/Promos | Strictly isolated CRUD & audit inspection | Verified in Workflow 5 & RBAC isolation tests | **PASS** |
| **Visual Chrome DevTools Click Run** | Live Chrome DevTools Automation | Automated real Chrome click-through | Chrome `DevToolsActivePort` inactive on host | **BLOCKED** (Node DOM + HTTP E2E ran instead) |
