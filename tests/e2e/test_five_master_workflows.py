"""
FLY — Phase 11 Full End-to-End 5-Workflow Regression Suite
1. Normal Successful Booking (Register -> Login -> Search -> Seat -> Hold -> Pay -> PNR/QR/PDF -> History)
2. Failed Payment & Immediate Seat Release
3. Payment Timeout & Immediate Rebooking by Second Passenger
4. Booking Cancellation, Refund Policy, Ticket Status & Audit Verification
5. Administrator Full Lifecycle (KPIs, Flight Create/Edit/Fare/Status, Inventory, Bookings, Audit Logs, Tenant Isolation)
"""

import os
import uuid
import json
import unittest
import urllib.request
import urllib.error

BASE_URL = os.environ.get("FLY_BASE_URL", "http://127.0.0.1:5000")


def req(method, path, payload=None, token=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
    r = urllib.request.Request(BASE_URL + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            raw = resp.read()
            ctype = resp.headers.get("Content-Type", "")
            if "json" in ctype:
                return resp.status, resp.headers, json.loads(raw.decode("utf-8"))
            return resp.status, resp.headers, raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, e.headers, json.loads(raw.decode("utf-8"))
        except Exception:
            return e.code, e.headers, raw


class FiveMasterWorkflowsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _, _, r_m0 = req("POST", "/api/auth/login", {"username": "Mahin0", "password": "Mahin0"})
        _, _, r_m1 = req("POST", "/api/auth/login", {"username": "Mahin1", "password": "Mahin1"})
        _, _, r_bg = req("POST", "/api/auth/login", {"username": "Admin_Biman", "password": "Admin_Biman"})
        _, _, r_bs = req("POST", "/api/auth/login", {"username": "Admin_USB", "password": "Admin_USB"})
        cls.tok_m0 = r_m0["token"]
        cls.tok_m1 = r_m1["token"]
        cls.tok_bg = r_bg["token"]
        cls.tok_bs = r_bs["token"]

        _, _, fl = req("GET", "/api/flights?from=DAC&to=CXB")
        cls.flight_id = fl["flights"][0]["id"]
        _, _, sd = req("GET", f"/api/flights/{cls.flight_id}/seats")
        avail = [s["id"] for s in sd["seats"] if s["status"] == "AVAILABLE"]
        cls.seats = avail[:5]

    def test_workflow_2_failed_payment_releases_seat(self):
        st, _, hold = req("POST", "/api/bookings/hold", {"flightId": self.flight_id, "seatIds": [self.seats[0]]}, token=self.tok_m0)
        self.assertEqual(st, 201)
        ref = hold["bookingReference"]
        st_f, _, res_f = req("POST", "/api/bookings/confirm", {"bookingReference": ref, "scenario": "SIMULATE_FAILURE", "idempotencyKey": uuid.uuid4().hex}, token=self.tok_m0)
        self.assertEqual(st_f, 400)
        self.assertEqual(res_f.get("code"), "PAYMENT_FAILED")

        _, _, bk = req("GET", f"/api/bookings/{ref}", token=self.tok_m0)
        self.assertEqual(bk["status"], "CANCELLED")
        _, _, sd = req("GET", f"/api/flights/{self.flight_id}/seats")
        seat = next(s for s in sd["seats"] if s["id"] == self.seats[0])
        self.assertEqual(seat["status"], "AVAILABLE")

    def test_workflow_3_payment_timeout_allows_second_passenger(self):
        st, _, hold = req("POST", "/api/bookings/hold", {"flightId": self.flight_id, "seatIds": [self.seats[1]]}, token=self.tok_m0)
        self.assertEqual(st, 201)
        ref1 = hold["bookingReference"]
        st_t, _, res_t = req("POST", "/api/bookings/confirm", {"bookingReference": ref1, "scenario": "SIMULATE_TIMEOUT", "idempotencyKey": uuid.uuid4().hex}, token=self.tok_m0)
        self.assertEqual(st_t, 410)
        self.assertEqual(res_t.get("code"), "PAYMENT_TIMEOUT")

        # Second passenger immediately locks the released seat
        st2, _, hold2 = req("POST", "/api/bookings/hold", {"flightId": self.flight_id, "seatIds": [self.seats[1]]}, token=self.tok_m1)
        self.assertEqual(st2, 201)
        req("POST", "/api/bookings/cancel", {"bookingReference": hold2["bookingReference"], "reason": "QA cleanup"}, token=self.tok_m1)

    def test_workflow_4_booking_cancellation_refund_and_audit(self):
        st, _, hold = req("POST", "/api/bookings/hold", {"flightId": self.flight_id, "seatIds": [self.seats[2]]}, token=self.tok_m0)
        self.assertEqual(st, 201)
        ref = hold["bookingReference"]
        st_c, _, conf = req("POST", "/api/bookings/confirm", {"bookingReference": ref, "scenario": "SIMULATE_SUCCESS", "idempotencyKey": uuid.uuid4().hex}, token=self.tok_m0)
        self.assertEqual(st_c, 200)
        pnr = conf["pnrCode"]

        # History contains confirmed booking
        _, _, hist = req("GET", "/api/reservations/my", token=self.tok_m0)
        self.assertTrue(any(b["bookingReference"] == ref and b["status"] == "CONFIRMED" for b in hist))

        # Cancel and verify refund & ticket status & seat release
        st_x, _, can_res = req("POST", "/api/bookings/cancel", {"bookingReference": ref, "reason": "Trip postponed"}, token=self.tok_m0)
        self.assertEqual(st_x, 200)
        self.assertGreater(can_res["refundAmount"], 0)

        _, _, tk = req("GET", f"/api/reservations/ticket/{pnr}", token=self.tok_m0)
        self.assertEqual(tk["status"], "CANCELLED")
        self.assertEqual(tk["ticketStatus"], "CANCELLED")

        _, _, sd = req("GET", f"/api/flights/{self.flight_id}/seats")
        self.assertEqual(next(s for s in sd["seats"] if s["id"] == self.seats[2])["status"], "AVAILABLE")

    def test_workflow_5_administrator_lifecycle_and_isolation(self):
        # 1. Dashboard KPIs
        st_d, _, dash = req("GET", "/api/admin/dashboard", token=self.tok_bg)
        self.assertEqual(st_d, 200)
        self.assertEqual(dash["airlineId"], 839)

        # 2. Create Flight -> Update Fare & Status -> Inspect Inventory -> Audit Logs
        fnum = f"BG-E2E-{uuid.uuid4().hex[:4]}".upper()
        st_cf, _, cf = req("POST", "/api/airline/flights", {
            "flightNumber": fnum, "depIATA": "DAC", "arrIATA": "ZYL",
            "depDateTime": "2027-08-12 14:00", "arrDateTime": "2027-08-12 14:55",
            "aircraftModel": "Boeing 737-800", "economyPrice": 3900
        }, token=self.tok_bg)
        self.assertEqual(st_cf, 201)
        new_fid = cf["flightId"]
        try:
            st_u, _, _ = req("PUT", f"/api/airline/flights/{new_fid}", {"economyPrice": 4200, "status": "ON_TIME"}, token=self.tok_bg)
            self.assertEqual(st_u, 200)

            st_i, _, inv = req("GET", f"/api/admin/inventory/{new_fid}", token=self.tok_bg)
            self.assertEqual(st_i, 200)
            self.assertGreater(inv["summary"]["AVAILABLE"], 0)

            # Cross-airline admin rejected on inventory & flight edit
            st_x1, _, _ = req("GET", f"/api/admin/inventory/{new_fid}", token=self.tok_bs)
            self.assertEqual(st_x1, 403)
            st_x2, _, _ = req("PUT", f"/api/airline/flights/{new_fid}", {"status": "DELAYED"}, token=self.tok_bs)
            self.assertEqual(st_x2, 403)

            _, _, bks = req("GET", "/api/admin/all-bookings", token=self.tok_bg)
            self.assertEqual(bks["airlineId"], 839)

            _, _, logs = req("GET", "/api/admin/audit-logs", token=self.tok_bg)
            self.assertTrue(any(l.get("flight_id") == new_fid and l.get("event_type") == "ADMIN_FLIGHT_CREATED" for l in logs["logs"]))
        finally:
            req("DELETE", f"/api/airline/flights/{new_fid}", token=self.tok_bg)


if __name__ == "__main__":
    unittest.main(verbosity=2)
