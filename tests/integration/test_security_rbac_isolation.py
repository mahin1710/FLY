"""
FLY — Security, RBAC, Airline Data Isolation, Tampering & Idempotency Tests
"""

import os
import sys
import uuid
import json
import unittest
import urllib.request
import urllib.error

BASE_URL = os.environ.get("FLY_BASE_URL", "http://127.0.0.1:5000")


def http_req(method, path, payload=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(BASE_URL + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            raw = resp.read()
            ctype = resp.headers.get("Content-Type", "")
            if "json" in ctype:
                return resp.status, json.loads(raw.decode("utf-8"))
            return resp.status, raw.decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "ignore")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


class SecurityAndIsolationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Log in as existing seeded roles
        _, r_m0 = http_req("POST", "/api/auth/login", {"username": "Mahin0", "password": "Mahin0"})
        _, r_m1 = http_req("POST", "/api/auth/login", {"username": "Mahin1", "password": "Mahin1"})
        _, r_bg = http_req("POST", "/api/auth/login", {"username": "Admin_Biman", "password": "Admin_Biman"})
        _, r_bs = http_req("POST", "/api/auth/login", {"username": "Admin_USB", "password": "Admin_USB"})
        cls.tok_m0 = r_m0["token"]
        cls.tok_m1 = r_m1["token"]
        cls.tok_bg = r_bg["token"]
        cls.tok_bs = r_bs["token"]

        _, fl = http_req("GET", "/api/flights?limit=5")
        cls.flight_id = fl["flights"][0]["id"]
        _, seats_d = http_req("GET", f"/api/flights/{cls.flight_id}/seats")
        cls.free_seats = [s["id"] for s in seats_d["seats"] if s["status"] == "AVAILABLE"]

    def test_01_login_page_hides_demo_credentials(self):
        st, html = http_req("GET", "/login")
        self.assertEqual(st, 200)
        for leak in ("Mahin0", "Mahin1", "Admin_Biman", "SystemAdmin"):
            self.assertNotIn(leak, html, f"Login HTML leaked demo account credential hint: {leak}")

    def test_02_unauthenticated_rejection(self):
        for ep in ("/api/reservations/my", "/api/admin/dashboard"):
            st, _ = http_req("GET", ep)
            self.assertEqual(st, 401, f"{ep} allowed unauthenticated access")
        st_h, _ = http_req("POST", "/api/bookings/hold", {"flightId": self.flight_id, "seatIds": [self.free_seats[0]]})
        self.assertEqual(st_h, 401)

    def test_03_passenger_cannot_access_admin_endpoints(self):
        for ep in ("/api/admin/dashboard", "/api/airline/flights", "/api/admin/audit-logs"):
            st, _ = http_req("GET", ep, token=self.tok_m0)
            self.assertEqual(st, 403, f"Passenger should not reach {ep}")

    def test_04_airline_admin_isolation(self):
        # Biman Admin (839) requesting US-Bangla (371) data must fail with 403
        st, _ = http_req("GET", "/api/admin/dashboard?airlineId=371", token=self.tok_bg)
        self.assertEqual(st, 403)

        # Fetch a US-Bangla flight and verify Biman Admin cannot mutate it
        _, usb_flights = http_req("GET", "/api/airline/flights", token=self.tok_bs)
        self.assertTrue(len(usb_flights) > 0)
        usb_fid = usb_flights[0]["id"]
        st_put, _ = http_req("PUT", f"/api/airline/flights/{usb_fid}", {"status": "DELAYED"}, token=self.tok_bg)
        self.assertEqual(st_put, 403)

    def test_05_idor_booking_protection(self):
        # Mahin0 creates a hold
        st_h, hold = http_req(
            "POST",
            "/api/bookings/hold",
            {"flightId": self.flight_id, "seatIds": [self.free_seats[0]]},
            token=self.tok_m0,
        )
        self.assertEqual(st_h, 201)
        ref = hold["bookingReference"]
        try:
            st_get, _ = http_req("GET", f"/api/bookings/{ref}", token=self.tok_m1)
            self.assertEqual(st_get, 403)
            st_can, _ = http_req("POST", "/api/bookings/cancel", {"bookingReference": ref}, token=self.tok_m1)
            self.assertEqual(st_can, 403)
        finally:
            http_req("POST", "/api/bookings/cancel", {"bookingReference": ref}, token=self.tok_m0)

    def test_06_server_rejects_client_fare_tampering(self):
        st_h, res = http_req(
            "POST",
            "/api/bookings/hold",
            {"flightId": self.flight_id, "seatIds": [self.free_seats[1]], "expectedFare": 1},
            token=self.tok_m0,
        )
        self.assertNotEqual(st_h, 201)
        self.assertEqual(res.get("code"), "FARE_CHANGED")

    def test_07_payment_failure_and_timeout_release_seats_and_idempotency(self):
        # Scenario A: Failure releases seat
        st1, h1 = http_req("POST", "/api/bookings/hold", {"flightId": self.flight_id, "seatIds": [self.free_seats[2]]}, token=self.tok_m0)
        self.assertEqual(st1, 201)
        st_fail, _ = http_req(
            "POST",
            "/api/bookings/confirm",
            {"bookingReference": h1["bookingReference"], "scenario": "SIMULATE_FAILURE", "idempotencyKey": uuid.uuid4().hex},
            token=self.tok_m0,
        )
        self.assertEqual(st_fail, 400)
        _, seats_after_fail = http_req("GET", f"/api/flights/{self.flight_id}/seats")
        seat_obj = next(s for s in seats_after_fail["seats"] if s["id"] == self.free_seats[2])
        self.assertEqual(seat_obj["status"], "AVAILABLE")

        # Scenario B: Success + Idempotent replay
        st2, h2 = http_req("POST", "/api/bookings/hold", {"flightId": self.flight_id, "seatIds": [self.free_seats[2]]}, token=self.tok_m0)
        self.assertEqual(st2, 201)
        ref2 = h2["bookingReference"]
        ikey = f"IDEM-{uuid.uuid4().hex}"
        try:
            ok1, c1 = http_req("POST", "/api/bookings/confirm", {"bookingReference": ref2, "scenario": "SIMULATE_SUCCESS", "idempotencyKey": ikey}, token=self.tok_m0)
            self.assertEqual(ok1, 200)
            ok2, c2 = http_req("POST", "/api/bookings/confirm", {"bookingReference": ref2, "scenario": "SIMULATE_SUCCESS", "idempotencyKey": ikey}, token=self.tok_m0)
            self.assertEqual(ok2, 200)
            self.assertTrue(c2.get("alreadyConfirmed"))
            self.assertEqual(c1.get("pnrCode"), c2.get("pnrCode"))
        finally:
            http_req("POST", "/api/bookings/cancel", {"bookingReference": ref2, "reason": "Test cleanup"}, token=self.tok_m0)

    def test_08_sql_injection_and_malformed_input_safety(self):
        import urllib.parse
        sqli = urllib.parse.quote("' OR 1=1 --")
        st1, body1 = http_req("GET", f"/api/flights?from={sqli}&to=CXB")
        self.assertEqual(st1, 200)
        self.assertEqual(len(body1.get("flights", [])), 0)

        st2, body2 = http_req("GET", "/api/flights/fare-breakdown?flightId=1&adults=notanint")
        self.assertEqual(st2, 400)
        self.assertNotIn("Traceback", str(body2))

    def test_09_flight_schedule_validation_and_conflict(self):
        # Arrival <= Departure rejected
        st_bad, _ = http_req("POST", "/api/airline/flights", {
            "flightNumber": f"BG-BAD-{uuid.uuid4().hex[:4]}",
            "depIATA": "DAC", "arrIATA": "CXB",
            "depDateTime": "2027-06-15 12:00:00", "arrDateTime": "2027-06-15 11:00:00",
            "economyPrice": 4500
        }, token=self.tok_bg)
        self.assertEqual(st_bad, 400)

        # Valid flight creation succeeds, exact duplicate schedule conflicts (409)
        fnum = f"BG-T-{uuid.uuid4().hex[:4]}".upper()
        st_ok, created = http_req("POST", "/api/airline/flights", {
            "flightNumber": fnum,
            "depIATA": "DAC", "arrIATA": "CXB",
            "depDateTime": "2027-06-20 10:00:00", "arrDateTime": "2027-06-20 11:05:00",
            "economyPrice": 4800
        }, token=self.tok_bg)
        self.assertEqual(st_ok, 201)
        fid = created["flightId"]
        try:
            st_dup, _ = http_req("POST", "/api/airline/flights", {
                "flightNumber": fnum,
                "depIATA": "DAC", "arrIATA": "CXB",
                "depDateTime": "2027-06-20 10:00:00", "arrDateTime": "2027-06-20 11:05:00",
                "economyPrice": 4800
            }, token=self.tok_bg)
            self.assertEqual(st_dup, 409)
        finally:
            http_req("DELETE", f"/api/airline/flights/{fid}", token=self.tok_bg)

    def test_10_confirmed_booking_flight_protection(self):
        # Find or create flight under Biman (839) and confirm a booking on it
        fnum = f"BG-PROT-{uuid.uuid4().hex[:4]}".upper()
        st_c, created = http_req("POST", "/api/airline/flights", {
            "flightNumber": fnum, "depIATA": "DAC", "arrIATA": "CGP",
            "depDateTime": "2027-07-10 09:00:00", "arrDateTime": "2027-07-10 09:55:00",
            "economyPrice": 4100
        }, token=self.tok_bg)
        self.assertEqual(st_c, 201)
        fid = created["flightId"]
        st_h, hold = http_req("POST", "/api/bookings/hold", {"flightId": fid, "seatIds": [self.free_seats[3]]}, token=self.tok_m0)
        self.assertEqual(st_h, 201)
        ref = hold["bookingReference"]
        try:
            st_p, _ = http_req("POST", "/api/bookings/confirm", {"bookingReference": ref, "scenario": "SIMULATE_SUCCESS", "idempotencyKey": uuid.uuid4().hex}, token=self.tok_m0)
            self.assertEqual(st_p, 200)
            st_cancel_fl, body_fl = http_req("PUT", f"/api/airline/flights/{fid}", {"status": "CANCELLED"}, token=self.tok_bg)
            self.assertEqual(st_cancel_fl, 409)
            self.assertEqual(body_fl.get("code"), "CONFIRMED_BOOKINGS_EXIST")
        finally:
            http_req("POST", "/api/bookings/cancel", {"bookingReference": ref}, token=self.tok_m0)
            http_req("DELETE", f"/api/airline/flights/{fid}", token=self.tok_bg)

    def test_11_admin_promo_management_and_airline_isolation(self):
        code = f"BGQA{uuid.uuid4().hex[:4]}".upper()
        st_cr, cr = http_req("POST", "/api/admin/promos", {
            "code": code, "discountType": "PERCENT", "discountValue": 12, "minFare": 3000
        }, token=self.tok_bg)
        self.assertEqual(st_cr, 201)
        pid = cr["id"]
        # US-Bangla admin cannot toggle Biman promo (403)
        st_cross, _ = http_req("PUT", f"/api/admin/promos/{pid}", {"isActive": False}, token=self.tok_bs)
        self.assertEqual(st_cross, 403)
        st_own, _ = http_req("PUT", f"/api/admin/promos/{pid}", {"isActive": False}, token=self.tok_bg)
        self.assertEqual(st_own, 200)

    def test_12_infant_requires_accompanying_adult(self):
        st, _ = http_req("GET", "/api/flights/fare-breakdown?flightId=1&adults=1&infants=2")
        self.assertEqual(st, 400)


if __name__ == "__main__":
    unittest.main(verbosity=2)
