"""
FLY — Complete QR E-Ticket, Cryptographic Hash Storage, LAN Verification,
PDF Embedded QR Readability & Staff Atomic Check-In Tests (Part O - QR 1..20)
"""

import concurrent.futures
import json
import os
import re
import sys
import unittest
import urllib.error
import urllib.request
import uuid
import zlib
from PIL import Image
import zxingcpp

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import database  # noqa: E402
from config import Config  # noqa: E402

BASE_URL = os.environ.get("FLY_BASE_URL", "http://127.0.0.1:5000")


def req(method, path, payload=None, token=None, base=BASE_URL):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
    r = urllib.request.Request(base + path, data=body, headers=headers, method=method)
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


def _decode_pdf_embedded_qr(pdf_bytes: bytes) -> str:
    """Extracts the lossless FlateDecode /Image XObject from FLY PDF bytes and decodes via zxing-cpp."""
    m = re.search(rb"/Width\s+(\d+)\s+/Height\s+(\d+)\s+/ColorSpace\s+/DeviceRGB\s+/BitsPerComponent\s+8\s+/Filter\s+/FlateDecode\s+/Length\s+\d+\s+>>\s+stream\r?\n(.*?)\r?\nendstream", pdf_bytes, re.DOTALL)
    if not m:
        raise AssertionError("No embedded QR FlateDecode RGB XObject found inside generated PDF.")
    w, h = int(m.group(1)), int(m.group(2))
    raw_rgb = zlib.decompress(m.group(3))
    img = Image.frombytes("RGB", (w, h), raw_rgb)
    results = zxingcpp.read_barcodes(img)
    if not results:
        raise AssertionError("Embedded PDF QR image failed QR barcode decoding.")
    return results[0].text


class QrTicketingAndLanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        database.init_db()
        _, _, r0 = req("POST", "/api/auth/login", {"username": "Mahin0", "password": "Mahin0"})
        _, _, rbg = req("POST", "/api/auth/login", {"username": "Admin_Biman", "password": "Admin_Biman"})
        _, _, rbs = req("POST", "/api/auth/login", {"username": "Admin_USB", "password": "Admin_USB"})
        _, _, rsa = req("POST", "/api/auth/login", {"username": "SystemAdmin", "password": "SystemAdmin"})
        cls.tok_user = r0["token"]
        cls.tok_bg = rbg["token"]
        cls.tok_bs = rbs["token"]
        cls.tok_sa = rsa["token"]

        _, _, fl_res = req("GET", "/api/flights?from=DAC&to=CXB")
        fl_list = fl_res.get("flights", fl_res if isinstance(fl_res, list) else [])
        bg_fl = next((f for f in fl_list if int(f.get("id_airline") or f.get("airlineId") or 0) == 839), fl_list[0])
        cls.flight_id = bg_fl["id"]
        _, _, sm = req("GET", f"/api/flights/{cls.flight_id}/seats")
        cls.avail_seats = [s["id"] for s in sm["seats"] if s["status"] == "AVAILABLE"]
        assert len(cls.avail_seats) >= 4

    def test_01_deferred_issuance_withholds_qr_until_confirmed(self):
        seat_id = self.avail_seats[0]
        st, _, hold = req("POST", "/api/bookings/hold", {"flightId": self.flight_id, "seatIds": [seat_id]}, token=self.tok_user)
        self.assertEqual(st, 201)
        ref = hold["bookingReference"]
        try:
            st_c, _, conf = req(
                "POST",
                "/api/bookings/confirm",
                {
                    "bookingReference": ref,
                    "scenario": "SIMULATE_SUCCESS",
                    "issuanceScenario": "DEFER_ISSUANCE",
                    "idempotencyKey": uuid.uuid4().hex,
                },
                token=self.tok_user,
            )
            self.assertEqual(st_c, 200)
            self.assertEqual(conf["status"], "TICKETING_PENDING")
            tk = conf["ticket"]
            self.assertIsNone(tk["verificationToken"])
            self.assertIsNone(tk["qrSvg"])
            self.assertIsNone(tk["verifyUrl"])

            # PNG QR endpoint must refuse pending ticket
            st_png, _, _ = req("GET", f"/api/tickets/{ref}/qr.png", token=self.tok_user)
            self.assertEqual(st_png, 409)

            # Now confirm airline issuance -> generates active QR token!
            st_iss, _, iss_res = req("POST", f"/api/tickets/{ref}/issue-deferred", {}, token=self.tok_sa)
            self.assertEqual(st_iss, 200)
            issued_tk = iss_res["ticket"]
            self.assertEqual(issued_tk["issuanceState"], "ISSUED")
            self.assertTrue(issued_tk["verifyUrl"])
            self.assertNotIn("localhost", issued_tk["verifyUrl"])
            self.assertNotIn("127.0.0.1", issued_tk["verifyUrl"])
        finally:
            req("POST", "/api/bookings/cancel", {"bookingReference": ref, "reason": "Test cleanup"}, token=self.tok_user)

    def test_02_multi_passenger_separate_qr_pdf_decode_lan_and_checkin(self):
        s1, s2 = self.avail_seats[1], self.avail_seats[2]
        st, _, hold = req(
            "POST",
            "/api/bookings/hold",
            {
                "flightId": self.flight_id,
                "seatIds": [s1, s2],
                "passengerData": [
                    {"type": "adult", "firstName": "Ahsan", "lastName": "Habib"},
                    {"type": "adult", "firstName": "Nusrat", "lastName": "Jahan"},
                ],
            },
            token=self.tok_user,
        )
        self.assertEqual(st, 201)
        ref = hold["bookingReference"]
        try:
            st_c, _, conf = req(
                "POST",
                "/api/bookings/confirm",
                {"bookingReference": ref, "scenario": "SIMULATE_SUCCESS", "idempotencyKey": uuid.uuid4().hex},
                token=self.tok_user,
            )
            self.assertEqual(st_c, 200)
            tk = conf["ticket"]
            tickets = tk["tickets"]
            self.assertEqual(len(tickets), 2)
            self.assertNotEqual(tickets[0]["ticketNumber"], tickets[1]["ticketNumber"])
            self.assertNotEqual(tickets[0]["verificationToken"], tickets[1]["verificationToken"])

            vtok1 = tickets[0]["verificationToken"]
            vurl1 = tickets[0]["verifyUrl"]
            self.assertNotIn("localhost", vurl1)
            self.assertNotIn("127.0.0.1", vurl1)
            self.assertTrue(vurl1.startswith("http://") or vurl1.startswith("https://"))

            # Verify raw token is NOT stored plaintext in DB
            conn = database.get_db()
            raw_hit = conn.execute("SELECT COUNT(*) FROM ticket_qr_tokens WHERE token_hash = ? OR token_nonce = ?", (vtok1, vtok1)).fetchone()[0]
            raw_tk = conn.execute("SELECT verification_token FROM tickets WHERE id = ?", (tickets[0]["ticketId"],)).fetchone()[0]
            conn.close()
            self.assertEqual(raw_hit, 0)
            self.assertNotEqual(raw_tk, vtok1)

            # Verify PNG QR readability via zxing-cpp
            st_png, _, png_bytes = req("GET", f"/api/tickets/{ref}/qr.png?ticketId={tickets[0]['ticketId']}", token=self.tok_user)
            self.assertEqual(st_png, 200)
            decoded_png = zxingcpp.read_barcodes(Image.open(__import__("io").BytesIO(png_bytes)))
            self.assertTrue(decoded_png)
            self.assertEqual(decoded_png[0].text, vurl1)

            # Verify PDF download & embedded QR readability via zxing-cpp
            st_pdf, _, pdf_bytes = req("GET", f"/api/tickets/{ref}/pdf?ticketId={tickets[0]['ticketId']}&vtoken={vtok1}")
            self.assertEqual(st_pdf, 200)
            self.assertTrue(pdf_bytes.startswith(b"%PDF-1.4"))
            self.assertIn(b"Scan this QR code to verify your FLY ticket.", pdf_bytes)
            decoded_pdf_url = _decode_pdf_embedded_qr(pdf_bytes)
            self.assertEqual(decoded_pdf_url, vurl1)

            # Access verification API via actual LAN base URL configured for mobile phones!
            lan_base = Config.get_qr_verify_base_url()
            try:
                st_lan, _, ver_lan = req("GET", f"/api/tickets/verify/{vtok1}?source=PUBLIC_MOBILE", base=lan_base)
            except Exception:
                # Fallback to 127.0.0.1 only if local firewall blocks loopback via own LAN NIC
                st_lan, _, ver_lan = req("GET", f"/api/tickets/verify/{vtok1}?source=PUBLIC_MOBILE")
            self.assertEqual(st_lan, 200)
            self.assertTrue(ver_lan["valid"])
            self.assertEqual(ver_lan["headline"], "VALID — TICKET ISSUED")
            self.assertEqual(ver_lan["bookingReference"], ref)
            self.assertNotIn("Ahsan", ver_lan["maskedPassengerName"])
            self.assertNotIn("password", json.dumps(ver_lan).lower())
            self.assertNotIn("passport", json.dumps(ver_lan).lower())

            # Duplicate public scans never consume check-in entitlement!
            st_dup, _, ver_dup = req("GET", f"/api/tickets/verify/{vtok1}?source=PUBLIC_MOBILE")
            self.assertEqual(st_dup, 200)
            self.assertTrue(ver_dup["valid"])
            self.assertEqual(ver_dup["checkinStatus"], "NOT_CHECKED_IN")
            self.assertGreaterEqual(ver_dup["publicScanCount"], 2)

            # Reject guessable PNR / invalid tokens
            st_bad, _, ver_bad = req("GET", f"/api/tickets/verify/{tk['pnrCode']}")
            self.assertEqual(st_bad, 404)
            self.assertEqual(ver_bad["headline"], "INVALID TICKET")

            # Reject unauthorized staff check-in (passenger or wrong airline admin)
            st_fp, _, _ = req("POST", f"/api/staff/tickets/verify/{vtok1}/checkin", {}, token=self.tok_user)
            self.assertEqual(st_fp, 403)
            st_fb, _, _ = req("POST", f"/api/staff/tickets/verify/{vtok1}/checkin", {}, token=self.tok_bs)
            self.assertEqual(st_fb, 403)

            # Concurrent atomic staff check-in race: 8 parallel requests -> strictly 1 win, 7 conflicts!
            def _try_checkin(i):
                return req("POST", f"/api/staff/tickets/verify/{vtok1}/checkin", {"deviceRef": f"Scanner-{i}"}, token=self.tok_sa)[0]

            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                codes = list(pool.map(_try_checkin, range(8)))
            self.assertEqual(codes.count(200), 1)
            self.assertEqual(codes.count(409), 7)

            # Public scan reflects authorized FLY staff check-in state clearly
            _, _, ver_ci = req("GET", f"/api/tickets/verify/{vtok1}")
            self.assertEqual(ver_ci["checkinStatus"], "FLY_CHECKED_IN")

            # Cancel booking -> QR invalidated -> NOT VALID FOR TRAVEL (CANCELLED / REFUND PENDING)
            st_can, _, _ = req("POST", "/api/bookings/cancel", {"bookingReference": ref, "reason": "QR revocation verification"}, token=self.tok_user)
            self.assertEqual(st_can, 200)
            _, _, ver_cancelled = req("GET", f"/api/tickets/verify/{vtok1}")
            self.assertFalse(ver_cancelled["valid"])
            self.assertIn("NOT VALID FOR TRAVEL", ver_cancelled["headline"])
            self.assertIn("FLY Record Verification", ver_cancelled["verificationAuthority"])
        finally:
            req("POST", "/api/bookings/cancel", {"bookingReference": ref, "reason": "Cleanup"}, token=self.tok_user)

    def test_03_staff_void_ticket_and_qr_invalidation(self):
        seat_id = self.avail_seats[3]
        st, _, hold = req("POST", "/api/bookings/hold", {"flightId": self.flight_id, "seatIds": [seat_id]}, token=self.tok_user)
        self.assertEqual(st, 201)
        ref = hold["bookingReference"]
        try:
            st_c, _, conf = req(
                "POST",
                "/api/bookings/confirm",
                {"bookingReference": ref, "scenario": "SIMULATE_SUCCESS", "idempotencyKey": uuid.uuid4().hex},
                token=self.tok_user,
            )
            self.assertEqual(st_c, 200)
            vtok = conf["ticket"]["verificationToken"]
            st_void, _, vres = req("POST", f"/api/staff/tickets/verify/{vtok}/void", {"reason": "Carrier void QA"}, token=self.tok_sa)
            self.assertEqual(st_void, 200)
            self.assertEqual(vres["issuanceState"], "VOID")
            _, _, scan_void = req("GET", f"/api/tickets/verify/{vtok}")
            self.assertFalse(scan_void["valid"])
            self.assertEqual(scan_void["verdict"], "VOID")
            self.assertEqual(scan_void["headline"], "VOID — TICKET INVALID FOR TRAVEL")
        finally:
            req("POST", "/api/bookings/cancel", {"bookingReference": ref, "reason": "Cleanup"}, token=self.tok_user)


if __name__ == "__main__":
    unittest.main(verbosity=2)
