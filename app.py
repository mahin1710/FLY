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
            'airlineId': acc['id_airline']
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
    return jsonify({'user': user})

@app.route('/api/auth/demo-users', methods=['GET'])
def api_demo_users():
    """Returns seeded demo accounts for convenient testing."""
    return jsonify({
        'users': [
            {'username': 'Mahin0', 'role': 'PASSENGER', 'displayName': 'MMH_Mahin', 'airlineId': None, 'desc': 'Passenger Account (Dhaka)'},
            {'username': 'Admin_Biman', 'role': 'AIRLINE_ADMIN', 'displayName': 'Biman Bangladesh Airlines', 'airlineId': 839, 'desc': 'Airline Admin (BG)'},
            {'username': 'Admin_USB', 'role': 'AIRLINE_ADMIN', 'displayName': 'US-Bangla Airlines', 'airlineId': 371, 'desc': 'Airline Admin (BS)'},
            {'username': 'Mahin1', 'role': 'PASSENGER', 'displayName': 'Chittagong Traveler', 'airlineId': None, 'desc': 'Passenger Account (Chittagong)'}
        ]
    })

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

    flights = []
    for r in rows:
        d = dict(r)
        d['flightNumber'] = f"{d['airlineIATA']}-{d['id']}"
        d['flightStatus'] = 'ON TIME'
        d['totalSeats'] = 120
        d['availableSeats'] = max(0, 120 - d['bookedCount'])
        flights.append(d)

    return jsonify(flights)

@app.route('/api/flights', methods=['GET'])
def api_search_flights():
    """Searches flights with filters."""
    dep_city = request.args.get('depCity', '').strip()
    arr_city = request.args.get('arrCity', '').strip()
    airline_id = request.args.get('airlineId')

    conn = database.get_db()
    cursor = conn.cursor()

    query = """
        SELECT f.*,
               al.name as airlineName, al.IATA as airlineIATA,
               da.name as depAirportName, da.IATA as depIATA, da.city as depCity, da.country as depCountry,
               aa.name as arrAirportName, aa.IATA as arrIATA, aa.city as arrCity, aa.country as arrCountry,
               (SELECT COUNT(*) FROM reservations r WHERE r.id_flight = f.id AND r.status = 'CONFIRMED') as bookedCount
        FROM flights f
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE 1=1
    """
    params = []
    if dep_city:
        query += " AND (da.city LIKE ? OR da.IATA LIKE ?)"
        params.extend([f"%{dep_city}%", f"%{dep_city}%"])
    if arr_city:
        query += " AND (aa.city LIKE ? OR aa.IATA LIKE ?)"
        params.extend([f"%{arr_city}%", f"%{arr_city}%"])
    if airline_id:
        query += " AND f.id_airline = ?"
        params.append(airline_id)

    query += " ORDER BY f.dep_datetime ASC LIMIT 50"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    flights = []
    for r in rows:
        d = dict(r)
        d['flightNumber'] = f"{d['airlineIATA']}-{d['id']}"
        d['flightStatus'] = 'ON TIME'
        d['totalSeats'] = 120
        d['availableSeats'] = max(0, 120 - d['bookedCount'])
        flights.append(d)

    return jsonify(flights)

@app.route('/api/flights/<int:flight_id>', methods=['GET'])
def api_flight_detail(flight_id):
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
        WHERE f.id = ?
    """, (flight_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({'error': 'Flight not found'}), 404

    d = dict(row)
    d['flightNumber'] = f"{d['airlineIATA']}-{d['id']}"
    d['flightStatus'] = 'ON TIME'
    d['totalSeats'] = 120
    d['availableSeats'] = max(0, 120 - d['bookedCount'])
    return jsonify(d)

@app.route('/api/flights/<int:flight_id>/seats', methods=['GET'])
def api_flight_seats(flight_id):
    """Returns seat map and real-time availability for a flight."""
    user = get_current_user()
    account_id = user['id'] if user else None
    seats = database.get_flight_seats(flight_id, account_id)
    return jsonify(seats)

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
    return jsonify(rows)

@app.route('/api/airline/flights', methods=['GET'])
def api_airline_flights():
    user = get_current_user()
    if not user or user['role'].upper() != 'AIRLINE_ADMIN':
        return jsonify({'error': 'Forbidden'}), 403

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
        return jsonify({'error': 'Forbidden'}), 403

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
