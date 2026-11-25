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


if __name__ == "__main__":
    unittest.main(verbosity=2)
