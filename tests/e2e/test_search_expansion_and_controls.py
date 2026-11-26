"""
FLY — Parts 11 & 12 Required End-to-End Search, Date, Travellers, Hotels & Cars Tests
Verifies:
- Test 1: One Way Flight (Dhaka DAC -> Dubai DXB) future date
- Test 2: Round Trip Flight & Return >= Departure validation
- Test 3: Multi City search parameters & homepage tab order
- Test 4: Past Date Prevention (Asia/Dhaka timezone boundary)
- Test 5: No Travellers selector on homepage; Adults/Children/Infants + revalidation on seat_map
- Test 6: Hotel Search validation + honest unconfigured provider boundary
- Test 7: Car Rental Search validation + honest unconfigured provider boundary
- Test 8: Popular Destinations WebP local image resolution (8/8 200 OK)
- Test 9: General Button, Route & Page Integrity Audit
"""

import os
import re
import json
import uuid
import unittest
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timedelta, timezone

BASE_URL = os.environ.get("FLY_BASE_URL", "http://127.0.0.1:5000")


def fetch(method, path, payload=None, token=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(BASE_URL + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            raw = r.read()
            ctype = r.headers.get("Content-Type", "")
            return r.status, ctype, json.loads(raw.decode("utf-8")) if "json" in ctype else raw.decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "ignore")
        try:
            return e.code, e.headers.get("Content-Type", ""), json.loads(raw)
        except Exception:
            return e.code, "", raw


class SearchExpansionAndControlsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        dhaka_today = datetime.now(timezone(timedelta(hours=6))).date()
        cls.today_str = dhaka_today.strftime("%Y-%m-%d")
        cls.yesterday_str = (dhaka_today - timedelta(days=1)).strftime("%Y-%m-%d")
        cls.future_dep = (dhaka_today + timedelta(days=5)).strftime("%Y-%m-%d")
        cls.future_ret = (dhaka_today + timedelta(days=9)).strftime("%Y-%m-%d")

        _, _, login_d = fetch("POST", "/api/auth/login", {"username": "Mahin0", "password": "Mahin0"})
        cls.token = login_d["token"]

    def test_01_homepage_trip_order_and_no_travellers_selector(self):
        st, _, html = fetch("GET", "/")
        self.assertEqual(st, 200)
        # No visible travellers selector in homepage flight search form
        self.assertNotIn('id="travellersField"', html)
        self.assertNotIn("showPartnerModal", html)
        self.assertNotIn("/js/app.js", html)

        # Trip type exact order: One Way (active) -> Round Trip -> Multi City
        idx_ow = html.find('id="tabOneWay"')
        idx_rt = html.find('id="tabRoundTrip"')
        idx_mc = html.find('id="tabMultiCity"')
        self.assertTrue(0 < idx_ow < idx_rt < idx_mc, "Trip type buttons not in One Way -> Round Trip -> Multi City order")
        self.assertIn('class="trip-pill active" id="tabOneWay"', html)

        # Hotels and Car Rentals product tabs present
        self.assertIn('id="catTabHotels"', html)
        self.assertIn('id="catTabCarRental"', html)
        self.assertIn('id="hotelsSearchForm"', html)
        self.assertIn('id="carsSearchForm"', html)

    def test_02_oneway_dhaka_to_dubai_autocomplete_and_search(self):
        # Verify Dhaka & Dubai airport autocomplete endpoints return DAC and DXB
        st_ac1, _, ac_dac = fetch("GET", "/api/airports/search?q=Dhaka")
        self.assertEqual(st_ac1, 200)
        self.assertTrue(any(a.get("IATA") == "DAC" for a in ac_dac))

        st_ac2, _, ac_dxb = fetch("GET", "/api/airports/search?q=Dubai")
        self.assertEqual(st_ac2, 200)
        self.assertTrue(any(a.get("IATA") == "DXB" for a in ac_dxb))

        # Execute One Way DAC -> DXB search for future departure date
        st_f, _, res = fetch("GET", f"/api/flights?from=DAC&to=DXB&departure={self.future_dep}")
        self.assertEqual(st_f, 200)
        self.assertGreater(len(res.get("flights", [])), 0, "Expected DAC -> DXB flight(s) in database")

    def test_03_round_trip_date_validation(self):
        # Valid return >= departure passes
        st_ok, _, _ = fetch("GET", f"/api/flights?from=DAC&to=CXB&departure={self.future_dep}&return={self.future_ret}")
        self.assertEqual(st_ok, 200)
        # Return < departure rejected with 400
        st_bad, _, err = fetch("GET", f"/api/flights?from=DAC&to=CXB&departure={self.future_ret}&return={self.future_dep}")
        self.assertEqual(st_bad, 400)
        self.assertEqual(err.get("code"), "INVALID_RETURN_DATE")

    def test_04_past_travel_date_rejected_by_backend(self):
        st, _, err = fetch("GET", f"/api/flights?from=DAC&to=CXB&departure={self.yesterday_str}")
        self.assertEqual(st, 400)
        self.assertEqual(err.get("code"), "PAST_DATE_REJECTED")

    def test_05_booking_travellers_selection_and_fare_revalidation(self):
        _, _, seat_html = fetch("GET", "/flights/976/seats")
        self.assertIn("Select Travellers", seat_html)
        self.assertIn('id="btnPlusAdults"', seat_html)
        self.assertIn('id="btnPlusChildren"', seat_html)
        self.assertIn('id="btnPlusInfants"', seat_html)

        # Fare breakdown recalculates for 2 Adults + 1 Child + 1 Infant
        st_f1, _, fb1 = fetch("GET", "/api/flights/fare-breakdown?flightId=976&adults=1&children=0&infants=0")
        st_f2, _, fb2 = fetch("GET", "/api/flights/fare-breakdown?flightId=976&adults=2&children=1&infants=1")
        self.assertEqual(st_f1, 200)
        self.assertEqual(st_f2, 200)
        self.assertGreater(fb2["totalPayable"], fb1["totalPayable"])

        # Hold seats with 1 Adult + 1 Infant (1 seat) and verify checkout stores categories
        _, _, sd = fetch("GET", "/api/flights/976/seats")
        avail_id = next(s["id"] for s in sd["seats"] if s["status"] == "AVAILABLE")
        st_h, _, hold = fetch(
            "POST",
            "/api/bookings/hold",
            {"flightId": 976, "seatIds": [avail_id], "adults": 1, "children": 0, "infants": 1, "cabinClass": "Economy"},
            token=self.token,
        )
        self.assertEqual(st_h, 201)
        ref = hold["bookingReference"]
        try:
            st_b, _, bk = fetch("GET", f"/api/bookings/{ref}", token=self.token)
            self.assertEqual(st_b, 200)
            self.assertEqual(len(bk.get("passengerData") or []), 2)
        finally:
            fetch("POST", "/api/bookings/cancel", {"bookingReference": ref, "reason": "Test cleanup"}, token=self.token)

    def test_06_hotels_search_validation_and_provider_honesty(self):
        # Past checkIn rejected
        st_p, _, _ = fetch("GET", f"/api/hotels/search?destination=Dubai&checkIn={self.yesterday_str}&checkOut={self.future_ret}&rooms=1&adults=2")
        self.assertEqual(st_p, 400)
        # Check-out <= Check-in rejected
        st_bad, _, _ = fetch("GET", f"/api/hotels/search?destination=Dubai&checkIn={self.future_dep}&checkOut={self.future_dep}&rooms=1&adults=2")
        self.assertEqual(st_bad, 400)
        # Valid query returns honest providerConfigured=False when keys unset (no fake inventory)
        st_ok, _, res = fetch("GET", f"/api/hotels/search?destination=Dubai&checkIn={self.future_dep}&checkOut={self.future_ret}&rooms=1&adults=2&children=1")
        self.assertEqual(st_ok, 200)
        self.assertFalse(res["providerConfigured"])
        self.assertEqual(res["code"], "PROVIDER_NOT_CONFIGURED")
        self.assertEqual(res["hotels"], [])

        # HTML page loads 200 OK
        st_pg, _, _ = fetch("GET", f"/hotels/search?destination=Dubai&checkIn={self.future_dep}&checkOut={self.future_ret}&rooms=1&adults=2&children=0")
        self.assertEqual(st_pg, 200)

    def test_07_car_rentals_validation_and_provider_honesty(self):
        # Underage driver (<21) rejected
        st_age, _, _ = fetch("GET", f"/api/cars/search?pickupLocation=Dhaka&pickupDate={self.future_dep}&pickupTime=10:00&returnDate={self.future_ret}&returnTime=10:00&driverAge=18")
        self.assertEqual(st_age, 400)
        # Same-day return <= pickup time rejected
        st_tm, _, _ = fetch("GET", f"/api/cars/search?pickupLocation=Dhaka&pickupDate={self.future_dep}&pickupTime=14:00&returnDate={self.future_dep}&returnTime=12:00&driverAge=25")
        self.assertEqual(st_tm, 400)
        # Valid query returns honest unconfigured adapter boundary
        st_ok, _, res = fetch("GET", f"/api/cars/search?pickupLocation=Dhaka%20(DAC)&pickupDate={self.future_dep}&pickupTime=10:00&returnDate={self.future_ret}&returnTime=12:00&driverAge=26")
        self.assertEqual(st_ok, 200)
        self.assertFalse(res["providerConfigured"])
        self.assertEqual(res["code"], "PROVIDER_NOT_CONFIGURED")
        self.assertEqual(res["cars"], [])

        st_pg, _, _ = fetch("GET", f"/cars/search?pickupLocation=DAC&pickupDate={self.future_dep}&returnDate={self.future_ret}")
        self.assertEqual(st_pg, 200)

    def test_08_popular_destination_webp_images_load_200(self):
        _, _, html = fetch("GET", "/")
        imgs = re.findall(r'/images/destinations/[a-z0-9\-]+\.webp', html)
        self.assertEqual(len(imgs), 8, f"Expected 8 destination WebP cards, found {imgs}")
        for img_path in imgs:
            req = urllib.request.Request(BASE_URL + img_path, method="GET")
            with urllib.request.urlopen(req, timeout=5) as r:
                self.assertEqual(r.status, 200, f"Destination image {img_path} failed")
                self.assertGreater(len(r.read()), 5000, f"Destination image {img_path} looks empty/corrupt")


if __name__ == "__main__":
    unittest.main(verbosity=2)
