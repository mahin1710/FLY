"""
FLY — Critical Concurrency & Double-Booking Prevention Test Suite
Tests 20+ simultaneous threaded hold requests on the exact same flight seat,
multi-seat atomic rollback, and automatic lock expiration recovery.
"""

import os
import sys
import uuid
import secrets
import unittest
import urllib.request
import urllib.error
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import database  # noqa: E402

BASE_URL = os.environ.get("FLY_BASE_URL", "http://127.0.0.1:5000")


def http_json(method, path, payload=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(BASE_URL + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "ignore")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw}


class ConcurrentSeatLockTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Find an active future flight and 3 currently available seats
        status, data = http_json("GET", "/api/flights?limit=10")
        assert status == 200 and data.get("flights"), "No active flights available for concurrency testing"
        cls.flight_id = data["flights"][0]["id"]

        s_status, s_data = http_json("GET", f"/api/flights/{cls.flight_id}/seats")
        assert s_status == 200
        avail = [s for s in s_data["seats"] if s["status"] == "AVAILABLE"]
        assert len(avail) >= 4, "Need at least 4 free seats on test flight"
        cls.target_seat = avail[0]
        cls.rollback_seat_free = avail[1]
        cls.rollback_seat_taken = avail[2]
        cls.expiry_seat = avail[3]

        # Provision 20 distinct test passengers + auth_sessions tokens in DB
        cls.tokens = []
        cls.created_refs = []
        cls.created_user_ids = []
        tag = uuid.uuid4().hex[:6]
        pw_hash = database.hash_password("Password123!")
        now_dt = datetime.utcnow()
        created_at = now_dt.strftime("%Y-%m-%d %H:%M:%S")
        expires_at = (now_dt + timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
        conn = database.get_db()
        cur = conn.cursor()
        for i in range(20):
            uname = f"concur_{tag}_{i}"
            email = f"{uname}@test.fly"
            cur.execute(
                "INSERT INTO accounts (username, password, emailAddress, role, display_name, location) VALUES (?, ?, ?, 'PASSENGER', ?, 'Dhaka, Bangladesh')",
                (uname, pw_hash, email, f"Test Pax {i}"),
            )
            uid = cur.lastrowid
            cls.created_user_ids.append(uid)
            tok = secrets.token_hex(32)
            cur.execute(
                "INSERT INTO auth_sessions (token, account_id, username, role, airline_id, ip_address, user_agent, created_at, expires_at) VALUES (?, ?, ?, 'PASSENGER', NULL, '127.0.0.1', 'concurrency-test', ?, ?)",
                (tok, uid, uname, created_at, expires_at),
            )
            cls.tokens.append(tok)
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        for idx, ref in enumerate(cls.created_refs):
            tok = cls.tokens[0]
            try:
                http_json("POST", "/api/bookings/cancel", {"bookingReference": ref, "reason": "Test cleanup"}, token=tok)
            except Exception:
                pass
        # Fallback direct cleanup for any booking created by any test user
        if cls.created_refs:
            conn = database.get_db()
            for ref in cls.created_refs:
                conn.execute("UPDATE reservations SET status = 'CANCELLED' WHERE booking_reference = ?", (ref,))
                conn.execute("UPDATE bookings SET status = 'CANCELLED' WHERE booking_reference = ?", (ref,))
            conn.commit()
            conn.close()

    def test_01_twenty_simultaneous_holds_same_seat(self):
        """Exactly 1 of 20 simultaneous users wins the seat; 19 get 409 Conflict."""

        def attempt_hold(token):
            return http_json(
                "POST",
                "/api/bookings/hold",
                {"flightId": self.flight_id, "seatIds": [self.target_seat["id"]], "cabinClass": "Economy"},
                token=token,
            )

        with ThreadPoolExecutor(max_workers=20) as pool:
            results = list(pool.map(attempt_hold, self.tokens))

        wins = [r for r in results if r[0] == 201]
        conflicts = [r for r in results if r[0] == 409]
        others = [r for r in results if r[0] not in (201, 409)]

        for _, payload in wins:
            if payload.get("bookingReference"):
                self.created_refs.append(payload["bookingReference"])

        self.assertEqual(len(others), 0, f"Unexpected non-201/409 responses: {others}")
        self.assertEqual(len(wins), 1, f"DOUBLE BOOKING DETECTED! Wins={len(wins)}: {wins}")
        self.assertEqual(len(conflicts), 19, f"Expected 19 conflicts, got {len(conflicts)}")

        # Verify database state strictly holds 1 active reservation
        conn = database.get_db()
        active_rows = conn.execute(
            "SELECT COUNT(*) FROM reservations WHERE id_flight = ? AND id_seat = ? AND status IN ('PENDING_PAYMENT','HELD','LOCKED','CONFIRMED')",
            (self.flight_id, self.target_seat["id"]),
        ).fetchone()[0]
        conn.close()
        self.assertEqual(active_rows, 1)

    def test_02_atomic_multi_seat_rollback(self):
        """If 1 of 2 requested seats is already held, BOTH must remain clean (zero partial hold)."""
        # First lock rollback_seat_taken legitimately
        st1, r1 = http_json(
            "POST",
            "/api/bookings/hold",
            {"flightId": self.flight_id, "seatIds": [self.rollback_seat_taken["id"]]},
            token=self.tokens[0],
        )
        self.assertEqual(st1, 201)
        self.created_refs.append(r1["bookingReference"])

        # Now user 2 tries to book [rollback_seat_free, rollback_seat_taken] together
        st2, r2 = http_json(
            "POST",
            "/api/bookings/hold",
            {"flightId": self.flight_id, "seatIds": [self.rollback_seat_free["id"], self.rollback_seat_taken["id"]]},
            token=self.tokens[1],
        )
        self.assertEqual(st2, 409)
        self.assertEqual(r2.get("code"), "SEAT_UNAVAILABLE")

        # Verify rollback_seat_free was NOT partially locked
        _, seat_snap = http_json("GET", f"/api/flights/{self.flight_id}/seats")
        free_row = next(s for s in seat_snap["seats"] if s["id"] == self.rollback_seat_free["id"])
        self.assertEqual(free_row["status"], "AVAILABLE")

    def test_03_expired_lock_auto_releases_seat(self):
        """An expired lock must automatically release its seat for the next passenger."""
        st1, r1 = http_json(
            "POST",
            "/api/bookings/hold",
            {"flightId": self.flight_id, "seatIds": [self.expiry_seat["id"]]},
            token=self.tokens[2],
        )
        self.assertEqual(st1, 201)
        ref1 = r1["bookingReference"]
        self.created_refs.append(ref1)

        # Backdate expiration directly in DB to simulate 10-minute window elapsing
        past = (datetime.utcnow() - timedelta(minutes=2)).strftime("%Y-%m-%d %H:%M:%S")
        conn = database.get_db()
        conn.execute("UPDATE bookings SET expires_at = ? WHERE booking_reference = ?", (past, ref1))
        conn.execute("UPDATE reservations SET expires_at = ? WHERE booking_reference = ?", (past, ref1))
        conn.commit()
        conn.close()

        # User 3 attempts to lock the same seat -> triggers cleanup_expired_holds and succeeds
        st2, r2 = http_json(
            "POST",
            "/api/bookings/hold",
            {"flightId": self.flight_id, "seatIds": [self.expiry_seat["id"]]},
            token=self.tokens[3],
        )
        self.assertEqual(st2, 201, f"Expired lock blocked new reservation: {r2}")
        self.created_refs.append(r2["bookingReference"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
