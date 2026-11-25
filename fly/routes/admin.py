"""
FLY Airline & System Administration API Blueprint
Strictly enforces RBAC (AIRLINE_ADMIN / SYSTEM_ADMIN) and airline-level tenant isolation.
"""

from datetime import datetime
from flask import Blueprint, request, jsonify
import database
from fly.middleware.auth import get_current_user, require_roles

admin_bp = Blueprint("admin", __name__)


def _resolve_airline_scope(user):
    """
    Returns (allowed_airline_id, error_response).
    For AIRLINE_ADMIN: strictly bound to user['airlineId']; client airlineId override rejected with 403.
    For SYSTEM_ADMIN / SUPER_ADMIN: None (global) or validated query airlineId.
    """
    role = (user.get("role") or "").upper()
    req_airline = request.args.get("airlineId")
    if role == "AIRLINE_ADMIN":
        if req_airline and str(req_airline).isdigit() and int(req_airline) != int(user.get("airlineId") or -1):
            return None, (jsonify({"error": "Forbidden: Airline admin cannot access another airline's records.", "code": "FORBIDDEN"}), 403)
        return int(user["airlineId"]), None
    if req_airline and str(req_airline).isdigit():
        return int(req_airline), None
    return None, None


@admin_bp.route("/api/admin/dashboard", methods=["GET"])
@admin_bp.route("/api/airline/stats", methods=["GET"])
@require_roles("AIRLINE_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN")
def api_admin_dashboard():
    database.cleanup_expired_holds()
    user = get_current_user()
    airline_scope, err = _resolve_airline_scope(user)
    if err:
        return err

    conn = database.get_db()
    cursor = conn.cursor()

    flight_where = "COALESCE(f.is_active, 1) = 1" + (" AND f.id_airline = ?" if airline_scope else "")
    f_params = (airline_scope,) if airline_scope else ()

    total_flights = cursor.execute(f"SELECT COUNT(*) FROM flights f WHERE {flight_where}", f_params).fetchone()[0]

    b_row = cursor.execute(
        f"""
        SELECT COUNT(*) as totalBookings,
               SUM(CASE WHEN b.status = 'CONFIRMED' THEN 1 ELSE 0 END) as confirmedBookings,
               SUM(CASE WHEN b.status = 'CANCELLED' OR b.status = 'REFUNDED' THEN 1 ELSE 0 END) as cancelledBookings,
               SUM(CASE WHEN b.status = 'PENDING_PAYMENT' THEN 1 ELSE 0 END) as activeLocks,
               COALESCE(SUM(CASE WHEN b.status = 'CONFIRMED' THEN b.total_amount ELSE 0 END), 0) as totalRevenue
        FROM bookings b
        JOIN flights f ON b.id_flight = f.id
        WHERE 1=1 {"AND f.id_airline = ?" if airline_scope else ""}
        """,
        f_params,
    ).fetchone()

    seat_booked_row = cursor.execute(
        f"""
        SELECT COUNT(*) as occupiedSeats
        FROM reservations r
        JOIN flights f ON r.id_flight = f.id
        WHERE r.status IN ('CONFIRMED', 'PENDING_PAYMENT', 'HELD', 'LOCKED')
          {"AND f.id_airline = ?" if airline_scope else ""}
        """,
        f_params,
    ).fetchone()

    total_capacity = max(1, total_flights * 120)
    occupancy_pct = round((float(seat_booked_row["occupiedSeats"] or 0) / total_capacity) * 100.0, 2)

    recent_flights = [
        dict(r)
        for r in cursor.execute(
            f"""
            SELECT f.id, COALESCE(f.flight_number, al.IATA || '-' || (100 + (f.id % 900))) as flightNumber,
                   f.dep_datetime, f.arr_datetime, f.status, f.economy_price,
                   al.name as airlineName, al.IATA as airlineIATA,
                   da.IATA as depIATA, aa.IATA as arrIATA,
                   (SELECT COUNT(*) FROM reservations r WHERE r.id_flight = f.id AND r.status = 'CONFIRMED') as bookedSeats
            FROM flights f
            JOIN airLines al ON f.id_airline = al.id
            JOIN airports da ON f.dep_airport = da.id
            JOIN airports aa ON f.arr_airport = aa.id
            WHERE {flight_where}
            ORDER BY f.dep_datetime DESC
            LIMIT 8
            """,
            f_params,
        ).fetchall()
    ]
    conn.close()

    return jsonify(
        {
            "airlineId": airline_scope,
            "role": user["role"],
            "totalFlights": total_flights,
            "totalBookings": int(b_row["totalBookings"] or 0),
            "confirmedBookings": int(b_row["confirmedBookings"] or 0),
            "cancelledBookings": int(b_row["cancelledBookings"] or 0),
            "activeLocks": int(b_row["activeLocks"] or 0),
            "totalRevenue": float(b_row["totalRevenue"] or 0),
            "seatOccupancyPct": occupancy_pct,
            "occupiedSeats": int(seat_booked_row["occupiedSeats"] or 0),
            "recentFlights": recent_flights,
        }
    )


@admin_bp.route("/api/airline/flights", methods=["GET", "POST"])
@require_roles("AIRLINE_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN")
def api_airline_flights():
    database.cleanup_expired_holds()
    user = get_current_user()
    airline_scope, err = _resolve_airline_scope(user)
    if err:
        return err

    conn = database.get_db()
    cursor = conn.cursor()

    if request.method == "GET":
        where = "COALESCE(f.is_active, 1) = 1" + (" AND f.id_airline = ?" if airline_scope else "")
        params = (airline_scope,) if airline_scope else ()
        rows = cursor.execute(
            f"""
            SELECT f.*, al.name as airlineName, al.IATA as airlineIATA,
                   da.city as depCity, da.IATA as depIATA, aa.city as arrCity, aa.IATA as arrIATA,
                   (SELECT COUNT(*) FROM reservations r WHERE r.id_flight = f.id AND r.status = 'CONFIRMED') as bookedCount,
                   (SELECT COUNT(*) FROM reservations r WHERE r.id_flight = f.id AND r.status IN ('PENDING_PAYMENT','HELD','LOCKED')) as lockedCount
            FROM flights f
            JOIN airLines al ON f.id_airline = al.id
            JOIN airports da ON f.dep_airport = da.id
            JOIN airports aa ON f.arr_airport = aa.id
            WHERE {where}
            ORDER BY f.dep_datetime DESC
            LIMIT 100
            """,
            params,
        ).fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])

    # POST -> Create new flight strictly inside authorized airline
    data = request.get_json() or {}
    target_airline = airline_scope if airline_scope else data.get("airlineId")
    if not target_airline:
        conn.close()
        return jsonify({"error": "airlineId is required."}), 400
    if airline_scope and data.get("airlineId") and int(data.get("airlineId")) != airline_scope:
        conn.close()
        return jsonify({"error": "Forbidden: Cannot create flight for another airline."}), 403

    dep_iata = (data.get("depIATA") or "").strip().upper()
    arr_iata = (data.get("arrIATA") or "").strip().upper()
    dep_dt = (data.get("depDateTime") or "").strip().replace("T", " ")
    arr_dt = (data.get("arrDateTime") or "").strip().replace("T", " ")
    flight_num = (data.get("flightNumber") or "").strip().upper()
    aircraft = (data.get("aircraftModel") or "Boeing 737-800").strip()
    try:
        econ = float(data.get("economyPrice") or 0)
        bus = float(data.get("businessPrice") or round(econ * 2.1))
        first = float(data.get("firstPrice") or round(econ * 3.2))
    except (ValueError, TypeError):
        conn.close()
        return jsonify({"error": "Invalid numeric fare amount."}), 400

    if not dep_iata or not arr_iata or dep_iata == arr_iata:
        conn.close()
        return jsonify({"error": "Distinct departure and arrival IATA codes are required."}), 400
    if not dep_dt or not arr_dt or econ <= 0 or bus < 0 or first < 0:
        conn.close()
        return jsonify({"error": "Valid departure/arrival times and positive economy price required."}), 400
    dep_parsed = database.parse_dt_utc(dep_dt)
    arr_parsed = database.parse_dt_utc(arr_dt)
    if not dep_parsed or not arr_parsed or arr_parsed <= dep_parsed:
        conn.close()
        return jsonify({"error": "Arrival timestamp must be strictly after departure timestamp."}), 400
    dep_dt = dep_parsed.strftime("%Y-%m-%d %H:%M")
    arr_dt = arr_parsed.strftime("%Y-%m-%d %H:%M")

    dep_ap = cursor.execute("SELECT id FROM airports WHERE UPPER(IATA) = ?", (dep_iata,)).fetchone()
    arr_ap = cursor.execute("SELECT id FROM airports WHERE UPPER(IATA) = ?", (arr_iata,)).fetchone()
    if not dep_ap or not arr_ap:
        conn.close()
        return jsonify({"error": "Unknown departure or arrival IATA code."}), 400

    al_row = cursor.execute("SELECT IATA FROM airLines WHERE id = ?", (int(target_airline),)).fetchone()
    if not flight_num and al_row:
        flight_num = f"{al_row['IATA']}-{int(datetime.utcnow().timestamp()) % 900 + 100}"

    conflict = cursor.execute(
        """
        SELECT id FROM flights
        WHERE id_airline = ? AND UPPER(COALESCE(flight_number, '')) = UPPER(?)
          AND dep_datetime = ? AND COALESCE(is_active, 1) = 1
        """,
        (int(target_airline), flight_num, dep_dt),
    ).fetchone()
    if conflict:
        conn.close()
        return jsonify({"error": f"Schedule conflict: Flight {flight_num} already departs at {dep_dt}.", "code": "SCHEDULE_CONFLICT"}), 409

    cursor.execute(
        """
        INSERT INTO flights (
            id_airline, flight_number, dep_airport, arr_airport,
            dep_datetime, arr_datetime, aircraft_model, stops, status,
            first_price, business_price, economy_price, luggage_price, weight_price, is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, 350.0, 120.0, 1)
        """,
        (int(target_airline), flight_num, dep_ap["id"], arr_ap["id"], dep_dt, arr_dt, aircraft, int(data.get("stops") or 0), first, bus, econ),
    )
    new_fid = cursor.lastrowid
    database.log_audit_event(
        cursor,
        event_type="ADMIN_FLIGHT_CREATED",
        result="SUCCESS",
        actor_id=user["id"],
        actor_role=user["role"],
        airline_id=int(target_airline),
        flight_id=new_fid,
        details=f"Scheduled {flight_num} ({dep_iata}->{arr_iata}) at {dep_dt}",
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "flightId": new_fid, "flightNumber": flight_num}), 201


@admin_bp.route("/api/airline/flights/<int:flight_id>", methods=["PUT", "DELETE"])
@require_roles("AIRLINE_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN")
def api_airline_flight_mutate(flight_id):
    user = get_current_user()
    airline_scope, err = _resolve_airline_scope(user)
    if err:
        return err

    conn = database.get_db()
    cursor = conn.cursor()
    flight = cursor.execute("SELECT * FROM flights WHERE id = ?", (flight_id,)).fetchone()
    if not flight:
        conn.close()
        return jsonify({"error": "Flight not found."}), 404
    if airline_scope and flight["id_airline"] != airline_scope:
        conn.close()
        return jsonify({"error": "Forbidden: Cannot modify another airline's flight."}), 403

    if request.method == "DELETE":
        confirmed = cursor.execute(
            "SELECT COUNT(*) FROM reservations WHERE id_flight = ? AND status = 'CONFIRMED'",
            (flight_id,),
        ).fetchone()[0]
        if confirmed > 0:
            conn.close()
            return jsonify({"error": f"Cannot delete flight with {confirmed} confirmed seat reservation(s). Cancel flight status instead."}), 409
        cursor.execute("UPDATE flights SET is_active = 0, status = 'CANCELLED' WHERE id = ?", (flight_id,))
        database.log_audit_event(
            cursor,
            event_type="ADMIN_FLIGHT_DEACTIVATED",
            result="SUCCESS",
            actor_id=user["id"],
            actor_role=user["role"],
            airline_id=flight["id_airline"],
            flight_id=flight_id,
            details=f"Deactivated flight #{flight_id}",
        )
        conn.commit()
        conn.close()
        return jsonify({"success": True, "message": "Flight deactivated."})

    data = request.get_json() or {}
    updates = []
    params = []
    new_dep = (str(data.get("depDateTime") or flight["dep_datetime"]).strip().replace("T", " "))
    new_arr = (str(data.get("arrDateTime") or flight["arr_datetime"]).strip().replace("T", " "))
    dep_p = database.parse_dt_utc(new_dep)
    arr_p = database.parse_dt_utc(new_arr)
    if ("depDateTime" in data or "arrDateTime" in data) and (not dep_p or not arr_p or arr_p <= dep_p):
        conn.close()
        return jsonify({"error": "Arrival timestamp must be strictly after departure timestamp."}), 400

    confirmed_cnt = cursor.execute(
        "SELECT COUNT(*) FROM reservations WHERE id_flight = ? AND status = 'CONFIRMED'",
        (flight_id,),
    ).fetchone()[0]
    new_status = str(data.get("status") or "").upper()
    if confirmed_cnt > 0 and not data.get("force"):
        if new_status == "CANCELLED" or ("depDateTime" in data and new_dep != flight["dep_datetime"]):
            conn.close()
            return jsonify({
                "error": f"Flight has {confirmed_cnt} confirmed seat reservation(s). Confirm explicit disruption force override or process refunds first.",
                "code": "CONFIRMED_BOOKINGS_EXIST",
            }), 409

    for body_k, col in [
        ("status", "status"),
        ("depDateTime", "dep_datetime"),
        ("arrDateTime", "arr_datetime"),
        ("economyPrice", "economy_price"),
        ("businessPrice", "business_price"),
        ("firstPrice", "first_price"),
        ("aircraftModel", "aircraft_model"),
    ]:
        if body_k in data and data[body_k] is not None and str(data[body_k]).strip() != "":
            val = data[body_k]
            if body_k == "depDateTime":
                val = dep_p.strftime("%Y-%m-%d %H:%M")
            elif body_k == "arrDateTime":
                val = arr_p.strftime("%Y-%m-%d %H:%M")
            elif body_k == "economyPrice" and float(val) <= 0:
                conn.close()
                return jsonify({"error": "Economy price must be greater than zero."}), 400
            elif body_k in ("businessPrice", "firstPrice") and float(val) < 0:
                conn.close()
                return jsonify({"error": "Fare prices cannot be negative."}), 400
            elif body_k == "status":
                val = str(val).upper()
                if val not in ("SCHEDULED", "ON_TIME", "DELAYED", "CANCELLED", "COMPLETED"):
                    conn.close()
                    return jsonify({"error": "Invalid flight status."}), 400
            updates.append(f"{col} = ?")
            params.append(val)

    if not updates:
        conn.close()
        return jsonify({"error": "No valid update fields supplied."}), 400

    cursor.execute(f"UPDATE flights SET {', '.join(updates)} WHERE id = ?", params + [flight_id])
    database.log_audit_event(
        cursor,
        event_type="ADMIN_FLIGHT_UPDATED",
        result="SUCCESS",
        actor_id=user["id"],
        actor_role=user["role"],
        airline_id=flight["id_airline"],
        flight_id=flight_id,
        details=f"Updated flight #{flight_id}: {', '.join(updates)}",
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Flight updated."})


@admin_bp.route("/api/admin/all-bookings", methods=["GET"])
@require_roles("AIRLINE_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN")
def api_admin_all_bookings():
    database.cleanup_expired_holds()
    user = get_current_user()
    airline_scope, err = _resolve_airline_scope(user)
    if err:
        return err

    q = (request.args.get("q") or "").strip()
    where = ["1=1"]
    params = []
    if airline_scope:
        where.append("f.id_airline = ?")
        params.append(airline_scope)
    if q:
        kw = f"%{q}%"
        where.append("(b.booking_reference LIKE ? OR b.pnr_code LIKE ? OR a.username LIKE ? OR a.emailAddress LIKE ?)")
        params.extend([kw, kw, kw, kw])

    conn = database.get_db()
    rows = [
        dict(r)
        for r in conn.execute(
            f"""
            SELECT b.id as bookingId, b.booking_reference as bookingReference, b.pnr_code as pnrCode,
                   b.status, b.total_amount, b.cabin_class, b.created_at, b.paid_at, b.refund_status, b.refund_amount,
                   a.username, a.emailAddress, a.display_name,
                   f.id as flightId, COALESCE(f.flight_number, al.IATA || '-' || (100 + (f.id % 900))) as flightNumber,
                   f.dep_datetime, f.arr_datetime, f.id_airline,
                   al.name as airlineName, al.IATA as airlineIATA,
                   da.city as depCity, da.IATA as depIATA, aa.city as arrCity, aa.IATA as arrIATA
            FROM bookings b
            JOIN accounts a ON b.id_account = a.id
            JOIN flights f ON b.id_flight = f.id
            JOIN airLines al ON f.id_airline = al.id
            JOIN airports da ON f.dep_airport = da.id
            JOIN airports aa ON f.arr_airport = aa.id
            WHERE {' AND '.join(where)}
            ORDER BY b.created_at DESC
            LIMIT 100
            """,
            params,
        ).fetchall()
    ]
    conn.close()
    return jsonify({"airlineId": airline_scope, "bookings": rows})


@admin_bp.route("/api/admin/inventory/<int:flight_id>", methods=["GET"])
@require_roles("AIRLINE_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN")
def api_admin_flight_inventory(flight_id):
    user = get_current_user()
    airline_scope, err = _resolve_airline_scope(user)
    if err:
        return err

    conn = database.get_db()
    flight = conn.execute(
        """
        SELECT f.*, al.name as airlineName, al.IATA as airlineIATA, da.IATA as depIATA, aa.IATA as arrIATA
        FROM flights f
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE f.id = ?
        """,
        (flight_id,),
    ).fetchone()
    conn.close()

    if not flight:
        return jsonify({"error": "Flight not found."}), 404
    if airline_scope and flight["id_airline"] != airline_scope:
        return jsonify({"error": "Forbidden: Cannot inspect another airline's inventory."}), 403

    seats = database.get_flight_seats(flight_id, None)
    counts = {"AVAILABLE": 0, "LOCKED": 0, "BOOKED": 0}
    for s in seats:
        counts[s["status"]] = counts.get(s["status"], 0) + 1
    return jsonify({"flight": dict(flight), "summary": counts, "seats": seats})


@admin_bp.route("/api/admin/audit-logs", methods=["GET"])
@require_roles("AIRLINE_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN")
def api_admin_audit_logs():
    user = get_current_user()
    airline_scope, err = _resolve_airline_scope(user)
    if err:
        return err

    conn = database.get_db()
    where = "WHERE id_airline = ?" if airline_scope else ""
    params = (airline_scope,) if airline_scope else ()
    rows = [
        dict(r)
        for r in conn.execute(
            f"SELECT * FROM audit_logs {where} ORDER BY id DESC LIMIT 150",
            params,
        ).fetchall()
    ]
    conn.close()
    return jsonify({"logs": rows})


@admin_bp.route("/api/admin/refunds", methods=["GET"])
@admin_bp.route("/api/admin/refunds/<int:req_id>/decision", methods=["POST"])
@require_roles("AIRLINE_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN")
def api_admin_refunds(req_id=None):
    user = get_current_user()
    airline_scope, err = _resolve_airline_scope(user)
    if err:
        return err

    conn = database.get_db()
    cursor = conn.cursor()

    if request.method == "GET":
        where = "WHERE rr.id_airline = ?" if airline_scope else ""
        params = (airline_scope,) if airline_scope else ()
        rows = [
            dict(r)
            for r in cursor.execute(
                f"""
                SELECT rr.*, a.username, b.pnr_code, al.IATA as airlineIATA
                FROM refund_requests rr
                JOIN accounts a ON rr.id_account = a.id
                JOIN bookings b ON rr.booking_reference = b.booking_reference
                JOIN airLines al ON rr.id_airline = al.id
                {where}
                ORDER BY rr.id DESC LIMIT 100
                """,
                params,
            ).fetchall()
        ]
        conn.close()
        return jsonify({"refunds": rows})

    row = cursor.execute("SELECT * FROM refund_requests WHERE id = ?", (req_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Refund request not found."}), 404
    if airline_scope and row["id_airline"] != airline_scope:
        conn.close()
        return jsonify({"error": "Forbidden: Cannot process refund for another airline."}), 403

    data = request.get_json() or {}
    decision = (data.get("decision") or "APPROVED").strip().upper()
    note = (data.get("note") or "Processed by airline admin").strip()
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    if decision not in ("APPROVED", "REJECTED"):
        conn.close()
        return jsonify({"error": "Decision must be APPROVED or REJECTED."}), 400

    approved_amt = float(row["requested_amount"]) if decision == "APPROVED" else 0.0
    cursor.execute(
        "UPDATE refund_requests SET status = ?, approved_amount = ?, reviewed_by = ?, review_note = ?, updated_at = ? WHERE id = ?",
        (decision, approved_amt, user["id"], note, now_iso, req_id),
    )
    if decision == "APPROVED":
        cursor.execute(
            "UPDATE bookings SET status = 'REFUNDED', refund_status = 'APPROVED', refund_amount = ? WHERE booking_reference = ?",
            (approved_amt, row["booking_reference"]),
        )
        cursor.execute("UPDATE reservations SET status = 'CANCELLED' WHERE booking_reference = ?", (row["booking_reference"],))
        cursor.execute("UPDATE tickets SET status = 'REFUNDED' WHERE booking_reference = ?", (row["booking_reference"],))

    database.log_audit_event(
        cursor,
        event_type=f"ADMIN_REFUND_{decision}",
        result=decision,
        actor_id=user["id"],
        actor_role=user["role"],
        airline_id=row["id_airline"],
        reservation_ref=row["booking_reference"],
        details=note,
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "decision": decision})


@admin_bp.route("/api/admin/settings", methods=["GET", "PUT"])
@require_roles("AIRLINE_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN")
def api_admin_settings():
    user = get_current_user()
    airline_scope, err = _resolve_airline_scope(user)
    if err:
        return err

    conn = database.get_db()
    cursor = conn.cursor()
    if request.method == "GET":
        pols = [
            dict(r)
            for r in cursor.execute(
                "SELECT * FROM baggage_policies WHERE id_airline IS NULL OR id_airline = ? ORDER BY id_airline DESC, route_scope ASC",
                (airline_scope or 0,),
            ).fetchall()
        ]
        promos = [dict(r) for r in cursor.execute("SELECT * FROM promo_codes ORDER BY id DESC").fetchall()]
        conn.close()
        return jsonify({"baggagePolicies": pols, "promoCodes": promos})

    data = request.get_json() or {}
    scope = (data.get("routeScope") or "DOMESTIC").upper()
    if scope not in ("DOMESTIC", "INTERNATIONAL"):
        conn.close()
        return jsonify({"error": "routeScope must be DOMESTIC or INTERNATIONAL."}), 400

    target_aid = airline_scope
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute(
        """
        INSERT INTO baggage_policies (id_airline, route_scope, included_checked_kg, included_pieces, cabin_kg, extra_per_kg_fee, extra_piece_fee, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(COALESCE(id_airline, 0), route_scope) DO UPDATE SET
            included_checked_kg = excluded.included_checked_kg,
            included_pieces = excluded.included_pieces,
            cabin_kg = excluded.cabin_kg,
            extra_per_kg_fee = excluded.extra_per_kg_fee,
            extra_piece_fee = excluded.extra_piece_fee,
            updated_at = excluded.updated_at
        """,
        (
            target_aid,
            scope,
            int(data.get("includedCheckedKg") or (23 if scope == "DOMESTIC" else 40)),
            int(data.get("includedPieces") or 1),
            int(data.get("cabinKg") or 7),
            float(data.get("extraPerKgFee") or 120.0),
            float(data.get("extraPieceFee") or 350.0),
            now_iso,
        ),
    )
    database.log_audit_event(
        cursor,
        event_type="ADMIN_BAGGAGE_POLICY_UPDATED",
        result="SUCCESS",
        actor_id=user["id"],
        actor_role=user["role"],
        airline_id=target_aid,
        details=f"Updated {scope} baggage policy",
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Baggage policy updated."})


@admin_bp.route("/api/admin/promos", methods=["POST"])
@admin_bp.route("/api/admin/promos/<int:promo_id>", methods=["PUT"])
@require_roles("AIRLINE_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN")
def api_admin_promos(promo_id=None):
    user = get_current_user()
    airline_scope, err = _resolve_airline_scope(user)
    if err:
        return err

    conn = database.get_db()
    cursor = conn.cursor()
    data = request.get_json() or {}

    if request.method == "PUT" and promo_id:
        row = cursor.execute("SELECT * FROM promo_codes WHERE id = ?", (promo_id,)).fetchone()
        if not row:
            conn.close()
            return jsonify({"error": "Promo code not found."}), 404
        if airline_scope and row["id_airline"] != airline_scope:
            conn.close()
            return jsonify({"error": "Forbidden: Cannot modify another airline's promo code."}), 403

        is_active = int(bool(data.get("isActive", not row["is_active"])))
        usage_limit = max(1, int(data.get("usageLimit") or row["usage_limit"] or 1000))
        cursor.execute("UPDATE promo_codes SET is_active = ?, usage_limit = ? WHERE id = ?", (is_active, usage_limit, promo_id))
        database.log_audit_event(cursor, event_type="ADMIN_PROMO_UPDATED", result="SUCCESS", actor_id=user["id"], actor_role=user["role"], airline_id=row["id_airline"], details=f"Promo {row['code']} active={is_active}")
        conn.commit()
        conn.close()
        return jsonify({"success": True, "isActive": is_active})

    code = (data.get("code") or "").strip().upper()
    dtype = (data.get("discountType") or "PERCENT").strip().upper()
    try:
        dval = float(data.get("discountValue") or 0)
        min_fare = max(0.0, float(data.get("minFare") or 0))
        max_disc = float(data.get("maxDiscount") or dval) if data.get("maxDiscount") is not None else None
        usage_limit = max(1, int(data.get("usageLimit") or 1000))
    except (ValueError, TypeError):
        conn.close()
        return jsonify({"error": "Invalid numeric fields for promo code."}), 400

    if not code or len(code) < 3 or dtype not in ("PERCENT", "FIXED") or dval <= 0:
        conn.close()
        return jsonify({"error": "Valid promo code (min 3 chars), discount type, and positive discount value required."}), 400
    if dtype == "PERCENT" and dval > 90:
        conn.close()
        return jsonify({"error": "Percent promo cannot exceed 90%."}), 400

    target_aid = airline_scope
    try:
        cursor.execute(
            """
            INSERT INTO promo_codes (code, discount_type, discount_value, min_fare, max_discount, usage_limit, id_airline, expires_at, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (code, dtype, dval, min_fare, max_disc, usage_limit, target_aid, data.get("expiresAt") or "2027-12-31 23:59:59"),
        )
        new_id = cursor.lastrowid
        database.log_audit_event(cursor, event_type="ADMIN_PROMO_CREATED", result="SUCCESS", actor_id=user["id"], actor_role=user["role"], airline_id=target_aid, details=f"Created promo {code} ({dtype} {dval})")
        conn.commit()
        conn.close()
        return jsonify({"success": True, "id": new_id, "code": code}), 201
    except Exception:
        conn.close()
        return jsonify({"error": f"Promo code '{code}' already exists."}), 409
