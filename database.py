"""
FLY FLIGHT BOOKING SYSTEM - DATABASE & DATA ACCESS LAYER
Author: mahin1710
Description: Simple, clean, beginner-friendly SQLite database management
             supporting seat availability, 15-minute atomic seat holding,
             payment confirmation, and customer data isolation.
"""

import sqlite3
import os
import hashlib
import secrets
from datetime import datetime, timedelta

# Find database file path cleanly
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
POSSIBLE_DB_PATHS = [
    os.path.join(BASE_DIR, 'database', 'flight_booking.db'),
    os.path.join(BASE_DIR, 'database.db'),
    os.path.join(BASE_DIR, 'Skynet-master', 'Skynet-master', 'web', 'database.db'),
]

def get_db_path():
    """Returns the first existing database file, or creates database/flight_booking.db"""
    for p in POSSIBLE_DB_PATHS:
        if os.path.exists(p):
            return p
    default_p = os.path.join(BASE_DIR, 'database', 'flight_booking.db')
    os.makedirs(os.path.dirname(default_p), exist_ok=True)
    return default_p

DB_PATH = get_db_path()

def get_db():
    """
    Creates and returns a connection to the SQLite database.
    Sets row_factory to sqlite3.Row so columns can be accessed by name.
    """
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn

# -------------------------------------------------------------
# PASSWORD HASHING (scrypt - compatible with existing seeds)
# -------------------------------------------------------------
def hash_password(password: str) -> str:
    """Hashes a password using scrypt with a unique random salt."""
    salt = secrets.token_hex(16)
    derived = hashlib.scrypt(password.encode('utf-8'), salt=salt.encode('utf-8'), n=16384, r=8, p=1, maxmem=0, dklen=64)
    return f"scrypt:{salt}:{derived.hex()}"

def verify_password(password: str, stored_hash: str) -> bool:
    """Verifies a password against scrypt hash with plain-text fallback."""
    if not stored_hash:
        return False
    if stored_hash.startswith("scrypt:"):
        parts = stored_hash.split(":")
        if len(parts) != 3:
            return False
        salt = parts[1]
        orig_key = parts[2]
        # Check salt as utf-8 string (Node.js format)
        derived = hashlib.scrypt(password.encode('utf-8'), salt=salt.encode('utf-8'), n=16384, r=8, p=1, maxmem=0, dklen=64)
        if secrets.compare_digest(derived.hex(), orig_key):
            return True
        try:
            derived_hex = hashlib.scrypt(password.encode('utf-8'), salt=bytes.fromhex(salt), n=16384, r=8, p=1, maxmem=0, dklen=64)
            if secrets.compare_digest(derived_hex.hex(), orig_key):
                return True
        except Exception:
            pass
        return False
    # Plain text fallback for old accounts
    return stored_hash == password or stored_hash == password.strip()

# -------------------------------------------------------------
# DATABASE INITIALIZATION & SCHEMA MIGRATION
# -------------------------------------------------------------
def init_db():
    """Ensures all necessary tables and columns exist in SQLite."""
    conn = get_db()
    cursor = conn.cursor()

    # 1. Ensure accounts table has role, display_name, location
    try:
        cursor.execute("PRAGMA table_info(accounts);")
        columns = [row['name'] for row in cursor.fetchall()]
        if 'role' not in columns:
            cursor.execute("ALTER TABLE accounts ADD COLUMN role TEXT DEFAULT 'PASSENGER';")
        if 'display_name' not in columns:
            cursor.execute("ALTER TABLE accounts ADD COLUMN display_name TEXT;")
        if 'location' not in columns:
            cursor.execute("ALTER TABLE accounts ADD COLUMN location TEXT DEFAULT 'Dhaka, Bangladesh';")
    except Exception as e:
        print(f"[DB Init Note] Accounts table column check: {e}")

    # 2. Ensure auth_sessions table exists for Bearer token sessions
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS auth_sessions (
            token TEXT PRIMARY KEY,
            account_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            role TEXT NOT NULL,
            airline_id INTEGER,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
        );
    """)

    # 3. Ensure bookings table exists for multi-seat atomic transactions & 15-min holds
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_reference TEXT UNIQUE NOT NULL,
            id_account INTEGER NOT NULL,
            id_flight INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('PENDING_PAYMENT', 'CONFIRMED', 'EXPIRED', 'CANCELLED')),
            total_amount REAL NOT NULL,
            nbr_luggages INTEGER DEFAULT 0,
            weight REAL DEFAULT 0,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            payment_ref TEXT,
            payment_method TEXT,
            paid_at TEXT,
            FOREIGN KEY(id_account) REFERENCES accounts(id),
            FOREIGN KEY(id_flight) REFERENCES flights(id) ON DELETE CASCADE
        );
    """)

    # 4. Ensure reservations table has booking_reference, status, expires_at, etc.
    try:
        cursor.execute("PRAGMA table_info(reservations);")
        res_cols = [row['name'] for row in cursor.fetchall()]
        if 'booking_reference' not in res_cols:
            cursor.execute("ALTER TABLE reservations ADD COLUMN booking_reference TEXT;")
        if 'status' not in res_cols:
            cursor.execute("ALTER TABLE reservations ADD COLUMN status TEXT DEFAULT 'CONFIRMED';")
        if 'created_at' not in res_cols:
            cursor.execute("ALTER TABLE reservations ADD COLUMN created_at TEXT;")
        if 'expires_at' not in res_cols:
            cursor.execute("ALTER TABLE reservations ADD COLUMN expires_at TEXT;")
        if 'payment_ref' not in res_cols:
            cursor.execute("ALTER TABLE reservations ADD COLUMN payment_ref TEXT;")
        if 'total_price' not in res_cols:
            cursor.execute("ALTER TABLE reservations ADD COLUMN total_price REAL DEFAULT 0;")
    except Exception as e:
        print(f"[DB Init Note] Reservations table check: {e}")

    conn.commit()
    conn.close()

    # Seed demo accounts if missing
    seed_demo_accounts()

# -------------------------------------------------------------
# DEMO ACCOUNTS SEEDER
# -------------------------------------------------------------
def seed_demo_accounts():
    """Seeds the 4 live demo accounts safely without overwriting."""
    conn = get_db()
    cursor = conn.cursor()

    demo_accounts = [
        {"username": "Mahin0", "password": "Mahin0", "role": "PASSENGER", "display_name": "MMH_Mahin", "airline_id": None},
        {"username": "Admin_Biman", "password": "Admin_Biman", "role": "AIRLINE_ADMIN", "display_name": "Biman Bangladesh Airlines", "airline_id": 839},
        {"username": "Admin_USB", "password": "Admin_USB", "role": "AIRLINE_ADMIN", "display_name": "US-Bangla Airlines", "airline_id": 371},
        {"username": "Mahin1", "password": "Mahin1", "role": "PASSENGER", "display_name": "Chittagong Traveler", "airline_id": None},
    ]

    for acc in demo_accounts:
        cursor.execute("SELECT id, password, role FROM accounts WHERE username = ?", (acc['username'],))
        row = cursor.fetchone()
        if not row:
            hashed = hash_password(acc['password'])
            cursor.execute("""
                INSERT INTO accounts (username, password, role, display_name, id_airline, location)
                VALUES (?, ?, ?, ?, ?, 'Dhaka, Bangladesh')
            """, (acc['username'], hashed, acc['role'], acc['display_name'], acc['airline_id']))
        else:
            # Update role and display_name if needed
            cursor.execute("""
                UPDATE accounts SET role = ?, display_name = ?, id_airline = ?
                WHERE username = ?
            """, (acc['role'], acc['display_name'], acc['airline_id'], acc['username']))

    conn.commit()
    conn.close()

# -------------------------------------------------------------
# SEAT HOLDING & EXPIRATION LOGIC
# -------------------------------------------------------------
def is_expired(expires_at_str):
    """Checks whether an expiration timestamp (supports ISO format) is in the past."""
    if not expires_at_str:
        return False
    try:
        clean = str(expires_at_str).replace('T', ' ').replace('Z', '')
        if '.' in clean:
            clean = clean.split('.')[0]
        exp_dt = datetime.strptime(clean[:19], "%Y-%m-%d %H:%M:%S")
        return exp_dt <= datetime.utcnow()
    except Exception:
        return False

def cleanup_expired_holds():
    """
    Automatically checks and releases temporary seat holds whose 15-minute window has expired.
    Changes booking and reservation status from PENDING_PAYMENT to EXPIRED.
    """
    conn = get_db()
    cursor = conn.cursor()

    # Find expired pending bookings
    cursor.execute("SELECT booking_reference, expires_at FROM bookings WHERE status = 'PENDING_PAYMENT'")
    rows = cursor.fetchall()
    expired_refs = [row['booking_reference'] for row in rows if is_expired(row['expires_at'])]

    for ref in expired_refs:
        cursor.execute("UPDATE bookings SET status = 'EXPIRED' WHERE booking_reference = ?", (ref,))
        cursor.execute("UPDATE reservations SET status = 'EXPIRED' WHERE booking_reference = ?", (ref,))

    if expired_refs:
        conn.commit()
    conn.close()

def get_flight_seats(flight_id: int, current_account_id: int = None):
    """
    Returns all seats for a given flight with their availability status:
    AVAILABLE, HELD, or BOOKED, plus whether it is held by the current user.
    """
    cleanup_expired_holds()
    conn = get_db()
    cursor = conn.cursor()

    # 1. Fetch all seats
    cursor.execute("SELECT id, column, row, type FROM seats ORDER BY row ASC, column ASC")
    seats = cursor.fetchall()

    # 2. Fetch active reservations/holds for this flight
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute("""
        SELECT r.id_seat, r.status, r.id_account, r.booking_reference, r.expires_at
        FROM reservations r
        WHERE r.id_flight = ? AND r.status IN ('CONFIRMED', 'PENDING_PAYMENT')
    """, (flight_id,))
    res_rows = cursor.fetchall()

    res_map = {}
    for r in res_rows:
        status = r['status']
        if status == 'PENDING_PAYMENT' and is_expired(r['expires_at']):
            continue  # expired
        res_map[r['id_seat']] = r

    result = []
    for s in seats:
        seat_id = s['id']
        active = res_map.get(seat_id)
        if not active:
            seat_status = 'AVAILABLE'
            is_held_by_me = False
            booking_ref = None
        elif active['status'] == 'CONFIRMED':
            seat_status = 'BOOKED'
            is_held_by_me = False
            booking_ref = active['booking_reference']
        elif active['status'] == 'PENDING_PAYMENT':
            seat_status = 'HELD'
            is_held_by_me = bool(current_account_id and active['id_account'] == current_account_id)
            booking_ref = active['booking_reference']
        else:
            seat_status = 'AVAILABLE'
            is_held_by_me = False
            booking_ref = None

        result.append({
            'id': seat_id,
            'code': f"{s['column']}{s['row']}",
            'seatCode': f"{s['column']}{s['row']}",
            'column': s['column'],
            'row': s['row'],
            'type': s['type'],
            'status': seat_status,
            'isHeldByMe': is_held_by_me,
            'bookingReference': booking_ref
        })

    conn.close()
    return result

def hold_seats_atomic(flight_id: int, seat_ids: list, account_id: int, nbr_luggages: int = 0, weight: float = 0.0):
    """
    Atomically locks multiple seats for 15 minutes.
    If any requested seat is already booked or held, returns failure.
    """
    cleanup_expired_holds()
    conn = get_db()
    cursor = conn.cursor()

    try:
        # Check flight details and pricing
        cursor.execute("SELECT * FROM flights WHERE id = ?", (flight_id,))
        flight = cursor.fetchone()
        if not flight:
            conn.close()
            return False, "Flight not found", "FLIGHT_NOT_FOUND", None

        # Check availability of all requested seats
        now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        placeholders = ",".join("?" for _ in seat_ids)
        cursor.execute(f"""
            SELECT r.id_seat, r.status, r.id_account, r.expires_at
            FROM reservations r
            WHERE r.id_flight = ? AND r.id_seat IN ({placeholders})
              AND r.status IN ('CONFIRMED', 'PENDING_PAYMENT')
        """, [flight_id] + seat_ids)
        conflicts = cursor.fetchall()

        for c in conflicts:
            if c['status'] == 'CONFIRMED':
                conn.close()
                return False, f"Seat {c['id_seat']} is already booked.", "SEAT_UNAVAILABLE", None
            if c['status'] == 'PENDING_PAYMENT':
                if not is_expired(c['expires_at']):
                    # Held by someone else or current user?
                    if c['id_account'] != account_id:
                        conn.close()
                        return False, "One or more selected seats are currently held by another user.", "SEAT_UNAVAILABLE", None

        # Calculate fare
        cursor.execute(f"SELECT id, type, column, row FROM seats WHERE id IN ({placeholders})", seat_ids)
        seat_rows = cursor.fetchall()

        total_fare = 0.0
        for s in seat_rows:
            stype = (s['type'] or 'economy').lower()
            if stype == 'first':
                total_fare += flight['first_price'] or 75000
            elif stype == 'business':
                total_fare += flight['business_price'] or 45000
            else:
                total_fare += flight['economy_price'] or 25000

        # Luggage fees
        luggage_price = flight['luggage_price'] or 0
        weight_price = flight['weight_price'] or 0
        total_fare += (nbr_luggages * luggage_price) + (weight * weight_price)

        # Generate unique booking reference
        rand_hex = secrets.token_hex(4).upper()
        rand_code = secrets.token_hex(2).upper()
        booking_ref = f"BK-{flight_id}-{rand_hex}-{rand_code}"

        # 15-minute hold timestamps
        created_dt = datetime.utcnow()
        expires_dt = created_dt + timedelta(minutes=15)
        created_at_str = created_dt.strftime("%Y-%m-%d %H:%M:%S")
        expires_at_str = expires_dt.strftime("%Y-%m-%d %H:%M:%S")

        # 1. Insert into bookings table
        cursor.execute("""
            INSERT INTO bookings (booking_reference, id_account, id_flight, status, total_amount, nbr_luggages, weight, created_at, expires_at)
            VALUES (?, ?, ?, 'PENDING_PAYMENT', ?, ?, ?, ?, ?)
        """, (booking_ref, account_id, flight_id, total_fare, nbr_luggages, weight, created_at_str, expires_at_str))

        # 2. Insert/update reservations
        for s in seat_rows:
            stype = (s['type'] or 'economy').lower()
            if stype == 'first':
                seat_fare = flight['first_price'] or 75000
            elif stype == 'business':
                seat_fare = flight['business_price'] or 45000
            else:
                seat_fare = flight['economy_price'] or 25000

            cursor.execute("""
                INSERT INTO reservations (id_flight, id_account, id_seat, nbr_luggages, weight, booking_reference, status, created_at, expires_at, total_price)
                VALUES (?, ?, ?, ?, ?, ?, 'PENDING_PAYMENT', ?, ?, ?)
            """, (flight_id, account_id, s['id'], nbr_luggages, weight, booking_ref, created_at_str, expires_at_str, seat_fare))

        conn.commit()
        conn.close()

        hold_info = {
            'bookingReference': booking_ref,
            'flightId': flight_id,
            'expiresAt': expires_at_str,
            'secondsRemaining': 900,
            'totalAmount': total_fare,
            'seatCodes': [f"{s['column']}{s['row']}" for s in seat_rows]
        }
        return True, "Seats held successfully for 15 minutes.", None, hold_info

    except Exception as e:
        conn.rollback()
        conn.close()
        return False, f"Seat holding failed: {str(e)}", "SERVER_ERROR", None

def confirm_payment_atomic(booking_ref: str, account_id: int, payment_method: str = 'TEST_MODE', transaction_ref: str = None):
    """
    Confirms payment for a held booking:
    1. Validates ownership and status
    2. Validates 15-minute hold has not expired
    3. Simulates payment verification (Test Mode)
    4. Transitions booking and reservations to CONFIRMED
    5. Seats permanently become BOOKED
    """
    cleanup_expired_holds()
    conn = get_db()
    cursor = conn.cursor()

    try:
        now_dt = datetime.utcnow()
        now_iso = now_dt.strftime("%Y-%m-%d %H:%M:%S")

        cursor.execute("SELECT * FROM bookings WHERE booking_reference = ?", (booking_ref,))
        booking = cursor.fetchone()
        if not booking:
            conn.close()
            return False, "Booking not found.", "NOT_FOUND", None

        # Check account ownership (unless admin)
        cursor.execute("SELECT role FROM accounts WHERE id = ?", (account_id,))
        acc = cursor.fetchone()
        role = acc['role'].upper() if acc and acc['role'] else 'PASSENGER'

        if role == 'PASSENGER' and booking['id_account'] != account_id:
            conn.close()
            return False, "Access denied: You cannot confirm payment for another customer's booking.", "FORBIDDEN", None

        # Idempotent: already confirmed
        if booking['status'] == 'CONFIRMED':
            conn.close()
            ticket = get_ticket_data(booking_ref)
            return True, "Payment already confirmed for this reservation.", None, {
                'alreadyConfirmed': True,
                'bookingReference': booking_ref,
                'ticket': ticket
            }

        # Check expiration
        if booking['status'] == 'EXPIRED' or is_expired(booking['expires_at']):
            cursor.execute("UPDATE bookings SET status = 'EXPIRED' WHERE booking_reference = ?", (booking_ref,))
            cursor.execute("UPDATE reservations SET status = 'EXPIRED' WHERE booking_reference = ?", (booking_ref,))
            conn.commit()
            conn.close()
            return False, "This reservation has expired. Seats have been released back to availability.", "RESERVATION_EXPIRED", None

        if booking['status'] == 'CANCELLED':
            conn.close()
            return False, "This reservation was cancelled.", "CANCELLED", None

        # Successful Payment Confirmation (Test Mode Verification)
        txn_ref = transaction_ref or f"TXN-{int(now_dt.timestamp())}-{secrets.token_hex(3).upper()}"
        paid_at_str = now_iso

        cursor.execute("""
            UPDATE bookings
            SET status = 'CONFIRMED', payment_ref = ?, payment_method = ?, paid_at = ?
            WHERE booking_reference = ?
        """, (txn_ref, payment_method, paid_at_str, booking_ref))

        cursor.execute("""
            UPDATE reservations
            SET status = 'CONFIRMED', payment_ref = ?
            WHERE booking_reference = ?
        """, (txn_ref, booking_ref))

        conn.commit()
        conn.close()

        ticket = get_ticket_data(booking_ref)
        return True, "Payment verified successfully! Booking confirmed.", None, {
            'bookingReference': booking_ref,
            'paymentRef': txn_ref,
            'paidAt': paid_at_str,
            'ticket': ticket
        }

    except Exception as e:
        conn.rollback()
        conn.close()
        return False, f"Payment confirmation error: {str(e)}", "SERVER_ERROR", None

def get_ticket_data(booking_ref: str):
    """Builds official boarding pass ticket data for a confirmed booking."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT b.*,
               a.username, a.emailAddress, a.display_name,
               p.firstName, p.lastName,
               f.id as flightId, f.dep_datetime, f.arr_datetime, f.first_price, f.business_price, f.economy_price,
               al.id as airlineId, al.name as airlineName, al.IATA as airlineIATA,
               da.name as depAirportName, da.IATA as depIATA, da.city as depCity, da.country as depCountry,
               aa.name as arrAirportName, aa.IATA as arrIATA, aa.city as arrCity, aa.country as arrCountry
        FROM bookings b
        JOIN accounts a ON b.id_account = a.id
        LEFT JOIN passengers p ON a.id_passenger = p.id
        JOIN flights f ON b.id_flight = f.id
        JOIN airLines al ON f.id_airline = al.id
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE b.booking_reference = ?
    """, (booking_ref,))
    b = cursor.fetchone()
    if not b:
        conn.close()
        return None

    # Fetch seat details
    cursor.execute("""
        SELECT s.id, s.column, s.row, s.type
        FROM reservations r
        JOIN seats s ON r.id_seat = s.id
        WHERE r.booking_reference = ?
    """, (booking_ref,))
    seats = cursor.fetchall()
    conn.close()

    passenger_name = f"{b['firstName'] or ''} {b['lastName'] or ''}".strip()
    if not passenger_name:
        passenger_name = b['display_name'] or b['username']

    seat_codes = [f"{s['column']}{s['row']}" for s in seats]
    seat_class = seats[0]['type'] if seats else 'Economy'

    return {
        'bookingReference': booking_ref,
        'flightNumber': f"{b['airlineIATA']}-{b['flightId']}",
        'passengerName': passenger_name,
        'airlineName': b['airlineName'],
        'airlineIATA': b['airlineIATA'],
        'airlineId': b['airlineId'],
        'depAirportName': b['depAirportName'],
        'depIATA': b['depIATA'],
        'depCity': b['depCity'],
        'arrAirportName': b['arrAirportName'],
        'arrIATA': b['arrIATA'],
        'arrCity': b['arrCity'],
        'depDateTime': b['dep_datetime'],
        'arrDateTime': b['arr_datetime'],
        'seatNumbers': ", ".join(seat_codes) if seat_codes else "Assigned",
        'seatClass': seat_class.capitalize(),
        'nbrLuggages': b['nbr_luggages'],
        'weight': b['weight'],
        'totalAmount': b['total_amount'],
        'paymentRef': b['payment_ref'],
        'status': b['status'],
        'gate': f"G{b['flightId'] % 12 + 1}",
        'terminal': f"T{b['flightId'] % 3 + 1}"
    }
