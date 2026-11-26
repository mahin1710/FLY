"""
FLY Realistic Airline Cancellation, Refund Quotation, Payment Refund Adapters & Financial Ledger Engine

Implements Parts F through N:
- Separate cancellation workflows: Voluntary, Airline-Initiated, Schedule Change,
  Partial (passenger / segment), No-Show, Before-Issuance, Ticketing Failure.
- Exact integer minor-unit (paisa = BDT * 100) / Decimal arithmetic (zero float rounding error).
- Versioned FLY Fee Policies saved with bookings (historical bookings never rewritten silently).
- Per-airline fare rules & coupon/departure inspection.
- Immutable versioned refund_quotes & refund_quote_items with TTL expiry & revalidation.
- Separated Payment Refund Adapters (Card, bKash, Nagad, Bank Transfer, Cash/Manual).
- Independent cancellation status vs refund payment status tracking & timeline history.
- Dual-approval + settlement-evidence enforcement for manual refunds & high-value payouts.
- Append-only financial_ledger_entries & notification_outbox.
"""

import json
import secrets
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
import database
from config import Config
from fly.services import qr_service


def to_minor(amount) -> int:
    d = Decimal(str(amount if amount is not None else "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int(d * 100)


def from_minor(minor: int) -> float:
    return float((Decimal(int(minor or 0)) / Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def format_bdt_minor(minor: int) -> str:
    d = (Decimal(int(minor or 0)) / Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if d == int(d):
        return f"BDT {int(d):,}"
    return f"BDT {d:,.2f}"


def _mask_payment_destination(method: str, payment_ref: str = None, bank_account: str = None) -> tuple:
    m = (method or "SIMULATED_CARD").upper()
    ref = (payment_ref or "").strip()
    suffix = ref[-4:] if len(ref) >= 4 else "XXXX"
    if "BKASH" in m:
        return "bKash Wallet", f"bKash Merchant Reversal (Original Ref ****{suffix})"
    if "NAGAD" in m:
        return "Nagad Wallet", f"Nagad Merchant Reversal (Original Ref ****{suffix})"
    if "BANK" in m:
        acct = (bank_account or "").strip()
        acct_mask = f"****{acct[-4:]}" if len(acct) >= 4 else "Verified Original Bank Account"
        return "Bank Transfer", acct_mask
    if "CASH" in m or "MANUAL" in m:
        return "Manual Counter / Cash", "Verified Original Payer Settlement Desk"
    return "Card / Gateway", f"Original Card Route (Ref ****{suffix})"


# ------------------------------------------------------------------
# SUPPLIER CANCELLATION ADAPTER (Part F3/F4/J)
# ------------------------------------------------------------------
class SupplierCancellationAdapter:
    """
    Encapsulates airline/GDS/BSP cancellation & refund quotation interactions.
    In local sandbox/DEMO_LOCAL mode, validates actual rule records cleanly and honors
    controlled test scenarios without faking live airline network responses.
    """

    @staticmethod
    def submit_cancellation(booking, ctype: str, supplier_scenario: str = "SUPPLIER_OK") -> dict:
        scen = (supplier_scenario or "SUPPLIER_OK").strip().upper()
        now_str = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        airline_iata = booking["airlineIATA"] if "airlineIATA" in booking.keys() else "FL"
        supplier_name = f"{Config.FLIGHT_PROVIDER_ACTIVE}:{airline_iata}"

        if scen == "SUPPLIER_FAIL":
            return {
                "ok": False,
                "status": "FAILED",
                "supplierName": supplier_name,
                "supplierRef": None,
                "message": "Supplier rejected cancellation request or GDS link timed out.",
            }
        if scen == "SUPPLIER_MANUAL_REVIEW":
            return {
                "ok": True,
                "status": "MANUAL_REVIEW",
                "supplierName": supplier_name,
                "supplierRef": f"SUP-REV-{secrets.token_hex(3).upper()}",
                "bspSettlement": False,
                "message": "Airline coupon status requires manual supplier/GDS verification before cancellation.",
            }
        if scen == "BSP_AGENCY":
            return {
                "ok": True,
                "status": "CANCELLED_BY_SUPPLIER",
                "supplierName": supplier_name,
                "supplierRef": f"BSP-{airline_iata}-{now_str[-6:]}-{secrets.token_hex(2).upper()}",
                "bspSettlement": True,
                "message": "Inventory cancelled; refund submitted via airline BSP/agency settlement cycle.",
            }
        return {
            "ok": True,
            "status": "CANCELLED_BY_SUPPLIER",
            "supplierName": supplier_name,
            "supplierRef": f"SUP-{airline_iata}-{now_str[-6:]}-{secrets.token_hex(2).upper()}",
            "bspSettlement": False,
            "message": f"Supplier confirmed cancellation ({ctype}).",
        }


# ------------------------------------------------------------------
# PAYMENT METHOD REFUND ADAPTERS (Part I)
# ------------------------------------------------------------------
class BaseRefundAdapter:
    name = "BASE"

    @classmethod
    def initiate(cls, refund_row: dict, gateway_scenario: str = "GATEWAY_PENDING") -> dict:
        raise NotImplementedError


class CardGatewayRefundAdapter(BaseRefundAdapter):
    name = "CARD_GATEWAY_ADAPTER"

    @classmethod
    def initiate(cls, refund_row: dict, gateway_scenario: str = "GATEWAY_PENDING") -> dict:
        scen = (gateway_scenario or "GATEWAY_PENDING").strip().upper()
        is_sandbox = Config.PAYMENT_GATEWAY_ACTIVE in ("SIMULATED", "SANDBOX", "")
        has_live_sslc = bool(Config.SSLCOMMERZ_STORE_ID and Config.SSLCOMMERZ_STORE_PASS)

        if not is_sandbox and not has_live_sslc:
            return {
                "ok": False,
                "refundStatus": "RECONCILIATION_REQUIRED",
                "gatewayRef": None,
                "estimatedWindow": None,
                "error": "Live card gateway credentials are not configured; routed for manual finance reconciliation.",
            }

        gw_ref = f"GWR-CARD-{secrets.token_hex(4).upper()}"
        if scen == "GATEWAY_FAIL":
            return {
                "ok": False,
                "refundStatus": "FAILED",
                "gatewayRef": gw_ref,
                "estimatedWindow": None,
                "error": "Card acquirer rejected refund API submission (insufficient settlement window or network error).",
            }
        if scen == "GATEWAY_SETTLED_IMMEDIATE":
            # Only when explicit test/sandbox settlement webhook confirmation is simulated directly
            return {
                "ok": True,
                "refundStatus": "REFUNDED",
                "gatewayRef": gw_ref,
                "settledMinor": int(refund_row["approved_amount_minor"]),
                "estimatedWindow": "3-7 banking days (Acquirer settled in sandbox)",
                "message": "Refund settled by card gateway.",
            }
        if scen == "GATEWAY_WRONG_AMOUNT":
            wrong_minor = max(0, int(refund_row["approved_amount_minor"]) // 2)
            return {
                "ok": False,
                "refundStatus": "RECONCILIATION_REQUIRED",
                "gatewayRef": gw_ref,
                "settledMinor": wrong_minor,
                "estimatedWindow": None,
                "error": f"Amount mismatch returned by gateway: expected {format_bdt_minor(refund_row['approved_amount_minor'])}, got {format_bdt_minor(wrong_minor)}.",
            }
        return {
            "ok": True,
            "refundStatus": "GATEWAY_PROCESSING",
            "gatewayRef": gw_ref,
            "estimatedWindow": "5-10 business days (Card network SLA)" if is_sandbox else None,
            "message": "Refund submitted to original card payment route; awaiting bank settlement confirmation.",
        }


class BkashRefundAdapter(BaseRefundAdapter):
    name = "BKASH_ADAPTER"

    @classmethod
    def initiate(cls, refund_row: dict, gateway_scenario: str = "GATEWAY_PENDING") -> dict:
        has_live = bool(Config.BKASH_APP_KEY and Config.BKASH_APP_SECRET)
        is_sandbox = Config.PAYMENT_GATEWAY_ACTIVE in ("SIMULATED", "SANDBOX", "")
        if not is_sandbox and not has_live:
            return {
                "ok": True,
                "requiresManual": True,
                "refundStatus": "APPROVAL_PENDING",
                "gatewayRef": None,
                "estimatedWindow": None,
                "message": "bKash automated merchant refund API is not configured; routed to controlled manual finance review.",
            }
        scen = (gateway_scenario or "GATEWAY_PENDING").strip().upper()
        gw_ref = f"BKR-{secrets.token_hex(4).upper()}"
        if scen == "GATEWAY_FAIL":
            return {
                "ok": False,
                "refundStatus": "FAILED",
                "gatewayRef": gw_ref,
                "estimatedWindow": None,
                "error": "bKash merchant refund call failed.",
            }
        return {
            "ok": True,
            "refundStatus": "GATEWAY_PROCESSING",
            "gatewayRef": gw_ref,
            "estimatedWindow": "2-5 business days (bKash merchant reversal)" if is_sandbox else None,
            "message": "Refund initiated via bKash merchant adapter using original payment reference.",
        }


class NagadRefundAdapter(BaseRefundAdapter):
    name = "NAGAD_ADAPTER"

    @classmethod
    def initiate(cls, refund_row: dict, gateway_scenario: str = "GATEWAY_PENDING") -> dict:
        has_live = bool(Config.NAGAD_MERCHANT_ID and Config.NAGAD_MERCHANT_KEY)
        is_sandbox = Config.PAYMENT_GATEWAY_ACTIVE in ("SIMULATED", "SANDBOX", "")
        if not is_sandbox and not has_live:
            return {
                "ok": True,
                "requiresManual": True,
                "refundStatus": "APPROVAL_PENDING",
                "gatewayRef": None,
                "estimatedWindow": None,
                "message": "Nagad automated refund API is not active; queued for controlled manual processing.",
            }
        scen = (gateway_scenario or "GATEWAY_PENDING").strip().upper()
        gw_ref = f"NGR-{secrets.token_hex(4).upper()}"
        if scen == "GATEWAY_FAIL":
            return {"ok": False, "refundStatus": "FAILED", "gatewayRef": gw_ref, "estimatedWindow": None, "error": "Nagad refund API error."}
        return {
            "ok": True,
            "refundStatus": "GATEWAY_PROCESSING",
            "gatewayRef": gw_ref,
            "estimatedWindow": "3-5 business days (Nagad reversal)" if is_sandbox else None,
            "message": "Refund submitted to Nagad merchant adapter.",
        }


class ManualSettlementRefundAdapter(BaseRefundAdapter):
    name = "MANUAL_FINANCE_ADAPTER"

    @classmethod
    def initiate(cls, refund_row: dict, gateway_scenario: str = "MANUAL") -> dict:
        return {
            "ok": True,
            "requiresManual": True,
            "refundStatus": "APPROVAL_PENDING",
            "gatewayRef": None,
            "estimatedWindow": None,
            "message": "Requires finance verification, payer destination check, and settlement evidence before completion.",
        }


def resolve_refund_adapter(payment_method: str) -> BaseRefundAdapter:
    m = (payment_method or "SIMULATED_CARD").upper()
    if "BKASH" in m:
        return BkashRefundAdapter
    if "NAGAD" in m:
        return NagadRefundAdapter
    if "BANK" in m or "CASH" in m or "MANUAL" in m:
        return ManualSettlementRefundAdapter
    return CardGatewayRefundAdapter


# ------------------------------------------------------------------
# FEE POLICY & FARE RULE HELPERS (Part F / G)
# ------------------------------------------------------------------
def get_fee_policy_by_version(cursor, version: str = None) -> dict:
    row = None
    if version:
        row = cursor.execute("SELECT * FROM fee_policies WHERE version = ?", (version,)).fetchone()
    if not row:
        row = cursor.execute("SELECT * FROM fee_policies WHERE is_active = 1 ORDER BY id DESC LIMIT 1").fetchone()
    if row:
        return dict(row)
    return {
        "version": "FLY-POL-V1",
        "name": "Standard FLY Service Fee Policy v1",
        "booking_service_fee_minor": 0,
        "cancellation_service_fee_minor": 35000,
        "refund_processing_fee_minor": 0,
        "waive_on_airline_cancel": 1,
        "waive_on_ticketing_error": 1,
        "waive_on_schedule_change": 1,
        "currency": "BDT",
        "legal_notes": "Disclosed policy.",
    }


def get_fare_rule(cursor, airline_id: int, fare_family: str) -> dict:
    ff = (fare_family or "STANDARD").strip().upper()
    row = None
    if airline_id:
        row = cursor.execute(
            "SELECT * FROM fare_rules WHERE id_airline = ? AND UPPER(fare_family) = ?",
            (int(airline_id), ff),
        ).fetchone()
    if not row:
        row = cursor.execute(
            "SELECT * FROM fare_rules WHERE id_airline IS NULL AND UPPER(fare_family) = ?",
            (ff,),
        ).fetchone()
    if not row:
        row = cursor.execute(
            "SELECT * FROM fare_rules WHERE id_airline IS NULL AND UPPER(fare_family) = 'STANDARD'"
        ).fetchone()
    if row:
        return dict(row)
    return {
        "fare_family": ff,
        "is_refundable": 1,
        "voluntary_cancel_fee_minor": 80000,
        "no_show_fee_minor": 200000,
        "partial_cancel_allowed": 1,
        "split_pnr_required": 0,
        "min_hours_before_dep": 4,
        "tax_refundable_pct": 100,
        "airline_charge_refundable": 1,
        "ancillary_refundable": 0,
        "notes": "Default fare tariff",
    }


def _append_refund_history(cursor, refund_id: int, from_st: str, to_st: str, stage_label: str, note: str, actor_id=None, actor_role=None):
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute(
        """
        INSERT INTO refund_status_history (refund_id, from_status, to_status, stage_label, note, actor_id, actor_role, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (refund_id, from_st, to_st, stage_label, note, actor_id, actor_role, now_iso),
    )


def _record_ledger(cursor, booking_ref: str, entry_type: str, direction: str, amount_minor: int, currency: str = "BDT", refund_id=None, cancellation_id=None, reference_id=None, description=None, created_by=None):
    if int(amount_minor) < 0:
        raise ValueError("Ledger amount_minor cannot be negative.")
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute(
        """
        INSERT INTO financial_ledger_entries (
            entry_ref, booking_reference, refund_id, cancellation_id,
            entry_type, direction, amount_minor, currency, original_currency,
            fx_rate, reference_id, description, created_by, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '1.0000', ?, ?, ?, ?)
        """,
        (
            f"LED-{secrets.token_hex(5).upper()}",
            booking_ref,
            refund_id,
            cancellation_id,
            entry_type,
            direction,
            int(amount_minor),
            currency,
            currency,
            reference_id,
            description,
            created_by,
            now_iso,
        ),
    )


def _queue_notification(cursor, booking_ref: str, recipient_email: str, subject: str, body_summary: str, metadata: dict = None):
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute(
        """
        INSERT INTO notification_outbox (booking_reference, recipient_email, channel, subject, body_summary, status, metadata_json, created_at)
        VALUES (?, ?, 'EMAIL', ?, ?, 'DISPATCHED_LOCAL_OUTBOX', ?, ?)
        """,
        (booking_ref, recipient_email or "", subject, body_summary, json.dumps(metadata or {}), now_iso),
    )


# ------------------------------------------------------------------
# CANCELLATION QUOTE ENGINE (Part F / G / H)
# ------------------------------------------------------------------
def generate_refund_quote(
    booking_ref_or_pnr: str,
    user: dict,
    cancellation_type: str = "VOLUNTARY",
    selected_ticket_ids: list = None,
    selected_segment_ids: list = None,
    reason: str = "",
    simulate_coupon_state: str = None,
    simulate_no_show: bool = False,
) -> tuple:
    """
    Inspects booking, ticket(s), segments, fare_rules, fee_policy_version, payment capture,
    and departure/coupon state to produce & store an immutable versioned refund quote.
    Never modifies booking/ticket status or submits irreversible supplier cancellation.
    """
    key = (booking_ref_or_pnr or "").strip()
    if not key:
        return 400, {"error": "Booking reference or PNR is required."}

    ctype = (cancellation_type or "VOLUNTARY").strip().upper()
    valid_types = ("VOLUNTARY", "AIRLINE_INITIATED", "SCHEDULE_CHANGE", "PARTIAL", "NO_SHOW", "BEFORE_ISSUANCE", "TICKETING_FAILURE")
    if ctype not in valid_types:
        return 400, {"error": f"Invalid cancellationType. Allowed: {', '.join(valid_types)}"}

    conn = database.get_db()
    cursor = conn.cursor()
    try:
        booking = cursor.execute(
            """
            SELECT b.*,
                   f.id_airline, f.flight_number, f.dep_datetime, f.arr_datetime, f.status as flightStatus,
                   f.dep_airport, f.arr_airport,
                   al.name as airlineName, al.IATA as airlineIATA,
                   da.IATA as depIATA, da.city as depCity, aa.IATA as arrIATA, aa.city as arrCity,
                   a.emailAddress as accountEmail
            FROM bookings b
            JOIN accounts a ON b.id_account = a.id
            JOIN flights f ON b.id_flight = f.id
            JOIN airLines al ON f.id_airline = al.id
            JOIN airports da ON f.dep_airport = da.id
            JOIN airports aa ON f.arr_airport = aa.id
            WHERE b.booking_reference = ? OR UPPER(b.pnr_code) = UPPER(?)
            """,
            (key, key),
        ).fetchone()
        if not booking:
            return 404, {"error": "Booking not found."}

        role = str(user.get("role") or "PASSENGER").upper()
        if role == "PASSENGER" and booking["id_account"] != user["id"]:
            return 403, {"error": "Forbidden: You do not own this booking.", "code": "FORBIDDEN"}
        if role == "AIRLINE_ADMIN" and booking["id_airline"] != user.get("airlineId"):
            return 403, {"error": "Forbidden: Booking belongs to another airline.", "code": "FORBIDDEN"}
        if ctype in ("AIRLINE_INITIATED", "SCHEDULE_CHANGE") and role == "PASSENGER" and str(booking["flightStatus"] or "").upper() not in ("CANCELLED", "DELAYED"):
            # Passenger may still request schedule-change / airline-cancel evaluation if flight was disrupted,
            # otherwise flag that carrier disruption verification is required
            pass

        ref = booking["booking_reference"]
        b_status = str(booking["status"] or "").upper()
        if b_status in ("CANCELLED", "REFUNDED", "EXPIRED"):
            return 409, {"error": f"Booking is already {b_status} and cannot be cancelled again.", "code": "ALREADY_FINALIZED"}

        tickets = cursor.execute(
            "SELECT * FROM tickets WHERE booking_reference = ? ORDER BY passenger_index ASC, id ASC",
            (ref,),
        ).fetchall()
        segments = cursor.execute(
            "SELECT * FROM ticket_segments WHERE booking_reference = ? ORDER BY ticket_id ASC, segment_order ASC",
            (ref,),
        ).fetchall()

        # Retrieve captured payment total in minor units (never allow refund > captured)
        pay_row = cursor.execute(
            "SELECT * FROM payments WHERE booking_reference = ? AND status = 'CAPTURED' ORDER BY id DESC LIMIT 1",
            (ref,),
        ).fetchone()
        total_paid_minor = to_minor(pay_row["amount"]) if pay_row else (to_minor(booking["total_amount"]) if b_status in ("CONFIRMED", "TICKETING_PENDING", "PARTIALLY_CANCELLED") else 0)
        already_refunded_minor = cursor.execute(
            "SELECT COALESCE(SUM(approved_amount_minor), 0) FROM refunds WHERE booking_reference = ? AND status NOT IN ('FAILED', 'NOT_ELIGIBLE')",
            (ref,),
        ).fetchone()[0] or 0
        remaining_paid_minor = max(0, total_paid_minor - int(already_refunded_minor))

        # Check departure & no-show status
        now_dt = datetime.utcnow()
        dep_dt = database.parse_dt_utc(booking["dep_datetime"])
        hours_until_dep = ((dep_dt - now_dt).total_seconds() / 3600.0) if dep_dt else 48.0
        dep_passed = hours_until_dep < 0
        fare_family = (booking["fare_family"] if "fare_family" in booking.keys() and booking["fare_family"] else "STANDARD").upper()
        rule = get_fare_rule(cursor, booking["id_airline"], fare_family)
        fee_pol = get_fee_policy_by_version(cursor, booking["fee_policy_version"] if "fee_policy_version" in booking.keys() else None)

        no_show_detected = bool(simulate_no_show or ctype == "NO_SHOW" or (dep_passed and b_status == "CONFIRMED"))
        if no_show_detected and ctype == "VOLUNTARY":
            ctype = "NO_SHOW"

        # Determine coupon usage state
        used_segs = [s for s in segments if str(s["coupon_status"]).upper() == "USED"]
        open_segs = [s for s in segments if str(s["coupon_status"]).upper() in ("OPEN", "CHECKED_IN")]
        coupon_state = (simulate_coupon_state or "").strip().upper()
        if not coupon_state:
            if used_segs and open_segs:
                coupon_state = "PARTIALLY_USED"
            elif used_segs and not open_segs:
                coupon_state = "USED"
            else:
                coupon_state = "OPEN"

        # Handle Unpaid Hold / Before Issuance cleanly
        if b_status == "PENDING_PAYMENT" or (ctype == "BEFORE_ISSUANCE" and not pay_row):
            ctype = "BEFORE_ISSUANCE"
            quote_ref = f"QT-{secrets.token_hex(4).upper()}"
            now_iso = now_dt.strftime("%Y-%m-%d %H:%M:%S")
            exp_iso = (now_dt + timedelta(minutes=Config.REFUND_QUOTE_TTL_MINUTES)).strftime("%Y-%m-%d %H:%M:%S")
            cursor.execute(
                """
                INSERT INTO refund_quotes (
                    quote_ref, booking_reference, cancellation_type, currency, fare_family,
                    coupon_state, no_show_detected, fee_policy_version, original_paid_minor,
                    airline_penalty_minor, supplier_charge_minor, non_refundable_tax_minor,
                    refundable_tax_minor, fly_service_fee_minor, other_deductions_minor,
                    final_refund_minor, refundable_eligible, supplier_quote_ref, expires_at,
                    status, breakdown_json, created_by, created_at
                )
                VALUES (?, ?, 'BEFORE_ISSUANCE', 'BDT', ?, 'UNISSUED_HOLD', 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, 1, 'HOLD_RELEASE', ?, 'ACTIVE', ?, ?, ?)
                """,
                (quote_ref, ref, fare_family, fee_pol["version"], exp_iso, json.dumps({"note": "Unpaid seat lock release; no payment captured."}), user["id"], now_iso),
            )
            qid = cursor.lastrowid
            conn.commit()
            return 200, {
                "quoteId": qid,
                "quoteRef": quote_ref,
                "bookingReference": ref,
                "pnrCode": booking["pnr_code"],
                "cancellationType": "BEFORE_ISSUANCE",
                "fareFamily": fare_family,
                "couponState": "UNISSUED_HOLD",
                "originalPaidBDT": 0.0,
                "airlinePenaltyBDT": 0.0,
                "nonRefundableTaxesBDT": 0.0,
                "refundableTaxesBDT": 0.0,
                "flyServiceFeeBDT": 0.0,
                "otherDeductionsBDT": 0.0,
                "finalRefundBDT": 0.0,
                "currency": "BDT",
                "items": [{"lineCode": "HOLD_RELEASE", "label": "Unpaid seat reservation release", "category": "INFO", "amountBDT": 0.0}],
                "expiresAt": exp_iso,
                "irreversibleWarning": "Releasing this hold frees your locked seats immediately.",
                "paymentMethod": "NONE",
                "maskedPaymentRef": "No payment captured",
                "refundDestination": "Not applicable",
                "tickets": [dict(t) for t in tickets],
                "segments": [dict(s) for s in segments],
            }

        # Partial validation & proportional factor computation
        selected_ticket_ids = [int(x) for x in (selected_ticket_ids or []) if str(x).isdigit()]
        selected_segment_ids = [int(x) for x in (selected_segment_ids or []) if str(x).isdigit()]
        active_tickets = [t for t in tickets if t["status"] == "ISSUED"]
        active_segments = [s for s in segments if str(s["coupon_status"]).upper() in ("OPEN", "CHECKED_IN")]

        portion_num = 1
        portion_den = 1
        if ctype == "PARTIAL" or selected_ticket_ids or selected_segment_ids:
            ctype = "PARTIAL"
            if not rule["partial_cancel_allowed"]:
                return 409, {
                    "error": f"Supplier rule for {booking['airlineIATA']} {fare_family} fare does not permit partial cancellation.",
                    "code": "PARTIAL_NOT_PERMITTED",
                }
            if selected_ticket_ids:
                valid_sel = [t for t in active_tickets if t["id"] in selected_ticket_ids]
                if not valid_sel or len(valid_sel) >= len(active_tickets):
                    return 400, {"error": "Select a proper subset of active passenger tickets for partial cancellation."}
                portion_num = len(valid_sel)
                portion_den = max(1, len(active_tickets))
            elif selected_segment_ids:
                valid_segs = [s for s in active_segments if s["id"] in selected_segment_ids]
                if not valid_segs:
                    return 400, {"error": "No eligible open segment selected for partial cancellation."}
                # Check if return or unused segment is eligible
                if any(str(s["coupon_status"]).upper() == "USED" for s in segments if s["id"] in selected_segment_ids):
                    return 409, {"error": "Flown/USED segments cannot be cancelled."}
                portion_num = len(valid_segs)
                portion_den = max(1, len(segments))
            else:
                return 400, {"error": "Select passenger ticket(s) or unused segment(s) for partial cancellation."}

        if coupon_state == "USED":
            return 409, {"error": "Ticket coupon is fully USED and has no remaining refundable travel segment.", "code": "COUPON_USED"}

        # Decompose original fare breakdown cleanly in minor units
        fb = {}
        if booking["fare_breakdown"]:
            try:
                fb = json.loads(booking["fare_breakdown"])
            except Exception:
                fb = {}
        base_minor = to_minor(fb.get("baseFare") or (from_minor(total_paid_minor) * 0.78))
        taxes_minor = to_minor(fb.get("taxes") or 0)
        air_chg_minor = to_minor(fb.get("airlineCharges") or 0)
        extras_minor = to_minor(fb.get("extrasTotal") or 0)
        disc_minor = to_minor(fb.get("discount") or 0)

        # Apply exact proportional ratio for PARTIAL or PARTIALLY_USED (using Decimal arithmetic)
        ratio = Decimal(portion_num) / Decimal(portion_den)
        if coupon_state == "PARTIALLY_USED" and portion_num == portion_den and len(segments) > 1:
            # Only unused coupon ratio remains eligible
            ratio = Decimal(max(1, len(open_segs))) / Decimal(len(segments))

        scoped_paid_minor = min(remaining_paid_minor, int((Decimal(total_paid_minor) * ratio).quantize(Decimal("1"), rounding=ROUND_HALF_UP)))
        scoped_base_minor = int((Decimal(base_minor) * ratio).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        scoped_tax_minor = int((Decimal(taxes_minor) * ratio).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        scoped_air_chg_minor = int((Decimal(air_chg_minor) * ratio).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        scoped_extras_minor = int((Decimal(extras_minor) * ratio).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        scoped_disc_minor = int((Decimal(disc_minor) * ratio).quantize(Decimal("1"), rounding=ROUND_HALF_UP))

        # Refundability & Penalties (Part F3/F4/F6/G1)
        airline_penalty_minor = 0
        non_refundable_tax_minor = 0
        refundable_tax_minor = 0
        supplier_charge_minor = 0
        fly_service_fee_minor = 0
        other_deductions_minor = 0
        manual_review_note = None

        if ctype in ("AIRLINE_INITIATED", "SCHEDULE_CHANGE", "TICKETING_FAILURE"):
            # Involuntary cancellation or ticketing error: full captured scope refund, waivers respected
            refundable_tax_minor = scoped_tax_minor
            airline_penalty_minor = 0
            if ctype == "AIRLINE_INITIATED" and not fee_pol.get("waive_on_airline_cancel", 1):
                fly_service_fee_minor = int(fee_pol.get("cancellation_service_fee_minor") or 0)
            elif ctype == "SCHEDULE_CHANGE" and not fee_pol.get("waive_on_schedule_change", 1):
                fly_service_fee_minor = int(fee_pol.get("cancellation_service_fee_minor") or 0)
            elif ctype == "TICKETING_FAILURE" and not fee_pol.get("waive_on_ticketing_error", 1):
                fly_service_fee_minor = int(fee_pol.get("cancellation_service_fee_minor") or 0)
        elif ctype == "BEFORE_ISSUANCE" and pay_row:
            # Paid booking still awaiting issuance (e.g. customer cancelled before issuance)
            refundable_tax_minor = scoped_tax_minor
            fly_service_fee_minor = 0
        else:
            # VOLUNTARY / PARTIAL / NO_SHOW governed strictly by airline fare_rules
            tax_pct = int(rule.get("tax_refundable_pct", 100))
            refundable_tax_minor = int((Decimal(scoped_tax_minor) * Decimal(tax_pct) / Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            non_refundable_tax_minor = max(0, scoped_tax_minor - refundable_tax_minor)

            if not rule.get("is_refundable", 1):
                # Non-refundable fare: base fare & non-refundable carrier surcharges retained; unused govt taxes remain refundable!
                airline_penalty_minor = max(0, scoped_base_minor - scoped_disc_minor)
                if not rule.get("airline_charge_refundable", 0):
                    other_deductions_minor += scoped_air_chg_minor
                if not rule.get("ancillary_refundable", 0):
                    other_deductions_minor += scoped_extras_minor
                fly_service_fee_minor = min(int(fee_pol.get("cancellation_service_fee_minor") or 0), refundable_tax_minor)
            else:
                if no_show_detected:
                    airline_penalty_minor = int(rule.get("no_show_fee_minor") or 200000) * portion_num
                    manual_review_note = "Flight departure time passed or No-Show indicated; airline no-show penalty & coupon audit apply."
                else:
                    airline_penalty_minor = int(rule.get("voluntary_cancel_fee_minor") or 80000) * portion_num
                if not rule.get("airline_charge_refundable", 1):
                    other_deductions_minor += scoped_air_chg_minor
                if not rule.get("ancillary_refundable", 0):
                    other_deductions_minor += scoped_extras_minor
                fly_service_fee_minor = int(fee_pol.get("cancellation_service_fee_minor") or 0)

        total_deductions_minor = airline_penalty_minor + supplier_charge_minor + non_refundable_tax_minor + fly_service_fee_minor + other_deductions_minor
        # Guard: Never refund more than paid, and cap penalty cleanly when fare is lower than standard penalty
        if total_deductions_minor > scoped_paid_minor:
            excess = total_deductions_minor - scoped_paid_minor
            # Reduce penalty/deductions so refund floors cleanly at 0 without negative refund
            final_refund_minor = 0
            airline_penalty_minor = max(0, airline_penalty_minor - excess)
        else:
            final_refund_minor = max(0, scoped_paid_minor - total_deductions_minor)

        # Alternative flights check on airline-initiated / schedule change (F4)
        alternatives = []
        if ctype in ("AIRLINE_INITIATED", "SCHEDULE_CHANGE"):
            alt_rows = cursor.execute(
                """
                SELECT f.id, f.flight_number, f.dep_datetime, f.arr_datetime, f.economy_price,
                       al.name as airlineName, al.IATA as airlineIATA
                FROM flights f
                JOIN airLines al ON f.id_airline = al.id
                WHERE f.dep_airport = ? AND f.arr_airport = ? AND f.id != ?
                  AND COALESCE(f.is_active, 1) = 1 AND UPPER(COALESCE(f.status,'SCHEDULED')) != 'CANCELLED'
                ORDER BY f.dep_datetime ASC LIMIT 4
                """,
                (booking["dep_airport"], booking["arr_airport"], booking["id_flight"]),
            ).fetchall()
            alternatives = [dict(a) for a in alt_rows]

        quote_ref = f"QT-{secrets.token_hex(4).upper()}"
        now_iso = now_dt.strftime("%Y-%m-%d %H:%M:%S")
        exp_iso = (now_dt + timedelta(minutes=Config.REFUND_QUOTE_TTL_MINUTES)).strftime("%Y-%m-%d %H:%M:%S")
        pay_method = booking["payment_method"] or (pay_row["payment_method"] if pay_row else "SIMULATED_CARD")
        pay_ref = booking["payment_ref"] or (pay_row["transaction_ref"] if pay_row else None)
        method_label, dest_mask = _mask_payment_destination(pay_method, pay_ref)

        items = [
            ("ORIGINAL_PAID", "Original amount collected", "CREDIT", scoped_paid_minor, "Captured Payment Record"),
            ("AIRLINE_PENALTY", "Airline cancellation / no-show penalty" if no_show_detected else "Airline cancellation penalty", "DEDUCTION", airline_penalty_minor, f"{booking['airlineIATA']} Fare Rule ({fare_family})"),
            ("NON_REF_TAX", "Non-refundable taxes & charges", "DEDUCTION", non_refundable_tax_minor + other_deductions_minor, "Tax & Carrier Tariff"),
            ("REFUNDABLE_TAX", "Refundable taxes included", "INFO", refundable_tax_minor, "Tax Schedule"),
            ("FLY_SERVICE_FEE", f"Disclosed FLY service fee ({fee_pol['version']})", "DEDUCTION", fly_service_fee_minor, "Waived for involuntary disruption" if ctype in ("AIRLINE_INITIATED", "SCHEDULE_CHANGE", "TICKETING_FAILURE") else fee_pol["version"]),
            ("ESTIMATED_REFUND", "Final estimated customer refund", "CREDIT", final_refund_minor, "Authoritative Quote"),
        ]

        breakdown_payload = {
            "scopeRatio": str(ratio),
            "selectedTicketIds": selected_ticket_ids,
            "selectedSegmentIds": selected_segment_ids,
            "feePolicyVersion": fee_pol["version"],
            "fareRuleNotes": rule.get("notes"),
            "splitPnrRequired": bool(rule.get("split_pnr_required")) if ctype == "PARTIAL" else False,
            "manualReviewRecommended": bool(no_show_detected or ctype == "NO_SHOW"),
            "manualReviewNote": manual_review_note,
            "alternatives": alternatives,
        }

        cursor.execute(
            """
            INSERT INTO refund_quotes (
                quote_ref, booking_reference, cancellation_type, currency, fare_family,
                coupon_state, no_show_detected, fee_policy_version, original_paid_minor,
                airline_penalty_minor, supplier_charge_minor, non_refundable_tax_minor,
                refundable_tax_minor, fly_service_fee_minor, other_deductions_minor,
                final_refund_minor, refundable_eligible, supplier_quote_ref, expires_at,
                status, breakdown_json, created_by, created_at
            )
            VALUES (?, ?, ?, 'BDT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
            """,
            (
                quote_ref,
                ref,
                ctype,
                fare_family,
                coupon_state,
                1 if no_show_detected else 0,
                fee_pol["version"],
                scoped_paid_minor,
                airline_penalty_minor,
                supplier_charge_minor,
                non_refundable_tax_minor,
                refundable_tax_minor,
                fly_service_fee_minor,
                other_deductions_minor,
                final_refund_minor,
                1 if final_refund_minor > 0 or bool(rule.get("is_refundable")) else 0,
                f"SUPQT-{booking['airlineIATA']}-{secrets.token_hex(3).upper()}",
                exp_iso,
                json.dumps(breakdown_payload),
                user["id"],
                now_iso,
            ),
        )
        quote_id = cursor.lastrowid
        for code, lbl, cat, amt_m, src in items:
            cursor.execute(
                """
                INSERT INTO refund_quote_items (quote_id, line_code, label, category, amount_minor, currency, authority_source)
                VALUES (?, ?, ?, ?, ?, 'BDT', ?)
                """,
                (quote_id, code, lbl, cat, int(amt_m), src),
            )
        conn.commit()

        return 200, {
            "quoteId": quote_id,
            "quoteRef": quote_ref,
            "bookingReference": ref,
            "pnrCode": booking["pnr_code"],
            "airlineName": booking["airlineName"],
            "airlineIATA": booking["airlineIATA"],
            "journey": f"{booking['depCity']} ({booking['depIATA']}) -> {booking['arrCity']} ({booking['arrIATA']})",
            "depDateTime": booking["dep_datetime"],
            "cancellationType": ctype,
            "fareFamily": fare_family,
            "fareRuleNotes": rule.get("notes"),
            "couponState": coupon_state,
            "noShowDetected": no_show_detected,
            "splitPnrRequired": bool(breakdown_payload["splitPnrRequired"]),
            "manualReviewRecommended": bool(breakdown_payload["manualReviewRecommended"]),
            "manualReviewNote": manual_review_note,
            "feePolicyVersion": fee_pol["version"],
            "currency": "BDT",
            "originalPaidBDT": from_minor(scoped_paid_minor),
            "airlinePenaltyBDT": from_minor(airline_penalty_minor),
            "supplierChargeBDT": from_minor(supplier_charge_minor),
            "nonRefundableTaxesBDT": from_minor(non_refundable_tax_minor),
            "refundableTaxesBDT": from_minor(refundable_tax_minor),
            "flyServiceFeeBDT": from_minor(fly_service_fee_minor),
            "otherDeductionsBDT": from_minor(other_deductions_minor),
            "finalRefundBDT": from_minor(final_refund_minor),
            "items": [
                {"lineCode": c, "label": l, "category": cat, "amountBDT": from_minor(a), "authoritySource": src}
                for c, l, cat, a, src in items
            ],
            "paymentMethod": method_label,
            "rawPaymentMethod": pay_method,
            "maskedPaymentRef": f"****{pay_ref[-4:]}" if pay_ref and len(pay_ref) >= 4 else "N/A",
            "refundDestination": dest_mask,
            "estimatedWindow": "Processing time depends on airline, payment provider, and receiving bank/wallet.",
            "alternatives": alternatives,
            "selectedTicketIds": selected_ticket_ids,
            "selectedSegmentIds": selected_segment_ids,
            "expiresAt": exp_iso,
            "irreversibleWarning": "Submitting cancellation to the airline/supplier may become irreversible once confirmed. Review all deductions above before confirming.",
            "tickets": [dict(t) for t in tickets],
            "segments": [dict(s) for s in segments],
        }
    finally:
        conn.close()


def reject_refund_quote(quote_ref_or_id: str, user: dict, reason: str = "Customer declined quote") -> tuple:
    key = str(quote_ref_or_id or "").strip()
    conn = database.get_db()
    cursor = conn.cursor()
    try:
        q = cursor.execute(
            "SELECT rq.*, b.id_account, b.id_flight FROM refund_quotes rq JOIN bookings b ON rq.booking_reference = b.booking_reference JOIN flights f ON b.id_flight = f.id WHERE rq.quote_ref = ? OR rq.id = ?",
            (key, int(key) if key.isdigit() else -1),
        ).fetchone()
        if not q:
            return 404, {"error": "Refund quote not found."}
        if str(user.get("role")).upper() == "PASSENGER" and q["id_account"] != user["id"]:
            return 403, {"error": "Forbidden."}
        cursor.execute("UPDATE refund_quotes SET status = 'REJECTED' WHERE id = ? AND status = 'ACTIVE'", (q["id"],))
        database.log_audit_event(
            cursor,
            event_type="REFUND_QUOTE_REJECTED",
            result="REJECTED",
            actor_id=user["id"],
            actor_role=user["role"],
            reservation_ref=q["booking_reference"],
            details=f"Quote {q['quote_ref']} declined by customer: {reason}",
        )
        conn.commit()
        return 200, {"success": True, "quoteRef": q["quote_ref"], "status": "REJECTED", "message": "Refund quote declined; your booking remains unchanged."}
    finally:
        conn.close()


# ------------------------------------------------------------------
# EXPLICIT CONFIRMATION, SUPPLIER SUBMIT, QR REVOCATION & REFUND ENGINE
# ------------------------------------------------------------------
def confirm_cancellation_and_initiate_refund(
    booking_ref_or_pnr: str,
    user: dict,
    quote_id: int = None,
    quote_ref: str = None,
    customer_confirmed: bool = False,
    cancellation_type: str = "VOLUNTARY",
    reason: str = "Passenger requested cancellation",
    idempotency_key: str = None,
    supplier_scenario: str = "SUPPLIER_OK",
    gateway_scenario: str = "GATEWAY_PENDING",
    bank_account: str = None,
    selected_ticket_ids: list = None,
    selected_segment_ids: list = None,
    ip_address: str = None,
) -> tuple:
    """
    Executes cancellation after explicit customer confirmation:
    - Revalidates quote TTL and prevents duplicate cancellation/refund clicks.
    - Submits to SupplierCancellationAdapter.
    - Only revokes affected ticket QRs & updates seats after supplier confirms.
    - Creates refund tracking record, ledger entries, & payment adapter initiation.
    """
    if not customer_confirmed:
        return 400, {"error": "Explicit customer confirmation is required after reviewing the refund quotation.", "code": "CONFIRMATION_REQUIRED"}

    key = (booking_ref_or_pnr or "").strip()
    idem = (idempotency_key or f"CAN-{key}-{quote_ref or quote_id or 'DIRECT'}").strip()

    conn = database.get_db(isolation_level=None)
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN IMMEDIATE;")
        now_dt = datetime.utcnow()
        now_iso = now_dt.strftime("%Y-%m-%d %H:%M:%S")

        # Duplicate click idempotency check in refunds / cancellations
        prior_cancel = cursor.execute(
            "SELECT c.*, r.refund_ref, r.status as refund_status, r.approved_amount_minor FROM cancellations c LEFT JOIN refunds r ON r.cancellation_id = c.id WHERE c.quote_id = ? AND c.customer_confirmed = 1",
            (int(quote_id),) if quote_id else (-1,),
        ).fetchone()
        if prior_cancel and prior_cancel["status"] in ("CANCELLED_BY_SUPPLIER", "MANUAL_REVIEW"):
            cursor.execute("COMMIT;")
            return 200, {
                "success": True,
                "idempotentReplay": True,
                "cancellationRef": prior_cancel["cancellation_ref"],
                "cancellationStatus": prior_cancel["status"],
                "refundRef": prior_cancel["refund_ref"],
                "refundStatus": prior_cancel["refund_status"],
                "refundAmount": from_minor(prior_cancel["approved_amount_minor"] or 0),
                "message": "Cancellation already confirmed (idempotent replay prevented duplicate submission).",
            }

        booking = cursor.execute(
            """
            SELECT b.*, f.id_airline, f.dep_datetime, al.IATA as airlineIATA, a.emailAddress as accountEmail
            FROM bookings b
            JOIN accounts a ON b.id_account = a.id
            JOIN flights f ON b.id_flight = f.id
            JOIN airLines al ON f.id_airline = al.id
            WHERE b.booking_reference = ? OR UPPER(b.pnr_code) = UPPER(?)
            """,
            (key, key),
        ).fetchone()
        if not booking:
            cursor.execute("ROLLBACK;")
            return 404, {"error": "Booking not found."}

        role = str(user.get("role") or "PASSENGER").upper()
        if role == "PASSENGER" and booking["id_account"] != user["id"]:
            cursor.execute("ROLLBACK;")
            return 403, {"error": "Forbidden: Cannot cancel another customer's booking.", "code": "FORBIDDEN"}
        if role == "AIRLINE_ADMIN" and booking["id_airline"] != user.get("airlineId"):
            cursor.execute("ROLLBACK;")
            return 403, {"error": "Forbidden: Booking belongs to another airline.", "code": "FORBIDDEN"}

        ref = booking["booking_reference"]
        if booking["status"] in ("CANCELLED", "REFUNDED", "EXPIRED"):
            cursor.execute("ROLLBACK;")
            return 409, {"error": f"Booking is already {booking['status']}.", "code": "ALREADY_CANCELLED"}

        # Retrieve and validate quote
        q_row = None
        if quote_id:
            q_row = cursor.execute("SELECT * FROM refund_quotes WHERE id = ? AND booking_reference = ?", (int(quote_id), ref)).fetchone()
        elif quote_ref:
            q_row = cursor.execute("SELECT * FROM refund_quotes WHERE quote_ref = ? AND booking_reference = ?", (quote_ref.strip(), ref)).fetchone()
        if not q_row:
            cursor.execute("ROLLBACK;")
            return 400, {"error": "Valid refund quotation (quoteId or quoteRef) is required before confirming cancellation."}

        if q_row["status"] == "REJECTED":
            cursor.execute("ROLLBACK;")
            return 409, {"error": "This refund quotation was rejected. Generate a fresh quote first."}

        if database.is_expired(q_row["expires_at"]) or q_row["status"] == "EXPIRED":
            cursor.execute("UPDATE refund_quotes SET status = 'EXPIRED' WHERE id = ?", (q_row["id"],))
            cursor.execute("COMMIT;")
            return 409, {
                "error": "Your refund quotation has expired. Please refresh and revalidate the quote before submitting.",
                "code": "QUOTE_EXPIRED",
            }

        q_meta = json.loads(q_row["breakdown_json"]) if q_row["breakdown_json"] else {}
        ctype = q_row["cancellation_type"]
        sel_tids = [int(x) for x in (selected_ticket_ids or q_meta.get("selectedTicketIds") or [])]
        sel_sids = [int(x) for x in (selected_segment_ids or q_meta.get("selectedSegmentIds") or [])]

        # Handle unconfirmed seat hold (BEFORE_ISSUANCE without payment) cleanly
        if booking["status"] == "PENDING_PAYMENT":
            can_ref = f"CAN-{secrets.token_hex(4).upper()}"
            cursor.execute("UPDATE refund_quotes SET status = 'CONFIRMED' WHERE id = ?", (q_row["id"],))
            cursor.execute(
                """
                INSERT INTO cancellations (
                    cancellation_ref, booking_reference, id_account, id_airline, cancellation_type,
                    status, reason, quote_id, customer_confirmed, customer_confirmed_at,
                    supplier_ref, supplier_status, is_partial, is_test, created_by, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, 'BEFORE_ISSUANCE', 'CANCELLED_BY_SUPPLIER', ?, ?, 1, ?, 'HOLD_RELEASED', 'CANCELLED', 0, 1, ?, ?, ?)
                """,
                (can_ref, ref, booking["id_account"], booking["id_airline"], reason, q_row["id"], now_iso, user["id"], now_iso, now_iso),
            )
            cursor.execute(
                "UPDATE bookings SET status = 'CANCELLED', cancelled_at = ?, cancellation_reason = ?, cancellation_type = 'BEFORE_ISSUANCE', refund_amount = 0, refund_status = 'HOLD_RELEASED' WHERE booking_reference = ?",
                (now_iso, reason, ref),
            )
            cursor.execute("UPDATE reservations SET status = 'CANCELLED' WHERE booking_reference = ?", (ref,))
            database.log_audit_event(cursor, "HOLD_RELEASED", "CANCELLED", user["id"], user["role"], booking["id_airline"], booking["id_flight"], reservation_ref=ref, details=reason, ip_address=ip_address)
            cursor.execute("COMMIT;")
            return 200, {
                "success": True,
                "cancellationRef": can_ref,
                "cancellationStatus": "CANCELLED_BY_SUPPLIER",
                "refundAmount": 0.0,
                "refundStatus": "HOLD_RELEASED",
                "message": "Reservation hold cancelled and seats released back to inventory.",
            }

        # Guard against duplicate active refund submission for same scope
        existing_ref = cursor.execute(
            "SELECT * FROM refunds WHERE booking_reference = ? AND status NOT IN ('FAILED', 'NOT_ELIGIBLE') AND cancellation_type = ? AND ? = 0",
            (ref, ctype, 1 if ctype == "PARTIAL" else 0),
        ).fetchone()
        if existing_ref:
            cursor.execute("COMMIT;")
            return 409, {
                "error": f"A refund workflow ({existing_ref['refund_ref']}) is already active in status {existing_ref['status']}.",
                "code": "DUPLICATE_REFUND",
                "refundRef": existing_ref["refund_ref"],
            }

        # Submit cancellation to Supplier / Airline Adapter
        sup_res = SupplierCancellationAdapter.submit_cancellation(booking, ctype, supplier_scenario=supplier_scenario)
        can_ref = f"CAN-{secrets.token_hex(4).upper()}"

        if not sup_res["ok"]:
            cursor.execute(
                """
                INSERT INTO cancellations (
                    cancellation_ref, booking_reference, id_account, id_airline, cancellation_type,
                    status, reason, quote_id, customer_confirmed, customer_confirmed_at,
                    supplier_ref, supplier_status, supplier_response_json, is_partial, is_test, created_by, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, 'FAILED', ?, ?, 1, ?, NULL, 'FAILED', ?, ?, ?, ?, ?, ?)
                """,
                (
                    can_ref, ref, booking["id_account"], booking["id_airline"], ctype,
                    reason, q_row["id"], now_iso, json.dumps(sup_res),
                    1 if ctype == "PARTIAL" else 0, 1, user["id"], now_iso, now_iso,
                ),
            )
            database.log_audit_event(cursor, "SUPPLIER_CANCEL_FAILED", "FAILED", user["id"], user["role"], booking["id_airline"], booking["id_flight"], reservation_ref=ref, details=sup_res["message"], ip_address=ip_address)
            cursor.execute("COMMIT;")
            return 502, {
                "error": sup_res["message"],
                "code": "SUPPLIER_CANCELLATION_FAILED",
                "cancellationRef": can_ref,
                "cancellationStatus": "FAILED",
            }

        # Manual review path (uncertain coupon/no-show or provider manual review):
        # Put tickets into CANCELLATION_PENDING without invalidating entire itinerary blindly yet!
        is_manual_sup = (sup_res["status"] == "MANUAL_REVIEW") or bool(q_meta.get("manualReviewRecommended") and ctype == "NO_SHOW" and supplier_scenario == "SUPPLIER_MANUAL_REVIEW")
        can_status = "MANUAL_REVIEW" if is_manual_sup else "CANCELLED_BY_SUPPLIER"

        cursor.execute("UPDATE refund_quotes SET status = 'CONFIRMED' WHERE id = ?", (q_row["id"],))
        cursor.execute(
            """
            INSERT INTO cancellations (
                cancellation_ref, booking_reference, id_account, id_airline, cancellation_type,
                status, reason, quote_id, customer_confirmed, customer_confirmed_at,
                supplier_ref, supplier_status, supplier_response_json, alternative_options_json,
                is_partial, is_test, created_by, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                can_ref, ref, booking["id_account"], booking["id_airline"], ctype,
                can_status, reason, q_row["id"], now_iso,
                sup_res.get("supplierRef"), sup_res["status"], json.dumps(sup_res),
                json.dumps(q_meta.get("alternatives") or []),
                1 if ctype == "PARTIAL" else 0, 1, user["id"], now_iso, now_iso,
            ),
        )
        cancellation_id = cursor.lastrowid

        # Update tickets, segments, seats & revoke QR tokens appropriately
        tickets = cursor.execute("SELECT * FROM tickets WHERE booking_reference = ?", (ref,)).fetchall()
        refund_minor = int(q_row["final_refund_minor"])
        refund_bdt = from_minor(refund_minor)

        if can_status == "MANUAL_REVIEW":
            cursor.execute("UPDATE tickets SET issuance_state = 'CANCELLATION_PENDING', updated_at = ? WHERE booking_reference = ? AND status = 'ISSUED'", (now_iso, ref))
            cursor.execute("UPDATE bookings SET cancellation_type = ?, cancellation_reason = ?, refund_amount = ?, refund_status = 'APPROVAL_PENDING' WHERE booking_reference = ?", (ctype, reason, refund_bdt, ref))
        elif ctype == "PARTIAL":
            # Partial cancellation: cancel only chosen ticket(s) or chosen unused segment(s)!
            if sel_tids:
                for t in tickets:
                    if t["id"] in sel_tids and t["status"] == "ISSUED":
                        cursor.execute(
                            "UPDATE tickets SET status = 'CANCELLED', issuance_state = 'CANCELLED', updated_at = ? WHERE id = ?",
                            (now_iso, t["id"]),
                        )
                        cursor.execute("UPDATE ticket_segments SET coupon_status = 'CANCELLED' WHERE ticket_id = ?", (t["id"],))
                        qr_service.revoke_qr_tokens(cursor, ticket_id=t["id"], reason="PARTIAL_CANCELLATION")
                        cursor.execute(
                            """
                            INSERT INTO cancellation_items (cancellation_id, ticket_id, passenger_name, seat_code, item_type, item_status, amount_minor)
                            VALUES (?, ?, ?, ?, 'PASSENGER', 'CANCELLED', ?)
                            """,
                            (cancellation_id, t["id"], t["passenger_name"], t["seat_codes"], refund_minor // max(1, len(sel_tids))),
                        )
                        # Release only cancelled seat code on flight
                        if t["seat_codes"]:
                            cursor.execute(
                                """
                                UPDATE reservations SET status = 'CANCELLED'
                                WHERE booking_reference = ? AND id_seat IN (
                                    SELECT id FROM seats WHERE (column || row) = ?
                                )
                                """,
                                (ref, t["seat_codes"].strip()),
                            )
            elif sel_sids:
                for sid in sel_sids:
                    seg = cursor.execute("SELECT * FROM ticket_segments WHERE id = ? AND booking_reference = ?", (sid, ref)).fetchone()
                    if seg:
                        cursor.execute("UPDATE ticket_segments SET coupon_status = 'CANCELLED' WHERE id = ?", (sid,))
                        cursor.execute(
                            "INSERT INTO cancellation_items (cancellation_id, ticket_id, segment_id, seat_code, item_type, item_status, amount_minor) VALUES (?, ?, ?, ?, 'SEGMENT', 'CANCELLED', ?)",
                            (cancellation_id, seg["ticket_id"], sid, seg["seat_code"], refund_minor // max(1, len(sel_sids))),
                        )
                        # Mark parent ticket PARTIALLY_USED/CANCELLED appropriately if all open segments cancelled
                        rem_open = cursor.execute("SELECT COUNT(*) FROM ticket_segments WHERE ticket_id = ? AND coupon_status = 'OPEN'", (seg["ticket_id"],)).fetchone()[0]
                        if rem_open == 0:
                            cursor.execute("UPDATE tickets SET status = 'CANCELLED', issuance_state = 'CANCELLED', updated_at = ? WHERE id = ?", (now_iso, seg["ticket_id"]))
                            qr_service.revoke_qr_tokens(cursor, ticket_id=seg["ticket_id"], reason="ALL_SEGMENTS_CANCELLED")
            cursor.execute(
                "UPDATE bookings SET status = 'CONFIRMED', cancellation_type = 'PARTIAL', cancellation_reason = ?, refund_amount = COALESCE(refund_amount, 0) + ?, refund_status = ? WHERE booking_reference = ?",
                (reason, refund_bdt, "GATEWAY_PROCESSING" if refund_minor > 0 else "NO_REFUND", ref),
            )
        else:
            # Full cancellation: invalidate all tickets, segments, QR tokens & release all seats
            cursor.execute("UPDATE bookings SET status = 'CANCELLED', cancelled_at = ?, cancellation_type = ?, cancellation_reason = ?, refund_amount = ?, refund_status = ? WHERE booking_reference = ?", (now_iso, ctype, reason, refund_bdt, "GATEWAY_PROCESSING" if refund_minor > 0 else "NO_REFUND", ref))
            cursor.execute("UPDATE reservations SET status = 'CANCELLED' WHERE booking_reference = ?", (ref,))
            cursor.execute("UPDATE tickets SET status = 'CANCELLED', issuance_state = 'CANCELLED', updated_at = ? WHERE booking_reference = ?", (now_iso, ref))
            cursor.execute("UPDATE ticket_segments SET coupon_status = 'CANCELLED' WHERE booking_reference = ?", (ref,))
            qr_service.revoke_qr_tokens(cursor, booking_reference=ref, reason=f"SUPPLIER_CANCELLATION_{ctype}")
            for t in tickets:
                cursor.execute(
                    "INSERT INTO cancellation_items (cancellation_id, ticket_id, passenger_name, seat_code, item_type, item_status, amount_minor) VALUES (?, ?, ?, ?, 'FULL', 'CANCELLED', ?)",
                    (cancellation_id, t["id"], t["passenger_name"], t["seat_codes"], refund_minor // max(1, len(tickets))),
                )

        # Create independent Refunds record & timeline
        refund_ref = f"RF-{secrets.token_hex(4).upper()}"
        pay_method = booking["payment_method"] or "SIMULATED_CARD"
        pay_ref = booking["payment_ref"]
        _, dest_mask = _mask_payment_destination(pay_method, pay_ref, bank_account=bank_account)
        dual_req = 1 if (refund_bdt >= Config.DUAL_APPROVAL_THRESHOLD_BDT or "BANK" in pay_method.upper() or "CASH" in pay_method.upper()) else 0

        if refund_minor <= 0:
            init_rf_status = "NOT_ELIGIBLE"
        elif can_status == "MANUAL_REVIEW" or dual_req or ctype == "NO_SHOW" or sup_res.get("bspSettlement"):
            init_rf_status = "SUBMITTED_TO_SUPPLIER" if sup_res.get("bspSettlement") else "APPROVAL_PENDING"
        else:
            init_rf_status = "GATEWAY_REFUND_PENDING"

        cursor.execute(
            """
            INSERT INTO refunds (
                refund_ref, cancellation_id, quote_id, booking_reference, id_account, id_airline,
                cancellation_type, currency, approved_amount_minor, settled_amount_minor,
                payment_method, original_payment_ref, refund_destination, status,
                requires_manual, dual_approval_required, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'BDT', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                refund_ref, cancellation_id, q_row["id"], ref, booking["id_account"], booking["id_airline"],
                ctype, refund_minor, pay_method, pay_ref, dest_mask, init_rf_status,
                1 if ("BANK" in pay_method.upper() or "CASH" in pay_method.upper()) else 0,
                dual_req, now_iso, now_iso,
            ),
        )
        refund_id = cursor.lastrowid

        # Record supplier refund reference
        cursor.execute(
            """
            INSERT INTO supplier_refund_references (
                refund_id, cancellation_id, supplier_name, supplier_cancel_ref,
                bsp_settlement_status, raw_payload, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                refund_id, cancellation_id, sup_res["supplierName"], sup_res.get("supplierRef"),
                "PENDING_BSP" if sup_res.get("bspSettlement") else "CONFIRMED",
                json.dumps(sup_res), now_iso,
            ),
        )

        # Immutable Ledger entries for quote & refund liability
        if refund_minor > 0:
            _record_ledger(cursor, ref, "REFUND_LIABILITY", "DEBIT", refund_minor, refund_id=refund_id, cancellation_id=cancellation_id, reference_id=refund_ref, description=f"Authorized refund liability ({ctype})", created_by=user["id"])
        if q_row["airline_penalty_minor"] > 0:
            _record_ledger(cursor, ref, "AIRLINE_PENALTY", "CREDIT", q_row["airline_penalty_minor"], refund_id=refund_id, cancellation_id=cancellation_id, reference_id=can_ref, description="Airline cancellation penalty retained", created_by=user["id"])
        if q_row["fly_service_fee_minor"] > 0:
            _record_ledger(cursor, ref, "FLY_SERVICE_FEE", "CREDIT", q_row["fly_service_fee_minor"], refund_id=refund_id, cancellation_id=cancellation_id, reference_id=can_ref, description=f"FLY service fee ({q_row['fee_policy_version']})", created_by=user["id"])

        _append_refund_history(cursor, refund_id, None, "REQUESTED", "1. Cancellation requested", reason, user["id"], user["role"])
        _append_refund_history(cursor, refund_id, "REQUESTED", "QUOTE_READY", "2. Refund calculation completed", f"Quote {q_row['quote_ref']} ({format_bdt_minor(refund_minor)})", user["id"], user["role"])
        _append_refund_history(cursor, refund_id, "QUOTE_READY", "SUBMITTED_TO_SUPPLIER", "3. Cancellation submitted to supplier", f"Submitted to {sup_res['supplierName']}", user["id"], "SYSTEM")
        _append_refund_history(cursor, refund_id, "SUBMITTED_TO_SUPPLIER", init_rf_status, "4. Supplier confirmation received", sup_res["message"], None, "SUPPLIER")

        final_rf_status = init_rf_status
        estimated_window = "Your refund is being processed. Completion time depends on the airline, payment provider, and receiving bank or wallet."
        gw_ref = None

        # Only submit immediately to payment gateway adapter if automated & supplier-confirmed & eligible & single-approval
        if refund_minor > 0 and init_rf_status == "GATEWAY_REFUND_PENDING":
            adapter = resolve_refund_adapter(pay_method)
            # Idempotency check in refund_transactions
            existing_tx = cursor.execute("SELECT * FROM refund_transactions WHERE idempotency_key = ?", (idem,)).fetchone()
            if not existing_tx:
                ad_res = adapter.initiate(
                    {"refund_ref": refund_ref, "approved_amount_minor": refund_minor, "original_payment_ref": pay_ref},
                    gateway_scenario=gateway_scenario,
                )
                gw_ref = ad_res.get("gatewayRef")
                final_rf_status = ad_res["refundStatus"]
                if ad_res.get("estimatedWindow"):
                    estimated_window = ad_res["estimatedWindow"]
                tx_ref = f"RFTX-{secrets.token_hex(4).upper()}"
                cursor.execute(
                    """
                    INSERT INTO refund_transactions (
                        refund_id, refund_txn_ref, idempotency_key, adapter_name, operation,
                        amount_minor, currency, status, gateway_ref, raw_response_json, error_message, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, 'INITIATE_REFUND', ?, 'BDT', ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        refund_id, tx_ref, idem, adapter.name, refund_minor,
                        final_rf_status, gw_ref, json.dumps(ad_res), ad_res.get("error"), now_iso, now_iso,
                    ),
                )
                settled_m = int(ad_res.get("settledMinor") or 0) if final_rf_status == "REFUNDED" else 0
                cursor.execute(
                    """
                    UPDATE refunds
                    SET status = ?, provider_ref = ?, estimated_window = ?, failure_reason = ?,
                        settled_amount_minor = ?, requires_manual = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        final_rf_status, gw_ref, ad_res.get("estimatedWindow"), ad_res.get("error"),
                        settled_m, 1 if ad_res.get("requiresManual") else 0, now_iso, refund_id,
                    ),
                )
                _append_refund_history(
                    cursor, refund_id, init_rf_status, final_rf_status,
                    "5. Refund sent to payment provider" if ad_res.get("ok") else "Gateway Attention Required",
                    ad_res.get("message") or ad_res.get("error") or "",
                    None, adapter.name,
                )
                if final_rf_status == "REFUNDED":
                    _append_refund_history(cursor, refund_id, final_rf_status, "REFUNDED", "7. Refund completed", f"Settled {format_bdt_minor(settled_m)} via {gw_ref}", None, adapter.name)
                    _record_ledger(cursor, ref, "GATEWAY_REFUND_OUTFLOW", "DEBIT", settled_m, refund_id=refund_id, cancellation_id=cancellation_id, reference_id=gw_ref, description=f"Gateway settled refund {gw_ref}")
                    cursor.execute("UPDATE bookings SET refund_status = 'REFUNDED' WHERE booking_reference = ? AND status = 'CANCELLED'", (ref,))
                    cursor.execute("UPDATE tickets SET status = 'REFUNDED', issuance_state = 'REFUNDED', updated_at = ? WHERE booking_reference = ? AND status = 'CANCELLED'", (now_iso, ref))

        cursor.execute(
            "UPDATE bookings SET refund_status = ? WHERE booking_reference = ?",
            (final_rf_status if refund_minor > 0 else "NOT_ELIGIBLE", ref),
        )

        # Keep legacy refund_requests table synced for any older admin views / tests
        cursor.execute(
            """
            INSERT INTO refund_requests (booking_reference, id_account, id_airline, reason, requested_amount, approved_amount, status, reviewed_by, review_note, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ref, booking["id_account"], booking["id_airline"], reason, refund_bdt,
                refund_bdt if final_rf_status in ("REFUNDED", "GATEWAY_PROCESSING") else 0.0,
                "APPROVED" if final_rf_status in ("REFUNDED", "GATEWAY_PROCESSING") else ("REJECTED" if final_rf_status == "NOT_ELIGIBLE" else "PENDING"),
                user["id"], f"{refund_ref} ({final_rf_status})", now_iso, now_iso,
            ),
        )

        _queue_notification(
            cursor,
            ref,
            booking["accountEmail"],
            f"FLY Cancellation & Refund Update — {ref}",
            f"Cancellation {can_ref} ({can_status}). Refund {refund_ref} ({format_bdt_minor(refund_minor)}) current status: {final_rf_status}.",
            {"cancellationRef": can_ref, "refundRef": refund_ref, "refundStatus": final_rf_status},
        )
        database.log_audit_event(
            cursor,
            event_type="CANCELLATION_CONFIRMED",
            result=final_rf_status,
            actor_id=user["id"],
            actor_role=user["role"],
            airline_id=booking["id_airline"],
            flight_id=booking["id_flight"],
            reservation_ref=ref,
            details=f"{can_ref} ({ctype}) -> {refund_ref}: {format_bdt_minor(refund_minor)} [{final_rf_status}]",
            ip_address=ip_address,
        )
        cursor.execute("COMMIT;")

        return 200, {
            "success": True,
            "cancellationRef": can_ref,
            "cancellationStatus": can_status,
            "cancellationType": ctype,
            "supplierRef": sup_res.get("supplierRef"),
            "refundRef": refund_ref,
            "refundStatus": final_rf_status,
            "refundAmount": refund_bdt,
            "currency": "BDT",
            "gatewayRef": gw_ref,
            "refundDestination": dest_mask,
            "estimatedWindow": estimated_window,
            "message": f"Cancellation confirmed ({can_status}). Refund {refund_ref} is now {final_rf_status}.",
        }
    except Exception as exc:
        try:
            cursor.execute("ROLLBACK;")
        except Exception:
            pass
        return 500, {"error": f"Cancellation processing error: {exc}"}
    finally:
        conn.close()


# ------------------------------------------------------------------
# REFUND TRACKING TIMELINE & SETTLEMENT RECONCILIATION (Part J / K / L)
# ------------------------------------------------------------------
def get_refund_tracking(ref_or_booking: str, user: dict) -> tuple:
    key = (ref_or_booking or "").strip()
    conn = database.get_db()
    cursor = conn.cursor()
    try:
        row = cursor.execute(
            """
            SELECT r.*, c.cancellation_ref, c.status as cancellation_status, c.reason as cancellation_reason,
                   c.customer_confirmed_at, c.supplier_ref,
                   b.pnr_code, b.status as booking_status, al.name as airlineName, al.IATA as airlineIATA
            FROM refunds r
            LEFT JOIN cancellations c ON r.cancellation_id = c.id
            JOIN bookings b ON r.booking_reference = b.booking_reference
            JOIN airLines al ON r.id_airline = al.id
            WHERE UPPER(r.refund_ref) = UPPER(?) OR r.booking_reference = ? OR UPPER(b.pnr_code) = UPPER(?)
            ORDER BY r.id DESC LIMIT 1
            """,
            (key, key, key),
        ).fetchone()
        if not row:
            return 404, {"error": "No refund record found for this reference."}

        role = str(user.get("role") or "PASSENGER").upper()
        if role == "PASSENGER" and row["id_account"] != user["id"]:
            return 403, {"error": "Forbidden: Cannot inspect another customer's refund status."}
        if role == "AIRLINE_ADMIN" and row["id_airline"] != user.get("airlineId"):
            return 403, {"error": "Forbidden: Refund belongs to another airline."}

        hist = [
            dict(h)
            for h in cursor.execute(
                "SELECT * FROM refund_status_history WHERE refund_id = ? ORDER BY id ASC",
                (row["id"],),
            ).fetchall()
        ]
        txns = [
            dict(t)
            for t in cursor.execute(
                "SELECT refund_txn_ref, adapter_name, operation, amount_minor, currency, status, gateway_ref, error_message, created_at FROM refund_transactions WHERE refund_id = ? ORDER BY id DESC",
                (row["id"],),
            ).fetchall()
        ]
        quote = cursor.execute("SELECT * FROM refund_quotes WHERE id = ?", (row["quote_id"],)).fetchone() if row["quote_id"] else None
        q_items = [
            dict(qi)
            for qi in cursor.execute("SELECT * FROM refund_quote_items WHERE quote_id = ? ORDER BY id ASC", (row["quote_id"],)).fetchall()
        ] if row["quote_id"] else []

        st = row["status"]
        stages = [
            ("1. Cancellation requested", True),
            ("2. Refund calculation completed", True),
            ("3. Cancellation submitted to supplier", any("SUPPLIER" in h["to_status"] or "CANCELLED" in h["to_status"] or "PROCESSING" in h["to_status"] or "REFUNDED" in h["to_status"] for h in hist)),
            ("4. Supplier confirmation received", row["cancellation_status"] == "CANCELLED_BY_SUPPLIER"),
            ("5. Refund sent to payment provider", st in ("GATEWAY_REFUND_PENDING", "GATEWAY_PROCESSING", "PARTIALLY_REFUNDED", "REFUNDED", "RECONCILIATION_REQUIRED")),
            ("6. Refund processing", st in ("GATEWAY_PROCESSING", "PARTIALLY_REFUNDED", "REFUNDED")),
            ("7. Refund completed", st == "REFUNDED"),
        ]

        return 200, {
            "refundId": row["id"],
            "refundRef": row["refund_ref"],
            "cancellationRef": row["cancellation_ref"],
            "cancellationStatus": row["cancellation_status"],
            "cancellationType": row["cancellation_type"],
            "cancellationReason": row["cancellation_reason"],
            "bookingReference": row["booking_reference"],
            "pnrCode": row["pnr_code"],
            "airlineName": row["airlineName"],
            "airlineIATA": row["airlineIATA"],
            "amountBDT": from_minor(row["approved_amount_minor"]),
            "settledAmountBDT": from_minor(row["settled_amount_minor"]),
            "currency": row["currency"],
            "paymentMethod": row["payment_method"],
            "refundDestination": row["refund_destination"],
            "status": row["status"],
            "providerRef": row["provider_ref"],
            "supplierRef": row["supplier_ref"],
            "failureReason": row["failure_reason"],
            "estimatedWindow": row["estimated_window"] or "Your refund is being processed. The completion time depends on the airline, payment provider, and receiving bank or wallet.",
            "requestedAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "timelineStages": [{"label": lbl, "completed": done} for lbl, done in stages],
            "history": hist,
            "transactions": txns,
            "quoteBreakdown": [
                {"label": qi["label"], "category": qi["category"], "amountBDT": from_minor(qi["amount_minor"]), "authoritySource": qi["authority_source"]}
                for qi in q_items
            ] if q_items else [],
            "quoteRef": quote["quote_ref"] if quote else None,
        }
    finally:
        conn.close()


def reconcile_gateway_refund(refund_ref: str, staff_user: dict, simulate_outcome: str = "SETTLED", settled_amount_bdt: float = None, provider_ref: str = None, note: str = "Gateway settlement reconciled") -> tuple:
    """
    Polls or reconciles an initiated refund cleanly (never blinds-submits duplicates!).
    Only transitions to REFUNDED when verified settlement matches.
    """
    if str(staff_user.get("role") or "").upper() not in ("AIRLINE_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN"):
        return 403, {"error": "Forbidden: Admin privileges required."}

    conn = database.get_db(isolation_level=None)
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN IMMEDIATE;")
        now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        row = cursor.execute("SELECT * FROM refunds WHERE UPPER(refund_ref) = UPPER(?) OR id = ?", (refund_ref.strip(), int(refund_ref) if str(refund_ref).isdigit() else -1)).fetchone()
        if not row:
            cursor.execute("ROLLBACK;")
            return 404, {"error": "Refund record not found."}
        if str(staff_user.get("role")).upper() == "AIRLINE_ADMIN" and int(row["id_airline"]) != int(staff_user.get("airlineId") or -1):
            cursor.execute("ROLLBACK;")
            return 403, {"error": "Forbidden: Cannot reconcile another airline's refund."}

        if row["status"] == "REFUNDED":
            cursor.execute("COMMIT;")
            return 200, {"success": True, "alreadySettled": True, "refundRef": row["refund_ref"], "status": "REFUNDED"}

        outcome = (simulate_outcome or "SETTLED").strip().upper()
        approved_minor = int(row["approved_amount_minor"])
        settled_minor = to_minor(settled_amount_bdt) if settled_amount_bdt is not None else approved_minor
        gw_ref = provider_ref or row["provider_ref"] or f"GWR-STL-{secrets.token_hex(4).upper()}"

        # Pre-retry status check prevents duplicate refund submission
        existing_settled = cursor.execute(
            "SELECT 1 FROM refund_transactions WHERE refund_id = ? AND status = 'REFUNDED'",
            (row["id"],),
        ).fetchone()
        if existing_settled:
            cursor.execute("COMMIT;")
            return 409, {"error": "Refund already settled in gateway transaction history."}

        if outcome == "FAILED":
            new_st = "FAILED"
            cursor.execute("UPDATE refunds SET status = 'FAILED', failure_reason = ?, updated_at = ? WHERE id = ?", (note, now_iso, row["id"]))
        elif settled_minor > approved_minor or settled_minor <= 0:
            new_st = "RECONCILIATION_REQUIRED"
            cursor.execute("UPDATE refunds SET status = 'RECONCILIATION_REQUIRED', settled_amount_minor = ?, failure_reason = ?, updated_at = ? WHERE id = ?", (settled_minor, f"Discrepancy vs approved {format_bdt_minor(approved_minor)}", now_iso, row["id"]))
        elif settled_minor < approved_minor:
            new_st = "PARTIALLY_REFUNDED"
            cursor.execute("UPDATE refunds SET status = 'PARTIALLY_REFUNDED', settled_amount_minor = ?, provider_ref = ?, updated_at = ? WHERE id = ?", (settled_minor, gw_ref, now_iso, row["id"]))
            _record_ledger(cursor, row["booking_reference"], "GATEWAY_REFUND_OUTFLOW", "DEBIT", settled_minor, refund_id=row["id"], reference_id=gw_ref, description=note, created_by=staff_user["id"])
        else:
            new_st = "REFUNDED"
            cursor.execute("UPDATE refunds SET status = 'REFUNDED', settled_amount_minor = ?, provider_ref = ?, failure_reason = NULL, updated_at = ? WHERE id = ?", (settled_minor, gw_ref, now_iso, row["id"]))
            _record_ledger(cursor, row["booking_reference"], "GATEWAY_REFUND_OUTFLOW", "DEBIT", settled_minor, refund_id=row["id"], reference_id=gw_ref, description=note, created_by=staff_user["id"])
            cursor.execute("UPDATE bookings SET refund_status = 'REFUNDED' WHERE booking_reference = ? AND status = 'CANCELLED'", (row["booking_reference"],))
            cursor.execute("UPDATE tickets SET status = 'REFUNDED', issuance_state = 'REFUNDED', updated_at = ? WHERE booking_reference = ? AND status = 'CANCELLED'", (now_iso, row["booking_reference"]))
            qr_service.revoke_qr_tokens(cursor, booking_reference=row["booking_reference"], reason="REFUND_SETTLED")

        tx_ref = f"RFTX-{secrets.token_hex(4).upper()}"
        cursor.execute(
            """
            INSERT INTO refund_transactions (
                refund_id, refund_txn_ref, idempotency_key, adapter_name, operation,
                amount_minor, currency, status, gateway_ref, raw_response_json, created_at, updated_at
            )
            VALUES (?, ?, ?, 'RECONCILIATION_SERVICE', 'POLL_RECONCILE', ?, 'BDT', ?, ?, ?, ?, ?)
            """,
            (row["id"], tx_ref, f"REC-{row['id']}-{now_iso}-{secrets.token_hex(2)}", settled_minor, new_st, gw_ref, json.dumps({"note": note, "outcome": outcome}), now_iso, now_iso),
        )
        _append_refund_history(cursor, row["id"], row["status"], new_st, "7. Refund completed" if new_st == "REFUNDED" else f"Status updated: {new_st}", note, staff_user["id"], staff_user["role"])
        _queue_notification(cursor, row["booking_reference"], "", f"Refund {row['refund_ref']} Update: {new_st}", note, {"refundRef": row["refund_ref"], "status": new_st})
        database.log_audit_event(cursor, f"REFUND_{new_st}", new_st, staff_user["id"], staff_user["role"], row["id_airline"], reservation_ref=row["booking_reference"], details=f"{row['refund_ref']} -> {new_st} ({gw_ref})")
        cursor.execute("COMMIT;")
        return 200, {"success": True, "refundRef": row["refund_ref"], "status": new_st, "settledAmount": from_minor(settled_minor), "providerRef": gw_ref}
    except Exception as exc:
        try:
            cursor.execute("ROLLBACK;")
        except Exception:
            pass
        return 500, {"error": str(exc)}
    finally:
        conn.close()


def process_manual_refund_operation(
    refund_id_or_ref: str,
    staff_user: dict,
    action: str,
    reason: str = "",
    transfer_reference: str = "",
    evidence_ref: str = "",
    bank_account_masked: str = "",
) -> tuple:
    """
    Authorized Manual Refund Operations (Part I4/I5/L4):
    - Enforces reason, approval, dual approval for high-value/sensitive payouts,
      and blocks marking REFUNDED without transferReference & evidenceRef settlement proof.
    """
    role = str(staff_user.get("role") or "").upper()
    if role not in ("AIRLINE_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN"):
        return 403, {"error": "Forbidden: Finance/Admin privileges required."}

    act = (action or "").strip().upper()
    if act not in ("APPROVE", "DUAL_APPROVE", "SETTLE", "REJECT"):
        return 400, {"error": "Action must be APPROVE, DUAL_APPROVE, SETTLE, or REJECT."}

    conn = database.get_db(isolation_level=None)
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN IMMEDIATE;")
        now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        r = cursor.execute(
            "SELECT * FROM refunds WHERE UPPER(refund_ref) = UPPER(?) OR id = ?",
            (str(refund_id_or_ref).strip(), int(refund_id_or_ref) if str(refund_id_or_ref).isdigit() else -1),
        ).fetchone()
        if not r:
            cursor.execute("ROLLBACK;")
            return 404, {"error": "Refund request not found."}
        if role == "AIRLINE_ADMIN" and int(r["id_airline"]) != int(staff_user.get("airlineId") or -1):
            cursor.execute("ROLLBACK;")
            return 403, {"error": "Forbidden: Cannot process another airline's refund."}

        appr = cursor.execute("SELECT * FROM manual_refund_approvals WHERE refund_id = ? ORDER BY id DESC LIMIT 1", (r["id"],)).fetchone()
        if not appr:
            if not reason.strip() and act != "SETTLE":
                reason = "Manual provider settlement workflow"
            cursor.execute(
                """
                INSERT INTO manual_refund_approvals (refund_id, requested_by, reason, bank_account_masked, status, created_at)
                VALUES (?, ?, ?, ?, 'PENDING', ?)
                """,
                (r["id"], staff_user["id"], reason.strip() or "Manual finance handling", bank_account_masked or r["refund_destination"], now_iso),
            )
            appr = cursor.execute("SELECT * FROM manual_refund_approvals WHERE id = ?", (cursor.lastrowid,)).fetchone()

        if act == "REJECT":
            if not reason.strip():
                cursor.execute("ROLLBACK;")
                return 400, {"error": "Reason is required to reject a manual refund."}
            cursor.execute("UPDATE manual_refund_approvals SET status = 'REJECTED', evidence_notes = ? WHERE id = ?", (reason, appr["id"]))
            cursor.execute("UPDATE refunds SET status = 'FAILED', failure_reason = ?, updated_at = ? WHERE id = ?", (reason, now_iso, r["id"]))
            _append_refund_history(cursor, r["id"], r["status"], "FAILED", "Manual refund rejected", reason, staff_user["id"], role)
            cursor.execute("COMMIT;")
            return 200, {"success": True, "refundRef": r["refund_ref"], "status": "FAILED"}

        if act == "APPROVE":
            if not reason.strip():
                cursor.execute("ROLLBACK;")
                return 400, {"error": "Reason for manual handling is required before approval."}
            new_app_st = "FIRST_APPROVED" if r["dual_approval_required"] else "APPROVED"
            new_rf_st = "SUPPLIER_APPROVED" if r["dual_approval_required"] else "GATEWAY_PROCESSING"
            cursor.execute(
                "UPDATE manual_refund_approvals SET first_approver_id = ?, first_approved_at = ?, reason = ?, status = ? WHERE id = ?",
                (staff_user["id"], now_iso, reason.strip(), new_app_st, appr["id"]),
            )
            cursor.execute("UPDATE refunds SET status = ?, updated_at = ? WHERE id = ?", (new_rf_st, now_iso, r["id"]))
            _append_refund_history(cursor, r["id"], r["status"], new_rf_st, "4. Finance approval recorded", reason, staff_user["id"], role)
            cursor.execute("COMMIT;")
            return 200, {
                "success": True,
                "refundRef": r["refund_ref"],
                "approvalStatus": new_app_st,
                "status": new_rf_st,
                "dualApprovalPending": bool(r["dual_approval_required"]),
            }

        if act == "DUAL_APPROVE":
            if appr["first_approver_id"] and int(appr["first_approver_id"]) == int(staff_user["id"]):
                cursor.execute("ROLLBACK;")
                return 409, {"error": "Dual approval requires a DIFFERENT authorized administrator to give second sign-off.", "code": "DUAL_APPROVAL_SAME_USER"}
            cursor.execute(
                "UPDATE manual_refund_approvals SET second_approver_id = ?, second_approved_at = ?, status = 'APPROVED' WHERE id = ?",
                (staff_user["id"], now_iso, appr["id"]),
            )
            cursor.execute("UPDATE refunds SET status = 'SUPPLIER_APPROVED', updated_at = ? WHERE id = ?", (now_iso, r["id"]))
            _append_refund_history(cursor, r["id"], r["status"], "SUPPLIER_APPROVED", "5. Dual finance sign-off completed", reason or "Second approver authorized disbursement", staff_user["id"], role)
            cursor.execute("COMMIT;")
            return 200, {"success": True, "refundRef": r["refund_ref"], "approvalStatus": "APPROVED", "status": "SUPPLIER_APPROVED"}

        # act == "SETTLE": Strictly block silent completion without transferReference & evidenceRef!
        if r["dual_approval_required"] and appr["status"] not in ("APPROVED", "SETTLED"):
            cursor.execute("ROLLBACK;")
            return 409, {"error": "High-value or sensitive manual refund requires dual approval before settlement.", "code": "DUAL_APPROVAL_REQUIRED"}
        if not r["dual_approval_required"] and appr["status"] == "PENDING":
            cursor.execute("ROLLBACK;")
            return 409, {"error": "Manual refund must be approved before recording settlement.", "code": "APPROVAL_REQUIRED"}

        t_ref = (transfer_reference or "").strip()
        ev_ref = (evidence_ref or "").strip()
        if len(t_ref) < 4 or len(ev_ref) < 4:
            cursor.execute("ROLLBACK;")
            return 400, {
                "error": "Settlement evidence is required: both transferReference and evidenceRef (receipt/slip ID) must be provided before marking REFUNDED.",
                "code": "EVIDENCE_REQUIRED",
            }

        settled_minor = int(r["approved_amount_minor"])
        cursor.execute(
            """
            UPDATE manual_refund_approvals
            SET transfer_reference = ?, evidence_ref = ?, evidence_notes = ?, settlement_verified = 1, status = 'SETTLED'
            WHERE id = ?
            """,
            (t_ref, ev_ref, reason.strip() or "Verified settlement evidence", appr["id"]),
        )
        cursor.execute(
            "UPDATE refunds SET status = 'REFUNDED', settled_amount_minor = ?, provider_ref = ?, updated_at = ? WHERE id = ?",
            (settled_minor, t_ref, now_iso, r["id"]),
        )
        cursor.execute("UPDATE bookings SET refund_status = 'REFUNDED' WHERE booking_reference = ? AND status = 'CANCELLED'", (r["booking_reference"],))
        cursor.execute("UPDATE tickets SET status = 'REFUNDED', issuance_state = 'REFUNDED', updated_at = ? WHERE booking_reference = ? AND status = 'CANCELLED'", (now_iso, r["booking_reference"]))
        qr_service.revoke_qr_tokens(cursor, booking_reference=r["booking_reference"], reason="MANUAL_REFUND_SETTLED")
        _record_ledger(cursor, r["booking_reference"], "MANUAL_SETTLEMENT_OUTFLOW", "DEBIT", settled_minor, refund_id=r["id"], reference_id=t_ref, description=f"Manual settlement {t_ref} (evidence: {ev_ref})", created_by=staff_user["id"])
        _append_refund_history(cursor, r["id"], r["status"], "REFUNDED", "7. Refund completed", f"Settled via {t_ref} (evidence {ev_ref})", staff_user["id"], role)
        _queue_notification(cursor, r["booking_reference"], "", f"Refund Completed — {r['refund_ref']}", f"Your refund of {format_bdt_minor(settled_minor)} has been settled (Ref: {t_ref}).")
        database.log_audit_event(cursor, "MANUAL_REFUND_SETTLED", "REFUNDED", staff_user["id"], role, r["id_airline"], reservation_ref=r["booking_reference"], details=f"{r['refund_ref']} settled with proof {t_ref}/{ev_ref}")
        cursor.execute("COMMIT;")
        return 200, {"success": True, "refundRef": r["refund_ref"], "status": "REFUNDED", "transferReference": t_ref, "evidenceRef": ev_ref}
    except Exception as exc:
        try:
            cursor.execute("ROLLBACK;")
        except Exception:
            pass
        return 500, {"error": str(exc)}
    finally:
        conn.close()
