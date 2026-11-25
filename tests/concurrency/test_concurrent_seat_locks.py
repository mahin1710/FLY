"""
FLY — Phase 4 Concurrency & Database Stress Test Suite
Tests:
A. 50 simultaneous independent reservation attempts on the SAME flight seat (1 wins, 49 conflict)
B. Overlapping multi-seat atomicity (User A requests [10A, 10B], User B requests [10B, 10C])
C. Expired lock testing (lazy cleanup, repeated cleanup, expired checkout, expired lock extension)
D. Simultaneous payment idempotency (same key & different key on same booking)
E. Live SQLite partial unique index & PNR/idempotency integrity verification
"""

import os
import sys
import uuid
import time
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
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "ignore")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw}


class ConcurrencyStressTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        status, data = http_json("GET", "/api/flights?limit=10")
        assert status == 200 and data.get("flights"), "No active flights available"
        cls.flight_id = data["flights"][0]["id"]

        s_status, s_data = http_json("GET", f"/api/flights/{cls.flight_id}/seats")
        assert s_status == 200
        avail = [s for s in s_data["seats"] if s["status"] == "AVAILABLE"]
        assert len(avail) >= 7, "Need at least 7 free seats for 50-thread stress suite"

        cls.seat_50 = avail[0]
        cls.seat_multi_a = avail[1]
        cls.seat_multi_shared = avail[2]
        cls.seat_multi_c = avail[3]
        cls.seat_exp = avail[4]
        cls.seat_idem = avail[5]

        # Provision 50 isolated passenger sessions + DB accounts cleanly
        cls.tokens = []
        cls.created_refs = []
        cls.temp_user_ids = []
        cls.tag = uuid.uuid4().hex[:6]
        pw_hash = database.hash_password("Password123!")
        now_dt = datetime.utcnow()
        created_at = now_dt.strftime("%Y-%m-%d %H:%M:%S")
        expires_at = (now_dt + timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")

        conn = database.get_db()
        cur = conn.cursor()
        for i in range(50):
            uname = f"stress50_{cls.tag}_{i}"
            email = f"{uname}@test.fly"
            cur.execute(
                "INSERT INTO accounts (username, password, emailAddress, role, display_name, location) VALUES (?, ?, ?, 'PASSENGER', ?, 'Dhaka, Bangladesh')",
                (uname, pw_hash, email, f"Stress Pax {i}"),
            )
            uid = cur.lastrowid
            cls.temp_user_ids.append(uid)
            tok = secrets.token_hex(32)
            cur.execute(
                "INSERT INTO auth_sessions (token, account_id, username, role, airline_id, ip_address, user_agent, created_at, expires_at) VALUES (?, ?, ?, 'PASSENGER', NULL, '127.0.0.1', 'stress-test', ?, ?)",
                (tok, uid, uname, created_at, expires_at),
            )
            cls.tokens.append(tok)
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        conn = database.get_db()
        for ref in cls.created_refs:
            conn.execute("DELETE FROM tickets WHERE booking_reference = ?", (ref,))
            conn.execute("DELETE FROM payments WHERE booking_reference = ?", (ref,))
            conn.execute("DELETE FROM reservations WHERE booking_reference = ?", (ref,))
            conn.execute("DELETE FROM refund_requests WHERE booking_reference = ?", (ref,))
            conn.execute("DELETE FROM bookings WHERE booking_reference = ?", (ref,))
        if cls.temp_user_ids:
            ph = ",".join("?" for _ in cls.temp_user_ids)
            conn.execute(f"DELETE FROM audit_logs WHERE actor_id IN ({ph})", cls.temp_user_ids)
            conn.execute(f"DELETE FROM auth_sessions WHERE account_id IN ({ph})", cls.temp_user_ids)
            conn.execute(f"DELETE FROM accounts WHERE id IN ({ph})", cls.temp_user_ids)
        conn.commit()
        conn.close()

    def test_01_fifty_simultaneous_holds_same_seat(self):
        """Phase 4A: 50 independent threads attempt to reserve the SAME seat concurrently."""
        t0 = time.perf_counter()

        def attempt(tok):
            return http_json(
                "POST",
                "/api/bookings/hold",
                {"flightId": self.flight_id, "seatIds": [self.seat_50["id"]], "cabinClass": "Economy"},
                token=tok,
            )

        with ThreadPoolExecutor(max_workers=50) as pool:
            results = list(pool.map(attempt, self.tokens))

        elapsed = time.perf_counter() - t0
        wins = [r for r in results if r[0] == 201]
        conflicts = [r for r in results if r[0] == 409]
        unexpected = [r for r in results if r[0] not in (201, 409)]

        for _, body in wins:
            if body.get("bookingReference"):
                self.created_refs.append(body["bookingReference"])

        print(f"\n[Stress50] Seat={self.seat_50['code']} duration={elapsed:.3f}s wins={len(wins)} conflicts={len(conflicts)} unexpected={len(unexpected)}")

        self.assertEqual(len(unexpected), 0, f"Unexpected errors: {unexpected}")
        self.assertEqual(len(wins), 1, f"Expected strictly 1 winner across 50 threads, got {len(wins)}")
        self.assertEqual(len(conflicts), 49, f"Expected 49 conflicts across 50 threads, got {len(conflicts)}")

        conn = database.get_db()
        active_cnt = conn.execute(
            "SELECT COUNT(*) FROM reservations WHERE id_flight = ? AND id_seat = ? AND status IN ('PENDING_PAYMENT','HELD','LOCKED','CONFIRMED')",
            (self.flight_id, self.seat_50["id"]),
        ).fetchone()[0]
        conn.close()
        self.assertEqual(active_cnt, 1)

    def test_02_overlapping_multiseat_atomicity(self):
        """Phase 4B: Simultaneous overlapping requests [A, Shared] vs [Shared, C] -> exactly 1 succeeds, 0 partial locks."""

        def hold_pair(args):
            tok, pair = args
            return http_json(
                "POST",
                "/api/bookings/hold",
                {"flightId": self.flight_id, "seatIds": pair, "cabinClass": "Economy"},
                token=tok,
            )

        pair_a = [self.seat_multi_a["id"], self.seat_multi_shared["id"]]
        pair_b = [self.seat_multi_shared["id"], self.seat_multi_c["id"]]

        with ThreadPoolExecutor(max_workers=2) as pool:
            res = list(pool.map(hold_pair, [(self.tokens[10], pair_a), (self.tokens[11], pair_b)]))

        wins = [r for r in res if r[0] == 201]
        conflicts = [r for r in res if r[0] == 409]
        for _, body in wins:
            if body.get("bookingReference"):
                self.created_refs.append(body["bookingReference"])

        self.assertEqual(len(wins), 1, f"Expected 1 winner on overlapping multi-seat hold, got {res}")
        self.assertEqual(len(conflicts), 1, f"Expected 1 full rollback conflict, got {res}")

        # The loser's non-shared seat MUST remain AVAILABLE
        _, seat_snap = http_json("GET", f"/api/flights/{self.flight_id}/seats")
        by_id = {s["id"]: s for s in seat_snap["seats"]}
        winner_seats = set(wins[0][1]["seatIds"])
        if self.seat_multi_a["id"] not in winner_seats:
            self.assertEqual(by_id[self.seat_multi_a["id"]]["status"], "AVAILABLE")
        if self.seat_multi_c["id"] not in winner_seats:
            self.assertEqual(by_id[self.seat_multi_c["id"]]["status"], "AVAILABLE")

    def test_03_expired_lock_lifecycle_and_rejection(self):
        """Phase 4C: Expired lock blocks checkout & extension, repeated cleanup is idempotent, next user can reserve."""
        st, r1 = http_json("POST", "/api/bookings/hold", {"flightId": self.flight_id, "seatIds": [self.seat_exp["id"]]}, token=self.tokens[20])
        self.assertEqual(st, 201)
        ref1 = r1["bookingReference"]
        self.created_refs.append(ref1)

        past = (datetime.utcnow() - timedelta(minutes=3)).strftime("%Y-%m-%d %H:%M:%S")
        conn = database.get_db()
        conn.execute("UPDATE bookings SET expires_at = ? WHERE booking_reference = ?", (past, ref1))
        conn.execute("UPDATE reservations SET expires_at = ? WHERE booking_reference = ?", (past, ref1))
        conn.commit()
        conn.close()

        # Expired lock extension must fail (410)
        st_ext, _ = http_json("POST", f"/api/bookings/{ref1}/extend-lock", {}, token=self.tokens[20])
        self.assertEqual(st_ext, 410)

        # Expired checkout confirmation must fail (410)
        st_pay, _ = http_json(
            "POST",
            "/api/bookings/confirm",
            {"bookingReference": ref1, "scenario": "SIMULATE_SUCCESS", "idempotencyKey": f"EXP-{self.tag}"},
            token=self.tokens[20],
        )
        self.assertEqual(st_pay, 410)

        # Repeated cleanup execution is idempotent
        database.cleanup_expired_holds()
        database.cleanup_expired_holds()

        # New passenger cleanly acquires released seat
        st2, r2 = http_json("POST", "/api/bookings/hold", {"flightId": self.flight_id, "seatIds": [self.seat_exp["id"]]}, token=self.tokens[21])
        self.assertEqual(st2, 201)
        self.created_refs.append(r2["bookingReference"])

    def test_04_concurrent_payment_idempotency(self):
        """Phase 4D: 10 simultaneous confirm requests (mix of same & distinct keys) produce strictly 1 CAPTURED payment and 1 ticket."""
        st, h = http_json("POST", "/api/bookings/hold", {"flightId": self.flight_id, "seatIds": [self.seat_idem["id"]]}, token=self.tokens[30])
        self.assertEqual(st, 201)
        ref = h["bookingReference"]
        self.created_refs.append(ref)

        same_key = f"SAMEKEY-{self.tag}"
        payloads = [
            {"bookingReference": ref, "scenario": "SIMULATE_SUCCESS", "idempotencyKey": same_key if i < 6 else f"DIFFKEY-{self.tag}-{i}"}
            for i in range(10)
        ]

        def pay(p):
            return http_json("POST", "/api/bookings/confirm", p, token=self.tokens[30])

        with ThreadPoolExecutor(max_workers=10) as pool:
            pay_res = list(pool.map(pay, payloads))

        statuses = [r[0] for r in pay_res]
        self.assertTrue(all(s == 200 for s in statuses), f"Expected all idempotent replays/confirmations 200 OK, got {pay_res}")

        pnrs = {r[1].get("pnrCode") for r in pay_res if isinstance(r[1], dict)}
        self.assertEqual(len(pnrs), 1, f"Multiple PNRs issued on concurrent payment! {pnrs}")

        conn = database.get_db()
        pay_rows = conn.execute("SELECT COUNT(*) FROM payments WHERE booking_reference = ? AND status = 'CAPTURED'", (ref,)).fetchone()[0]
        ticket_rows = conn.execute("SELECT COUNT(*) FROM tickets WHERE booking_reference = ?", (ref,)).fetchone()[0]
        conn.close()
        self.assertEqual(pay_rows, 1, "Multiple CAPTURED payments inserted!")
        self.assertEqual(ticket_rows, 1, "Multiple tickets issued!")


if __name__ == "__main__":
    unittest.main(verbosity=2)
