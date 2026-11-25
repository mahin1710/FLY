"""
FLY — Full End-to-End Passenger Journey Test
Register -> Search -> Seats -> Lock -> Extend -> Promo/Passenger Details -> Pay -> PNR/QR/PDF -> Cancel
"""

import os
import uuid
import json
import unittest
import urllib.request
import urllib.error

BASE_URL = os.environ.get("FLY_BASE_URL", "http://127.0.0.1:5000")


def req_raw(method, path, payload=None, token=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(BASE_URL + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


class EndToEndBookingJourneyTest(unittest.TestCase):
    def test_complete_passenger_lifecycle(self):
        tag = uuid.uuid4().hex[:6]
        uname = f"e2e_pax_{tag}"
        email = f"{uname}@fly.bd"

        # 1. Register new passenger
        st, _, raw = req_raw("POST", "/api/auth/register", {
            "username": uname, "password": "Password123!", "email": email, "firstName": "Amina", "lastName": "Rahman"
        })
        self.assertEqual(st, 201)
        token = json.loads(raw)["token"]

        # 2. Search flights DAC -> CXB
        st, _, raw = req_raw("GET", "/api/flights?from=DAC&to=CXB")
        self.assertEqual(st, 200)
        flights = json.loads(raw)["flights"]
        self.assertTrue(len(flights) > 0, "Expected DAC->CXB flights in seeded database")
        fid = flights[0]["id"]

        # 3. Get available seat
        st, _, raw = req_raw("GET", f"/api/flights/{fid}/seats", token=token)
        self.assertEqual(st, 200)
        avail = next(s for s in json.loads(raw)["seats"] if s["status"] == "AVAILABLE")

        # 4. Atomic seat hold (10 min lock)
        st, _, raw = req_raw("POST", "/api/bookings/hold", {"flightId": fid, "seatIds": [avail["id"]], "cabinClass": "Economy"}, token=token)
        self.assertEqual(st, 201)
        hold = json.loads(raw)
        ref = hold["bookingReference"]

        try:
            # 5. Extend lock (+2 min)
            st, _, raw = req_raw("POST", f"/api/bookings/{ref}/extend-lock", {}, token=token)
            self.assertEqual(st, 200)

            # 6. Apply passenger details + extra luggage + FLY10 promo code
            st, _, raw = req_raw("PUT", f"/api/bookings/{ref}/details", {
                "passengerData": [{"firstName": "Amina", "lastName": "Rahman", "passportNumber": "B009911"}],
                "contactEmail": email,
                "contactPhone": "+8801700000000",
                "nbrLuggages": 1,
                "weight": 10,
                "mealFee": 650,
                "insurance": True,
                "promoCode": "FLY10",
            }, token=token)
            self.assertEqual(st, 200)
            upd = json.loads(raw)
            self.assertEqual(upd["promoCode"], "FLY10")
            self.assertGreater(upd["discountAmount"], 0)

            # 7. Confirm simulated payment
            st, _, raw = req_raw("POST", "/api/bookings/confirm", {
                "bookingReference": ref, "paymentMethod": "SIMULATED_CARD", "scenario": "SIMULATE_SUCCESS", "idempotencyKey": f"E2E-{tag}"
            }, token=token)
            self.assertEqual(st, 200)
            conf = json.loads(raw)
            pnr = conf["pnrCode"]
            self.assertEqual(len(pnr), 6)

            # 8. Retrieve ticket + QR SVG
            st, _, raw = req_raw("GET", f"/api/reservations/ticket/{pnr}", token=token)
            self.assertEqual(st, 200)
            ticket = json.loads(raw)
            self.assertIn("<svg", ticket["qrSvg"])
            vtok = ticket["verificationToken"]

            # 9. Download official PDF ticket
            st, hdrs, pdf_bytes = req_raw("GET", f"/api/tickets/{pnr}/pdf", token=token)
            self.assertEqual(st, 200)
            self.assertIn("application/pdf", hdrs.get("Content-Type", ""))
            self.assertTrue(pdf_bytes.startswith(b"%PDF-1.4"))

            # 10. Public QR token verification & guest PNR lookup
            st, _, raw = req_raw("GET", f"/api/tickets/verify/{vtok}")
            self.assertEqual(st, 200)
            self.assertTrue(json.loads(raw)["valid"])

            st, _, raw = req_raw("POST", "/api/bookings/lookup", {"reference": pnr, "verifier": email})
            self.assertEqual(st, 200)
            self.assertEqual(json.loads(raw)["booking"]["pnrCode"], pnr)
        finally:
            # 11. Cancel and verify seat release
            req_raw("POST", "/api/bookings/cancel", {"bookingReference": ref, "reason": "E2E cleanup"}, token=token)


if __name__ == "__main__":
    unittest.main(verbosity=2)
