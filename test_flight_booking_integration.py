import unittest
import requests
import time
import json

BASE_URL = "http://127.0.0.1:5000"

class TestFlightBookingIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Register or login test users
        cls.session_a = requests.Session()
        cls.session_b = requests.Session()

        # Login user A
        res_a = cls.session_a.post(f"{BASE_URL}/api/auth/login", json={
            "username": "customer",
            "password": "customer123"
        })
        if res_a.status_code != 200:
            res_a = cls.session_a.post(f"{BASE_URL}/api/auth/register", json={
                "username": f"test_a_{int(time.time())}",
                "password": "Password123!",
                "displayName": "User A"
            })
        cls.user_a = res_a.json().get("user")
        cls.token_a = res_a.json().get("token")

        # Login user B
        res_b = cls.session_b.post(f"{BASE_URL}/api/auth/login", json={
            "username": "admin",
            "password": "admin123"
        })
        if res_b.status_code != 200:
            res_b = cls.session_b.post(f"{BASE_URL}/api/auth/register", json={
                "username": f"test_b_{int(time.time())}",
                "password": "Password123!",
                "displayName": "User B"
            })
        cls.user_b = res_b.json().get("user")
        cls.token_b = res_b.json().get("token")

        # Get available flights
        flights_res = requests.get(f"{BASE_URL}/api/flights/search")
        cls.flights = flights_res.json().get("flights", [])
        assert len(cls.flights) >= 2, "Need at least 2 flights for tests"
        cls.flight1 = cls.flights[0]
        cls.flight2 = cls.flights[1]

    def test_01_fare_breakdown_calculation(self):
        """Test transparent fare calculation for one-way and round trips."""
        payload = {
            "flightIds": [self.flight1["id"], self.flight2["id"]],
            "cabinClass": "economy",
            "adults": 2,
            "children": 1,
            "infants": 0,
            "nbrLuggages": 2,
            "weight": 20
        }
        res = requests.post(f"{BASE_URL}/api/flights/fare-breakdown", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("success"))
        breakdown = data.get("breakdown")
        self.assertIn("baseFare", breakdown)
        self.assertIn("taxes", breakdown)
        self.assertIn("airlineCharges", breakdown)
        self.assertIn("totalPayable", breakdown)
        self.assertGreater(breakdown["totalPayable"], 0)
        # Check that totalPayable equals sum of components
        expected_sum = (
            breakdown["baseFare"] +
            breakdown["taxes"] +
            breakdown["airlineCharges"] +
            breakdown["serviceCharges"] +
            breakdown["luggageCharges"] -
            breakdown["discount"]
        )
        self.assertEqual(breakdown["totalPayable"], expected_sum)

    def test_02_pre_booking_revalidation_valid(self):
        """Test pre-booking revalidation when flight and seats are available."""
        # Get seats for flight1
        seats_res = requests.get(f"{BASE_URL}/api/flights/{self.flight1['id']}/seats")
        available_seats = [s for s in seats_res.json() if s.get("status") == "AVAILABLE"]
        self.assertGreaterEqual(len(available_seats), 1)

        payload = {
            "flightIds": [self.flight1["id"]],
            "seatIds": [available_seats[0]["id"]],
            "cabinClass": "economy",
            "adults": 1,
            "children": 0,
            "infants": 0,
            "passengerData": [
                {
                    "type": "adult",
                    "fullName": "Mahir Hossain",
                    "documentType": "Passport",
                    "documentNumber": "A12345678"
                }
            ]
        }
        headers = {"Authorization": f"Bearer {self.token_a}"} if self.token_a else {}
        res = requests.post(f"{BASE_URL}/api/bookings/validate", json=payload, headers=headers)
        self.assertEqual(res.status_code, 200)
        val = res.json()
        self.assertTrue(val.get("valid"))
        self.assertIn("currentFare", val)

    def test_03_pre_booking_revalidation_price_change_alert(self):
        """Test that sending outdated expectedTotal triggers priceChanged alert."""
        seats_res = requests.get(f"{BASE_URL}/api/flights/{self.flight1['id']}/seats")
        available_seats = [s for s in seats_res.json() if s.get("status") == "AVAILABLE"]
        
        payload = {
            "flightIds": [self.flight1["id"]],
            "seatIds": [available_seats[0]["id"]],
            "cabinClass": "economy",
            "adults": 1,
            "children": 0,
            "infants": 0,
            "expectedTotal": 100.0, # Deliberately wrong/outdated fare
            "passengerData": [
                {
                    "type": "adult",
                    "fullName": "John Doe",
                    "documentType": "NID",
                    "documentNumber": "1990123456789"
                }
            ]
        }
        res = requests.post(f"{BASE_URL}/api/bookings/validate", json=payload)
        self.assertEqual(res.status_code, 200)
        val = res.json()
        self.assertFalse(val.get("valid"))
        self.assertTrue(val.get("priceChanged"))
        self.assertIn("Fare updated", val.get("error", ""))

    def test_04_seat_hold_and_conflict_prevention(self):
        """User A holds a seat; User B cannot hold the same seat."""
        seats_res = requests.get(f"{BASE_URL}/api/flights/{self.flight1['id']}/seats")
        available_seats = [s for s in seats_res.json() if s.get("status") == "AVAILABLE"]
        self.assertGreaterEqual(len(available_seats), 1)
        target_seat = available_seats[0]

        # User A holds seat
        hold_payload_a = {
            "flightId": self.flight1["id"],
            "accountId": self.user_a["id"],
            "seatIds": [target_seat["id"]],
            "nbrLuggages": 1,
            "weight": 15,
            "passengerData": [
                {
                    "type": "adult",
                    "fullName": "User Alpha",
                    "documentType": "Passport",
                    "documentNumber": "P11223344"
                }
            ],
            "cabinClass": "economy",
            "tripType": "oneway"
        }
        res_a = self.session_a.post(f"{BASE_URL}/api/bookings/hold", json=hold_payload_a)
        self.assertEqual(res_a.status_code, 201)
        data_a = res_a.json()
        self.assertTrue(data_a.get("success"))
        booking_ref = data_a.get("bookingReference")
        self.assertIsNotNone(booking_ref)

        # User B tries to hold the same seat -> Expect 409 Conflict
        hold_payload_b = {
            "flightId": self.flight1["id"],
            "accountId": self.user_b["id"],
            "seatIds": [target_seat["id"]],
            "nbrLuggages": 0,
            "weight": 0
        }
        res_b = self.session_b.post(f"{BASE_URL}/api/bookings/hold", json=hold_payload_b)
        self.assertEqual(res_b.status_code, 409)

        # Confirm User A's payment
        confirm_payload = {
            "bookingReference": booking_ref,
            "paymentMethod": "credit_card",
            "transactionRef": f"TXN-TEST-{int(time.time())}"
        }
        conf_res = self.session_a.post(f"{BASE_URL}/api/bookings/confirm", json=confirm_payload)
        self.assertEqual(conf_res.status_code, 200)
        conf_data = conf_res.json()
        self.assertTrue(conf_data.get("success"))
        self.assertIn("ticket", conf_data)
        ticket = conf_data["ticket"]
        self.assertEqual(ticket.get("bookingReference"), booking_ref)
        self.assertEqual(ticket.get("fullName"), "USER ALPHA")

        # Idempotent re-confirmation check (prevent duplicate charge / duplicate confirm)
        dup_res = self.session_a.post(f"{BASE_URL}/api/bookings/confirm", json=confirm_payload)
        self.assertEqual(dup_res.status_code, 200)
        dup_data = dup_res.json()
        self.assertTrue(dup_data.get("success"))
        self.assertEqual(dup_data.get("bookingReference"), booking_ref)

    def test_05_round_trip_booking_flow(self):
        """Test round trip selection, hold, payment, and retrieval."""
        # Find available seats on flight1 and flight2
        seats_f1 = [s for s in requests.get(f"{BASE_URL}/api/flights/{self.flight1['id']}/seats").json() if s.get("status") == "AVAILABLE"]
        self.assertGreaterEqual(len(seats_f1), 1)
        seat1 = seats_f1[0]

        hold_payload = {
            "flightId": self.flight1["id"],
            "returnFlightId": self.flight2["id"],
            "accountId": self.user_a["id"],
            "seatIds": [seat1["id"]],
            "nbrLuggages": 2,
            "weight": 25,
            "tripType": "roundtrip",
            "cabinClass": "business",
            "passengerData": [
                {
                    "type": "adult",
                    "fullName": "Sarah Jenkins",
                    "documentType": "Passport",
                    "documentNumber": "B99887766"
                }
            ]
        }
        hold_res = self.session_a.post(f"{BASE_URL}/api/bookings/hold", json=hold_payload)
        self.assertEqual(hold_res.status_code, 201)
        ref = hold_res.json()["bookingReference"]

        # Confirm payment
        conf_res = self.session_a.post(f"{BASE_URL}/api/bookings/confirm", json={
            "bookingReference": ref,
            "paymentMethod": "instant_verification"
        })
        self.assertEqual(conf_res.status_code, 200)
        ticket = conf_res.json().get("ticket")
        self.assertIsNotNone(ticket)
        self.assertEqual(ticket.get("returnFlightId"), self.flight2["id"])

        # Check retrieval via GET /api/reservations/ticket/<ref>
        t_res = self.session_a.get(f"{BASE_URL}/api/reservations/ticket/{ref}")
        self.assertEqual(t_res.status_code, 200)
        fetched_ticket = t_res.json()
        self.assertEqual(fetched_ticket.get("bookingReference"), ref)
        self.assertEqual(fetched_ticket.get("fullName"), "SARAH JENKINS")

    def test_06_my_bookings_list_integration(self):
        """Test that user's bookings contain all newly confirmed reservations."""
        res = self.session_a.get(f"{BASE_URL}/api/reservations/my?accountId={self.user_a['id']}")
        self.assertEqual(res.status_code, 200)
        my_bookings = res.json()
        self.assertIsInstance(my_bookings, list)
        self.assertGreaterEqual(len(my_bookings), 1)
        first_b = my_bookings[0]
        self.assertIn("bookingReference", first_b)
        self.assertIn("status", first_b)

if __name__ == "__main__":
    unittest.main()
