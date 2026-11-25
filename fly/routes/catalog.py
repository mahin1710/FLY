"""
FLY Airports, Flights Catalog, Live Seat Availability & Fare Breakdown API Blueprint
"""

import json
import time
from datetime import datetime
from flask import Blueprint, request, jsonify, send_from_directory, current_app, Response
import database
from fly.middleware.auth import get_current_user

catalog_bp = Blueprint("catalog", __name__)


def enrich_flight_record(d, account_id=None):
    flight_id = d["id"]
    airline_iata = (d.get("airlineIATA") or "FL").strip().upper()
    airline_id = d.get("id_airline") or 0

    d["flightNumber"] = d.get("flight_number") or f"{airline_iata}-{100 + (flight_id % 900)}"
    d["totalSeats"] = 120
    booked = int(d.get("bookedCount") or 0)
    d["availableSeats"] = max(0, 120 - booked)

    dep_time = d.get("dep_datetime") or ""
    arr_time = d.get("arr_datetime") or ""
    duration_mins = 0
    duration_formatted = "Non-stop"
    dt_dep = database.parse_dt_utc(dep_time)
    dt_arr = database.parse_dt_utc(arr_time)
    if dt_dep and dt_arr:
        diff = int((dt_arr - dt_dep).total_seconds() / 60)
        if diff > 0:
            duration_mins = diff
            hrs, mins = divmod(diff, 60)
            duration_formatted = f"{hrs}h {mins}m" if hrs and mins else (f"{hrs}h" if hrs else f"{mins}m")
    d["durationMinutes"] = duration_mins
    d["durationFormatted"] = duration_formatted

    db_status = (d.get("status") or "SCHEDULED").upper()
    d["flightStatus"] = db_status

    fleet_map = {
        "BG": ["Boeing 787-8 Dreamliner", "Boeing 737-800", "Dash 8-Q400", "Boeing 777-300ER"],
        "BS": ["Boeing 737-800", "ATR 72-600", "Airbus A330-300"],
        "VQ": ["ATR 72-500", "ATR 72-600"],
        "EK": ["Boeing 777-300ER", "Airbus A380-800"],
        "QR": ["Boeing 787-9 Dreamliner", "Airbus A350-900"],
        "SQ": ["Boeing 787-10", "Airbus A350-900"],
        "TK": ["Airbus A330-300", "Boeing 777-300ER"],
    }
    if d.get("aircraft_model"):
        d["aircraft"] = d["aircraft_model"]
    elif airline_iata in fleet_map:
        d["aircraft"] = fleet_map[airline_iata][flight_id % len(fleet_map[airline_iata])]
    elif duration_mins > 300:
        d["aircraft"] = "Boeing 787-8 Dreamliner"
    else:
        d["aircraft"] = "Boeing 737-800"

    dep_c = d.get("depCountry") or ""
    arr_c = d.get("arrCountry") or ""
    is_domestic_bd = (dep_c == "Bangladesh" and arr_c == "Bangladesh")

    stops_val = int(d.get("stops") or 0)
    if stops_val == 0 and not is_domestic_bd and duration_mins > 420:
        stops_val = 1
    d["stops"] = stops_val
    if stops_val == 0:
        d["stopsLabel"] = "Non-stop"
        d["transitAirport"] = None
        d["transitInfo"] = "Direct flight"
    else:
        hub = "DXB" if not is_domestic_bd else "CGP"
        d["stopsLabel"] = f"{stops_val} stop" if stops_val == 1 else f"{stops_val} stops"
        d["transitAirport"] = hub
        d["transitInfo"] = f"{d['stopsLabel']} via {hub}"

    # Configurable baggage policy from database (23 kg domestic / 40 kg international)
    policy = d.get("_baggagePolicy")
    if not policy:
        policy = database.get_baggage_policy(airline_id, is_domestic_bd)
    d["baggagePolicy"] = policy
    d["checkedBaggage"] = f"{policy['included_checked_kg']} kg"
    d["cabinBaggage"] = f"{policy['cabin_kg']} kg"
    d["baggageAllowance"] = f"Check-in: {policy['included_checked_kg']} kg ({policy['included_pieces']} pc) • Cabin: {policy['cabin_kg']} kg"

    refund_mod = flight_id % 10
    if refund_mod < 6:
        d["refundability"] = "Refundable"
        d["refundPolicy"] = "Refundable (Standard carrier fee applies before departure)"
    elif refund_mod < 8:
        d["refundability"] = "Partially Refundable"
        d["refundPolicy"] = "Partially Refundable (75% refundable up to 24h before departure)"
    else:
        d["refundability"] = "Non-refundable"
        d["refundPolicy"] = "Non-refundable ticket (Airport taxes refundable)"

    for k in ["depAirportName", "arrAirportName", "depCity", "arrCity"]:
        if d.get(k):
            d[k] = d[k].replace("?stanbul", "Istanbul").replace("Da?oguz", "Dashoguz")

    d.pop("_baggagePolicy", None)
    return d


@catalog_bp.route("/api/airports", methods=["GET"])
@catalog_bp.route("/api/airports/all", methods=["GET"])
def api_airports_all():
    conn = database.get_db()
    airports = [dict(r) for r in conn.execute("SELECT id, name, city, country, IATA FROM airports ORDER BY city ASC, name ASC").fetchall()]
    conn.close()
    return jsonify(airports)


@catalog_bp.route("/api/airports/cities", methods=["GET"])
def api_airports_cities():
    conn = database.get_db()
    cities = [r["city"] for r in conn.execute("SELECT DISTINCT city FROM airports WHERE city IS NOT NULL AND city != '' ORDER BY city ASC").fetchall()]
    conn.close()
    return jsonify(cities)


@catalog_bp.route("/api/airports/countries", methods=["GET"])
def api_airports_countries():
    conn = database.get_db()
    countries = [r["country"] for r in conn.execute("SELECT DISTINCT country FROM airports WHERE country IS NOT NULL AND country != '' ORDER BY country ASC").fetchall()]
    conn.close()
    return jsonify(countries)


@catalog_bp.route("/api/airports/search", methods=["GET"])
def api_airports_search():
    q = (request.args.get("q") or "").strip()
    conn = database.get_db()
    cursor = conn.cursor()
    if not q:
        rows = cursor.execute(
            """
            SELECT id, name, city, country, IATA, ICAO
            FROM airports
            WHERE IATA IN ('DAC', 'CXB', 'CGP', 'ZYL', 'DXB', 'LHR', 'SIN', 'BKK', 'KUL', 'DOH', 'JFK')
               OR country = 'Bangladesh'
            ORDER BY (CASE WHEN IATA IN ('DAC','CXB','CGP','ZYL','DXB') THEN 0 ELSE 1 END), IATA ASC
            LIMIT 15
            """
        ).fetchall()
    else:
        like_q = f"%{q}%"
        rows = cursor.execute(
            """
            SELECT id, name, city, country, IATA, ICAO
            FROM airports
            WHERE name LIKE ? OR city LIKE ? OR country LIKE ? OR IATA LIKE ? OR ICAO LIKE ?
            ORDER BY (CASE WHEN UPPER(IATA) = UPPER(?) THEN 0 ELSE 1 END),
                     (CASE WHEN country = 'Bangladesh' THEN 0 ELSE 1 END),
                     (CASE WHEN UPPER(city) LIKE UPPER(?) THEN 0 ELSE 1 END),
                     name ASC
            LIMIT 15
            """,
            (like_q, like_q, like_q, like_q, like_q, q, f"{q}%"),
        ).fetchall()
    conn.close()

    results = []
    for r in rows:
        d = dict(r)
        if d.get("name"):
            d["name"] = d["name"].replace("?stanbul", "Istanbul").replace("Da?oguz", "Dashoguz")
        if d.get("city"):
            d["city"] = d["city"].replace("?stanbul", "Istanbul")
        results.append(d)
    return jsonify(results)


@catalog_bp.route("/api/flights/popular-routes", methods=["GET"])
def api_popular_routes():
    """Returns genuine popular routes grounded in actual active flights in SQLite."""
    conn = database.get_db()
    rows = conn.execute(
        """
        SELECT da.IATA as depIATA, da.city as depCity, da.country as depCountry,
               aa.IATA as arrIATA, aa.city as arrCity, aa.country as arrCountry,
               MIN(f.economy_price) as minPrice, COUNT(f.id) as flightCount
        FROM flights f
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE COALESCE(f.is_active, 1) = 1 AND UPPER(COALESCE(f.status, 'SCHEDULED')) != 'CANCELLED'
          AND da.IATA IN ('DAC','CXB','CGP','ZYL','DXB')
        GROUP BY da.IATA, aa.IATA
        ORDER BY flightCount DESC, minPrice ASC
        LIMIT 8
        """
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@catalog_bp.route("/api/flights/featured", methods=["GET"])
def api_flights_featured():
    database.cleanup_expired_holds()
    conn = database.get_db()
    rows = conn.execute(
        """
        SELECT f.*,
               al.name as airlineName, al.IATA as airlineIATA,
               da.name as depAirportName, da.IATA as depIATA, da.city as depCity, da.country as depCountry,
               aa.name as arrAirportName, aa.IATA as arrIATA, aa.city as arrCity, aa.country as arrCountry,
               (SELECT COUNT(*) FROM reservations r WHERE r.id_flight = f.id AND r.status IN ('CONFIRMED','PENDING_PAYMENT','HELD','LOCKED')) as bookedCount
        FROM flights f
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE COALESCE(f.is_active, 1) = 1 AND UPPER(COALESCE(f.status, 'SCHEDULED')) != 'CANCELLED'
        ORDER BY (CASE WHEN da.IATA = 'DAC' THEN 0 ELSE 1 END), f.dep_datetime DESC
        LIMIT 12
        """
    ).fetchall()
    conn.close()
    return jsonify([enrich_flight_record(dict(r)) for r in rows])


@catalog_bp.route("/api/flights/filter-options", methods=["GET"])
def api_flight_filter_options():
    dep_city = (request.args.get("depCity") or request.args.get("from") or "").strip()
    arr_city = (request.args.get("arrCity") or request.args.get("to") or "").strip()
    conn = database.get_db()
    cursor = conn.cursor()

    where_clauses = ["COALESCE(f.is_active, 1) = 1", "UPPER(COALESCE(f.status, 'SCHEDULED')) != 'CANCELLED'"]
    params = []
    if dep_city:
        where_clauses.append("(da.city LIKE ? OR UPPER(da.IATA) = UPPER(?) OR da.name LIKE ?)")
        params.extend([f"%{dep_city}%", dep_city, f"%{dep_city}%"])
    if arr_city:
        where_clauses.append("(aa.city LIKE ? OR UPPER(aa.IATA) = UPPER(?) OR aa.name LIKE ?)")
        params.extend([f"%{arr_city}%", arr_city, f"%{arr_city}%"])
    where_sql = " AND ".join(where_clauses)

    price_row = cursor.execute(
        f"SELECT MIN(f.economy_price) as minPrice, MAX(f.economy_price) as maxPrice FROM flights f JOIN airports da ON f.dep_airport=da.id JOIN airports aa ON f.arr_airport=aa.id WHERE {where_sql}",
        params,
    ).fetchone()
    airlines = [
        dict(r)
        for r in cursor.execute(
            f"""
            SELECT al.id, al.name, al.IATA, COUNT(f.id) as flightCount
            FROM flights f
            JOIN airLines al ON f.id_airline = al.id
            JOIN airports da ON f.dep_airport = da.id
            JOIN airports aa ON f.arr_airport = aa.id
            WHERE {where_sql}
            GROUP BY al.id, al.name, al.IATA
            ORDER BY al.name ASC
            """,
            params,
        ).fetchall()
    ]
    conn.close()

    min_p = float(price_row["minPrice"] or 3000.0)
    max_p = float(price_row["maxPrice"] or 95000.0)
    return jsonify(
        {
            "minPrice": min_p,
            "maxPrice": max_p,
            "airlines": airlines,
            "stops": [
                {"value": 0, "label": "Non-stop"},
                {"value": 1, "label": "1 stop"},
                {"value": 2, "label": "2+ stops"},
            ],
        }
    )


@catalog_bp.route("/api/flights", methods=["GET"])
def api_search_flights():
    database.cleanup_expired_holds()
    user = get_current_user()

    dep_city = (request.args.get("depCity") or request.args.get("from") or "").strip()
    arr_city = (request.args.get("arrCity") or request.args.get("to") or "").strip()
    date_after = (request.args.get("dateAfter") or request.args.get("departure") or "").strip()
    date_before = (request.args.get("dateBefore") or "").strip()
    cabin_class = (request.args.get("cabinClass") or request.args.get("cabin") or "").strip().lower()
    q = (request.args.get("q") or request.args.get("search") or "").strip()
    airline_ids_param = (request.args.get("airlines") or request.args.get("airlineId") or "").strip()
    stops_filter = (request.args.get("stops") or "").strip().lower()
    max_price = request.args.get("maxPrice")
    dep_time_slot = (request.args.get("depTime") or "").strip().lower()
    arr_time_slot = (request.args.get("arrTime") or "").strip().lower()
    sort_by = (request.args.get("sortBy") or "priceAsc").strip()

    try:
        limit = min(int(request.args.get("limit", 40)), 200)
    except (ValueError, TypeError):
        limit = 40
    try:
        offset = max(int(request.args.get("offset", 0)), 0)
    except (ValueError, TypeError):
        offset = 0

    where_clauses = ["COALESCE(f.is_active, 1) = 1", "UPPER(COALESCE(f.status, 'SCHEDULED')) != 'CANCELLED'"]
    params = []

    if dep_city:
        where_clauses.append("(da.city LIKE ? OR UPPER(da.IATA) = UPPER(?) OR da.name LIKE ?)")
        params.extend([f"%{dep_city}%", dep_city, f"%{dep_city}%"])
    if arr_city:
        where_clauses.append("(aa.city LIKE ? OR UPPER(aa.IATA) = UPPER(?) OR aa.name LIKE ?)")
        params.extend([f"%{arr_city}%", arr_city, f"%{arr_city}%"])
    if date_after:
        where_clauses.append("f.dep_datetime >= ?")
        params.append(f"{date_after} 00:00")
    if date_before:
        where_clauses.append("f.dep_datetime <= ?")
        params.append(f"{date_before} 23:59")
    if max_price:
        try:
            where_clauses.append("f.economy_price <= ?")
            params.append(float(max_price))
        except ValueError:
            pass
    if cabin_class and cabin_class not in ("all", ""):
        if "business" in cabin_class:
            where_clauses.append("f.business_price > 0")
        elif "first" in cabin_class:
            where_clauses.append("f.first_price > 0")
        else:
            where_clauses.append("f.economy_price > 0")
    if airline_ids_param:
        ids = [int(x) for x in airline_ids_param.split(",") if x.strip().isdigit()]
        if ids:
            ph = ",".join("?" for _ in ids)
            where_clauses.append(f"f.id_airline IN ({ph})")
            params.extend(ids)
    if q:
        kw = f"%{q}%"
        where_clauses.append(
            "(da.name LIKE ? OR da.city LIKE ? OR da.IATA LIKE ? OR aa.name LIKE ? OR aa.city LIKE ? OR aa.IATA LIKE ? OR al.name LIKE ? OR al.IATA LIKE ?)"
        )
        params.extend([kw] * 8)

    where_sql = " AND ".join(where_clauses)
    order_map = {
        "cheapest": "ORDER BY f.economy_price ASC, f.dep_datetime ASC",
        "priceAsc": "ORDER BY f.economy_price ASC, f.dep_datetime ASC",
        "priceDesc": "ORDER BY f.economy_price DESC",
        "fastest": "ORDER BY (julianday(f.arr_datetime) - julianday(f.dep_datetime)) ASC",
        "earliestDep": "ORDER BY f.dep_datetime ASC",
        "closestDate": "ORDER BY f.dep_datetime ASC",
        "furthestDate": "ORDER BY f.dep_datetime DESC",
    }
    order_sql = order_map.get(sort_by, "ORDER BY f.economy_price ASC")

    conn = database.get_db()
    cursor = conn.cursor()

    fav_sql = "0 as isFavorite"
    if user:
        fav_sql = f"(SELECT COUNT(*) FROM favorites fav WHERE fav.id_flight = f.id AND fav.id_account = {int(user['id'])}) > 0 as isFavorite"

    rows = cursor.execute(
        f"""
        SELECT f.*,
               al.name as airlineName, al.IATA as airlineIATA,
               da.name as depAirportName, da.IATA as depIATA, da.ICAO as depICAO, da.city as depCity, da.country as depCountry,
               aa.name as arrAirportName, aa.IATA as arrIATA, aa.ICAO as arrICAO, aa.city as arrCity, aa.country as arrCountry,
               (SELECT COUNT(*) FROM reservations r WHERE r.id_flight = f.id AND r.status IN ('CONFIRMED', 'PENDING_PAYMENT', 'HELD', 'LOCKED')) as bookedCount,
               {fav_sql}
        FROM flights f
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE {where_sql}
        {order_sql}
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    ).fetchall()

    total_count = cursor.execute(
        f"SELECT COUNT(*) as total FROM flights f JOIN airLines al ON f.id_airline=al.id JOIN airports da ON f.dep_airport=da.id JOIN airports aa ON f.arr_airport=aa.id WHERE {where_sql}",
        params,
    ).fetchone()["total"]

    conn.close()

    flights = [enrich_flight_record(dict(r), user["id"] if user else None) for r in rows]

    # Post-enrichment stops & time slot filtering
    if stops_filter in ("0", "direct", "nonstop"):
        flights = [f for f in flights if f["stops"] == 0]
    elif stops_filter in ("1", "1stop"):
        flights = [f for f in flights if f["stops"] == 1]

    def _matches_slot(dt_str, slot):
        if not slot or slot == "all":
            return True
        dt = database.parse_dt_utc(dt_str)
        if not dt:
            return True
        h = dt.hour
        if slot == "morning":
            return 5 <= h < 12
        if slot == "afternoon":
            return 12 <= h < 18
        if slot == "evening":
            return h >= 18 or h < 5
        return True

    if dep_time_slot:
        flights = [f for f in flights if _matches_slot(f.get("dep_datetime"), dep_time_slot)]
    if arr_time_slot:
        flights = [f for f in flights if _matches_slot(f.get("arr_datetime"), arr_time_slot)]

    return jsonify({"total": len(flights) if (stops_filter or dep_time_slot or arr_time_slot) else total_count, "flights": flights, "limit": limit, "offset": offset})


@catalog_bp.route("/api/flights/<int:flight_id>", methods=["GET"])
def api_flight_detail(flight_id):
    database.cleanup_expired_holds()
    user = get_current_user()
    conn = database.get_db()
    row = conn.execute(
        """
        SELECT f.*,
               al.name as airlineName, al.IATA as airlineIATA,
               da.name as depAirportName, da.IATA as depIATA, da.ICAO as depICAO, da.city as depCity, da.country as depCountry,
               aa.name as arrAirportName, aa.IATA as arrIATA, aa.ICAO as arrICAO, aa.city as arrCity, aa.country as arrCountry,
               (SELECT COUNT(*) FROM reservations r WHERE r.id_flight = f.id AND r.status IN ('CONFIRMED','PENDING_PAYMENT','HELD','LOCKED')) as bookedCount
        FROM flights f
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE f.id = ?
        """,
        (flight_id,),
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "Flight not found"}), 404
    return jsonify(enrich_flight_record(dict(row), user["id"] if user else None))


@catalog_bp.route("/api/flights/<int:flight_id>/seats", methods=["GET"])
def api_flight_seats(flight_id):
    user = get_current_user()
    account_id = user["id"] if user else None
    seats = database.get_flight_seats(flight_id, account_id)
    return jsonify({"flightId": flight_id, "seats": seats})


@catalog_bp.route("/api/flights/<int:flight_id>/seats/stream", methods=["GET"])
def api_flight_seats_stream(flight_id):
    """Lightweight Server-Sent Events stream for real-time seat status updates."""
    user = get_current_user()
    account_id = user["id"] if user else None

    def generate():
        for _ in range(12):
            seats = database.get_flight_seats(flight_id, account_id)
            yield f"data: {json.dumps({'flightId': flight_id, 'seats': seats})}\n\n"
            time.sleep(5)

    return Response(generate(), mimetype="text/event-stream")


@catalog_bp.route("/api/flights/fare-breakdown", methods=["GET", "POST"])
def api_fare_breakdown():
    try:
        if request.method == "POST":
            data = request.get_json() or {}
            flight_ids = data.get("flightIds") or ([data["flightId"]] if data.get("flightId") else [1])
            cabin = data.get("cabinClass") or "Economy"
            adults = max(1, int(data.get("adults") or 1))
            children = max(0, int(data.get("children") or 0))
            infants = max(0, int(data.get("infants") or 0))
            luggage_count = max(0, int(data.get("luggageCount") or 0))
            luggage_weight = max(0.0, float(data.get("luggageWeight") or 0.0))
            meal_fee = max(0.0, float(data.get("mealFee") or 0.0))
            insurance = bool(data.get("insurance", False))
            seat_upgrade_fee = max(0.0, float(data.get("seatUpgradeFee") or 0.0))
            promo_code = data.get("promoCode")
        else:
            f_str = request.args.get("flightIds") or request.args.get("flightId") or "1"
            flight_ids = [int(x.strip()) for x in f_str.split(",") if x.strip().isdigit()]
            cabin = request.args.get("cabinClass") or "Economy"
            adults = max(1, int(request.args.get("adults") or 1))
            children = max(0, int(request.args.get("children") or 0))
            infants = max(0, int(request.args.get("infants") or 0))
            luggage_count = max(0, int(request.args.get("luggageCount") or 0))
            luggage_weight = max(0.0, float(request.args.get("luggageWeight") or 0.0))
            meal_fee = max(0.0, float(request.args.get("mealFee") or 0.0))
            insurance = request.args.get("insurance", "false").lower() == "true"
            seat_upgrade_fee = max(0.0, float(request.args.get("seatUpgradeFee") or 0.0))
            promo_code = request.args.get("promoCode")
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid numeric parameter for fare calculation."}), 400

    if infants > adults:
        return jsonify({"error": "Each infant must be accompanied by an adult passenger."}), 400

    breakdown = database.calculate_fare_breakdown(
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
    return jsonify(breakdown)


@catalog_bp.route("/api/promos/validate", methods=["POST"])
def api_validate_promo():
    data = request.get_json() or {}
    code = (data.get("code") or "").strip()
    fare_amount = float(data.get("baseFare") or data.get("fareAmount") or 0)
    airline_id = data.get("airlineId")
    ok, msg, discount, promo = database.validate_promo_code(code, fare_amount, airline_id)
    if not ok:
        return jsonify({"valid": False, "error": msg, "discount": 0}), 400
    return jsonify({"valid": True, "code": promo["code"], "message": msg, "discount": discount})


@catalog_bp.route("/api/airlines/<int:airline_id>/logo", methods=["GET"])
def api_airline_logo(airline_id):
    conn = database.get_db()
    row = conn.execute("SELECT IATA FROM airLines WHERE id = ?", (airline_id,)).fetchone()
    conn.close()
    iata = row["IATA"] if row else ""
    filename = "fly_icon.svg" if iata in ("BG", "BS", "EK", "QR", "VQ") else "default_logo.png"
    return send_from_directory(current_app.static_folder + "/images", filename)
