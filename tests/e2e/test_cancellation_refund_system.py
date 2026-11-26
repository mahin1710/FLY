"""
FLY — Complete Cancellation, Authoritative Refund Engine, Supplier Failure/Delay,
Payment Adapters, Dual-Approval Manual Settlement & Ledger Tests (Part O - Refund 1..24)
"""

import json
import os
import sys
import unittest
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import database  # noqa: E402

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
            return resp.status, json.loads(raw.decode("utf-8")) if "json" in ctype else raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode("utf-8"))
        except Exception:
            return e.code, raw


class CancellationAndRefundSystemTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        database.init_db()
        _, r0 = req("POST", "/api/auth/login", {"username": "Mahin0", "password": "Mahin0"})
        _, r1 = req("POST", "/api/auth/login", {"username": "Mahin1", "password": "Mahin1"})
        _, rbg = req("POST", "/api/auth/login", {"username": "Admin_Biman", "password": "Admin_Biman"})
        _, rsa = req("POST", "/api/auth/login", {"username": "SystemAdmin", "password": "SystemAdmin"})
        cls.tok_m0 = r0["token"]
        cls.tok_m1 = r1["token"]
        cls.tok_bg = rbg["token"]
        cls.tok_sa = rsa["token"]

        _, fl_res = req("GET", "/api/flights?from=DAC&to=DXB")
        fl_list = fl_res.get("flights", fl_res if isinstance(fl_res, list) else [])
        bg_intl = next((f for f in fl_list if int(f.get("id_airline") or f.get("airlineId") or 0) == 839), fl_list[0])
        cls.flight_id = bg_intl["id"]
        _, sm = req("GET", f"/api/flights/{cls.flight_id}/seats")
        cls.avail_seats = [s["id"] for s in sm["seats"] if s["status"] == "AVAILABLE"]
        assert len(cls.avail_seats) >= 8

    def _create_paid_booking(self, seat_ids, passengers=None, method="SIMULATED_CARD", issuance="ISSUED_IMMEDIATELY", fare_family=None):
        payload = {"flightId": self.flight_id, "seatIds": seat_ids}
        if passengers:
            payload["passengerData"] = passengers
        st, hold = req("POST", "/api/bookings/hold", payload, token=self.tok_m0)
        self.assertEqual(st, 201)
        ref = hold["bookingReference"]
        if fare_family:
            conn = database.get_db()
            conn.execute("UPDATE bookings SET fare_family = ? WHERE booking_reference = ?", (fare_family, ref))
            conn.commit()
            conn.close()
        st_c, conf = req(
            "POST",
            "/api/bookings/confirm",
            {
                "bookingReference": ref,
                "paymentMethod": method,
                "scenario": "SIMULATE_SUCCESS",
                "issuanceScenario": issuance,
                "idempotencyKey": uuid.uuid4().hex,
            },
            token=self.tok_m0,
        )
        self.assertEqual(st_c, 200)
        if fare_family:
            conn = database.get_db()
            conn.execute("UPDATE bookings SET fare_family = ? WHERE booking_reference = ?", (fare_family, ref))
            conn.execute("UPDATE tickets SET fare_family = ? WHERE booking_reference = ?", (fare_family, ref))
            conn.commit()
            conn.close()
        return ref, conf["ticket"]

    def test_01_quote_expiry_reject_explicit_confirm_and_supplier_failure(self):
        ref, tk = self._create_paid_booking([self.avail_seats[0]])
        try:
            # 1. Generate quote (fee policy pinned at creation)
            st_q, q = req("POST", "/api/cancellations/quote", {"bookingReference": ref, "cancellationType": "VOLUNTARY"}, token=self.tok_m0)
            self.assertEqual(st_q, 200)
            self.assertGreater(q["finalRefundBDT"], 0)

            # 2. Must fail without explicit customerConfirmed=True
            st_nc, err_nc = req("POST", "/api/cancellations/confirm", {"bookingReference": ref, "quoteId": q["quoteId"], "customerConfirmed": False}, token=self.tok_m0)
            self.assertEqual(st_nc, 400)
            self.assertEqual(err_nc["code"], "CONFIRMATION_REQUIRED")

            # 3. Reject quote keeps ticket valid
            st_rej, _ = req("POST", f"/api/refund-quotes/{q['quoteRef']}/reject", {}, token=self.tok_m0)
            self.assertEqual(st_rej, 200)
            st_v, vres = req("GET", f"/api/tickets/verify/{tk['verificationToken']}")
            self.assertEqual(st_v, 200)
            self.assertTrue(vres["valid"])

            # 4. Expired quote must be rejected cleanly with QUOTE_EXPIRED
            st_q2, q2 = req("POST", "/api/cancellations/quote", {"bookingReference": ref, "cancellationType": "VOLUNTARY"}, token=self.tok_m0)
            self.assertEqual(st_q2, 200)
            past_str = (datetime.utcnow() - timedelta(minutes=20)).strftime("%Y-%m-%d %H:%M:%S")
            conn = database.get_db()
            conn.execute("UPDATE refund_quotes SET expires_at = ? WHERE id = ?", (past_str, q2["quoteId"]))
            conn.commit()
            conn.close()
            st_exp, exp_err = req("POST", "/api/cancellations/confirm", {"bookingReference": ref, "quoteId": q2["quoteId"], "customerConfirmed": True}, token=self.tok_m0)
            self.assertEqual(st_exp, 409)
            self.assertEqual(exp_err["code"], "QUOTE_EXPIRED")

            # 5. Revalidate quote + Supplier failure leaves original ticket intact
            _, q3 = req("POST", "/api/cancellations/quote", {"bookingReference": ref, "cancellationType": "VOLUNTARY"}, token=self.tok_m0)
            st_sf, sf_err = req(
                "POST",
                "/api/cancellations/confirm",
                {"bookingReference": ref, "quoteId": q3["quoteId"], "customerConfirmed": True, "supplierScenario": "SUPPLIER_FAIL"},
                token=self.tok_m0,
            )
            self.assertEqual(st_sf, 502)
            self.assertEqual(sf_err["code"], "SUPPLIER_CANCELLATION_FAILED")
            _, v_still_ok = req("GET", f"/api/tickets/verify/{tk['verificationToken']}")
            self.assertTrue(v_still_ok["valid"])
        finally:
            req("POST", "/api/bookings/cancel", {"bookingReference": ref, "reason": "Cleanup"}, token=self.tok_m0)

    def test_02_non_refundable_saver_airline_cancel_no_show_and_partial_cancel(self):
        # A. Multi-passenger partial cancellation revokes ONLY 1st passenger QR, 2nd stays valid
        ref, tk = self._create_paid_booking(
            [self.avail_seats[1], self.avail_seats[2]],
            passengers=[
                {"type": "adult", "firstName": "Rafiq", "lastName": "Islam"},
                {"type": "adult", "firstName": "Taslima", "lastName": "Akter"},
            ],
        )
        t1, t2 = tk["tickets"][0], tk["tickets"][1]
        try:
            st_pq, pq = req(
                "POST",
                "/api/cancellations/quote",
                {"bookingReference": ref, "cancellationType": "PARTIAL", "selectedTicketIds": [t1["ticketId"]]},
                token=self.tok_m0,
            )
            self.assertEqual(st_pq, 200)
            self.assertAlmostEqual(pq["originalPaidBDT"], tk["totalAmount"] / 2, delta=5.0)

            st_pc, pc = req(
                "POST",
                "/api/cancellations/confirm",
                {"bookingReference": ref, "quoteId": pq["quoteId"], "customerConfirmed": True, "gatewayScenario": "GATEWAY_PENDING"},
                token=self.tok_m0,
            )
            self.assertEqual(st_pc, 200)
            # Independent refund status is NOT prematurely REFUNDED yet!
            self.assertIn(pc["refundStatus"], ("GATEWAY_PROCESSING", "APPROVAL_PENDING"))

            # Ticket 1 QR invalidated (shows CANCELLED or CANCELLED REFUND PENDING), Ticket 2 QR still VALID!
            _, v1 = req("GET", f"/api/tickets/verify/{t1['verificationToken']}")
            _, v2 = req("GET", f"/api/tickets/verify/{t2['verificationToken']}")
            self.assertFalse(v1["valid"])
            self.assertIn("NOT VALID FOR TRAVEL", v1["headline"])
            self.assertEqual(v2["headline"], "VALID — TICKET ISSUED")

            # Duplicate refund submission blocked / idempotent
            st_dup, dup_res = req(
                "POST",
                "/api/cancellations/confirm",
                {"bookingReference": ref, "quoteId": pq["quoteId"], "customerConfirmed": True},
                token=self.tok_m0,
            )
            self.assertTrue(dup_res.get("idempotentReplay") or st_dup == 409)

            # Reconcile gateway settlement -> becomes REFUNDED
            rf_ref = pc["refundRef"]
            st_rec, rec_res = req("POST", f"/api/admin/refunds/{rf_ref}/reconcile", {"outcome": "SETTLED"}, token=self.tok_bg)
            self.assertEqual(st_rec, 200)
            self.assertEqual(rec_res["status"], "REFUNDED")

            # Customer 9-stage refund tracking timeline & My Refunds endpoint
            st_tr, tr = req("GET", f"/api/refunds/track/{rf_ref}", token=self.tok_m0)
            self.assertEqual(st_tr, 200)
            self.assertEqual(tr["status"], "REFUNDED")
            self.assertEqual(len(tr["timelineStages"]), 9)
            self.assertTrue(all(st["completed"] for st in tr["timelineStages"]))
            st_myrf, my_rf = req("GET", "/api/refunds/my", token=self.tok_m0)
            self.assertEqual(st_myrf, 200)
            self.assertTrue(any(r["refund_ref"] == rf_ref for r in my_rf["refunds"]))
        finally:
            req("POST", "/api/bookings/cancel", {"bookingReference": ref, "reason": "Cleanup"}, token=self.tok_m0)

        # B. Non-refundable SAVER vs AIRLINE_INITIATED vs NO_SHOW
        ref_sv, _ = self._create_paid_booking([self.avail_seats[3]], fare_family="SAVER")
        try:
            _, q_sv = req("POST", "/api/cancellations/quote", {"bookingReference": ref_sv, "cancellationType": "VOLUNTARY"}, token=self.tok_m0)
            _, q_ai = req("POST", "/api/cancellations/quote", {"bookingReference": ref_sv, "cancellationType": "AIRLINE_INITIATED"}, token=self.tok_m0)
            _, q_ns = req("POST", "/api/cancellations/quote", {"bookingReference": ref_sv, "cancellationType": "NO_SHOW", "simulateNoShow": True}, token=self.tok_m0)
            self.assertLess(q_sv["finalRefundBDT"], q_ai["finalRefundBDT"])
            self.assertEqual(q_ai["airlinePenaltyBDT"], 0)
            self.assertEqual(q_ai["flyServiceFeeBDT"], 0)
            self.assertTrue(q_ns["noShowDetected"])
            self.assertTrue(q_ns["manualReviewRecommended"])
        finally:
            req("POST", "/api/bookings/cancel", {"bookingReference": ref_sv, "reason": "Cleanup"}, token=self.tok_m0)

    def test_03_manual_bank_dual_approval_evidence_reconciliation_and_reports(self):
        ref, tk = self._create_paid_booking([self.avail_seats[4]], method="BANK_TRANSFER")
        try:
            _, q = req("POST", "/api/cancellations/quote", {"bookingReference": ref, "cancellationType": "AIRLINE_INITIATED"}, token=self.tok_m0)
            st_c, res_c = req(
                "POST",
                "/api/cancellations/confirm",
                {"bookingReference": ref, "quoteId": q["quoteId"], "customerConfirmed": True, "bankAccount": "123456789012"},
                token=self.tok_m0,
            )
            self.assertEqual(st_c, 200)
            self.assertEqual(res_c["refundStatus"], "APPROVAL_PENDING")
            rf_ref = res_c["refundRef"]

            # 1st approval by Admin_Biman
            st_a1, a1 = req("POST", f"/api/admin/refunds/{rf_ref}/manual", {"action": "APPROVE", "reason": "Confirmed bank slip & payer match"}, token=self.tok_bg)
            self.assertEqual(st_a1, 200)
            self.assertTrue(a1["dualApprovalPending"])

            # Same admin cannot perform dual sign-off
            st_same, same_err = req("POST", f"/api/admin/refunds/{rf_ref}/manual", {"action": "DUAL_APPROVE"}, token=self.tok_bg)
            self.assertEqual(st_same, 409)
            self.assertEqual(same_err["code"], "DUAL_APPROVAL_SAME_USER")

            # SystemAdmin gives 2nd dual approval
            st_a2, _ = req("POST", f"/api/admin/refunds/{rf_ref}/manual", {"action": "DUAL_APPROVE", "reason": "Finance dual control check passed"}, token=self.tok_sa)
            self.assertEqual(st_a2, 200)

            # Settle without transferReference / evidenceRef MUST BE BLOCKED
            st_noev, noev = req("POST", f"/api/admin/refunds/{rf_ref}/manual", {"action": "SETTLE", "transferReference": "", "evidenceRef": ""}, token=self.tok_sa)
            self.assertEqual(st_noev, 400)
            self.assertEqual(noev["code"], "EVIDENCE_REQUIRED")

            # Settle WITH transferReference + evidenceRef succeeds and transitions ticket to REFUNDED
            st_ok, ok_res = req(
                "POST",
                f"/api/admin/refunds/{rf_ref}/manual",
                {"action": "SETTLE", "transferReference": "NPSB-20261126-991", "evidenceRef": "SLIP-88412", "reason": "Disbursed to verified payer bank"},
                token=self.tok_sa,
            )
            self.assertEqual(st_ok, 200)
            self.assertEqual(ok_res["status"], "REFUNDED")

            _, ver_rf = req("GET", f"/api/tickets/verify/{tk['verificationToken']}")
            self.assertEqual(ver_rf["headline"], "REFUNDED — TICKET NOT VALID FOR TRAVEL")

            # Admin Dashboard, List Search & Financial Reports populate accurately
            st_d, dash = req("GET", "/api/admin/refunds/dashboard", token=self.tok_sa)
            st_l, lst = req("GET", f"/api/admin/refunds/list?q={rf_ref}", token=self.tok_sa)
            st_dt, det = req("GET", f"/api/admin/refunds/{rf_ref}/details", token=self.tok_sa)
            st_rp, rpt = req("GET", "/api/admin/refunds/reports", token=self.tok_sa)
            self.assertEqual(st_d, 200)
            self.assertGreaterEqual(dash["completedRefunds"], 1)
            self.assertEqual(st_l, 200)
            self.assertEqual(lst["refunds"][0]["refund_ref"], rf_ref)
            self.assertEqual(st_dt, 200)
            self.assertTrue(len(det["ledgerEntries"]) >= 2)
            self.assertEqual(st_rp, 200)
            self.assertGreater(rpt["totalDisbursedBDT"], 0)
        finally:
            req("POST", "/api/bookings/cancel", {"bookingReference": ref, "reason": "Cleanup"}, token=self.tok_m0)

    def test_04_bkash_nagad_gateway_failure_wrong_amount_and_fee_policy_isolation(self):
        _, dom_res = req("GET", "/api/flights?from=DAC&to=CXB")
        dom_list = dom_res.get("flights", dom_res if isinstance(dom_res, list) else [])
        dom_fl = next((f for f in dom_list if int(f.get("id_airline") or f.get("airlineId") or 0) == 839), dom_list[0])
        dom_fid = dom_fl["id"]
        _, sm = req("GET", f"/api/flights/{dom_fid}/seats")
        seats = [s["id"] for s in sm["seats"] if s["status"] == "AVAILABLE"]
        self.assertGreaterEqual(len(seats), 2)

        # Hold under current active policy (350 BDT cancel fee)
        _, h_bk = req("POST", "/api/bookings/hold", {"flightId": dom_fid, "seatIds": [seats[0]]}, token=self.tok_m0)
        ref_bk = h_bk["bookingReference"]
        req("POST", "/api/bookings/confirm", {"bookingReference": ref_bk, "paymentMethod": "BKASH", "scenario": "SIMULATE_SUCCESS", "idempotencyKey": uuid.uuid4().hex}, token=self.tok_m0)
        expected_ver = h_bk.get("fareBreakdown", {}).get("feePolicy", {}).get("version") or "FLY-POL-V1"

        # Publish temporary higher fee policy; historical booking must keep its purchase-time version & fee
        req("POST", "/api/admin/fee-policies", {"version": f"FLY-POL-TMP-{uuid.uuid4().hex[:4].upper()}", "name": "Temp Higher Cancel Fee", "bookingServiceFeeBDT": 0, "cancellationServiceFeeBDT": 999}, token=self.tok_sa)
        try:
            _, q_bk = req("POST", "/api/cancellations/quote", {"bookingReference": ref_bk, "cancellationType": "VOLUNTARY"}, token=self.tok_m0)
            self.assertEqual(q_bk["feePolicyVersion"], expected_ver)
            self.assertEqual(q_bk["flyServiceFeeBDT"], 350.0)

            st_cbk, cbk = req("POST", "/api/cancellations/confirm", {"bookingReference": ref_bk, "quoteId": q_bk["quoteId"], "customerConfirmed": True, "gatewayScenario": "GATEWAY_PENDING"}, token=self.tok_m0)
            self.assertEqual(st_cbk, 200)
            self.assertEqual(cbk["refundStatus"], "GATEWAY_PROCESSING")

            # Reconcile wrong amount mismatch -> RECONCILIATION_REQUIRED
            st_wr, wr = req("POST", f"/api/admin/refunds/{cbk['refundRef']}/reconcile", {"outcome": "SETTLED", "settledAmountBDT": 999999.0}, token=self.tok_sa)
            self.assertEqual(st_wr, 200)
            self.assertEqual(wr["status"], "RECONCILIATION_REQUIRED")
        finally:
            conn = database.get_db()
            conn.execute("UPDATE fee_policies SET is_active = CASE WHEN version = 'FLY-POL-V1' THEN 1 ELSE 0 END")
            conn.commit()
            conn.close()
            req("POST", "/api/bookings/cancel", {"bookingReference": ref_bk, "reason": "Cleanup"}, token=self.tok_m0)

        # Nagad Gateway Failure -> refund tracks as FAILED cleanly
        _, h_ng = req("POST", "/api/bookings/hold", {"flightId": dom_fid, "seatIds": [seats[1]]}, token=self.tok_m0)
        ref_ng = h_ng["bookingReference"]
        try:
            req("POST", "/api/bookings/confirm", {"bookingReference": ref_ng, "paymentMethod": "NAGAD", "scenario": "SIMULATE_SUCCESS", "idempotencyKey": uuid.uuid4().hex}, token=self.tok_m0)
            _, q_ng = req("POST", "/api/cancellations/quote", {"bookingReference": ref_ng, "cancellationType": "AIRLINE_INITIATED"}, token=self.tok_m0)
            st_cng, cng = req("POST", "/api/cancellations/confirm", {"bookingReference": ref_ng, "quoteId": q_ng["quoteId"], "customerConfirmed": True, "gatewayScenario": "GATEWAY_FAIL"}, token=self.tok_m0)
            self.assertEqual(st_cng, 200)
            self.assertEqual(cng["refundStatus"], "FAILED")
        finally:
            req("POST", "/api/bookings/cancel", {"bookingReference": ref_ng, "reason": "Cleanup"}, token=self.tok_m0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
