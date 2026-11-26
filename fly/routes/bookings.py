"""
FLY Bookings, Seat Locks, Payment Confirmation, PNR Lookup, Tickets, Saved Travelers & Refunds Blueprint
"""

import json
from datetime import datetime
from flask import Blueprint, request, jsonify, Response
import database
from fly.middleware.auth import check_rate_limit, get_current_user, require_auth, verify_booking_access
from fly.services.pdf_service import build_ticket_pdf, generate_qr_svg

bookings_bp = Blueprint("bookings", __name__)


def _compute_refund_amount(booking_row, dep_datetime_str: str) -> float:
    total = float(booking_row["total_amount"] or 0.0)
    if booking_row["status"] == "PENDING_PAYMENT":
        return 0.0
    dep_dt = database.parse_dt_utc(dep_datetime_str)
    if not dep_dt:
        return round(total * 0.75, 2)
    hours_left = (dep_dt - datetime.utcnow()).total_seconds() / 3600.0
    if hours_left >= 24:
        return round(total * 0.85, 2)
    if hours_left >= 6:
        return round(total * 0.50, 2)
    return 0.0


@bookings_bp.route("/api/bookings/validate", methods=["POST"])
def api_validate_booking():
    database.cleanup_expired_holds()
    data = request.get_json() or {}
    flight_ids = data.get("flightIds") or ([data["flightId"]] if data.get("flightId") else [])
    if not flight_ids:
        return jsonify({"valid": False, "error": "At least one flight must be selected."}), 400

    seat_ids = sorted({int(s["id"] if isinstance(s, dict) else s) for s in (data.get("seatIds") or [])})
    cabin = data.get("cabinClass") or "Economy"
    adults = int(data.get("adults") or 1)
    children = int(data.get("children") or 0)
    infants = int(data.get("infants") or 0)
    luggage_count = int(data.get("luggageCount") or 0)
    luggage_weight = float(data.get("luggageWeight") or 0.0)
    meal_fee = float(data.get("mealFee") or 0.0)
    insurance = bool(data.get("insurance", False))
    seat_upgrade_fee = float(data.get("seatUpgradeFee") or 0.0)
    promo_code = data.get("promoCode")
    expected_total = data.get("expectedTotal")
    passengers = data.get("passengerData") or data.get("passengers") or []

    if passengers and isinstance(passengers, list):
        for idx, p in enumerate(passengers):
            full_name = (p.get("fullName") or "").strip()
            fn = (p.get("firstName") or "").strip()
            ln = (p.get("lastName") or "").strip()
            if not full_name and not (fn and ln):
                return jsonify({"valid": False, "error": f"Passenger {idx + 1}: Full name is required.", "code": "INVALID_PASSENGER_DATA"}), 400

    conn = database.get_db()
    cursor = conn.cursor()
    for fid in flight_ids:
        frow = cursor.execute("SELECT id, status, COALESCE(is_active, 1) as is_active FROM flights WHERE id = ?", (int(fid),)).fetchone()
        if not frow or not frow["is_active"] or (frow["status"] or "").upper() == "CANCELLED":
            conn.close()
            return jsonify({"valid": False, "error": f"Flight #{fid} is not available.", "code": "FLIGHT_NOT_FOUND"}), 404

    if seat_ids:
        ph = ",".join("?" for _ in seat_ids)
        conflicts = cursor.execute(
            f"""
            SELECT id_seat, status, expires_at FROM reservations
            WHERE id_flight = ? AND id_seat IN ({ph}) AND status IN ('CONFIRMED', 'PENDING_PAYMENT', 'HELD', 'LOCKED')
            """,
            [int(flight_ids[0])] + seat_ids,
        ).fetchall()
        for c in conflicts:
            if c["status"] == "CONFIRMED" or not database.is_expired(c["expires_at"]):
                conn.close()
                return jsonify({"valid": False, "error": "One or more selected seats are already reserved or locked.", "code": "SEAT_UNAVAILABLE"}), 409
    conn.close()

    current_fare = database.calculate_fare_breakdown(
        flight_ids=flight_ids,
        cabin_class=cabin,
        adults=adults,
        children=children,
        infants=infants,
        luggage_count=luggage_count,
        luggage_weight=luggage_weight,
        meal_fee=meal_fee,
        insurance=insurance,
        seat_upgrade_fee=seat_upgrade_fee,
        promo_code=promo_code,
    )

    if expected_total is not None and float(expected_total) > 0:
        if abs(float(expected_total) - float(current_fare["totalPayable"])) > 2.0:
            return jsonify(
                {
                    "valid": False,
                    "priceChanged": True,
                    "error": f"Flight fare updated from ৳{int(expected_total):,} to ৳{int(current_fare['totalPayable']):,}. Please confirm updated pricing.",
                    "code": "FARE_CHANGED",
                    "currentFare": current_fare,
                }
            ), 200

    return jsonify({"valid": True, "message": "Availability and fare revalidated.", "currentFare": current_fare})


@bookings_bp.route("/api/bookings/hold", methods=["POST"])
@require_auth
def api_hold_seats():
    user = get_current_user()
    data = request.get_json() or {}
    flight_id = data.get("flightId")
    seat_ids = data.get("seatIds") or data.get("seats") or []

    if not flight_id:
        return jsonify({"error": "flightId is required."}), 400
    if not seat_ids or not isinstance(seat_ids, list):
        return jsonify({"error": "seatIds must be a non-empty list."}), 400

    int_seat_ids = []
    for s in seat_ids:
        try:
            int_seat_ids.append(int(s["id"] if isinstance(s, dict) else s))
        except (ValueError, TypeError):
            continue

    ret_seat_ids = []
    for rs in (data.get("returnSeatIds") or []):
        try:
            ret_seat_ids.append(int(rs["id"] if isinstance(rs, dict) else rs))
        except (ValueError, TypeError):
            continue

    try:
        nbr_luggages = max(0, int(data.get("nbrLuggages") or data.get("nbr_luggages") or 0))
        weight = max(0.0, float(data.get("weight") or 0.0))
        meal_fee = max(0.0, float(data.get("mealFee") or 0.0))
        seat_upgrade_fee = max(0.0, float(data.get("seatUpgradeFee") or 0.0))
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid baggage or add-on numeric values."}), 400

    pax_list = data.get("passengerData") or data.get("passengers") or []
    if not pax_list and (data.get("adults") or data.get("children") or data.get("infants")):
        try:
            a_cnt = max(1, int(data.get("adults") or 1))
            c_cnt = max(0, int(data.get("children") or 0))
            i_cnt = max(0, int(data.get("infants") or 0))
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid passenger category counts."}), 400
        if i_cnt > a_cnt:
            return jsonify({"error": "Each infant must be accompanied by an adult passenger.", "code": "INVALID_PASSENGERS"}), 400
        if len(int_seat_ids) != (a_cnt + c_cnt):
            return jsonify({"error": f"Selected seats ({len(int_seat_ids)}) must match Adults + Children ({a_cnt + c_cnt}).", "code": "SEAT_PAX_MISMATCH"}), 400
        pax_list = ([{"type": "adult"} for _ in range(a_cnt)] + [{"type": "child"} for _ in range(c_cnt)] + [{"type": "infant"} for _ in range(i_cnt)])

    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "local").split(",")[0].strip()
    success, msg, code, hold_info = database.hold_seats_atomic(
        flight_id=int(flight_id),
        seat_ids=int_seat_ids,
        account_id=user["id"],
        nbr_luggages=nbr_luggages,
        weight=weight,
        passenger_data=pax_list,
        return_flight_id=data.get("returnFlightId"),
        return_seat_ids=ret_seat_ids,
        multi_leg_data=data.get("multiLegData") or [],
        cabin_class=data.get("cabinClass") or "Economy",
        trip_type=data.get("tripType") or "one_way",
        expected_fare=data.get("expectedFare") or data.get("totalAmount"),
        meal_fee=meal_fee,
        insurance=bool(data.get("insurance", False)),
        seat_upgrade_fee=seat_upgrade_fee,
        promo_code=data.get("promoCode"),
        extras_data=data.get("extrasData"),
        contact_email=data.get("contactEmail"),
        contact_phone=data.get("contactPhone"),
        ip_address=ip,
    )

    if not success:
        status_code = 409 if code == "SEAT_UNAVAILABLE" else 400
        return jsonify({"error": msg, "code": code, "details": hold_info}), status_code

    return jsonify({"success": True, "status": "PENDING_PAYMENT", "message": msg, **hold_info}), 201


@bookings_bp.route("/api/bookings/<string:booking_ref>/extend-lock", methods=["POST"])
@require_auth
def api_extend_lock(booking_ref):
    user = get_current_user()
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "local").split(",")[0].strip()
    ok, msg, code, info = database.extend_lock_atomic(booking_ref.strip(), user["id"], ip_address=ip)
    if not ok:
        status_code = 403 if code == "FORBIDDEN" else (410 if code == "RESERVATION_EXPIRED" else 400)
        return jsonify({"error": msg, "code": code}), status_code
    return jsonify({"success": True, "message": msg, **info})


@bookings_bp.route("/api/bookings/<string:booking_ref>", methods=["GET"])
@require_auth
def api_get_booking(booking_ref):
    database.cleanup_expired_holds()
    user = get_current_user()
    conn = database.get_db()
    booking = conn.execute(
        """
        SELECT b.*,
               a.username, a.emailAddress, a.display_name,
               f.id as flightId, f.flight_number, f.aircraft_model, f.dep_datetime, f.arr_datetime, f.id_airline,
               al.id as airlineId, al.name as airlineName, al.IATA as airlineIATA,
               da.name as depAirportName, da.IATA as depIATA, da.city as depCity, da.country as depCountry,
               aa.name as arrAirportName, aa.IATA as arrIATA, aa.city as arrCity, aa.country as arrCountry
        FROM bookings b
        JOIN accounts a ON b.id_account = a.id
        JOIN flights f ON b.id_flight = f.id
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE b.booking_reference = ? OR UPPER(b.pnr_code) = UPPER(?)
        """,
        (booking_ref.strip(), booking_ref.strip()),
    ).fetchone()

    if not booking:
        conn.close()
        return jsonify({"error": "Booking not found."}), 404

    allowed, err_msg = verify_booking_access(booking, user)
    if not allowed:
        conn.close()
        return jsonify({"error": err_msg, "code": "FORBIDDEN"}), 403

    seats = conn.execute(
        """
        SELECT s.id, s.column, s.row, s.type
        FROM reservations r
        JOIN seats s ON r.id_seat = s.id
        WHERE r.booking_reference = ?
        """,
        (booking["booking_reference"],),
    ).fetchall()
    conn.close()

    b_dict = dict(booking)
    b_dict["seats"] = [dict(s) for s in seats]
    b_dict["seatCodes"] = [f"{s['column']}{s['row']}" for s in seats]
    b_dict["seatNumbers"] = ", ".join(b_dict["seatCodes"])

    expires_dt = database.parse_dt_utc(b_dict.get("expires_at"))
    b_dict["secondsRemaining"] = max(0, int((expires_dt - datetime.utcnow()).total_seconds())) if expires_dt else 0

    for json_col, out_key in [("passenger_data", "passengerData"), ("fare_breakdown", "fareBreakdown"), ("extras_data", "extrasData")]:
        if b_dict.get(json_col):
            try:
                b_dict[out_key] = json.loads(b_dict[json_col])
            except Exception:
                b_dict[out_key] = None

    return jsonify(b_dict)


@bookings_bp.route("/api/bookings/<string:booking_ref>/details", methods=["PUT"])
@require_auth
def api_update_booking_details(booking_ref):
    """Updates passengers, contact details, extras & promo code on a held PENDING_PAYMENT booking."""
    user = get_current_user()
    data = request.get_json() or {}
    ref = booking_ref.strip()

    passengers = data.get("passengerData") or data.get("passengers") or []
    if passengers and isinstance(passengers, list):
        for idx, p in enumerate(passengers):
            full_name = (p.get("fullName") or "").strip()
            fn = (p.get("firstName") or "").strip()
            ln = (p.get("lastName") or "").strip()
            if not full_name and not (fn and ln):
                return jsonify({"error": f"Passenger {idx + 1}: first and last name required."}), 400

    conn = database.get_db(isolation_level=None)
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN IMMEDIATE;")
        booking = cursor.execute("SELECT * FROM bookings WHERE booking_reference = ?", (ref,)).fetchone()
        if not booking:
            cursor.execute("ROLLBACK;")
            return jsonify({"error": "Booking not found."}), 404
        if booking["id_account"] != user["id"] and user["role"] not in ("SYSTEM_ADMIN", "SUPER_ADMIN"):
            cursor.execute("ROLLBACK;")
            return jsonify({"error": "Forbidden.", "code": "FORBIDDEN"}), 403
        if booking["status"] != "PENDING_PAYMENT" or database.is_expired(booking["expires_at"]):
            cursor.execute("ROLLBACK;")
            return jsonify({"error": "Seat lock has expired. Please select seats again.", "code": "RESERVATION_EXPIRED"}), 410

        seat_rows = cursor.execute(
            """
            SELECT s.id, s.column, s.row FROM reservations r
            JOIN seats s ON r.id_seat = s.id
            WHERE r.booking_reference = ? AND r.id_flight = ?
            """,
            (ref, booking["id_flight"]),
        ).fetchall()

        seat_upgrade_fee = 0.0
        if booking["fare_breakdown"]:
            try:
                old_fb = json.loads(booking["fare_breakdown"])
                seat_upgrade_fee = float(old_fb.get("seatUpgradeFee") or 0.0)
            except Exception:
                seat_upgrade_fee = 0.0

        nbr_luggages = int(data.get("nbrLuggages") if data.get("nbrLuggages") is not None else (booking["nbr_luggages"] or 0))
        weight = float(data.get("weight") if data.get("weight") is not None else (booking["weight"] or 0.0))
        meal_fee = float(data.get("mealFee") or 0.0)
        insurance = bool(data.get("insurance", False))
        promo_code = (data.get("promoCode") or "").strip() or None
        contact_email = (data.get("contactEmail") or booking["contact_email"] or user.get("email") or "").strip()
        contact_phone = (data.get("contactPhone") or booking["contact_phone"] or "").strip()
        extras_data = data.get("extrasData") if data.get("extrasData") is not None else {
            "extraBaggageKg": weight,
            "mealFee": meal_fee,
            "insurance": insurance,
        }

        all_fids = [int(booking["id_flight"])]
        if booking["return_flight_id"]:
            all_fids.append(int(booking["return_flight_id"]))

        adults_count, children_count, infants_count = 0, 0, 0
        if passengers and isinstance(passengers, list):
            for p in passengers:
                pt = str(p.get("type") or p.get("passengerType") or "adult").lower()
                if "infant" in pt:
                    infants_count += 1
                elif "child" in pt:
                    children_count += 1
                else:
                    adults_count += 1
        if adults_count == 0:
            adults_count = max(1, len(seat_rows) or 1)
        if infants_count > adults_count:
            cursor.execute("ROLLBACK;")
            return jsonify({"error": "Each infant must be accompanied by an adult passenger.", "code": "INVALID_PASSENGERS"}), 400

        fare_breakdown = database.calculate_fare_breakdown(
            flight_ids=all_fids,
            cabin_class=booking["cabin_class"] or "Economy",
            adults=adults_count,
            children=children_count,
            infants=infants_count,
            luggage_count=nbr_luggages,
            luggage_weight=weight,
            meal_fee=meal_fee,
            insurance=insurance,
            seat_upgrade_fee=seat_upgrade_fee,
            promo_code=promo_code,
        )
        total_fare = float(fare_breakdown["totalPayable"])
        discount_amt = float(fare_breakdown.get("discount") or 0.0)

        cursor.execute(
            """
            UPDATE bookings
            SET passenger_data = ?, nbr_luggages = ?, weight = ?, extras_data = ?,
                promo_code = ?, discount_amount = ?, fare_breakdown = ?, total_amount = ?,
                contact_email = ?, contact_phone = ?
            WHERE booking_reference = ?
            """,
            (
                json.dumps(passengers) if passengers else booking["passenger_data"],
                nbr_luggages,
                weight,
                json.dumps(extras_data),
                promo_code.upper() if promo_code and discount_amt > 0 else None,
                discount_amt,
                json.dumps(fare_breakdown),
                total_fare,
                contact_email,
                contact_phone,
                ref,
            ),
        )
        cursor.execute("COMMIT;")
        return jsonify({
            "success": True,
            "bookingReference": ref,
            "totalAmount": total_fare,
            "discountAmount": discount_amt,
            "promoCode": promo_code.upper() if promo_code and discount_amt > 0 else None,
            "fareBreakdown": fare_breakdown,
        })
    except Exception:
        try:
            cursor.execute("ROLLBACK;")
        except Exception:
            pass
        return jsonify({"error": "Failed to update checkout details due to a server error."}), 500
    finally:
        conn.close()


@bookings_bp.route("/api/bookings/confirm", methods=["POST"])
@require_auth
def api_confirm_payment():
    user = get_current_user()
    data = request.get_json() or {}
    booking_ref = (data.get("bookingReference") or "").strip()
    payment_method = (data.get("paymentMethod") or "SIMULATED_CARD").strip()
    transaction_ref = data.get("transactionRef")
    idempotency_key = (data.get("idempotencyKey") or request.headers.get("Idempotency-Key") or "").strip()
    scenario = (data.get("scenario") or "SIMULATE_SUCCESS").strip().upper()

    if not booking_ref:
        return jsonify({"error": "bookingReference is required."}), 400

    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "local").split(",")[0].strip()
    success, msg, code, result_data = database.confirm_payment_atomic(
        booking_ref=booking_ref,
        account_id=user["id"],
        payment_method=payment_method,
        transaction_ref=transaction_ref,
        idempotency_key=idempotency_key or None,
        scenario=scenario,
        ip_address=ip,
    )

    if not success:
        status_code = 410 if code in ("RESERVATION_EXPIRED", "PAYMENT_TIMEOUT") else (403 if code == "FORBIDDEN" else (409 if code in ("CONFLICT", "DUPLICATE_PAYMENT_ATTEMPT") else 400))
        return jsonify({"error": msg, "code": code}), status_code

    return jsonify({"success": True, "status": "CONFIRMED", "message": msg, **result_data})


@bookings_bp.route("/api/bookings/cancel", methods=["POST"])
@require_auth
def api_cancel_booking():
    user = get_current_user()
    data = request.get_json() or {}
    booking_ref = (data.get("bookingReference") or "").strip()
    reason = (data.get("reason") or "Passenger requested cancellation").strip()
    if not booking_ref:
        return jsonify({"error": "bookingReference is required."}), 400

    conn = database.get_db(isolation_level=None)
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN IMMEDIATE;")
        booking = cursor.execute(
            """
            SELECT b.*, f.id_airline, f.dep_datetime
            FROM bookings b
            JOIN flights f ON b.id_flight = f.id
            WHERE b.booking_reference = ? OR UPPER(b.pnr_code) = UPPER(?)
            """,
            (booking_ref, booking_ref),
        ).fetchone()

        if not booking:
            cursor.execute("ROLLBACK;")
            return jsonify({"error": "Booking not found."}), 404

        allowed, err_msg = verify_booking_access(booking, user)
        if not allowed:
            cursor.execute("ROLLBACK;")
            return jsonify({"error": err_msg, "code": "FORBIDDEN"}), 403

        if booking["status"] in ("CANCELLED", "EXPIRED", "REFUNDED"):
            cursor.execute("ROLLBACK;")
            return jsonify({"error": f"Booking is already {booking['status']}."}), 400

        ref = booking["booking_reference"]
        now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        refund_amt = _compute_refund_amount(booking, booking["dep_datetime"])
        refund_stat = "REFUNDED" if refund_amt > 0 else "NO_REFUND"

        cursor.execute(
            """
            UPDATE bookings
            SET status = 'CANCELLED', cancelled_at = ?, cancellation_reason = ?, refund_amount = ?, refund_status = ?
            WHERE booking_reference = ?
            """,
            (now_iso, reason, refund_amt, refund_stat if booking["status"] == "CONFIRMED" else None, ref),
        )
        cursor.execute("UPDATE reservations SET status = 'CANCELLED' WHERE booking_reference = ?", (ref,))
        cursor.execute("UPDATE tickets SET status = 'CANCELLED' WHERE booking_reference = ?", (ref,))

        if booking["status"] == "CONFIRMED" and refund_amt > 0:
            cursor.execute(
                """
                INSERT INTO refund_requests (booking_reference, id_account, id_airline, reason, requested_amount, approved_amount, status, reviewed_by, review_note, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'APPROVED', ?, 'Auto-calculated cancellation refund policy', ?, ?)
                """,
                (ref, booking["id_account"], booking["id_airline"], reason, refund_amt, refund_amt, user["id"], now_iso, now_iso),
            )

        database.log_audit_event(
            cursor,
            event_type="BOOKING_CANCELLED",
            result="CANCELLED",
            actor_id=user["id"],
            actor_role=user["role"],
            airline_id=booking["id_airline"],
            flight_id=booking["id_flight"],
            reservation_ref=ref,
            details=f"Booking cancelled ({reason}). Refund: ৳{refund_amt:.0f}",
        )
        cursor.execute("COMMIT;")
        return jsonify({
            "success": True,
            "message": "Reservation cancelled and seats released.",
            "refundAmount": refund_amt,
            "refundStatus": refund_stat if booking["status"] == "CONFIRMED" else "HOLD_RELEASED",
        })
    except Exception:
        try:
            cursor.execute("ROLLBACK;")
        except Exception:
            pass
        return jsonify({"error": "Cancellation failed due to a server error."}), 500
    finally:
        conn.close()


@bookings_bp.route("/api/bookings/<string:booking_ref>/refund-request", methods=["POST"])
@require_auth
def api_request_refund(booking_ref):
    user = get_current_user()
    data = request.get_json() or {}
    reason = (data.get("reason") or "Schedule change / passenger cancellation").strip()

    conn = database.get_db()
    cursor = conn.cursor()
    booking = cursor.execute(
        """
        SELECT b.*, f.id_airline, f.dep_datetime
        FROM bookings b
        JOIN flights f ON b.id_flight = f.id
        WHERE b.booking_reference = ? OR UPPER(b.pnr_code) = UPPER(?)
        """,
        (booking_ref.strip(), booking_ref.strip()),
    ).fetchone()

    if not booking:
        conn.close()
        return jsonify({"error": "Booking not found."}), 404
    if booking["id_account"] != user["id"]:
        conn.close()
        return jsonify({"error": "Forbidden."}), 403
    if booking["status"] != "CONFIRMED":
        conn.close()
        return jsonify({"error": "Only confirmed bookings can submit a refund request."}), 400

    existing = cursor.execute(
        "SELECT id FROM refund_requests WHERE booking_reference = ? AND status = 'PENDING'",
        (booking["booking_reference"],),
    ).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "A pending refund request already exists for this booking."}), 409

    eligible_amt = _compute_refund_amount(booking, booking["dep_datetime"])
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute(
        """
        INSERT INTO refund_requests (booking_reference, id_account, id_airline, reason, requested_amount, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)
        """,
        (booking["booking_reference"], user["id"], booking["id_airline"], reason, eligible_amt, now_iso, now_iso),
    )
    cursor.execute(
        "UPDATE bookings SET refund_status = 'PENDING', refund_amount = ? WHERE booking_reference = ?",
        (eligible_amt, booking["booking_reference"]),
    )
    database.log_audit_event(
        cursor,
        event_type="REFUND_REQUESTED",
        result="PENDING",
        actor_id=user["id"],
        actor_role=user["role"],
        airline_id=booking["id_airline"],
        flight_id=booking["id_flight"],
        reservation_ref=booking["booking_reference"],
        details=f"Requested refund ৳{eligible_amt:.0f}: {reason}",
    )
    conn.commit()
    req_id = cursor.lastrowid
    conn.close()
    return jsonify({"success": True, "requestId": req_id, "requestedAmount": eligible_amt, "status": "PENDING"}), 201


@bookings_bp.route("/api/bookings/lookup", methods=["POST"])
def api_lookup_booking():
    """Public guest PNR / Reference lookup requiring matching booking email or surname."""
    if not check_rate_limit("pnr_lookup", limit=25, window_seconds=300):
        return jsonify({"error": "Too many lookup attempts. Please wait a few minutes."}), 429

    database.cleanup_expired_holds()
    data = request.get_json() or {}
    ref_or_pnr = (data.get("reference") or data.get("pnr") or "").strip()
    verifier = (data.get("verifier") or data.get("email") or data.get("lastName") or "").strip().lower()

    if not ref_or_pnr or not verifier:
        return jsonify({"error": "Both PNR/Booking Reference and booking email or last name are required."}), 400

    ticket = database.get_ticket_data(ref_or_pnr)
    if not ticket:
        return jsonify({"error": "No matching reservation found. Please verify your PNR and email/surname."}), 404

    contact_email = (ticket.get("contactEmail") or "").strip().lower()
    pax_names = [n.lower() for n in (ticket.get("passengerNames") or [])]
    matched = (verifier == contact_email) or any(verifier in nm.split() or verifier == nm for nm in pax_names)
    if not matched:
        return jsonify({"error": "No matching reservation found. Please verify your PNR and email/surname."}), 404

    # Return sanitized view (do not leak passport numbers or raw payment methods)
    return jsonify(
        {
            "success": True,
            "booking": {
                "bookingReference": ticket["bookingReference"],
                "pnrCode": ticket["pnrCode"],
                "ticketNumber": ticket["ticketNumber"],
                "verificationToken": ticket["verificationToken"],
                "status": ticket["status"],
                "paymentStatus": ticket["paymentStatus"],
                "airlineName": ticket["airlineName"],
                "airlineIATA": ticket["airlineIATA"],
                "flightNumber": ticket["flightNumber"],
                "depCity": ticket["depCity"],
                "depIATA": ticket["depIATA"],
                "arrCity": ticket["arrCity"],
                "arrIATA": ticket["arrIATA"],
                "depDateTime": ticket["depDateTime"],
                "arrDateTime": ticket["arrDateTime"],
                "seatNumbers": ticket["seatNumbers"],
                "seatClass": ticket["seatClass"],
                "baggageAllowance": ticket["baggageAllowance"],
                "passengerName": ticket["passengerName"],
                "totalAmount": ticket["totalAmount"],
            },
        }
    )


@bookings_bp.route("/api/reservations/my", methods=["GET"])
@require_auth
def api_my_reservations():
    database.cleanup_expired_holds()
    user = get_current_user()
    conn = database.get_db()
    rows = conn.execute(
        """
        SELECT b.id as bookingId, b.booking_reference as bookingReference, b.pnr_code as pnrCode,
               b.status, b.total_amount, b.discount_amount, b.promo_code, b.cabin_class,
               b.nbr_luggages, b.weight, b.created_at, b.expires_at, b.paid_at,
               b.cancelled_at, b.refund_amount, b.refund_status, b.passenger_data, b.return_flight_id, b.trip_type,
               f.id as flightId, f.flight_number, f.dep_datetime, f.arr_datetime,
               al.id as airlineId, al.name as airlineName, al.IATA as airlineIATA,
               da.name as depAirportName, da.IATA as depIATA, da.city as depCity, da.country as depCountry,
               aa.name as arrAirportName, aa.IATA as arrIATA, aa.city as arrCity, aa.country as arrCountry,
               (SELECT ticket_number FROM tickets t WHERE t.booking_reference = b.booking_reference LIMIT 1) as ticketNumber,
               (SELECT verification_token FROM tickets t WHERE t.booking_reference = b.booking_reference LIMIT 1) as verificationToken,
               (SELECT GROUP_CONCAT(s.column || s.row, ', ')
                FROM reservations r JOIN seats s ON r.id_seat = s.id
                WHERE r.booking_reference = b.booking_reference AND r.id_flight = b.id_flight) as seatNumbers
        FROM bookings b
        JOIN flights f ON b.id_flight = f.id
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE b.id_account = ?
        ORDER BY b.created_at DESC
        """,
        (user["id"],),
    ).fetchall()
    conn.close()

    now_dt = datetime.utcnow()
    bookings_list = []
    for r in rows:
        d = dict(r)
        if d["status"] == "PENDING_PAYMENT" and d["expires_at"]:
            exp_dt = database.parse_dt_utc(d["expires_at"])
            d["secondsRemaining"] = max(0, int((exp_dt - now_dt).total_seconds())) if exp_dt else 0
        else:
            d["secondsRemaining"] = 0
        bookings_list.append(d)
    return jsonify(bookings_list)


@bookings_bp.route("/api/reservations/ticket/<string:ticket_id>", methods=["GET"])
@require_auth
def api_get_ticket(ticket_id):
    user = get_current_user()
    ticket = database.get_ticket_data(ticket_id.strip())
    if not ticket:
        return jsonify({"error": "Ticket not found."}), 404

    allowed, err_msg = verify_booking_access(ticket, user)
    if not allowed:
        return jsonify({"error": err_msg, "code": "FORBIDDEN"}), 403

    vtok = ticket.get("verificationToken") or ticket.get("pnrCode") or ticket["bookingReference"]
    ticket["qrSvg"] = generate_qr_svg(f"/ticket/verify/{vtok}", size=124)
    return jsonify(ticket)


@bookings_bp.route("/api/tickets/<string:pnr_or_ref>/pdf", methods=["GET"])
def api_download_ticket_pdf(pnr_or_ref):
    user = get_current_user()
    vtoken = (request.args.get("vtoken") or "").strip()
    ticket = database.get_ticket_data(pnr_or_ref.strip())
    if not ticket:
        return jsonify({"error": "Ticket not found."}), 404

    if vtoken and ticket.get("verificationToken") == vtoken:
        pass
    elif user:
        allowed, err_msg = verify_booking_access(ticket, user)
        if not allowed:
            return jsonify({"error": err_msg}), 403
    else:
        return jsonify({"error": "Authentication or valid verification token required."}), 401

    pdf_bytes = build_ticket_pdf(ticket)
    filename = f"FLY-Ticket-{ticket.get('pnrCode') or ticket['bookingReference']}.pdf"
    return Response(
        pdf_bytes,
        mimetype="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@bookings_bp.route("/api/tickets/verify/<string:token>", methods=["GET"])
def api_verify_ticket_token(token):
    conn = database.get_db()
    row = conn.execute(
        """
        SELECT t.ticket_number, t.pnr_code, t.status, t.cabin_class, t.seat_codes, t.baggage_allowance, t.issued_at,
               al.name as airlineName, al.IATA as airlineIATA,
               f.flight_number, f.dep_datetime, f.arr_datetime,
               da.IATA as depIATA, da.city as depCity, aa.IATA as arrIATA, aa.city as arrCity
        FROM tickets t
        JOIN airLines al ON t.id_airline = al.id
        JOIN flights f ON t.id_flight = f.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE t.verification_token = ? OR UPPER(t.pnr_code) = UPPER(?)
        """,
        (token.strip(), token.strip()),
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({"valid": False, "error": "Verification reference not found."}), 404
    return jsonify({"valid": True, **dict(row)})


# -------------------------------------------------------------
# SAVED TRAVELERS, MASKED CARDS & FAVORITES
# -------------------------------------------------------------
@bookings_bp.route("/api/travelers", methods=["GET", "POST"])
@bookings_bp.route("/api/travelers/<int:traveler_id>", methods=["DELETE"])
@require_auth
def api_saved_travelers(traveler_id=None):
    user = get_current_user()
    conn = database.get_db()
    cursor = conn.cursor()

    if request.method == "GET":
        rows = cursor.execute("SELECT * FROM saved_travelers WHERE id_account = ? ORDER BY id DESC", (user["id"],)).fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])

    if request.method == "DELETE":
        cursor.execute("DELETE FROM saved_travelers WHERE id = ? AND id_account = ?", (traveler_id, user["id"]))
        conn.commit()
        conn.close()
        return jsonify({"success": True})

    data = request.get_json() or {}
    fn = (data.get("firstName") or "").strip()
    ln = (data.get("lastName") or "").strip()
    if not fn or not ln:
        conn.close()
        return jsonify({"error": "First name and last name are required."}), 400

    raw_doc = (data.get("documentNumber") or "").strip()
    masked_doc = f"****{raw_doc[-4:]}" if len(raw_doc) >= 4 else raw_doc
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute(
        """
        INSERT INTO saved_travelers (id_account, title, first_name, last_name, date_of_birth, gender, nationality, document_type, document_number_masked, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user["id"],
            (data.get("title") or "MR").strip(),
            fn,
            ln,
            data.get("dob") or data.get("dateOfBirth"),
            data.get("gender"),
            data.get("nationality") or "BD",
            data.get("idType") or "passport",
            masked_doc,
            now_iso,
        ),
    )
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return jsonify({"success": True, "id": new_id}), 201


@bookings_bp.route("/api/cards", methods=["GET", "POST"])
@require_auth
def api_cards():
    user = get_current_user()
    conn = database.get_db()
    cursor = conn.cursor()

    if request.method == "GET":
        rows = cursor.execute("SELECT id, card_holder, card_brand, last4, exp_month, exp_year FROM saved_cards WHERE id_account = ?", (user["id"],)).fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])

    data = request.get_json() or {}
    card_num = "".join(ch for ch in str(data.get("cardNumber") or "") if ch.isdigit())
    holder = (data.get("cardHolder") or "").strip()
    exp = (data.get("expirationDate") or "").strip()
    if len(card_num) < 4 or not holder or "/" not in exp:
        conn.close()
        return jsonify({"error": "Valid cardholder, last4/card digits, and MM/YY expiry required."}), 400

    last4 = card_num[-4:]
    brand = "VISA" if card_num.startswith("4") else ("MASTERCARD" if card_num.startswith("5") else "CARD")
    mm, yy = [x.strip() for x in exp.split("/", 1)]
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute(
        "INSERT INTO saved_cards (id_account, card_holder, card_brand, last4, exp_month, exp_year, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user["id"], holder, brand, last4, mm, yy, now_iso),
    )
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return jsonify({"success": True, "id": new_id, "last4": last4, "brand": brand}), 201


@bookings_bp.route("/api/favorites", methods=["GET"])
@bookings_bp.route("/api/favorites/<int:flight_id>", methods=["POST", "DELETE"])
@require_auth
def api_favorites(flight_id=None):
    user = get_current_user()
    conn = database.get_db()
    cursor = conn.cursor()
    if request.method == "GET":
        rows = cursor.execute(
            """
            SELECT f.*, al.name as airlineName, al.IATA as airlineIATA,
                   da.city as depCity, da.IATA as depIATA, aa.city as arrCity, aa.IATA as arrIATA
            FROM favorites fav
            JOIN flights f ON fav.id_flight = f.id
            JOIN airLines al ON f.id_airline = al.id
            JOIN airports da ON f.dep_airport = da.id
            JOIN airports aa ON f.arr_airport = aa.id
            WHERE fav.id_account = ?
            """,
            (user["id"],),
        ).fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])

    if request.method == "POST" and flight_id:
        cursor.execute("INSERT OR IGNORE INTO favorites (id_account, id_flight) VALUES (?, ?)", (user["id"], flight_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True})

    if request.method == "DELETE" and flight_id:
        cursor.execute("DELETE FROM favorites WHERE id_account = ? AND id_flight = ?", (user["id"], flight_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True})

    conn.close()
    return jsonify({"error": "Invalid favorite request"}), 400
