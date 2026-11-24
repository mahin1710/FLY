"""
FLY FLIGHT BOOKING SYSTEM - PYTHON FLASK BACKEND
Author: mahin1710
Description: Beginner-friendly, robust Python Flask application
             for the FLY flight reservation system. Supports seat holding,
             concurrency safety, test mode payments, and responsive web frontend.
"""

from flask import Flask, request, jsonify, render_template, send_from_directory
import os
import secrets
from datetime import datetime, timedelta
import database

# -------------------------------------------------------------
# APPLICATION SETUP
# -------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, 'templates'),
    static_folder=os.path.join(BASE_DIR, 'static'),
    static_url_path=''
)

# Initialize database schema and demo accounts on launch
database.init_db()

# -------------------------------------------------------------
# AUTHENTICATION & SESSION HELPERS
# -------------------------------------------------------------
def get_auth_token_from_request():
    """Extracts Bearer token from the Authorization header."""
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        return auth_header[7:].strip()
    return None

def get_current_user():
    """
    Validates the session token and returns the current user dict,
    or None if the user is unauthenticated or session is expired.
    """
    token = get_auth_token_from_request()
    if not token:
        return None

    conn = database.get_db()
    cursor = conn.cursor()
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute("""
        SELECT s.token, s.account_id, s.role, s.airline_id,
               a.username, a.display_name, a.emailAddress, a.location
        FROM auth_sessions s
        JOIN accounts a ON s.account_id = a.id
        WHERE s.token = ? AND datetime(s.expires_at) > datetime(?)
    """, (token, now_iso))
    user = cursor.fetchone()
    conn.close()

    if user:
        return {
            'id': user['account_id'],
            'username': user['username'],
            'role': user['role'],
            'displayName': user['display_name'] or user['username'],
            'email': user['emailAddress'],
            'location': user['location'],
            'airlineId': user['airline_id']
        }
    return None

# -------------------------------------------------------------
# FRONTEND TEMPLATE & STATIC ROUTES
# -------------------------------------------------------------
@app.route('/')
def home_page():
    """Serves the main FLY web application."""
    return render_template('index.html')

@app.route('/flight/list')
@app.route('/flight/search')
def flight_list_page():
    """Serves the flight search & listing page."""
    return render_template('index.html')

@app.route('/seat-selection')
def seat_selection_page():
    """Serves seat selection view."""
    if os.path.exists(os.path.join(app.template_folder, 'seat_selection.html')):
        return render_template('seat_selection.html')
    return render_template('index.html')

@app.route('/my-bookings')
def my_bookings_page():
    """Serves my bookings view."""
    if os.path.exists(os.path.join(app.template_folder, 'my_bookings.html')):
        return render_template('my_bookings.html')
    return render_template('index.html')

@app.route('/payment')
def payment_page():
    """Serves payment confirmation view."""
    if os.path.exists(os.path.join(app.template_folder, 'payment.html')):
        return render_template('payment.html')
    return render_template('index.html')

@app.route('/login')
@app.route('/logout')
def auth_pages():
    """Serves auth pages."""
    return render_template('index.html')

# Explicit static file fallbacks to guarantee images, CSS, JS load seamlessly
@app.route('/css/<path:filename>')
def serve_css(filename):
    return send_from_directory(os.path.join(app.static_folder, 'css'), filename)

@app.route('/js/<path:filename>')
def serve_js(filename):
    return send_from_directory(os.path.join(app.static_folder, 'js'), filename)

@app.route('/images/<path:filename>')
def serve_images(filename):
    return send_from_directory(os.path.join(app.static_folder, 'images'), filename)

# -------------------------------------------------------------
# AUTHENTICATION API ROUTES
# -------------------------------------------------------------
@app.route('/api/auth/login', methods=['POST'])
def api_login():
    """Authenticates a user and creates a secure session token."""
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()

    if not username or not password:
        return jsonify({'error': 'Username and password are required.'}), 400

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT a.*, p.firstName, p.lastName
        FROM accounts a
        LEFT JOIN passengers p ON a.id_passenger = p.id
        WHERE a.username = ? COLLATE NOCASE
    """, (username,))
    acc = cursor.fetchone()

    if not acc or not database.verify_password(password, acc['password']):
        conn.close()
        return jsonify({'error': 'Invalid username or password.'}), 401

    # Create session token (valid for 7 days)
    token = secrets.token_hex(24)
    now_dt = datetime.utcnow()
    expires_dt = now_dt + timedelta(days=7)
    created_at = now_dt.strftime("%Y-%m-%d %H:%M:%S")
    expires_at = expires_dt.strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute("""
        INSERT INTO auth_sessions (token, account_id, username, role, airline_id, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (token, acc['id'], acc['username'], acc['role'], acc['id_airline'], created_at, expires_at))

    conn.commit()
    conn.close()

    display_name = acc['display_name']
    if not display_name and (acc['firstName'] or acc['lastName']):
        display_name = f"{acc['firstName'] or ''} {acc['lastName'] or ''}".strip()
    if not display_name:
        display_name = acc['username']

    return jsonify({
        'success': True,
        'token': token,
        'user': {
            'id': acc['id'],
            'username': acc['username'],
            'role': acc['role'],
            'displayName': display_name,
            'email': acc['emailAddress'],
            'location': acc['location'] or 'Dhaka, Bangladesh',
            'airlineId': acc['id_airline'],
            'id_airline': acc['id_airline']
        }
    })

@app.route('/api/auth/logout', methods=['POST'])
def api_logout():
    """Logs out user by invalidating their session token."""
    token = get_auth_token_from_request()
    if token:
        conn = database.get_db()
        conn.execute("DELETE FROM auth_sessions WHERE token = ?", (token,))
        conn.commit()
        conn.close()
    return jsonify({'success': True, 'message': 'Logged out successfully.'})

@app.route('/api/auth/me', methods=['GET'])
def api_auth_me():
    """Returns the current authenticated user details."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized', 'code': 'UNAUTHORIZED'}), 401
    user_data = dict(user)
    user_data['id_airline'] = user.get('airlineId')
    return jsonify({'authenticated': True, 'user': user_data})

@app.route('/api/auth/demo-users', methods=['GET'])
def api_demo_users():
    """Returns seeded demo accounts for convenient testing."""
    return jsonify([
        {'username': 'Mahin0', 'role': 'PASSENGER', 'displayName': 'MMH_Mahin', 'airlineId': None, 'id_airline': None, 'desc': 'Passenger Account (Dhaka)'},
        {'username': 'Admin_Biman', 'role': 'AIRLINE_ADMIN', 'displayName': 'Biman Bangladesh Airlines', 'airlineId': 839, 'id_airline': 839, 'desc': 'Airline Admin (BG)'},
        {'username': 'Admin_USB', 'role': 'AIRLINE_ADMIN', 'displayName': 'US-Bangla Airlines', 'airlineId': 371, 'id_airline': 371, 'desc': 'Airline Admin (BS)'},
        {'username': 'Mahin1', 'role': 'PASSENGER', 'displayName': 'Chittagong Traveler', 'airlineId': None, 'id_airline': None, 'desc': 'Passenger Account (Chittagong)'}
    ])

# -------------------------------------------------------------
# AIRPORTS & FLIGHTS APIS
# -------------------------------------------------------------
@app.route('/api/airports/all', methods=['GET'])
def api_airports_all():
    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, city, country, IATA FROM airports ORDER BY city ASC, name ASC")
    airports = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify(airports)

@app.route('/api/airports/cities', methods=['GET'])
def api_airports_cities():
    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT city FROM airports WHERE city IS NOT NULL AND city != '' ORDER BY city ASC")
    cities = [row['city'] for row in cursor.fetchall()]
    conn.close()
    return jsonify(cities)

@app.route('/api/airports/countries', methods=['GET'])
def api_airports_countries():
    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT country FROM airports WHERE country IS NOT NULL AND country != '' ORDER BY country ASC")
    countries = [row['country'] for row in cursor.fetchall()]
    conn.close()
    return jsonify(countries)

@app.route('/api/airports/search', methods=['GET'])
def api_airports_search():
    """Searches real airports in SQLite by query string or returns top airports."""
    q = (request.args.get('q') or '').strip()
    conn = database.get_db()
    cursor = conn.cursor()

    if not q:
        cursor.execute("""
            SELECT id, name, city, country, IATA, ICAO 
            FROM airports 
            WHERE country = 'Bangladesh' OR IATA IN ('JFK', 'LHR', 'DXB', 'SIN', 'BKK', 'KUL', 'DOH')
            ORDER BY (CASE WHEN country = 'Bangladesh' THEN 0 ELSE 1 END), IATA ASC
            LIMIT 15
        """)
    else:
        like_q = f"%{q}%"
        cursor.execute("""
            SELECT id, name, city, country, IATA, ICAO 
            FROM airports 
            WHERE name LIKE ? OR city LIKE ? OR country LIKE ? OR IATA LIKE ? OR ICAO LIKE ?
            ORDER BY (CASE WHEN country = 'Bangladesh' THEN 0 ELSE 1 END),
                     (CASE WHEN UPPER(IATA) = UPPER(?) THEN 0 ELSE 1 END),
                     (CASE WHEN UPPER(city) LIKE UPPER(?) THEN 0 ELSE 1 END),
                     name ASC
            LIMIT 15
        """, (like_q, like_q, like_q, like_q, like_q, q, f"{q}%"))

    rows = cursor.fetchall()
    conn.close()

    results = []
    for r in rows:
        d = dict(r)
        if d.get('name'):
            d['name'] = d['name'].replace('?stanbul', 'Istanbul').replace('Da?oguz', 'Dashoguz')
        if d.get('city'):
            d['city'] = d['city'].replace('?stanbul', 'Istanbul')
        results.append(d)

    return jsonify(results)

# -------------------------------------------------------------
# FLIGHT RECORD ENRICHMENT ENGINE
# -------------------------------------------------------------
def enrich_flight_record(d, account_id=None):
    """
    Enriches flight record with realistic aviation attributes:
    - Airline name and IATA code
    - Flight number (e.g. BG-185, BS-102, VQ-969)
    - Aircraft model based on real airline fleets
    - Departure & arrival time, date, airport codes and names
    - Duration in minutes and formatted string (e.g. 1h 05m)
    - Number of stops (0, 1, 2) and transit information if 1+ stops
    - Baggage allowance (checked baggage e.g. 20 kg, cabin baggage 7 kg)
    - Refundability policy (Refundable, Partially Refundable, Non-refundable)
    - Total seats and real-time available seats
    - Cabin pricing and active favorite flag
    """
    flight_id = d['id']
    airline_name = d.get('airlineName') or 'Airlines'
    airline_iata = (d.get('airlineIATA') or 'FL').strip().upper()
    airline_id = d.get('id_airline') or 0

    d['flightNumber'] = f"{airline_iata}-{100 + (flight_id % 900)}"
    d['totalSeats'] = 120
    booked = int(d.get('bookedCount') or 0)
    d['availableSeats'] = max(0, 120 - booked)

    dep_time = d.get('dep_datetime') or ''
    arr_time = d.get('arr_datetime') or ''
    duration_mins = 0
    duration_formatted = 'Non-stop'
    if dep_time and arr_time:
        try:
            dt_dep = datetime.strptime(dep_time.replace('T', ' ')[:16], "%Y-%m-%d %H:%M")
            dt_arr = datetime.strptime(arr_time.replace('T', ' ')[:16], "%Y-%m-%d %H:%M")
            diff = int((dt_arr - dt_dep).total_seconds() / 60)
            if diff > 0:
                duration_mins = diff
                hrs = diff // 60
                mins = diff % 60
                duration_formatted = f"{hrs}h {mins}m" if hrs and mins else (f"{hrs}h" if hrs else f"{mins}m")
        except Exception:
            pass
    d['durationMinutes'] = duration_mins
    d['durationFormatted'] = duration_formatted

    # Flight Status
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    if dep_time and dep_time <= now_iso:
        d['flightStatus'] = 'BOARDING'
    else:
        d['flightStatus'] = 'ON TIME'

    # Real Aircraft Models per Airline Fleet
    fleet_map = {
        'BG': ['Boeing 787-8 Dreamliner', 'Boeing 737-800', 'Dash 8-Q400', 'Boeing 777-300ER'],
        'BS': ['Boeing 737-800', 'ATR 72-600', 'Airbus A330-300'],
        'VQ': ['ATR 72-500', 'ATR 72-600'],
        'EK': ['Boeing 777-300ER', 'Airbus A380-800'],
        'QR': ['Boeing 787-9 Dreamliner', 'Airbus A350-900'],
        'SQ': ['Boeing 787-10', 'Airbus A350-900'],
        'TK': ['Airbus A330-300', 'Boeing 777-300ER'],
        'SV': ['Boeing 777-300ER', 'Boeing 787-9'],
        'AI': ['Airbus A320neo', 'Boeing 787-8'],
        '6E': ['Airbus A320neo', 'Airbus A321neo'],
        'BA': ['Boeing 777-200ER', 'Airbus A350-1000'],
        'LH': ['Airbus A350-900', 'Boeing 747-8']
    }
    possible_fleet = fleet_map.get(airline_iata)
    if possible_fleet:
        d['aircraft'] = possible_fleet[flight_id % len(possible_fleet)]
    else:
        if duration_mins > 300:
            d['aircraft'] = ['Boeing 787-8 Dreamliner', 'Boeing 777-300ER', 'Airbus A350-900'][flight_id % 3]
        elif duration_mins > 120:
            d['aircraft'] = ['Boeing 737-800', 'Airbus A320neo', 'Airbus A321neo'][flight_id % 3]
        else:
            d['aircraft'] = ['Dash 8-Q400', 'ATR 72-600', 'Boeing 737-800'][flight_id % 3]

    # Stops & Transit info
    dep_c = d.get('depCountry') or ''
    arr_c = d.get('arrCountry') or ''
    is_domestic_bd = (dep_c == 'Bangladesh' and arr_c == 'Bangladesh')

    if is_domestic_bd or duration_mins <= 90:
        d['stops'] = 0
        d['stopsLabel'] = 'Non-stop'
        d['transitAirport'] = None
        d['transitInfo'] = 'Direct flight'
    elif duration_mins > 420:
        d['stops'] = 1 if (flight_id % 3 != 0) else 2
        d['stopsLabel'] = f"{d['stops']} stop" if d['stops'] == 1 else f"{d['stops']} stops"
        transit_hubs = ['DXB', 'DOH', 'IST', 'BKK', 'SIN', 'DEL']
        hub = transit_hubs[flight_id % len(transit_hubs)]
        d['transitAirport'] = hub
        d['transitInfo'] = f"Transit via {hub} ({1 + (flight_id % 2)}h {15 + (flight_id % 4)*10}m layover)"
    elif duration_mins > 180:
        d['stops'] = 1 if (flight_id % 4 == 0) else 0
        if d['stops'] == 1:
            hub = 'CGP' if dep_c == 'Bangladesh' else 'DXB'
            d['stopsLabel'] = '1 stop'
            d['transitAirport'] = hub
            d['transitInfo'] = f"1 stop via {hub} (1h 10m layover)"
        else:
            d['stopsLabel'] = 'Non-stop'
            d['transitAirport'] = None
            d['transitInfo'] = 'Direct flight'
    else:
        d['stops'] = 0
        d['stopsLabel'] = 'Non-stop'
        d['transitAirport'] = None
        d['transitInfo'] = 'Direct flight'

    # Baggage Allowance
    baggage_variants = ['20 kg', '25 kg', '30 kg', '35 kg']
    d['checkedBaggage'] = baggage_variants[(flight_id + airline_id) % len(baggage_variants)] if not is_domestic_bd else '20 kg'
    d['cabinBaggage'] = '7 kg'
    d['baggageAllowance'] = f"Check-in: {d['checkedBaggage']} • Cabin: {d['cabinBaggage']}"

    # Refundability Policy
    refund_mod = flight_id % 10
    if refund_mod < 6:
        d['refundability'] = 'Refundable'
        d['refundPolicy'] = 'Refundable (Standard cancellation fee applies)'
    elif refund_mod < 8:
        d['refundability'] = 'Partially Refundable'
        d['refundPolicy'] = 'Partially Refundable (Airline cancellation charges apply)'
    else:
        d['refundability'] = 'Non-refundable'
        d['refundPolicy'] = 'Non-refundable ticket'

    # Text sanitization
    for k in ['depAirportName', 'arrAirportName', 'depCity', 'arrCity']:
        if d.get(k):
            d[k] = d[k].replace('?stanbul', 'Istanbul').replace('Da?oguz', 'Dashoguz')

    return d

@app.route('/api/flights/featured', methods=['GET'])
def api_flights_featured():
    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT f.*,
               al.name as airlineName, al.IATA as airlineIATA,
               da.name as depAirportName, da.IATA as depIATA, da.city as depCity, da.country as depCountry,
               aa.name as arrAirportName, aa.IATA as arrIATA, aa.city as arrCity, aa.country as arrCountry,
               (SELECT COUNT(*) FROM reservations r WHERE r.id_flight = f.id AND r.status = 'CONFIRMED') as bookedCount
        FROM flights f
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        ORDER BY f.id DESC
        LIMIT 10
    """)
    rows = cursor.fetchall()
    conn.close()

    flights = [enrich_flight_record(dict(r)) for r in rows]
    return jsonify(flights)

@app.route('/api/flights/filter-options', methods=['GET'])
def api_flight_filter_options():
    """Returns available filtering metadata (airlines, price bounds, stops, baggage, etc.)."""
    dep_city = (request.args.get('depCity') or request.args.get('from') or '').strip()
    arr_city = (request.args.get('arrCity') or request.args.get('to') or '').strip()

    conn = database.get_db()
    cursor = conn.cursor()

    where_clauses = ["1=1"]
    params = []
    if dep_city:
        where_clauses.append("(da.city LIKE ? OR da.IATA = ? OR da.name LIKE ?)")
        params.extend([f"%{dep_city}%", dep_city.upper(), f"%{dep_city}%"])
    if arr_city:
        where_clauses.append("(aa.city LIKE ? OR aa.IATA = ? OR aa.name LIKE ?)")
        params.extend([f"%{arr_city}%", arr_city.upper(), f"%{arr_city}%"])

    where_sql = " AND ".join(where_clauses)

    # Price bounds
    cursor.execute(f"""
        SELECT MIN(f.economy_price) as minPrice, MAX(f.economy_price) as maxPrice
        FROM flights f
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE {where_sql}
    """, params)
    price_row = cursor.fetchone()
    min_price = float(price_row['minPrice'] or 3000.0)
    max_price = float(price_row['maxPrice'] or 90000.0)

    # Airlines in matching flights
    cursor.execute(f"""
        SELECT al.id, al.name, al.IATA, COUNT(f.id) as flightCount
        FROM flights f
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE {where_sql}
        GROUP BY al.id, al.name, al.IATA
        ORDER BY al.name ASC
    """, params)
    airlines = [dict(r) for r in cursor.fetchall()]
    conn.close()

    return jsonify({
        'minPrice': min_price,
        'maxPrice': max_price,
        'airlines': airlines,
        'stops': [
            {'value': 0, 'label': 'Non-stop'},
            {'value': 1, 'label': '1 stop'},
            {'value': 2, 'label': '2 or more stops'}
        ],
        'departureTimeSlots': [
            {'id': 'early_morning', 'label': 'Early Morning', 'time': '00:00 - 06:00', 'start': 0, 'end': 6},
            {'id': 'morning', 'label': 'Morning', 'time': '06:00 - 12:00', 'start': 6, 'end': 12},
            {'id': 'afternoon', 'label': 'Afternoon', 'time': '12:00 - 18:00', 'start': 12, 'end': 18},
            {'id': 'evening', 'label': 'Evening', 'time': '18:00 - 24:00', 'start': 18, 'end': 24}
        ],
        'arrivalTimeSlots': [
            {'id': 'early_morning', 'label': 'Early Morning', 'time': '00:00 - 06:00', 'start': 0, 'end': 6},
            {'id': 'morning', 'label': 'Morning', 'time': '06:00 - 12:00', 'start': 6, 'end': 12},
            {'id': 'afternoon', 'label': 'Afternoon', 'time': '12:00 - 18:00', 'start': 12, 'end': 18},
            {'id': 'evening', 'label': 'Evening', 'time': '18:00 - 24:00', 'start': 18, 'end': 24}
        ],
        'refundPolicies': ['Refundable', 'Partially Refundable', 'Non-refundable'],
        'baggageOptions': ['20 kg', '25 kg', '30 kg', '35 kg']
    })

@app.route('/api/flights', methods=['GET'])
def api_search_flights():
    """Searches flights with filters, pagination, and sorting."""
    database.cleanup_expired_holds()

    dep_city = (request.args.get('depCity') or request.args.get('from') or '').strip()
    arr_city = (request.args.get('arrCity') or request.args.get('to') or '').strip()
    dep_country = request.args.get('depCountry', '').strip()
    arr_country = request.args.get('arrCountry', '').strip()
    date_after = (request.args.get('dateAfter') or request.args.get('departure') or '').strip()
    date_before = (request.args.get('dateBefore') or request.args.get('return') or '').strip()
    cabin_class = (request.args.get('cabinClass') or request.args.get('cabin') or '').strip().lower()
    q = (request.args.get('q') or request.args.get('search') or '').strip()
    airline_id = request.args.get('airlineId')
    account_id = request.args.get('accountId')
    sort_by = request.args.get('sortBy', 'closestDate')

    try:
        limit = min(int(request.args.get('limit', 12)), 100)
    except (ValueError, TypeError):
        limit = 12
    try:
        offset = max(int(request.args.get('offset', 0)), 0)
    except (ValueError, TypeError):
        offset = 0

    conn = database.get_db()
    cursor = conn.cursor()

    where_clauses = ["1=1"]
    params = []

    if dep_country:
        where_clauses.append("da.country = ?")
        params.append(dep_country)
    if arr_country:
        where_clauses.append("aa.country = ?")
        params.append(arr_country)

    if dep_city:
        where_clauses.append("(da.city LIKE ? OR da.IATA = ? OR da.name LIKE ?)")
        params.extend([f"%{dep_city}%", dep_city.upper(), f"%{dep_city}%"])
    if arr_city:
        where_clauses.append("(aa.city LIKE ? OR aa.IATA = ? OR aa.name LIKE ?)")
        params.extend([f"%{arr_city}%", arr_city.upper(), f"%{arr_city}%"])

    if date_after:
        where_clauses.append("f.dep_datetime >= ?")
        params.append(f"{date_after} 00:00")
    if date_before:
        where_clauses.append("f.dep_datetime <= ?")
        params.append(f"{date_before} 23:59")

    if cabin_class and cabin_class not in ('all', ''):
        if 'economy' in cabin_class:
            where_clauses.append("f.economy_price > 0")
        elif 'business' in cabin_class:
            where_clauses.append("f.business_price > 0")
        elif 'first' in cabin_class:
            where_clauses.append("f.first_price > 0")

    if airline_id:
        where_clauses.append("f.id_airline = ?")
        params.append(airline_id)

    if q:
        kw = f"%{q}%"
        where_clauses.append("""(
            da.name LIKE ? OR da.city LIKE ? OR da.country LIKE ? OR da.IATA LIKE ? OR
            aa.name LIKE ? OR aa.city LIKE ? OR aa.country LIKE ? OR aa.IATA LIKE ? OR
            al.name LIKE ? OR al.IATA LIKE ?
        )""")
        params.extend([kw] * 10)

    where_sql = " AND ".join(where_clauses)

    order_sql = "ORDER BY f.dep_datetime ASC"
    if sort_by == 'furthestDate' or sort_by == 'latestDep':
        order_sql = "ORDER BY f.dep_datetime DESC"
    elif sort_by == 'priceAsc' or sort_by == 'cheapest':
        order_sql = "ORDER BY f.economy_price ASC"
    elif sort_by == 'priceDesc':
        order_sql = "ORDER BY f.economy_price DESC"
    elif sort_by == 'earliestArr':
        order_sql = "ORDER BY f.arr_datetime ASC"

    # Count total
    count_query = f"""
        SELECT COUNT(*) as total
        FROM flights f
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE {where_sql}
    """
    cursor.execute(count_query, params)
    total_count = cursor.fetchone()['total']

    # Fetch data
    fav_sql = "0 as isFavorite"
    if account_id:
        try:
            acc_id_int = int(account_id)
            fav_sql = f"(SELECT COUNT(*) FROM favorites fav WHERE fav.id_flight = f.id AND fav.id_account = {acc_id_int}) > 0 as isFavorite"
        except (ValueError, TypeError):
            pass

    data_query = f"""
        SELECT f.*,
               al.name as airlineName, al.IATA as airlineIATA,
               da.name as depAirportName, da.IATA as depIATA, da.ICAO as depICAO, da.city as depCity, da.country as depCountry,
               aa.name as arrAirportName, aa.IATA as arrIATA, aa.ICAO as arrICAO, aa.city as arrCity, aa.country as arrCountry,
               (SELECT COUNT(*) FROM reservations r WHERE r.id_flight = f.id AND r.status IN ('CONFIRMED', 'HELD')) as bookedCount,
               {fav_sql}
        FROM flights f
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE {where_sql}
        {order_sql}
        LIMIT ? OFFSET ?
    """
    cursor.execute(data_query, params + [limit, offset])
    rows = cursor.fetchall()
    conn.close()

    flights = [enrich_flight_record(dict(r), account_id) for r in rows]

    return jsonify({
        'total': total_count,
        'flights': flights,
        'limit': limit,
        'offset': offset
    })

@app.route('/api/flights/<int:flight_id>', methods=['GET'])
def api_flight_detail(flight_id):
    account_id = None
    user = get_current_user()
    if user:
        account_id = user['id']

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT f.*,
               al.name as airlineName, al.IATA as airlineIATA,
               da.name as depAirportName, da.IATA as depIATA, da.ICAO as depICAO, da.city as depCity, da.country as depCountry,
               aa.name as arrAirportName, aa.IATA as arrIATA, aa.ICAO as arrICAO, aa.city as arrCity, aa.country as arrCountry,
               (SELECT COUNT(*) FROM reservations r WHERE r.id_flight = f.id AND r.status = 'CONFIRMED') as bookedCount
        FROM flights f
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE f.id = ?
    """, (flight_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({'error': 'Flight not found'}), 404

    d = enrich_flight_record(dict(row), account_id)
    return jsonify(d)

@app.route('/api/flights/<int:flight_id>/seats', methods=['GET'])
def api_flight_seats(flight_id):
    """Returns seat map and real-time availability for a flight."""
    user = get_current_user()
    account_id = user['id'] if user else None
    req_acc = request.args.get('accountId')
    if req_acc:
        try:
            account_id = int(req_acc)
        except ValueError:
            pass
    seats = database.get_flight_seats(flight_id, account_id)
    return jsonify({
        'flightId': flight_id,
        'seats': seats
    })

# -------------------------------------------------------------
# SEAT HOLDING & BOOKING SYSTEM (CORE 15-MIN LOCKING ENGINE)
# -------------------------------------------------------------
@app.route('/api/bookings/hold', methods=['POST'])
def api_hold_seats():
    """
    Atomically locks selected seats for 15 minutes.
    Prevents race conditions and duplicate holds by other users.
    """
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Authentication required to hold seats.', 'code': 'UNAUTHORIZED'}), 401

    data = request.get_json() or {}
    flight_id = data.get('flightId')
    seat_ids = data.get('seatIds') or data.get('seats') or []

    if not flight_id:
        return jsonify({'error': 'flightId is required.'}), 400
    if not seat_ids or not isinstance(seat_ids, list):
        return jsonify({'error': 'seatIds must be a non-empty array.'}), 400

    # Ensure integer seat IDs
    int_seat_ids = []
    for s in seat_ids:
        try:
            int_seat_ids.append(int(s['id'] if isinstance(s, dict) else s))
        except (ValueError, TypeError):
            continue

    if not int_seat_ids:
        return jsonify({'error': 'No valid seat IDs provided.'}), 400

    nbr_luggages = int(data.get('nbrLuggages') or data.get('nbr_luggages') or 0)
    weight = float(data.get('weight') or 0.0)

    success, msg, code, hold_info = database.hold_seats_atomic(
        flight_id=int(flight_id),
        seat_ids=int_seat_ids,
        account_id=user['id'],
        nbr_luggages=nbr_luggages,
        weight=weight
    )

    if not success:
        status_code = 409 if code == 'SEAT_UNAVAILABLE' else 400
        return jsonify({'error': msg, 'code': code}), status_code

    return jsonify({
        'success': True,
        'status': 'PENDING_PAYMENT',
        'message': msg,
        **hold_info
    }), 201

@app.route('/api/bookings/<string:booking_ref>', methods=['GET'])
def api_get_booking(booking_ref):
    """
    Retrieves booking details, current countdown seconds, and route info.
    Validates ownership to enforce customer data isolation.
    """
    database.cleanup_expired_holds()
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Authentication required to view booking.', 'code': 'UNAUTHORIZED'}), 401

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT b.*,
               a.username, a.emailAddress, a.display_name,
               f.id as flightId, f.dep_datetime, f.arr_datetime, f.first_price, f.business_price, f.economy_price,
               al.id as airlineId, al.name as airlineName, al.IATA as airlineIATA,
               da.name as depAirportName, da.IATA as depIATA, da.city as depCity, da.country as depCountry,
               aa.name as arrAirportName, aa.IATA as arrIATA, aa.city as arrCity, aa.country as arrCountry
        FROM bookings b
        JOIN accounts a ON b.id_account = a.id
        JOIN flights f ON b.id_flight = f.id
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE b.booking_reference = ?
    """, (booking_ref.strip(),))
    booking = cursor.fetchone()

    if not booking:
        conn.close()
        return jsonify({'error': 'Booking not found.'}), 404

    # Enforce customer isolation
    if user['role'].upper() == 'PASSENGER' and booking['id_account'] != user['id']:
        conn.close()
        return jsonify({'error': 'Access denied: You cannot view another customer\'s booking.', 'code': 'FORBIDDEN'}), 403

    # Fetch seat codes
    cursor.execute("""
        SELECT s.id, s.column, s.row, s.type
        FROM reservations r
        JOIN seats s ON r.id_seat = s.id
        WHERE r.booking_reference = ?
    """, (booking_ref.strip(),))
    seats = cursor.fetchall()
    conn.close()

    b_dict = dict(booking)
    b_dict['seats'] = [dict(s) for s in seats]
    b_dict['seatCodes'] = [f"{s['column']}{s['row']}" for s in seats]
    b_dict['seatNumbers'] = ", ".join(b_dict['seatCodes'])

    # Calculate remaining seconds
    now_dt = datetime.utcnow()
    expires_dt = datetime.strptime(b_dict['expires_at'], "%Y-%m-%d %H:%M:%S")
    remaining = max(0, int((expires_dt - now_dt).total_seconds()))
    b_dict['secondsRemaining'] = remaining

    return jsonify(b_dict)

@app.route('/api/bookings/confirm', methods=['POST'])
def api_confirm_payment():
    """
    Confirms payment for a held booking.
    Validates ownership, hold non-expiration, and transitions status to CONFIRMED.
    Permanently marks seats as BOOKED and generates digital boarding pass.
    """
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Authentication required to confirm payment.', 'code': 'UNAUTHORIZED'}), 401

    data = request.get_json() or {}
    booking_ref = data.get('bookingReference', '').strip()
    payment_method = data.get('paymentMethod', 'TEST_MODE')
    transaction_ref = data.get('transactionRef')

    if not booking_ref:
        return jsonify({'error': 'bookingReference is required.'}), 400

    success, msg, code, result_data = database.confirm_payment_atomic(
        booking_ref=booking_ref,
        account_id=user['id'],
        payment_method=payment_method,
        transaction_ref=transaction_ref
    )

    if not success:
        status_code = 410 if code == 'RESERVATION_EXPIRED' else 400
        return jsonify({'error': msg, 'code': code}), status_code

    return jsonify({
        'success': True,
        'status': 'CONFIRMED',
        'message': msg,
        **result_data
    })

@app.route('/api/bookings/cancel', methods=['POST'])
def api_cancel_booking():
    """Releases held seats immediately."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Authentication required.', 'code': 'UNAUTHORIZED'}), 401

    data = request.get_json() or {}
    booking_ref = data.get('bookingReference', '').strip()
    if not booking_ref:
        return jsonify({'error': 'bookingReference is required.'}), 400

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id_account, status FROM bookings WHERE booking_reference = ?", (booking_ref,))
    booking = cursor.fetchone()

    if not booking:
        conn.close()
        return jsonify({'error': 'Booking not found.'}), 404

    if user['role'].upper() == 'PASSENGER' and booking['id_account'] != user['id']:
        conn.close()
        return jsonify({'error': 'Forbidden.'}), 403

    cursor.execute("UPDATE bookings SET status = 'CANCELLED' WHERE booking_reference = ?", (booking_ref,))
    cursor.execute("UPDATE reservations SET status = 'CANCELLED' WHERE booking_reference = ?", (booking_ref,))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Reservation cancelled and seats released.'})

# -------------------------------------------------------------
# MY BOOKINGS & RESERVATIONS
# -------------------------------------------------------------
@app.route('/api/reservations/my', methods=['GET'])
def api_my_reservations():
    """
    Returns user's personal booking history with real-time countdowns.
    Strictly isolates passenger data.
    """
    database.cleanup_expired_holds()
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Authentication required to view bookings.', 'code': 'UNAUTHORIZED'}), 401

    requested_acc = request.args.get('accountId')
    if requested_acc and user['role'].upper() == 'PASSENGER':
        try:
            if int(requested_acc) != user['id']:
                return jsonify({'error': 'Forbidden: Cannot view another customer\'s bookings.', 'code': 'FORBIDDEN'}), 403
        except ValueError:
            pass

    account_id = user['id']
    conn = database.get_db()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT b.id as bookingId, b.booking_reference as bookingReference, b.status,
               b.total_amount, b.nbr_luggages, b.weight, b.created_at, b.expires_at, b.paid_at,
               f.id as flightId, f.dep_datetime, f.arr_datetime,
               al.id as airlineId, al.name as airlineName, al.IATA as airlineIATA,
               da.name as depAirportName, da.IATA as depIATA, da.city as depCity, da.country as depCountry,
               aa.name as arrAirportName, aa.IATA as arrIATA, aa.city as arrCity, aa.country as arrCountry,
               (SELECT GROUP_CONCAT(s.column || s.row, ', ')
                FROM reservations r
                JOIN seats s ON r.id_seat = s.id
                WHERE r.booking_reference = b.booking_reference) as seatNumbers
        FROM bookings b
        JOIN flights f ON b.id_flight = f.id
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE b.id_account = ?
        ORDER BY b.created_at DESC
    """, (account_id,))
    rows = cursor.fetchall()
    conn.close()

    now_dt = datetime.utcnow()
    bookings_list = []
    for r in rows:
        d = dict(r)
        d['isBooking'] = True
        if d['status'] == 'PENDING_PAYMENT' and d['expires_at']:
            exp_dt = datetime.strptime(d['expires_at'], "%Y-%m-%d %H:%M:%S")
            d['secondsRemaining'] = max(0, int((exp_dt - now_dt).total_seconds()))
        else:
            d['secondsRemaining'] = 0
        bookings_list.append(d)

    return jsonify(bookings_list)

@app.route('/api/reservations/ticket/<string:ticket_id>', methods=['GET'])
def api_get_ticket(ticket_id):
    """Returns official boarding pass data for confirmed booking."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Authentication required.', 'code': 'UNAUTHORIZED'}), 401

    # Check if ticket_id is a booking reference
    ticket = database.get_ticket_data(ticket_id.strip())
    if not ticket:
        # Check by numeric reservation id
        conn = database.get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT booking_reference FROM reservations WHERE id = ?", (ticket_id,))
        row = cursor.fetchone()
        conn.close()
        if row and row['booking_reference']:
            ticket = database.get_ticket_data(row['booking_reference'])

    if not ticket:
        return jsonify({'error': 'Ticket not found.'}), 404

    return jsonify(ticket)

# -------------------------------------------------------------
# SAVED CARDS & FAVORITES
# -------------------------------------------------------------
@app.route('/api/cards', methods=['GET', 'POST'])
def api_cards():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401

    conn = database.get_db()
    cursor = conn.cursor()

    if request.method == 'GET':
        cursor.execute("SELECT id, cardNumber, expirationDate, cardHolder FROM creditCards WHERE id_account = ?", (user['id'],))
        cards = [dict(c) for c in cursor.fetchall()]
        conn.close()
        return jsonify(cards)

    data = request.get_json() or {}
    card_number = data.get('cardNumber', '').strip()
    exp_date = data.get('expirationDate', '').strip()
    card_holder = data.get('cardHolder', '').strip()

    if not card_number or not exp_date or not card_holder:
        conn.close()
        return jsonify({'error': 'All card fields are required.'}), 400

    cursor.execute("""
        INSERT INTO creditCards (id_account, cardNumber, expirationDate, cardHolder)
        VALUES (?, ?, ?, ?)
    """, (user['id'], card_number, exp_date, card_holder))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()

    return jsonify({'success': True, 'id': new_id}), 201

@app.route('/api/favorites', methods=['GET'])
def api_get_favorites():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT f.*, al.name as airlineName, al.IATA as airlineIATA,
               da.city as depCity, da.IATA as depIATA, aa.city as arrCity, aa.IATA as arrIATA
        FROM favorites fav
        JOIN flights f ON fav.id_flight = f.id
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE fav.id_account = ?
    """, (user['id'],))
    favs = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return jsonify(favs)

# -------------------------------------------------------------
# AIRLINE ADMIN & TENANT ISOLATION
# -------------------------------------------------------------
@app.route('/api/admin/all-bookings', methods=['GET'])
def api_admin_all_bookings():
    """Airline Portal: lists bookings scoped strictly to admin's airline."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized', 'code': 'UNAUTHORIZED'}), 401
    if user['role'].upper() != 'AIRLINE_ADMIN':
        return jsonify({'error': 'Forbidden: Airline admin access required.', 'code': 'FORBIDDEN'}), 403

    airline_id = user['airlineId']
    conn = database.get_db()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT b.id as bookingId, b.booking_reference as bookingReference, b.status,
               b.total_amount, b.created_at, b.paid_at,
               a.username, a.emailAddress, a.display_name,
               f.id as flightId, f.dep_datetime, f.arr_datetime, f.id_airline,
               al.name as airlineName, al.IATA as airlineIATA,
               da.city as depCity, da.IATA as depIATA, aa.city as arrCity, aa.IATA as arrIATA
        FROM bookings b
        JOIN accounts a ON b.id_account = a.id
        JOIN flights f ON b.id_flight = f.id
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE f.id_airline = ?
        ORDER BY b.created_at DESC
    """, (airline_id,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return jsonify({
        'airlineId': airline_id,
        'bookings': rows
    })

@app.route('/api/airline/flights', methods=['GET'])
def api_airline_flights():
    user = get_current_user()
    if not user or user['role'].upper() != 'AIRLINE_ADMIN':
        return jsonify({'error': 'Forbidden: Airline admin access required.', 'code': 'FORBIDDEN'}), 403

    requested_airline = request.args.get('airlineId')
    if requested_airline:
        try:
            if int(requested_airline) != user['airlineId']:
                return jsonify({'error': 'Forbidden: Cannot access another airline.', 'code': 'FORBIDDEN'}), 403
        except ValueError:
            pass

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT f.*, al.name as airlineName, al.IATA as airlineIATA,
               da.city as depCity, da.IATA as depIATA, aa.city as arrCity, aa.IATA as arrIATA,
               (SELECT COUNT(*) FROM reservations r WHERE r.id_flight = f.id AND r.status = 'CONFIRMED') as bookedCount
        FROM flights f
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE f.id_airline = ?
        ORDER BY f.dep_datetime DESC
    """, (user['airlineId'],))
    flights = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return jsonify(flights)

@app.route('/api/airline/stats', methods=['GET'])
def api_airline_stats():
    user = get_current_user()
    if not user or user['role'].upper() != 'AIRLINE_ADMIN':
        return jsonify({'error': 'Forbidden: Airline admin access required.', 'code': 'FORBIDDEN'}), 403

    requested_airline = request.args.get('airlineId')
    if requested_airline:
        try:
            if int(requested_airline) != user['airlineId']:
                return jsonify({'error': 'Forbidden: Cannot access another airline.', 'code': 'FORBIDDEN'}), 403
        except ValueError:
            pass

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT COUNT(DISTINCT f.id) as totalFlights,
               COUNT(b.id) as totalBookings,
               COALESCE(SUM(b.total_amount), 0) as totalRevenue
        FROM flights f
        LEFT JOIN bookings b ON b.id_flight = f.id AND b.status = 'CONFIRMED'
        WHERE f.id_airline = ?
    """, (user['airlineId'],))
    stats = dict(cursor.fetchone() or {})
    conn.close()
    return jsonify(stats)

# -------------------------------------------------------------
# AIRLINE LOGO & ASSET ROUTES
# -------------------------------------------------------------
@app.route('/api/airlines/<int:airline_id>/logo')
def api_airline_logo(airline_id):
    """Serves airline logo or default placeholder."""
    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT IATA FROM airLines WHERE id = ?", (airline_id,))
    row = cursor.fetchone()
    conn.close()

    logo_map = {
        'BG': 'fly_icon.svg',
        'BS': 'fly_icon.svg',
        'EK': 'fly_icon.svg',
        'QR': 'fly_icon.svg'
    }
    iata = row['IATA'] if row else ''
    filename = logo_map.get(iata, 'default_logo.png')
    return send_from_directory(os.path.join(app.static_folder, 'images'), filename)

# -------------------------------------------------------------
# MAIN RUNNER
# -------------------------------------------------------------
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"========================================================")
    print(f"  FLY Flight Booking System (Python Flask Edition)")
    print(f"  Author: mahin1710")
    print(f"  Server running on http://localhost:{port}")
    print(f"========================================================")
    app.run(host='0.0.0.0', port=port, debug=False)
