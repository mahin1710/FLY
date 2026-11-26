"""
FLY FLIGHT BOOKING & TICKET MANAGEMENT SYSTEM — DATABASE & TRANSACTION ENGINE
Author: mahin1710

Guarantees:
1. ACID-safe seat reservation & locking using explicit BEGIN IMMEDIATE transactions
   and database-level partial unique index `idx_active_seat_reservation`.
2. Non-destructive schema migrations preserving all existing airports, airlines,
   flights, accounts, and bookings in `database/flight_booking.db`.
3. Centralized authoritative fare calculation, configurable baggage policies
   (23 kg domestic / 40 kg international defaults), promo codes (FLY10),
   mock payment idempotency, PNR/e-ticket generation, and concurrency audit logs.
"""

import sqlite3
import os
import hashlib
import secrets
import json
import string
from datetime import datetime, timedelta
from config import Config

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
POSSIBLE_DB_PATHS = [
    Config.DATABASE_PATH,
    os.path.join(BASE_DIR, "database", "flight_booking.db"),
]


def get_db_path():
    for p in POSSIBLE_DB_PATHS:
        if p and os.path.exists(p):
            return p
    default_p = os.path.join(BASE_DIR, "database", "flight_booking.db")
    os.makedirs(os.path.dirname(default_p), exist_ok=True)
    return default_p


DB_PATH = get_db_path()


def get_db(isolation_level=""):
    """
    Returns a SQLite connection configured with WAL mode, foreign keys,
    and busy timeout for safe concurrent access.
    """
    conn = sqlite3.connect(DB_PATH, timeout=20, isolation_level=isolation_level)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=10000;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


# -------------------------------------------------------------
# PASSWORD HASHING (scrypt)
# -------------------------------------------------------------
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt.encode("utf-8"),
        n=16384,
        r=8,
        p=1,
        maxmem=0,
        dklen=64,
    )
    return f"scrypt:{salt}:{derived.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    if not stored_hash or not password:
        return False
    if stored_hash.startswith("scrypt:"):
        parts = stored_hash.split(":")
        if len(parts) != 3:
            return False
        salt = parts[1]
        orig_key = parts[2]
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt.encode("utf-8"),
            n=16384,
            r=8,
            p=1,
            maxmem=0,
            dklen=64,
        )
        if secrets.compare_digest(derived.hex(), orig_key):
            return True
        try:
            derived_hex = hashlib.scrypt(
                password.encode("utf-8"),
                salt=bytes.fromhex(salt),
                n=16384,
                r=8,
                p=1,
                maxmem=0,
                dklen=64,
            )
            if secrets.compare_digest(derived_hex.hex(), orig_key):
                return True
        except Exception:
            pass
        return False
    return secrets.compare_digest(stored_hash, password) or secrets.compare_digest(stored_hash, password.strip())


# -------------------------------------------------------------
# SAFE DATE & AUDIT LOG HELPERS
# -------------------------------------------------------------
def parse_dt_utc(dt_str):
    if not dt_str:
        return None
    try:
        clean = str(dt_str).replace("T", " ").replace("Z", "").strip()
        if "." in clean:
            clean = clean.split(".")[0]
        return datetime.strptime(clean[:19], "%Y-%m-%d %H:%M:%S")
    except Exception:
        try:
            return datetime.strptime(str(dt_str)[:16].replace("T", " "), "%Y-%m-%d %H:%M")
        except Exception:
            return None


def is_expired(expires_at_str) -> bool:
    exp_dt = parse_dt_utc(expires_at_str)
    if not exp_dt:
        return False
    return exp_dt <= datetime.utcnow()


def log_audit_event(
    cursor,
    event_type: str,
    result: str,
    actor_id=None,
    actor_role=None,
    airline_id=None,
    flight_id=None,
    seat_codes=None,
    reservation_ref=None,
    details=None,
    ip_address=None,
):
    """Writes an immutable concurrency or administrative audit log record (no PII/secrets)."""
    try:
        now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute(
            """
            INSERT INTO audit_logs (
                event_type, result, actor_id, actor_role, id_airline,
                flight_id, seat_codes, reservation_ref, details, ip_address, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_type,
                result,
                actor_id,
                actor_role,
                airline_id,
                flight_id,
                seat_codes,
                reservation_ref,
                details,
                ip_address,
                now_iso,
            ),
        )
    except Exception:
        pass


def record_standalone_audit(
    event_type: str,
    result: str,
    actor_id=None,
    actor_role=None,
    airline_id=None,
    flight_id=None,
    seat_codes=None,
    reservation_ref=None,
    details=None,
    ip_address=None,
):
    conn = get_db()
    try:
        cur = conn.cursor()
        log_audit_event(
            cur,
            event_type=event_type,
            result=result,
            actor_id=actor_id,
            actor_role=actor_role,
            airline_id=airline_id,
            flight_id=flight_id,
            seat_codes=seat_codes,
            reservation_ref=reservation_ref,
            details=details,
            ip_address=ip_address,
        )
        conn.commit()
    finally:
        conn.close()


# -------------------------------------------------------------
# SCHEMA MIGRATION & SEEDING (NON-DESTRUCTIVE)
# -------------------------------------------------------------
def _ensure_column(cursor, table: str, column: str, definition: str):
    cols = [r["name"] for r in cursor.execute(f"PRAGMA table_info({table});").fetchall()]
    if column not in cols:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition};")


def init_db():
    """Applies safe schema migrations, unique concurrency indexes, and repeatable seeds."""
    conn = get_db()
    cursor = conn.cursor()

    # 1. Accounts & Sessions
    _ensure_column(cursor, "accounts", "role", "TEXT DEFAULT 'PASSENGER'")
    _ensure_column(cursor, "accounts", "display_name", "TEXT")
    _ensure_column(cursor, "accounts", "location", "TEXT DEFAULT 'Dhaka, Bangladesh'")
    _ensure_column(cursor, "accounts", "is_active", "INTEGER DEFAULT 1")

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS auth_sessions (
            token TEXT PRIMARY KEY,
            account_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            role TEXT NOT NULL,
            airline_id INTEGER,
            ip_address TEXT,
            user_agent TEXT,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
        );
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_account ON auth_sessions(account_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON auth_sessions(expires_at);")

    # 2. Flights enhancements & indexes
    _ensure_column(cursor, "flights", "flight_number", "TEXT")
    _ensure_column(cursor, "flights", "aircraft_model", "TEXT")
    _ensure_column(cursor, "flights", "stops", "INTEGER DEFAULT 0")
    _ensure_column(cursor, "flights", "status", "TEXT DEFAULT 'SCHEDULED'")
    _ensure_column(cursor, "flights", "is_active", "INTEGER DEFAULT 1")

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_flights_route_dep ON flights(dep_airport, arr_airport, dep_datetime);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_flights_airline ON flights(id_airline, dep_datetime DESC);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_airports_iata ON airports(IATA);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_airports_city ON airports(city);")

    # 3. Bookings table & extended lifecycle columns
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_reference TEXT UNIQUE NOT NULL,
            id_account INTEGER NOT NULL,
            id_flight INTEGER NOT NULL,
            status TEXT NOT NULL,
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
        """
    )
    _ensure_column(cursor, "bookings", "passenger_data", "TEXT")
    _ensure_column(cursor, "bookings", "return_flight_id", "INTEGER")
    _ensure_column(cursor, "bookings", "multi_leg_data", "TEXT")
    _ensure_column(cursor, "bookings", "fare_breakdown", "TEXT")
    _ensure_column(cursor, "bookings", "trip_type", "TEXT DEFAULT 'one_way'")
    _ensure_column(cursor, "bookings", "pnr_code", "TEXT")
    _ensure_column(cursor, "bookings", "cabin_class", "TEXT DEFAULT 'Economy'")
    _ensure_column(cursor, "bookings", "extras_data", "TEXT")
    _ensure_column(cursor, "bookings", "discount_amount", "REAL DEFAULT 0")
    _ensure_column(cursor, "bookings", "promo_code", "TEXT")
    _ensure_column(cursor, "bookings", "lock_extensions", "INTEGER DEFAULT 0")
    _ensure_column(cursor, "bookings", "idempotency_key", "TEXT")
    _ensure_column(cursor, "bookings", "cancelled_at", "TEXT")
    _ensure_column(cursor, "bookings", "cancellation_reason", "TEXT")
    _ensure_column(cursor, "bookings", "refund_amount", "REAL DEFAULT 0")
    _ensure_column(cursor, "bookings", "refund_status", "TEXT")
    _ensure_column(cursor, "bookings", "contact_email", "TEXT")
    _ensure_column(cursor, "bookings", "contact_phone", "TEXT")
    _ensure_column(cursor, "bookings", "fee_policy_version", "TEXT DEFAULT 'FLY-POL-V1'")
    _ensure_column(cursor, "bookings", "cancellation_type", "TEXT")
    _ensure_column(cursor, "bookings", "fare_family", "TEXT DEFAULT 'STANDARD'")
    _ensure_column(cursor, "bookings", "is_test_booking", "INTEGER DEFAULT 1")

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_bookings_account ON bookings(id_account);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_bookings_flight ON bookings(id_flight, status);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_bookings_status_expires ON bookings(status, expires_at);")
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_pnr ON bookings(pnr_code) WHERE pnr_code IS NOT NULL;")
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_idempotency ON bookings(idempotency_key) WHERE idempotency_key IS NOT NULL;")

    # 4. Reservations table & CRITICAL DOUBLE-BOOKING UNIQUE INDEX FIX
    _ensure_column(cursor, "reservations", "booking_reference", "TEXT")
    _ensure_column(cursor, "reservations", "status", "TEXT DEFAULT 'CONFIRMED'")
    _ensure_column(cursor, "reservations", "created_at", "TEXT")
    _ensure_column(cursor, "reservations", "expires_at", "TEXT")
    _ensure_column(cursor, "reservations", "payment_ref", "TEXT")
    _ensure_column(cursor, "reservations", "total_price", "REAL DEFAULT 0")

    cursor.execute("DROP INDEX IF EXISTS idx_active_seat_reservation;")
    cursor.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_active_seat_reservation
        ON reservations (id_flight, id_seat)
        WHERE status IN ('PENDING_PAYMENT', 'HELD', 'LOCKED', 'CONFIRMED');
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_res_flight_status ON reservations(id_flight, status);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_res_booking_ref ON reservations(booking_reference);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_res_status_expires ON reservations(status, expires_at);")

    # 5. Favorites unique constraint
    cursor.execute(
        """
        DELETE FROM favorites WHERE id NOT IN (
            SELECT MIN(id) FROM favorites GROUP BY id_account, id_flight
        );
        """
    )
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_favorites_account_flight ON favorites(id_account, id_flight);")

    # 6. Baggage Policies (Configurable 23 kg domestic / 40 kg international)
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS baggage_policies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            id_airline INTEGER,
            route_scope TEXT NOT NULL CHECK(route_scope IN ('DOMESTIC', 'INTERNATIONAL')),
            included_checked_kg INTEGER NOT NULL DEFAULT 23,
            included_pieces INTEGER NOT NULL DEFAULT 1,
            cabin_kg INTEGER NOT NULL DEFAULT 7,
            extra_per_kg_fee REAL NOT NULL DEFAULT 120.0,
            extra_piece_fee REAL NOT NULL DEFAULT 350.0,
            updated_at TEXT NOT NULL
        );
        """
    )
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_baggage_policy ON baggage_policies(COALESCE(id_airline, 0), route_scope);")

    # 7. Promo Codes
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS promo_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            discount_type TEXT NOT NULL CHECK(discount_type IN ('PERCENT', 'FIXED')),
            discount_value REAL NOT NULL,
            min_fare REAL NOT NULL DEFAULT 0,
            max_discount REAL,
            usage_limit INTEGER NOT NULL DEFAULT 1000,
            used_count INTEGER NOT NULL DEFAULT 0,
            id_airline INTEGER,
            expires_at TEXT,
            is_active INTEGER NOT NULL DEFAULT 1
        );
        """
    )

    # 8. Saved Travelers
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS saved_travelers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            id_account INTEGER NOT NULL,
            title TEXT DEFAULT 'MR',
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            date_of_birth TEXT,
            gender TEXT,
            nationality TEXT DEFAULT 'BD',
            document_type TEXT DEFAULT 'passport',
            document_number_masked TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(id_account) REFERENCES accounts(id) ON DELETE CASCADE
        );
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_saved_travelers_acc ON saved_travelers(id_account);")

    # 9. Payments (Mock Gateway + Idempotency)
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_reference TEXT NOT NULL,
            id_account INTEGER NOT NULL,
            idempotency_key TEXT UNIQUE NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'BDT',
            payment_method TEXT NOT NULL,
            scenario TEXT NOT NULL DEFAULT 'SIMULATE_SUCCESS',
            status TEXT NOT NULL CHECK(status IN ('CAPTURED', 'FAILED', 'TIMEOUT')),
            transaction_ref TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(id_account) REFERENCES accounts(id)
        );
        """
    )

    # 10. Official E-Tickets
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_number TEXT UNIQUE NOT NULL,
            pnr_code TEXT NOT NULL,
            booking_reference TEXT NOT NULL,
            id_account INTEGER NOT NULL,
            id_flight INTEGER NOT NULL,
            id_airline INTEGER NOT NULL,
            passenger_name TEXT NOT NULL,
            seat_codes TEXT NOT NULL,
            cabin_class TEXT NOT NULL,
            baggage_allowance TEXT NOT NULL,
            verification_token TEXT UNIQUE NOT NULL,
            status TEXT NOT NULL DEFAULT 'ISSUED' CHECK(status IN ('ISSUED', 'CANCELLED', 'REFUNDED')),
            issued_at TEXT NOT NULL,
            FOREIGN KEY(id_account) REFERENCES accounts(id),
            FOREIGN KEY(id_flight) REFERENCES flights(id),
            FOREIGN KEY(id_airline) REFERENCES airLines(id)
        );
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tickets_booking_ref ON tickets(booking_reference);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tickets_pnr ON tickets(pnr_code);")

    # 11. Refund Requests
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS refund_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_reference TEXT NOT NULL,
            id_account INTEGER NOT NULL,
            id_airline INTEGER NOT NULL,
            reason TEXT NOT NULL,
            requested_amount REAL NOT NULL,
            approved_amount REAL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
            reviewed_by INTEGER,
            review_note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(id_account) REFERENCES accounts(id),
            FOREIGN KEY(id_airline) REFERENCES airLines(id)
        );
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_refunds_airline ON refund_requests(id_airline, status);")

    # 12. Concurrency & Admin Audit Logs
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            result TEXT NOT NULL,
            actor_id INTEGER,
            actor_role TEXT,
            id_airline INTEGER,
            flight_id INTEGER,
            seat_codes TEXT,
            reservation_ref TEXT,
            details TEXT,
            ip_address TEXT,
            created_at TEXT NOT NULL
        );
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_airline ON audit_logs(id_airline, created_at DESC);")

    # 13. Masked Saved Cards (PCI-safe replacement for creditCards CVV storage)
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS saved_cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            id_account INTEGER NOT NULL,
            card_holder TEXT NOT NULL,
            card_brand TEXT NOT NULL DEFAULT 'CARD',
            last4 TEXT NOT NULL,
            exp_month TEXT NOT NULL,
            exp_year TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(id_account) REFERENCES accounts(id) ON DELETE CASCADE
        );
        """
    )

    # 14. Extended Tickets Columns & Multi-Segment / QR / Scan History (Part A, D, E)
    _ensure_column(cursor, "tickets", "passenger_id", "INTEGER")
    _ensure_column(cursor, "tickets", "passenger_index", "INTEGER DEFAULT 1")
    _ensure_column(cursor, "tickets", "issuance_state", "TEXT DEFAULT 'ISSUED'")
    _ensure_column(cursor, "tickets", "checkin_status", "TEXT DEFAULT 'NOT_CHECKED_IN'")
    _ensure_column(cursor, "tickets", "checked_in_at", "TEXT")
    _ensure_column(cursor, "tickets", "checked_in_by", "INTEGER")
    _ensure_column(cursor, "tickets", "is_test_ticket", "INTEGER DEFAULT 1")
    _ensure_column(cursor, "tickets", "fare_family", "TEXT DEFAULT 'STANDARD'")
    _ensure_column(cursor, "tickets", "provider_name", "TEXT DEFAULT 'DEMO_LOCAL'")
    _ensure_column(cursor, "tickets", "airline_pnr", "TEXT")
    _ensure_column(cursor, "tickets", "fee_policy_version", "TEXT DEFAULT 'FLY-POL-V1'")
    _ensure_column(cursor, "tickets", "updated_at", "TEXT")

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS ticket_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id INTEGER NOT NULL,
            booking_reference TEXT NOT NULL,
            id_flight INTEGER NOT NULL,
            segment_order INTEGER NOT NULL DEFAULT 1,
            origin_iata TEXT NOT NULL,
            dest_iata TEXT NOT NULL,
            dep_datetime TEXT NOT NULL,
            arr_datetime TEXT NOT NULL,
            coupon_status TEXT NOT NULL DEFAULT 'OPEN' CHECK(coupon_status IN ('OPEN', 'CHECKED_IN', 'USED', 'VOID', 'CANCELLED', 'REFUNDED')),
            seat_code TEXT,
            cabin_class TEXT DEFAULT 'Economy',
            FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
            FOREIGN KEY(id_flight) REFERENCES flights(id)
        );
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ticket_segments_ticket ON ticket_segments(ticket_id, segment_order);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ticket_segments_ref ON ticket_segments(booking_reference);")

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS ticket_qr_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id INTEGER NOT NULL,
            token_hash TEXT UNIQUE NOT NULL,
            token_nonce TEXT NOT NULL,
            token_version INTEGER NOT NULL DEFAULT 1,
            is_test_token INTEGER NOT NULL DEFAULT 1,
            issued_at TEXT NOT NULL,
            expires_at TEXT,
            revoked_at TEXT,
            revoke_reason TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
        );
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_qr_tokens_ticket ON ticket_qr_tokens(ticket_id, revoked_at);")
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_qr_token_version ON ticket_qr_tokens(ticket_id, token_version);")

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS ticket_scan_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id INTEGER,
            qr_token_id INTEGER,
            scan_result TEXT NOT NULL,
            scan_source TEXT NOT NULL,
            scanned_by INTEGER,
            ip_address TEXT,
            user_agent TEXT,
            device_ref TEXT,
            checkin_event INTEGER NOT NULL DEFAULT 0,
            scanned_at TEXT NOT NULL,
            FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE SET NULL,
            FOREIGN KEY(qr_token_id) REFERENCES ticket_qr_tokens(id) ON DELETE SET NULL
        );
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_scan_logs_ticket ON ticket_scan_logs(ticket_id, scanned_at DESC);")

    # 15. Versioned Fee Policies & Per-Airline Fare Rules (Part F, G)
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS fee_policies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            booking_service_fee_minor INTEGER NOT NULL DEFAULT 0,
            cancellation_service_fee_minor INTEGER NOT NULL DEFAULT 50000,
            refund_processing_fee_minor INTEGER NOT NULL DEFAULT 0,
            waive_on_airline_cancel INTEGER NOT NULL DEFAULT 1,
            waive_on_ticketing_error INTEGER NOT NULL DEFAULT 1,
            waive_on_schedule_change INTEGER NOT NULL DEFAULT 1,
            currency TEXT NOT NULL DEFAULT 'BDT',
            legal_notes TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            updated_by INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS fare_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            id_airline INTEGER,
            fare_family TEXT NOT NULL,
            is_refundable INTEGER NOT NULL DEFAULT 1,
            voluntary_cancel_fee_minor INTEGER NOT NULL DEFAULT 150000,
            no_show_fee_minor INTEGER NOT NULL DEFAULT 250000,
            partial_cancel_allowed INTEGER NOT NULL DEFAULT 1,
            split_pnr_required INTEGER NOT NULL DEFAULT 0,
            min_hours_before_dep INTEGER NOT NULL DEFAULT 4,
            tax_refundable_pct INTEGER NOT NULL DEFAULT 100,
            airline_charge_refundable INTEGER NOT NULL DEFAULT 1,
            ancillary_refundable INTEGER NOT NULL DEFAULT 0,
            notes TEXT,
            updated_at TEXT NOT NULL
        );
        """
    )
    cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_fare_rule_airline_fam ON fare_rules(COALESCE(id_airline, 0), fare_family);")

    # 16. Cancellations, Immutable Quotes, Refunds, Adapters & Financial Ledger (Part F-M)
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS cancellations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cancellation_ref TEXT UNIQUE NOT NULL,
            booking_reference TEXT NOT NULL,
            id_account INTEGER NOT NULL,
            id_airline INTEGER NOT NULL,
            cancellation_type TEXT NOT NULL CHECK(cancellation_type IN (
                'VOLUNTARY', 'AIRLINE_INITIATED', 'SCHEDULE_CHANGE', 'PARTIAL',
                'NO_SHOW', 'BEFORE_ISSUANCE', 'TICKETING_FAILURE'
            )),
            status TEXT NOT NULL CHECK(status IN (
                'REQUESTED', 'QUOTE_PENDING', 'QUOTE_READY', 'CUSTOMER_CONFIRMATION_REQUIRED',
                'SUPPLIER_CANCEL_PENDING', 'CANCELLED_BY_SUPPLIER', 'REJECTED', 'MANUAL_REVIEW', 'FAILED'
            )),
            reason TEXT NOT NULL,
            quote_id INTEGER,
            customer_confirmed INTEGER NOT NULL DEFAULT 0,
            customer_confirmed_at TEXT,
            supplier_ref TEXT,
            supplier_status TEXT,
            supplier_response_json TEXT,
            alternative_options_json TEXT,
            is_partial INTEGER NOT NULL DEFAULT 0,
            is_test INTEGER NOT NULL DEFAULT 1,
            created_by INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(id_account) REFERENCES accounts(id),
            FOREIGN KEY(id_airline) REFERENCES airLines(id)
        );
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_cancellations_booking ON cancellations(booking_reference);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_cancellations_airline ON cancellations(id_airline, status);")

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS cancellation_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cancellation_id INTEGER NOT NULL,
            ticket_id INTEGER,
            segment_id INTEGER,
            passenger_name TEXT,
            seat_code TEXT,
            item_type TEXT NOT NULL CHECK(item_type IN ('PASSENGER', 'SEGMENT', 'ANCILLARY', 'FULL')),
            item_status TEXT NOT NULL DEFAULT 'PENDING',
            amount_minor INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(cancellation_id) REFERENCES cancellations(id) ON DELETE CASCADE,
            FOREIGN KEY(ticket_id) REFERENCES tickets(id),
            FOREIGN KEY(segment_id) REFERENCES ticket_segments(id)
        );
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS refund_quotes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quote_ref TEXT UNIQUE NOT NULL,
            booking_reference TEXT NOT NULL,
            cancellation_type TEXT NOT NULL,
            currency TEXT NOT NULL DEFAULT 'BDT',
            fare_family TEXT NOT NULL,
            coupon_state TEXT NOT NULL,
            no_show_detected INTEGER NOT NULL DEFAULT 0,
            fee_policy_version TEXT NOT NULL,
            original_paid_minor INTEGER NOT NULL,
            airline_penalty_minor INTEGER NOT NULL DEFAULT 0,
            supplier_charge_minor INTEGER NOT NULL DEFAULT 0,
            non_refundable_tax_minor INTEGER NOT NULL DEFAULT 0,
            refundable_tax_minor INTEGER NOT NULL DEFAULT 0,
            fly_service_fee_minor INTEGER NOT NULL DEFAULT 0,
            other_deductions_minor INTEGER NOT NULL DEFAULT 0,
            final_refund_minor INTEGER NOT NULL DEFAULT 0,
            refundable_eligible INTEGER NOT NULL DEFAULT 1,
            supplier_quote_ref TEXT,
            expires_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'EXPIRED', 'CONFIRMED', 'REJECTED')),
            breakdown_json TEXT,
            created_by INTEGER,
            created_at TEXT NOT NULL
        );
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_refund_quotes_booking ON refund_quotes(booking_reference, created_at DESC);")

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS refund_quote_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quote_id INTEGER NOT NULL,
            line_code TEXT NOT NULL,
            label TEXT NOT NULL,
            category TEXT NOT NULL CHECK(category IN ('CREDIT', 'DEDUCTION', 'INFO')),
            amount_minor INTEGER NOT NULL,
            currency TEXT NOT NULL DEFAULT 'BDT',
            authority_source TEXT NOT NULL,
            FOREIGN KEY(quote_id) REFERENCES refund_quotes(id) ON DELETE CASCADE
        );
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS refunds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            refund_ref TEXT UNIQUE NOT NULL,
            cancellation_id INTEGER,
            quote_id INTEGER,
            booking_reference TEXT NOT NULL,
            id_account INTEGER NOT NULL,
            id_airline INTEGER NOT NULL,
            cancellation_type TEXT NOT NULL DEFAULT 'VOLUNTARY',
            currency TEXT NOT NULL DEFAULT 'BDT',
            approved_amount_minor INTEGER NOT NULL DEFAULT 0,
            settled_amount_minor INTEGER NOT NULL DEFAULT 0,
            payment_method TEXT NOT NULL,
            original_payment_ref TEXT,
            refund_destination TEXT,
            status TEXT NOT NULL CHECK(status IN (
                'NOT_ELIGIBLE', 'QUOTE_READY', 'APPROVAL_PENDING', 'SUBMITTED_TO_SUPPLIER',
                'SUPPLIER_APPROVED', 'GATEWAY_REFUND_PENDING', 'GATEWAY_PROCESSING',
                'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED', 'RECONCILIATION_REQUIRED'
            )),
            estimated_window TEXT,
            provider_ref TEXT,
            failure_reason TEXT,
            requires_manual INTEGER NOT NULL DEFAULT 0,
            dual_approval_required INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(cancellation_id) REFERENCES cancellations(id),
            FOREIGN KEY(quote_id) REFERENCES refund_quotes(id),
            FOREIGN KEY(id_account) REFERENCES accounts(id),
            FOREIGN KEY(id_airline) REFERENCES airLines(id)
        );
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_refunds_booking_new ON refunds(booking_reference);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_refunds_status_new ON refunds(id_airline, status, created_at DESC);")

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS refund_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            refund_id INTEGER NOT NULL,
            refund_txn_ref TEXT UNIQUE NOT NULL,
            idempotency_key TEXT UNIQUE NOT NULL,
            adapter_name TEXT NOT NULL,
            operation TEXT NOT NULL,
            amount_minor INTEGER NOT NULL,
            currency TEXT NOT NULL DEFAULT 'BDT',
            status TEXT NOT NULL,
            gateway_ref TEXT,
            raw_response_json TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(refund_id) REFERENCES refunds(id) ON DELETE CASCADE
        );
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS refund_status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            refund_id INTEGER NOT NULL,
            from_status TEXT,
            to_status TEXT NOT NULL,
            stage_label TEXT NOT NULL,
            note TEXT,
            actor_id INTEGER,
            actor_role TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(refund_id) REFERENCES refunds(id) ON DELETE CASCADE
        );
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_refund_hist_ref ON refund_status_history(refund_id, id ASC);")

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS supplier_refund_references (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            refund_id INTEGER NOT NULL,
            cancellation_id INTEGER NOT NULL,
            supplier_name TEXT NOT NULL,
            supplier_cancel_ref TEXT,
            supplier_refund_ref TEXT,
            bsp_settlement_status TEXT NOT NULL DEFAULT 'PENDING',
            settled_at TEXT,
            raw_payload TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(refund_id) REFERENCES refunds(id) ON DELETE CASCADE,
            FOREIGN KEY(cancellation_id) REFERENCES cancellations(id) ON DELETE CASCADE
        );
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS manual_refund_approvals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            refund_id INTEGER NOT NULL,
            requested_by INTEGER,
            reason TEXT NOT NULL,
            first_approver_id INTEGER,
            first_approved_at TEXT,
            second_approver_id INTEGER,
            second_approved_at TEXT,
            transfer_reference TEXT,
            evidence_ref TEXT,
            evidence_notes TEXT,
            bank_account_masked TEXT,
            settlement_verified INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'FIRST_APPROVED', 'APPROVED', 'SETTLED', 'REJECTED')),
            created_at TEXT NOT NULL,
            FOREIGN KEY(refund_id) REFERENCES refunds(id) ON DELETE CASCADE
        );
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS financial_ledger_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_ref TEXT UNIQUE NOT NULL,
            booking_reference TEXT NOT NULL,
            refund_id INTEGER,
            cancellation_id INTEGER,
            entry_type TEXT NOT NULL,
            direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
            amount_minor INTEGER NOT NULL,
            currency TEXT NOT NULL DEFAULT 'BDT',
            original_currency TEXT NOT NULL DEFAULT 'BDT',
            fx_rate TEXT NOT NULL DEFAULT '1.0000',
            reference_id TEXT,
            description TEXT,
            created_by INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY(refund_id) REFERENCES refunds(id),
            FOREIGN KEY(cancellation_id) REFERENCES cancellations(id)
        );
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ledger_booking ON financial_ledger_entries(booking_reference, id DESC);")

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS notification_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_reference TEXT NOT NULL,
            recipient_email TEXT,
            channel TEXT NOT NULL DEFAULT 'EMAIL',
            subject TEXT NOT NULL,
            body_summary TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'QUEUED_DEV_LOG',
            metadata_json TEXT,
            created_at TEXT NOT NULL
        );
        """
    )

    # 6. Seed Versioned Service Fee Policy (Part G3) & Per-Airline Fare Rules (Part F3/G1)
    cursor.execute(
        """
        INSERT OR IGNORE INTO fee_policies (
            version, name, booking_service_fee_minor, cancellation_service_fee_minor,
            refund_processing_fee_minor, waive_on_airline_cancel, waive_on_ticketing_error,
            waive_on_schedule_change, currency, legal_notes, is_active, created_at, updated_at
        )
        VALUES (
            'FLY-POL-V1',
            'Standard FLY Service Fee Policy v1',
            0,
            35000,
            0,
            1,
            1,
            1,
            'BDT',
            'Cancellation service fee BDT 350 disclosed prior to purchase. Automatically waived on airline-initiated cancellations, schedule changes, and ticketing failures.',
            1,
            ?,
            ?
        )
        """,
        (now_iso, now_iso),
    )

    seeded_fare_rules = [
        # (id_airline, fare_family, is_refundable, vol_fee_minor, noshow_fee_minor, partial_ok, split_pnr, min_hrs, tax_pct, air_chg_ref, anc_ref, notes)
        (None, "SAVER", 0, 0, 0, 0, 1, 24, 100, 0, 0, "Non-refundable promotional fare; unused government/airport taxes remain eligible."),
        (None, "STANDARD", 1, 80000, 200000, 1, 1, 4, 100, 1, 0, "Standard refundable fare subject to carrier penalty & FLY disclosed policy."),
        (None, "FLEX", 1, 40000, 120000, 1, 0, 2, 100, 1, 1, "Flexible refundable fare with reduced penalty & ancillary refundability."),
        (None, "BUSINESS", 1, 50000, 150000, 1, 0, 2, 100, 1, 1, "Business cabin fare with low cancellation penalty."),
        (None, "FIRST", 1, 50000, 150000, 1, 0, 2, 100, 1, 1, "First class cabin fare with priority refund handling."),
        (839, "STANDARD", 1, 75000, 180000, 1, 1, 4, 100, 1, 0, "Biman Bangladesh Standard fare cancellation tariff."),
        (839, "SAVER", 0, 0, 0, 0, 1, 24, 100, 0, 0, "Biman Super Saver non-refundable; unused taxes refundable."),
        (839, "BUSINESS", 1, 60000, 140000, 1, 0, 2, 100, 1, 1, "Biman Business flexible penalty rule."),
        (371, "STANDARD", 1, 65000, 160000, 1, 1, 4, 100, 1, 0, "US-Bangla Airlines Standard fare cancellation tariff."),
        (371, "SAVER", 0, 0, 0, 0, 1, 24, 100, 0, 0, "US-Bangla Saver non-refundable except unused govt taxes."),
        (396, "STANDARD", 1, 450000, 750000, 1, 1, 6, 100, 1, 0, "Emirates International Economy Flex cancellation tariff."),
        (396, "BUSINESS", 1, 300000, 600000, 1, 0, 4, 100, 1, 1, "Emirates Business Class fare rules."),
    ]
    for aid, ffam, is_ref, vfee, nsfee, p_ok, sp_pnr, mhrs, tpct, achg, anc, note in seeded_fare_rules:
        cursor.execute(
            """
            INSERT OR IGNORE INTO fare_rules (
                id_airline, fare_family, is_refundable, voluntary_cancel_fee_minor,
                no_show_fee_minor, partial_cancel_allowed, split_pnr_required,
                min_hours_before_dep, tax_refundable_pct, airline_charge_refundable,
                ancillary_refundable, notes, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (aid, ffam, is_ref, vfee, nsfee, p_ok, sp_pnr, mhrs, tpct, achg, anc, note, now_iso),
        )

    # 7. Backfill missing QR token hashes & flight segments for legacy ISSUED tickets cleanly
    try:
        from fly.services import qr_service
        legacy_tickets = cursor.execute(
            """
            SELECT t.*, b.status as booking_status, f.dep_datetime, f.arr_datetime,
                   da.IATA as depIATA, aa.IATA as arrIATA
            FROM tickets t
            JOIN bookings b ON t.booking_reference = b.booking_reference
            JOIN flights f ON t.id_flight = f.id
            JOIN airports da ON f.dep_airport = da.id
            JOIN airports aa ON f.arr_airport = aa.id
            WHERE NOT EXISTS (SELECT 1 FROM ticket_qr_tokens qt WHERE qt.ticket_id = t.id)
            """
        ).fetchall()
        for lt in legacy_tickets:
            seg_cnt = cursor.execute("SELECT COUNT(*) FROM ticket_segments WHERE ticket_id = ?", (lt["id"],)).fetchone()[0]
            if seg_cnt == 0:
                c_stat = "CANCELLED" if lt["status"] in ("CANCELLED", "REFUNDED") else "OPEN"
                cursor.execute(
                    """
                    INSERT INTO ticket_segments (
                        ticket_id, booking_reference, id_flight, segment_order,
                        origin_iata, dest_iata, dep_datetime, arr_datetime, coupon_status, seat_code, cabin_class
                    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        lt["id"], lt["booking_reference"], lt["id_flight"],
                        lt["depIATA"], lt["arrIATA"], lt["dep_datetime"], lt["arr_datetime"],
                        c_stat, lt["seat_codes"], lt["cabin_class"],
                    ),
                )
            if lt["status"] == "ISSUED" and lt["booking_status"] == "CONFIRMED":
                qr_service.issue_qr_for_ticket(cursor, lt["id"], issuance_state="ISSUED", is_test_ticket=True)
    except Exception:
        pass

    conn.commit()
    conn.close()

    seed_initial_data()


def seed_initial_data():
    """Idempotently seeds roles, baggage rules, promos, and future BD/DXB flights."""
    conn = get_db()
    cursor = conn.cursor()
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    # 1. Normalize legacy airline account roles so airline isolation is consistent
    cursor.execute(
        """
        UPDATE accounts
        SET role = 'AIRLINE_ADMIN'
        WHERE id_airline IS NOT NULL AND (role IS NULL OR UPPER(role) = 'PASSENGER');
        """
    )

    # 2. Seed core passenger, airline admin, and system admin accounts
    demo_accounts = [
        {"username": "Mahin0", "password": "Mahin0", "role": "PASSENGER", "display_name": "MMH_Mahin", "airline_id": None, "email": "mahin0@flight.bd"},
        {"username": "Mahin1", "password": "Mahin1", "role": "PASSENGER", "display_name": "Chittagong Traveler", "airline_id": None, "email": "mahin1@flight.bd"},
        {"username": "Admin_Biman", "password": "Admin_Biman", "role": "AIRLINE_ADMIN", "display_name": "Biman Bangladesh Airlines", "airline_id": 839, "email": "admin.biman@biman-airlines.com"},
        {"username": "Admin_USB", "password": "Admin_USB", "role": "AIRLINE_ADMIN", "display_name": "US-Bangla Airlines", "airline_id": 371, "email": "admin.usb@usbair.com"},
        {"username": "Admin_EK", "password": "Admin_EK", "role": "AIRLINE_ADMIN", "display_name": "Emirates Operations", "airline_id": 396, "email": "admin.ek@emirates.com"},
        {"username": "SystemAdmin", "password": "SystemAdmin", "role": "SYSTEM_ADMIN", "display_name": "FLY System Administrator", "airline_id": None, "email": "sysadmin@fly-booking.com"},
    ]
    for acc in demo_accounts:
        cursor.execute("SELECT id, password FROM accounts WHERE username = ? COLLATE NOCASE", (acc["username"],))
        row = cursor.fetchone()
        if not row:
            cursor.execute(
                """
                INSERT INTO accounts (username, password, emailAddress, role, display_name, id_airline, location)
                VALUES (?, ?, ?, ?, ?, ?, 'Dhaka, Bangladesh')
                """,
                (acc["username"], hash_password(acc["password"]), acc["email"], acc["role"], acc["display_name"], acc["airline_id"]),
            )
        else:
            pwd_val = row["password"]
            if not pwd_val or not str(pwd_val).startswith("scrypt:"):
                pwd_val = hash_password(acc["password"])
            cursor.execute(
                """
                UPDATE accounts SET role = ?, display_name = ?, id_airline = ?, password = ?
                WHERE id = ?
                """,
                (acc["role"], acc["display_name"], acc["airline_id"], pwd_val, row["id"]),
            )

    # 3. Seed Global & Airline Baggage Policies (23 kg Domestic, 40 kg International)
    default_policies = [
        (None, "DOMESTIC", 23, 1, 7, 120.0, 350.0),
        (None, "INTERNATIONAL", 40, 2, 7, 250.0, 1200.0),
        (839, "DOMESTIC", 23, 1, 7, 120.0, 350.0),
        (839, "INTERNATIONAL", 40, 2, 7, 250.0, 1200.0),
        (371, "DOMESTIC", 23, 1, 7, 110.0, 320.0),
        (371, "INTERNATIONAL", 40, 2, 7, 230.0, 1100.0),
        (396, "INTERNATIONAL", 40, 2, 7, 300.0, 1500.0),
    ]
    for aid, scope, kg, pcs, cab_kg, per_kg, per_pc in default_policies:
        cursor.execute(
            """
            INSERT OR IGNORE INTO baggage_policies
                (id_airline, route_scope, included_checked_kg, included_pieces, cabin_kg, extra_per_kg_fee, extra_piece_fee, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (aid, scope, kg, pcs, cab_kg, per_kg, per_pc, now_iso),
        )

    # 4. Seed Promo Codes (FLY10 & DHAKA500)
    promos = [
        ("FLY10", "PERCENT", 10.0, 2000.0, 5000.0, 5000, None, "2027-12-31 23:59:59"),
        ("DHAKA500", "FIXED", 500.0, 3500.0, 500.0, 2000, None, "2027-12-31 23:59:59"),
    ]
    for code, dtype, dval, mfare, maxd, ulim, aid, exp in promos:
        cursor.execute(
            """
            INSERT OR IGNORE INTO promo_codes
                (code, discount_type, discount_value, min_fare, max_discount, usage_limit, id_airline, expires_at, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (code, dtype, dval, mfare, maxd, ulim, aid, exp),
        )

    # 5. Seed repeatable realistic upcoming flights (DAC, CXB, CGP, ZYL, DXB across BG, BS, EK)
    # Only insert if fewer than 12 future flights exist on these core routes.
    future_count = cursor.execute(
        """
        SELECT COUNT(*) FROM flights f
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE da.IATA IN ('DAC','CXB','CGP','ZYL','DXB')
          AND aa.IATA IN ('DAC','CXB','CGP','ZYL','DXB')
          AND f.dep_datetime >= '2026-12-01'
        """
    ).fetchone()[0]

    if future_count < 12:
        ap_rows = cursor.execute(
            "SELECT id, IATA FROM airports WHERE IATA IN ('DAC','CXB','CGP','ZYL','DXB')"
        ).fetchall()
        ap_map = {r["IATA"]: r["id"] for r in ap_rows}
        if len(ap_map) == 5:
            seed_schedules = [
                (839, "BG-433", "DAC", "CXB", "2026-12-05 09:30", "2026-12-05 10:25", "Boeing 737-800", 0, 14500, 9200, 4500),
                (371, "BS-141", "DAC", "CXB", "2026-12-05 14:15", "2026-12-05 15:10", "ATR 72-600", 0, 13800, 8800, 4300),
                (839, "BG-434", "CXB", "DAC", "2026-12-08 16:30", "2026-12-08 17:25", "Boeing 737-800", 0, 14500, 9200, 4500),
                (371, "BS-103", "DAC", "CGP", "2026-12-06 08:00", "2026-12-06 08:50", "ATR 72-600", 0, 12500, 7900, 3800),
                (839, "BG-611", "DAC", "CGP", "2026-12-06 18:10", "2026-12-06 19:00", "Dash 8-Q400", 0, 13000, 8200, 4000),
                (371, "BS-104", "CGP", "DAC", "2026-12-09 19:30", "2026-12-09 20:20", "ATR 72-600", 0, 12500, 7900, 3800),
                (839, "BG-601", "DAC", "ZYL", "2026-12-07 11:00", "2026-12-07 11:45", "Dash 8-Q400", 0, 11800, 7400, 3500),
                (371, "BS-535", "ZYL", "DAC", "2026-12-10 17:30", "2026-12-10 18:15", "ATR 72-600", 0, 11800, 7400, 3500),
                (839, "BG-347", "DAC", "DXB", "2026-12-12 18:30", "2026-12-12 22:15", "Boeing 787-8 Dreamliner", 0, 145000, 92000, 48500),
                (396, "EK-585", "DAC", "DXB", "2026-12-12 10:15", "2026-12-12 13:50", "Boeing 777-300ER", 0, 195000, 118000, 62000),
                (396, "EK-582", "DXB", "DAC", "2026-12-18 01:45", "2026-12-18 08:20", "Boeing 777-300ER", 0, 195000, 118000, 62000),
                (839, "BG-348", "DXB", "DAC", "2026-12-19 23:45", "2026-12-20 06:30", "Boeing 787-8 Dreamliner", 0, 145000, 92000, 48500),
            ]
            for aid, fnum, dep_c, arr_c, dep_dt, arr_dt, model, stops, p1, p2, p3 in seed_schedules:
                exists = cursor.execute(
                    "SELECT id FROM flights WHERE id_airline=? AND dep_airport=? AND arr_airport=? AND dep_datetime=?",
                    (aid, ap_map[dep_c], ap_map[arr_c], dep_dt),
                ).fetchone()
                if not exists:
                    cursor.execute(
                        """
                        INSERT INTO flights (
                            id_airline, flight_number, dep_airport, arr_airport,
                            dep_datetime, arr_datetime, aircraft_model, stops, status,
                            first_price, business_price, economy_price, luggage_price, weight_price, is_active
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, 350.0, 120.0, 1)
                        """,
                        (aid, fnum, ap_map[dep_c], ap_map[arr_c], dep_dt, arr_dt, model, stops, p1, p2, p3),
                    )

    # 6. Seed Versioned Service Fee Policy (Part G3) & Per-Airline Fare Rules (Part F3/G1)
    cursor.execute(
        """
        INSERT OR IGNORE INTO fee_policies (
            version, name, booking_service_fee_minor, cancellation_service_fee_minor,
            refund_processing_fee_minor, waive_on_airline_cancel, waive_on_ticketing_error,
            waive_on_schedule_change, currency, legal_notes, is_active, created_at, updated_at
        )
        VALUES (
            'FLY-POL-V1',
            'Standard FLY Service Fee Policy v1',
            0,
            35000,
            0,
            1,
            1,
            1,
            'BDT',
            'Cancellation service fee BDT 350 disclosed prior to purchase. Automatically waived on airline-initiated cancellations, schedule changes, and ticketing failures.',
            1,
            ?,
            ?
        )
        """,
        (now_iso, now_iso),
    )

    seeded_fare_rules = [
        # (id_airline, fare_family, is_refundable, vol_fee_minor, noshow_fee_minor, partial_ok, split_pnr, min_hrs, tax_pct, air_chg_ref, anc_ref, notes)
        (None, "SAVER", 0, 0, 0, 0, 1, 24, 100, 0, 0, "Non-refundable promotional fare; unused government/airport taxes remain eligible."),
        (None, "STANDARD", 1, 80000, 200000, 1, 1, 4, 100, 1, 0, "Standard refundable fare subject to carrier penalty & FLY disclosed policy."),
        (None, "FLEX", 1, 40000, 120000, 1, 0, 2, 100, 1, 1, "Flexible refundable fare with reduced penalty & ancillary refundability."),
        (None, "BUSINESS", 1, 50000, 150000, 1, 0, 2, 100, 1, 1, "Business cabin fare with low cancellation penalty."),
        (None, "FIRST", 1, 50000, 150000, 1, 0, 2, 100, 1, 1, "First class cabin fare with priority refund handling."),
        (839, "STANDARD", 1, 75000, 180000, 1, 1, 4, 100, 1, 0, "Biman Bangladesh Standard fare cancellation tariff."),
        (839, "SAVER", 0, 0, 0, 0, 1, 24, 100, 0, 0, "Biman Super Saver non-refundable; unused taxes refundable."),
        (839, "BUSINESS", 1, 60000, 140000, 1, 0, 2, 100, 1, 1, "Biman Business flexible penalty rule."),
        (371, "STANDARD", 1, 65000, 160000, 1, 1, 4, 100, 1, 0, "US-Bangla Airlines Standard fare cancellation tariff."),
        (371, "SAVER", 0, 0, 0, 0, 1, 24, 100, 0, 0, "US-Bangla Saver non-refundable except unused govt taxes."),
        (396, "STANDARD", 1, 450000, 750000, 1, 1, 6, 100, 1, 0, "Emirates International Economy Flex cancellation tariff."),
        (396, "BUSINESS", 1, 300000, 600000, 1, 0, 4, 100, 1, 1, "Emirates Business Class fare rules."),
    ]
    for aid, ffam, is_ref, vfee, nsfee, p_ok, sp_pnr, mhrs, tpct, achg, anc, note in seeded_fare_rules:
        cursor.execute(
            """
            INSERT OR IGNORE INTO fare_rules (
                id_airline, fare_family, is_refundable, voluntary_cancel_fee_minor,
                no_show_fee_minor, partial_cancel_allowed, split_pnr_required,
                min_hours_before_dep, tax_refundable_pct, airline_charge_refundable,
                ancillary_refundable, notes, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (aid, ffam, is_ref, vfee, nsfee, p_ok, sp_pnr, mhrs, tpct, achg, anc, note, now_iso),
        )

    # 7. Backfill missing QR token hashes & flight segments for legacy ISSUED tickets cleanly
    try:
        from fly.services import qr_service
        legacy_tickets = cursor.execute(
            """
            SELECT t.*, b.status as booking_status, f.dep_datetime, f.arr_datetime,
                   da.IATA as depIATA, aa.IATA as arrIATA
            FROM tickets t
            JOIN bookings b ON t.booking_reference = b.booking_reference
            JOIN flights f ON t.id_flight = f.id
            JOIN airports da ON f.dep_airport = da.id
            JOIN airports aa ON f.arr_airport = aa.id
            WHERE NOT EXISTS (SELECT 1 FROM ticket_qr_tokens qt WHERE qt.ticket_id = t.id)
            """
        ).fetchall()
        for lt in legacy_tickets:
            seg_cnt = cursor.execute("SELECT COUNT(*) FROM ticket_segments WHERE ticket_id = ?", (lt["id"],)).fetchone()[0]
            if seg_cnt == 0:
                c_stat = "CANCELLED" if lt["status"] in ("CANCELLED", "REFUNDED") else "OPEN"
                cursor.execute(
                    """
                    INSERT INTO ticket_segments (
                        ticket_id, booking_reference, id_flight, segment_order,
                        origin_iata, dest_iata, dep_datetime, arr_datetime, coupon_status, seat_code, cabin_class
                    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        lt["id"], lt["booking_reference"], lt["id_flight"],
                        lt["depIATA"], lt["arrIATA"], lt["dep_datetime"], lt["arr_datetime"],
                        c_stat, lt["seat_codes"], lt["cabin_class"],
                    ),
                )
            if lt["status"] == "ISSUED" and lt["booking_status"] == "CONFIRMED":
                qr_service.issue_qr_for_ticket(cursor, lt["id"], issuance_state="ISSUED", is_test_ticket=True)
    except Exception:
        pass

    conn.commit()
    conn.close()


# -------------------------------------------------------------
# EXPIRATION & SEAT MAP ENGINE
# -------------------------------------------------------------
def cleanup_expired_holds():
    """
    Releases expired temporary seat locks safely without touching CONFIRMED bookings.
    Logs every auto-expired reservation to audit_logs.
    """
    conn = get_db(isolation_level=None)
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN IMMEDIATE;")
        rows = cursor.execute(
            "SELECT booking_reference, id_flight, id_account, expires_at FROM bookings WHERE status = 'PENDING_PAYMENT'"
        ).fetchall()
        expired_rows = [r for r in rows if is_expired(r["expires_at"])]
        for r in expired_rows:
            ref = r["booking_reference"]
            cursor.execute("UPDATE bookings SET status = 'EXPIRED' WHERE booking_reference = ? AND status = 'PENDING_PAYMENT'", (ref,))
            cursor.execute(
                "UPDATE reservations SET status = 'EXPIRED' WHERE booking_reference = ? AND status IN ('PENDING_PAYMENT', 'HELD', 'LOCKED')",
                (ref,),
            )
            log_audit_event(
                cursor,
                event_type="LOCK_EXPIRED",
                result="RELEASED",
                actor_id=r["id_account"],
                flight_id=r["id_flight"],
                reservation_ref=ref,
                details="Temporary seat lock expired automatically and seats were released.",
            )
        cursor.execute("COMMIT;")
        return len(expired_rows)
    except Exception:
        try:
            cursor.execute("ROLLBACK;")
        except Exception:
            pass
        return 0
    finally:
        conn.close()


def _seat_category(col: str, row_num: int) -> str:
    if row_num in (12, 13):
        return "Exit Row"
    if row_num in (1, 4, 8):
        return "Extra Legroom"
    c = (col or "").upper()
    if c in ("A", "F"):
        return "Window"
    if c in ("B", "E"):
        return "Middle"
    return "Aisle"


def get_flight_seats(flight_id: int, current_account_id: int = None):
    cleanup_expired_holds()
    conn = get_db()
    cursor = conn.cursor()

    seats = cursor.execute("SELECT id, column, row, type FROM seats ORDER BY row ASC, column ASC").fetchall()
    res_rows = cursor.execute(
        """
        SELECT r.id_seat, r.status, r.id_account, r.booking_reference, r.expires_at
        FROM reservations r
        WHERE r.id_flight = ? AND r.status IN ('CONFIRMED', 'PENDING_PAYMENT', 'HELD', 'LOCKED')
        """,
        (flight_id,),
    ).fetchall()

    res_map = {}
    for r in res_rows:
        if r["status"] in ("PENDING_PAYMENT", "HELD", "LOCKED") and is_expired(r["expires_at"]):
            continue
        res_map[r["id_seat"]] = r

    result = []
    for s in seats:
        seat_id = s["id"]
        active = res_map.get(seat_id)
        if not active:
            seat_status = "AVAILABLE"
            is_held_by_me = False
            booking_ref = None
            expires_at = None
        elif active["status"] == "CONFIRMED":
            seat_status = "BOOKED"
            is_held_by_me = bool(current_account_id and active["id_account"] == current_account_id)
            booking_ref = active["booking_reference"] if is_held_by_me else None
            expires_at = None
        else:
            seat_status = "LOCKED"
            is_held_by_me = bool(current_account_id and active["id_account"] == current_account_id)
            booking_ref = active["booking_reference"] if is_held_by_me else None
            expires_at = active["expires_at"]

        code = f"{s['column']}{s['row']}"
        result.append(
            {
                "id": seat_id,
                "code": code,
                "seatCode": code,
                "column": s["column"],
                "row": s["row"],
                "type": (s["type"] or "economy").lower(),
                "category": _seat_category(s["column"], int(s["row"])),
                "status": seat_status,
                "isHeldByMe": is_held_by_me,
                "bookingReference": booking_ref,
                "expiresAt": expires_at,
            }
        )

    conn.close()
    return result


# -------------------------------------------------------------
# CONFIGURABLE BAGGAGE POLICIES & PROMO ENGINE
# -------------------------------------------------------------
def get_baggage_policy(airline_id, is_domestic: bool, cursor=None):
    scope = "DOMESTIC" if is_domestic else "INTERNATIONAL"
    own_conn = False
    if cursor is None:
        conn = get_db()
        cursor = conn.cursor()
        own_conn = True

    row = None
    if airline_id:
        row = cursor.execute(
            "SELECT * FROM baggage_policies WHERE id_airline = ? AND route_scope = ?",
            (int(airline_id), scope),
        ).fetchone()
    if not row:
        row = cursor.execute(
            "SELECT * FROM baggage_policies WHERE id_airline IS NULL AND route_scope = ?",
            (scope,),
        ).fetchone()

    if own_conn:
        conn.close()

    if row:
        return dict(row)
    return {
        "route_scope": scope,
        "included_checked_kg": 23 if is_domestic else 40,
        "included_pieces": 1 if is_domestic else 2,
        "cabin_kg": 7,
        "extra_per_kg_fee": 120.0 if is_domestic else 250.0,
        "extra_piece_fee": 350.0 if is_domestic else 1200.0,
    }


def validate_promo_code(code: str, fare_amount: float, airline_id=None, cursor=None):
    clean_code = (code or "").strip().upper()
    if not clean_code:
        return False, "Promo code is empty.", 0.0, None

    own_conn = False
    if cursor is None:
        conn = get_db()
        cursor = conn.cursor()
        own_conn = True

    row = cursor.execute("SELECT * FROM promo_codes WHERE UPPER(code) = ?", (clean_code,)).fetchone()
    if own_conn:
        conn.close()

    if not row or not row["is_active"]:
        return False, "Invalid or inactive promo code.", 0.0, None
    if row["expires_at"] and is_expired(row["expires_at"]):
        return False, "This promo code has expired.", 0.0, None
    if row["used_count"] >= row["usage_limit"]:
        return False, "Promo code usage limit reached.", 0.0, None
    if row["id_airline"] and airline_id and int(row["id_airline"]) != int(airline_id):
        return False, "Promo code is not valid for this airline.", 0.0, None
    if float(fare_amount) < float(row["min_fare"] or 0):
        return False, f"Minimum fare of ৳{int(row['min_fare']):,} required for {clean_code}.", 0.0, None

    if row["discount_type"] == "PERCENT":
        disc = round(float(fare_amount) * (float(row["discount_value"]) / 100.0))
        if row["max_discount"]:
            disc = min(disc, float(row["max_discount"]))
    else:
        disc = min(float(row["discount_value"]), float(fare_amount))

    return True, f"Promo {clean_code} applied (-৳{int(disc):,}).", float(disc), dict(row)


def calculate_fare_breakdown(
    flight_ids: list,
    cabin_class: str = "Economy",
    adults: int = 1,
    children: int = 0,
    infants: int = 0,
    luggage_count: int = 0,
    luggage_weight: float = 0.0,
    meal_fee: float = 0.0,
    insurance: bool = False,
    seat_upgrade_fee: float = 0.0,
    promo_code: str = None,
):
    conn = get_db()
    cursor = conn.cursor()

    adults = max(1, int(adults or 1))
    children = max(0, int(children or 0))
    infants = max(0, int(infants or 0))
    luggage_count = max(0, int(luggage_count or 0))
    luggage_weight = max(0.0, float(luggage_weight or 0.0))
    cabin_norm = (cabin_class or "Economy").strip()

    clean_flight_ids = []
    for fid in flight_ids:
        try:
            if fid is not None:
                clean_flight_ids.append(int(fid))
        except (ValueError, TypeError):
            continue
    if not clean_flight_ids:
        clean_flight_ids = [1]

    flights_info = []
    total_base_fare = 0.0
    total_taxes = 0.0
    total_airline_charges = 0.0
    total_luggage_fee = 0.0
    primary_airline_id = None

    for fid in clean_flight_ids:
        f_row = cursor.execute(
            """
            SELECT f.*,
                   al.name as airlineName, al.IATA as airlineIATA,
                   da.name as depAirportName, da.IATA as depIATA, da.city as depCity, da.country as depCountry,
                   aa.name as arrAirportName, aa.IATA as arrIATA, aa.city as arrCity, aa.country as arrCountry
            FROM flights f
            JOIN airLines al ON f.id_airline = al.id
            JOIN airports da ON f.dep_airport = da.id
            JOIN airports aa ON f.arr_airport = aa.id
            WHERE f.id = ?
            """,
            (fid,),
        ).fetchone()
        if not f_row:
            continue

        f_dict = dict(f_row)
        if primary_airline_id is None:
            primary_airline_id = f_dict.get("id_airline")

        is_domestic = (f_dict.get("depCountry") == "Bangladesh" and f_dict.get("arrCountry") == "Bangladesh")
        policy = get_baggage_policy(f_dict.get("id_airline"), is_domestic, cursor=cursor)

        base_adult_price = float(f_dict.get("economy_price") or 3500.0)
        if cabin_norm.lower().startswith("business") and f_dict.get("business_price"):
            base_adult_price = float(f_dict["business_price"])
        elif cabin_norm.lower().startswith("first") and f_dict.get("first_price"):
            base_adult_price = float(f_dict["first_price"])
        elif cabin_norm.lower().startswith("premium"):
            base_adult_price = round(base_adult_price * 1.35)

        base_child_price = round(base_adult_price * 0.75)
        base_infant_price = round(base_adult_price * 0.10)

        flight_base_fare = (adults * base_adult_price) + (children * base_child_price) + (infants * base_infant_price)
        vat_tax = round(flight_base_fare * 0.15)
        airport_tax = 500.0 * (adults + children)
        flight_taxes = vat_tax + airport_tax
        flight_airline_charges = 300.0 * (adults + children)

        extra_kg_fee = float(policy.get("extra_per_kg_fee") or 120.0)
        extra_pc_fee = float(policy.get("extra_piece_fee") or 350.0)
        flight_luggage_fee = (luggage_count * extra_pc_fee) + (luggage_weight * extra_kg_fee)

        total_base_fare += flight_base_fare
        total_taxes += flight_taxes
        total_airline_charges += flight_airline_charges
        total_luggage_fee += flight_luggage_fee

        f_dict["baggagePolicy"] = policy
        f_dict["calculatedUnitPrice"] = base_adult_price
        f_dict["flightBaseFare"] = flight_base_fare
        f_dict["flightTaxes"] = flight_taxes
        flights_info.append(f_dict)

    fee_pol = cursor.execute(
        "SELECT * FROM fee_policies WHERE is_active = 1 ORDER BY id DESC LIMIT 1"
    ).fetchone()
    pol_version = fee_pol["version"] if fee_pol else "FLY-POL-V1"
    booking_service_fee = round((int(fee_pol["booking_service_fee_minor"] or 0) / 100.0), 2) if fee_pol else 0.0
    cancel_service_fee = round((int(fee_pol["cancellation_service_fee_minor"] or 0) / 100.0), 2) if fee_pol else 350.0

    insurance_fee = 450.0 * (adults + children) if insurance else 0.0
    meal_total = max(0.0, float(meal_fee or 0.0))
    seat_fee_total = max(0.0, float(seat_upgrade_fee or 0.0))
    extras_total = total_luggage_fee + insurance_fee + meal_total + seat_fee_total

    subtotal = total_base_fare + total_taxes + total_airline_charges + extras_total + booking_service_fee

    discount = 0.0
    promo_info = None
    if promo_code:
        ok, pmsg, disc_val, pdata = validate_promo_code(promo_code, total_base_fare, primary_airline_id, cursor=cursor)
        if ok:
            discount = disc_val
            promo_info = {"valid": True, "code": promo_code.strip().upper(), "message": pmsg, "discount": discount}
        else:
            promo_info = {"valid": False, "code": promo_code.strip().upper(), "message": pmsg, "discount": 0.0}

    conn.close()

    total_payable = max(0, round(subtotal - discount))
    return {
        "currency": "BDT",
        "currencySymbol": "৳",
        "cabinClass": cabin_norm,
        "adults": adults,
        "children": children,
        "infants": infants,
        "totalPassengers": adults + children + infants,
        "baseFare": total_base_fare,
        "taxes": total_taxes,
        "airlineCharges": total_airline_charges,
        "serviceCharges": booking_service_fee,
        "luggageFee": total_luggage_fee,
        "mealFee": meal_total,
        "insuranceFee": insurance_fee,
        "seatUpgradeFee": seat_fee_total,
        "extrasTotal": extras_total,
        "discounts": discount,
        "discount": discount,
        "promo": promo_info,
        "feePolicy": {
            "version": pol_version,
            "bookingServiceFeeBDT": booking_service_fee,
            "cancellationServiceFeeBDT": cancel_service_fee,
            "waiverNotice": fee_pol["legal_notes"] if fee_pol else "Cancellation service fee waived on airline-initiated cancellations.",
        },
        "totalPayable": total_payable,
        "flights": flights_info,
    }


# -------------------------------------------------------------
# ATOMIC SEAT LOCKING, EXTENSION & PAYMENT CONFIRMATION
# -------------------------------------------------------------
def hold_seats_atomic(
    flight_id: int,
    seat_ids: list,
    account_id: int,
    nbr_luggages: int = 0,
    weight: float = 0.0,
    passenger_data: list = None,
    return_flight_id: int = None,
    return_seat_ids: list = None,
    multi_leg_data: list = None,
    cabin_class: str = "Economy",
    trip_type: str = "one_way",
    expected_fare: float = None,
    meal_fee: float = 0.0,
    insurance: bool = False,
    seat_upgrade_fee: float = 0.0,
    promo_code: str = None,
    extras_data: dict = None,
    contact_email: str = None,
    contact_phone: str = None,
    ip_address: str = None,
):
    """
    Atomically locks requested seat(s) for Config.SEAT_LOCK_MINUTES (10 min default).
    - Uses BEGIN IMMEDIATE to eliminate read-then-write races in SQLite WAL.
    - Enforces partial unique index idx_active_seat_reservation across active statuses.
    - Sorts seat IDs consistently to avoid deadlocks.
    - Rolls back ALL seats across outbound + return legs if ANY seat is unavailable.
    """
    sorted_seats = sorted({int(s) for s in seat_ids})
    sorted_return_seats = sorted({int(s) for s in (return_seat_ids or [])})
    if not sorted_seats:
        return False, "No valid seat IDs provided.", "INVALID_SEATS", None
    if len(sorted_seats) > Config.MAX_SEATS_PER_BOOKING:
        return False, f"Maximum {Config.MAX_SEATS_PER_BOOKING} seats per booking.", "TOO_MANY_SEATS", None

    conn = get_db(isolation_level=None)
    cursor = conn.cursor()

    try:
        cursor.execute("BEGIN IMMEDIATE;")

        # 1. Sweep any expired temporary holds inside this immediate transaction
        exp_rows = cursor.execute(
            "SELECT booking_reference, id_flight, id_account, expires_at FROM bookings WHERE status = 'PENDING_PAYMENT'"
        ).fetchall()
        for er in exp_rows:
            if is_expired(er["expires_at"]):
                cursor.execute("UPDATE bookings SET status = 'EXPIRED' WHERE booking_reference = ?", (er["booking_reference"],))
                cursor.execute(
                    "UPDATE reservations SET status = 'EXPIRED' WHERE booking_reference = ? AND status IN ('PENDING_PAYMENT','HELD','LOCKED')",
                    (er["booking_reference"],),
                )

        # 2. Verify outbound flight availability and future departure boundary
        flight = cursor.execute("SELECT * FROM flights WHERE id = ? AND COALESCE(is_active, 1) = 1", (flight_id,)).fetchone()
        if not flight or (flight["status"] or "").upper() == "CANCELLED":
            cursor.execute("ROLLBACK;")
            return False, "Flight is not available for booking.", "FLIGHT_UNAVAILABLE", None

        from fly.services.travel_providers import get_booking_today_str
        dep_date_part = str(flight["dep_datetime"] or "")[:10]
        if dep_date_part and dep_date_part < get_booking_today_str(Config.BOOKING_TIMEZONE):
            cursor.execute("ROLLBACK;")
            return False, "Cannot book seats for a past flight departure.", "PAST_DATE_REJECTED", None

        airline_id = flight["id_airline"]

        # Helper to validate all seats for a leg in sorted order
        def _check_leg_conflicts(target_fid: int, target_seat_ids: list):
            ph = ",".join("?" for _ in target_seat_ids)
            rows = cursor.execute(f"SELECT id, column, row, type FROM seats WHERE id IN ({ph}) ORDER BY id ASC", target_seat_ids).fetchall()
            if len(rows) != len(target_seat_ids):
                return None, "One or more selected seats do not exist."
            conflicts = cursor.execute(
                f"""
                SELECT r.id_seat, r.status, r.id_account, r.expires_at
                FROM reservations r
                WHERE r.id_flight = ? AND r.id_seat IN ({ph})
                  AND r.status IN ('CONFIRMED', 'PENDING_PAYMENT', 'HELD', 'LOCKED')
                """,
                [target_fid] + target_seat_ids,
            ).fetchall()
            for c in conflicts:
                if c["status"] == "CONFIRMED" or not is_expired(c["expires_at"]):
                    return None, f"Seat #{c['id_seat']} is already locked or booked by another reservation."
            return rows, None

        seat_rows, err = _check_leg_conflicts(flight_id, sorted_seats)
        if err:
            log_audit_event(
                cursor,
                event_type="LOCK_ATTEMPT",
                result="CONFLICT",
                actor_id=account_id,
                airline_id=airline_id,
                flight_id=flight_id,
                seat_codes=",".join(str(x) for x in sorted_seats),
                details=err,
                ip_address=ip_address,
            )
            cursor.execute("COMMIT;")
            return False, err, "SEAT_UNAVAILABLE", None

        ret_seat_rows = []
        if return_flight_id and sorted_return_seats:
            ret_flight = cursor.execute("SELECT id, status FROM flights WHERE id = ? AND COALESCE(is_active, 1) = 1", (int(return_flight_id),)).fetchone()
            if not ret_flight or (ret_flight["status"] or "").upper() == "CANCELLED":
                cursor.execute("ROLLBACK;")
                return False, "Return flight is not available.", "FLIGHT_UNAVAILABLE", None
            ret_seat_rows, r_err = _check_leg_conflicts(int(return_flight_id), sorted_return_seats)
            if r_err:
                log_audit_event(
                    cursor,
                    event_type="LOCK_ATTEMPT",
                    result="CONFLICT",
                    actor_id=account_id,
                    airline_id=airline_id,
                    flight_id=int(return_flight_id),
                    seat_codes=",".join(str(x) for x in sorted_return_seats),
                    details=r_err,
                    ip_address=ip_address,
                )
                cursor.execute("COMMIT;")
                return False, r_err, "SEAT_UNAVAILABLE", None

        # 3. Compute authoritative fare server-side
        adults_count, children_count, infants_count = 0, 0, 0
        if passenger_data and isinstance(passenger_data, list):
            for p in passenger_data:
                pt = str(p.get("type") or p.get("passengerType") or "adult").lower()
                if "infant" in pt:
                    infants_count += 1
                elif "child" in pt:
                    children_count += 1
                else:
                    adults_count += 1
        if adults_count == 0:
            adults_count = max(1, len(sorted_seats))
        if infants_count > adults_count:
            cursor.execute("ROLLBACK;")
            return False, "Each infant must be accompanied by an adult passenger.", "INVALID_PASSENGERS", None

        all_fids = [int(flight_id)]
        if return_flight_id:
            all_fids.append(int(return_flight_id))

        # Compute seat upgrade fee from seat classes if applicable
        fare_breakdown = calculate_fare_breakdown(
            flight_ids=all_fids,
            cabin_class=cabin_class,
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
        discount_amt = float(fare_breakdown["discount"] or 0.0)

        if expected_fare is not None and float(expected_fare) > 0:
            if abs(float(expected_fare) - total_fare) > 2.0:
                cursor.execute("ROLLBACK;")
                return (
                    False,
                    f"Flight fare updated from ৳{int(expected_fare):,} to ৳{int(total_fare):,}. Please confirm updated pricing.",
                    "FARE_CHANGED",
                    {"fareBreakdown": fare_breakdown},
                )

        # 4. Create booking + atomic reservations with configurable lock window (default 10 mins)
        lock_mins = Config.SEAT_LOCK_MINUTES
        booking_ref = f"BK-{flight_id}-{secrets.token_hex(3).upper()}-{secrets.token_hex(2).upper()}"
        created_dt = datetime.utcnow()
        expires_dt = created_dt + timedelta(minutes=lock_mins)
        created_str = created_dt.strftime("%Y-%m-%d %H:%M:%S")
        expires_str = expires_dt.strftime("%Y-%m-%d %H:%M:%S")

        fee_ver = (fare_breakdown.get("feePolicy") or {}).get("version") or "FLY-POL-V1"
        fare_fam = "BUSINESS" if cabin_class.lower().startswith("bus") else ("FIRST" if cabin_class.lower().startswith("first") else ("FLEX" if cabin_class.lower().startswith("prem") else "STANDARD"))

        cursor.execute(
            """
            INSERT INTO bookings (
                booking_reference, id_account, id_flight, status, total_amount,
                nbr_luggages, weight, created_at, expires_at,
                passenger_data, return_flight_id, multi_leg_data, fare_breakdown,
                trip_type, cabin_class, extras_data, discount_amount, promo_code,
                lock_extensions, contact_email, contact_phone,
                fee_policy_version, fare_family, is_test_booking
            )
            VALUES (?, ?, ?, 'PENDING_PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1)
            """,
            (
                booking_ref,
                account_id,
                flight_id,
                total_fare,
                nbr_luggages,
                weight,
                created_str,
                expires_str,
                json.dumps(passenger_data) if passenger_data else None,
                return_flight_id,
                json.dumps(multi_leg_data) if multi_leg_data else None,
                json.dumps(fare_breakdown),
                trip_type,
                cabin_class,
                json.dumps(extras_data) if extras_data else None,
                discount_amt,
                promo_code.strip().upper() if promo_code and discount_amt > 0 else None,
                contact_email,
                contact_phone,
                fee_ver,
                fare_fam,
            ),
        )

        per_seat_price = round(total_fare / max(1, len(seat_rows) + len(ret_seat_rows)), 2)
        for s in seat_rows:
            cursor.execute(
                """
                INSERT INTO reservations (
                    id_flight, id_account, id_seat, nbr_luggages, weight,
                    booking_reference, status, created_at, expires_at, total_price
                )
                VALUES (?, ?, ?, ?, ?, ?, 'PENDING_PAYMENT', ?, ?, ?)
                """,
                (flight_id, account_id, s["id"], nbr_luggages, weight, booking_ref, created_str, expires_str, per_seat_price),
            )
        for rs in ret_seat_rows:
            cursor.execute(
                """
                INSERT INTO reservations (
                    id_flight, id_account, id_seat, nbr_luggages, weight,
                    booking_reference, status, created_at, expires_at, total_price
                )
                VALUES (?, ?, ?, 0, 0, ?, 'PENDING_PAYMENT', ?, ?, ?)
                """,
                (int(return_flight_id), account_id, rs["id"], booking_ref, created_str, expires_str, per_seat_price),
            )

        seat_codes = [f"{s['column']}{s['row']}" for s in seat_rows]
        ret_codes = [f"{s['column']}{s['row']}" for s in ret_seat_rows]

        log_audit_event(
            cursor,
            event_type="LOCK_SUCCESS",
            result="LOCKED",
            actor_id=account_id,
            airline_id=airline_id,
            flight_id=flight_id,
            seat_codes=",".join(seat_codes + ret_codes),
            reservation_ref=booking_ref,
            details=f"Locked {len(seat_codes) + len(ret_codes)} seat(s) for {lock_mins} minutes.",
            ip_address=ip_address,
        )

        cursor.execute("COMMIT;")

        hold_info = {
            "bookingReference": booking_ref,
            "flightId": flight_id,
            "seatIds": sorted_seats,
            "returnFlightId": return_flight_id,
            "tripType": trip_type,
            "cabinClass": cabin_class,
            "expiresAt": expires_str,
            "secondsRemaining": lock_mins * 60,
            "totalAmount": total_fare,
            "fareBreakdown": fare_breakdown,
            "passengerData": passenger_data or [],
            "seatCodes": seat_codes,
            "returnSeatCodes": ret_codes,
        }
        return True, f"Seats locked for {lock_mins} minutes.", None, hold_info

    except sqlite3.IntegrityError as ie:
        try:
            cursor.execute("ROLLBACK;")
        except Exception:
            pass
        record_standalone_audit(
            event_type="LOCK_CONFLICT",
            result="REJECTED",
            actor_id=account_id,
            flight_id=flight_id,
            seat_codes=",".join(str(x) for x in sorted_seats),
            details=f"Unique constraint prevented double-booking: {ie}",
            ip_address=ip_address,
        )
        return False, "One or more selected seats were just locked by another traveler.", "SEAT_UNAVAILABLE", None
    except Exception as e:
        try:
            cursor.execute("ROLLBACK;")
        except Exception:
            pass
        return False, f"Seat holding failed: {str(e)}", "SERVER_ERROR", None
    finally:
        conn.close()


def extend_lock_atomic(booking_ref: str, account_id: int, ip_address: str = None):
    """Allows one controlled 2-minute extension for an active PENDING_PAYMENT hold."""
    cleanup_expired_holds()
    conn = get_db(isolation_level=None)
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN IMMEDIATE;")
        b = cursor.execute("SELECT * FROM bookings WHERE booking_reference = ?", (booking_ref,)).fetchone()
        if not b:
            cursor.execute("ROLLBACK;")
            return False, "Booking hold not found.", "NOT_FOUND", None
        if b["id_account"] != account_id:
            cursor.execute("ROLLBACK;")
            return False, "Access denied.", "FORBIDDEN", None
        if b["status"] != "PENDING_PAYMENT" or is_expired(b["expires_at"]):
            cursor.execute("ROLLBACK;")
            return False, "Reservation lock has already expired or completed.", "RESERVATION_EXPIRED", None
        if int(b["lock_extensions"] or 0) >= Config.MAX_LOCK_EXTENSIONS:
            cursor.execute("ROLLBACK;")
            return False, "Maximum lock extension limit (1) reached.", "EXTENSION_LIMIT_REACHED", None

        cur_exp = parse_dt_utc(b["expires_at"]) or datetime.utcnow()
        new_exp = cur_exp + timedelta(minutes=Config.SEAT_EXTENSION_MINUTES)
        new_exp_str = new_exp.strftime("%Y-%m-%d %H:%M:%S")

        cursor.execute(
            "UPDATE bookings SET expires_at = ?, lock_extensions = COALESCE(lock_extensions, 0) + 1 WHERE booking_reference = ?",
            (new_exp_str, booking_ref),
        )
        cursor.execute("UPDATE reservations SET expires_at = ? WHERE booking_reference = ?", (new_exp_str, booking_ref))
        log_audit_event(
            cursor,
            event_type="LOCK_EXTENDED",
            result="SUCCESS",
            actor_id=account_id,
            flight_id=b["id_flight"],
            reservation_ref=booking_ref,
            details=f"Extended seat lock by {Config.SEAT_EXTENSION_MINUTES} minutes.",
            ip_address=ip_address,
        )
        cursor.execute("COMMIT;")

        remaining = max(0, int((new_exp - datetime.utcnow()).total_seconds()))
        return True, f"Seat lock extended by {Config.SEAT_EXTENSION_MINUTES} minutes.", None, {
            "bookingReference": booking_ref,
            "expiresAt": new_exp_str,
            "secondsRemaining": remaining,
        }
    except Exception as e:
        try:
            cursor.execute("ROLLBACK;")
        except Exception:
            pass
        return False, str(e), "SERVER_ERROR", None
    finally:
        conn.close()


def _generate_unique_pnr(cursor) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    for _ in range(25):
        candidate = "".join(secrets.choice(alphabet) for _ in range(6))
        if not cursor.execute("SELECT 1 FROM bookings WHERE pnr_code = ?", (candidate,)).fetchone():
            return candidate
    return secrets.token_hex(3).upper()


def _generate_unique_ticket_number(cursor) -> str:
    for _ in range(25):
        num = f"997-{secrets.randbelow(8999999999) + 1000000000}"
        if not cursor.execute("SELECT 1 FROM tickets WHERE ticket_number = ?", (num,)).fetchone():
            return num
    return f"997-{int(datetime.utcnow().timestamp())}"


def _to_minor_units(amount_val) -> int:
    from decimal import Decimal, ROUND_HALF_UP
    d = Decimal(str(amount_val if amount_val is not None else "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int(d * 100)


def _extract_passengers_for_booking(booking_row, seat_codes: list) -> list:
    pax_entries = []
    if booking_row["passenger_data"]:
        try:
            raw_list = json.loads(booking_row["passenger_data"])
            seat_idx = 0
            for idx, p in enumerate(raw_list, start=1):
                nm = p.get("fullName") or f"{p.get('title', '')} {p.get('firstName', '')} {p.get('lastName', '')}".strip()
                ptype = str(p.get("type") or p.get("passengerType") or "adult").lower()
                assigned = p.get("seatCode") or ""
                if not assigned:
                    if "infant" in ptype:
                        assigned = "Infant Lap"
                    elif seat_idx < len(seat_codes):
                        assigned = seat_codes[seat_idx]
                        seat_idx += 1
                    else:
                        assigned = seat_codes[0] if seat_codes else "Assigned"
                pax_entries.append({
                    "passenger_index": idx,
                    "name": nm or f"Passenger {idx}",
                    "seat_code": assigned,
                    "type": ptype,
                })
        except Exception:
            pax_entries = []
    if not pax_entries:
        # Fallback: 1 ticket per occupied seat or single primary passenger
        if seat_codes and len(seat_codes) > 1:
            for idx, sc in enumerate(seat_codes, start=1):
                pax_entries.append({"passenger_index": idx, "name": f"Passenger {idx}", "seat_code": sc, "type": "adult"})
        else:
            pax_entries.append({"passenger_index": 1, "name": "Passenger", "seat_code": ", ".join(seat_codes) or "Assigned", "type": "adult"})
    return pax_entries


def _issue_tickets_and_qr_in_tx(cursor, booking, pnr_code: str, seat_codes: list, now_iso: str, issue_qr: bool = True):
    """Issues per-passenger e-tickets, segment records, QR tokens (only if issued), and notifications."""
    from fly.services import qr_service

    booking_ref = booking["booking_reference"]
    is_dom = (booking["depCountry"] == "Bangladesh" and booking["arrCountry"] == "Bangladesh")
    bpol = get_baggage_policy(booking["id_airline"], is_dom, cursor=cursor)
    baggage_str = f"Check-in: {bpol['included_checked_kg']} kg ({bpol['included_pieces']} pc) • Cabin: {bpol['cabin_kg']} kg"
    if int(booking["nbr_luggages"] or 0) > 0:
        baggage_str += f" + {booking['nbr_luggages']} extra pc"

    pax_entries = _extract_passengers_for_booking(booking, seat_codes)
    issuance_state = "ISSUED" if issue_qr else "TICKETING_PENDING"
    fare_family = (booking["fare_family"] if "fare_family" in booking.keys() and booking["fare_family"] else "STANDARD")
    fee_ver = (booking["fee_policy_version"] if "fee_policy_version" in booking.keys() and booking["fee_policy_version"] else "FLY-POL-V1")
    is_test = int(booking["is_test_booking"]) if "is_test_booking" in booking.keys() and booking["is_test_booking"] is not None else 1

    # Segment rows (outbound + optional return / multi-leg)
    flight_legs = []
    main_leg = cursor.execute(
        """
        SELECT f.id, f.dep_datetime, f.arr_datetime, da.IATA as origin_iata, aa.IATA as dest_iata
        FROM flights f
        JOIN airports da ON f.dep_airport = da.id
        JOIN airports aa ON f.arr_airport = aa.id
        WHERE f.id = ?
        """,
        (booking["id_flight"],),
    ).fetchone()
    if main_leg:
        flight_legs.append(dict(main_leg))
    if booking["return_flight_id"]:
        ret_leg = cursor.execute(
            """
            SELECT f.id, f.dep_datetime, f.arr_datetime, da.IATA as origin_iata, aa.IATA as dest_iata
            FROM flights f
            JOIN airports da ON f.dep_airport = da.id
            JOIN airports aa ON f.arr_airport = aa.id
            WHERE f.id = ?
            """,
            (int(booking["return_flight_id"]),),
        ).fetchone()
        if ret_leg:
            flight_legs.append(dict(ret_leg))

    issued_numbers = []
    qr_urls = []
    for pax in pax_entries:
        t_num = _generate_unique_ticket_number(cursor) if issue_qr else f"PEND-{booking_ref}-{pax['passenger_index']}"
        placeholder_digest = hashlib.sha256(f"{booking_ref}:{pax['passenger_index']}:{secrets.token_hex(8)}".encode()).hexdigest()
        cursor.execute(
            """
            INSERT INTO tickets (
                ticket_number, pnr_code, booking_reference, id_account, id_flight, id_airline,
                passenger_name, passenger_index, seat_codes, cabin_class, baggage_allowance,
                verification_token, status, issuance_state, checkin_status, is_test_ticket,
                fare_family, provider_name, airline_pnr, fee_policy_version, issued_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?, 'NOT_CHECKED_IN', ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                t_num,
                pnr_code,
                booking_ref,
                booking["id_account"],
                booking["id_flight"],
                booking["id_airline"],
                pax["name"],
                pax["passenger_index"],
                pax["seat_code"],
                booking["cabin_class"] or "Economy",
                baggage_str,
                placeholder_digest,
                issuance_state,
                is_test,
                fare_family,
                Config.FLIGHT_PROVIDER_ACTIVE,
                pnr_code,
                fee_ver,
                now_iso if issue_qr else "PENDING",
                now_iso,
            ),
        )
        t_id = cursor.lastrowid
        for seg_idx, leg in enumerate(flight_legs, start=1):
            cursor.execute(
                """
                INSERT INTO ticket_segments (
                    ticket_id, booking_reference, id_flight, segment_order,
                    origin_iata, dest_iata, dep_datetime, arr_datetime,
                    coupon_status, seat_code, cabin_class
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
                """,
                (
                    t_id,
                    booking_ref,
                    leg["id"],
                    seg_idx,
                    leg["origin_iata"],
                    leg["dest_iata"],
                    leg["dep_datetime"],
                    leg["arr_datetime"],
                    pax["seat_code"] if seg_idx == 1 else "Assigned",
                    booking["cabin_class"] or "Economy",
                ),
            )
        if issue_qr:
            raw_tok, vurl, _ = qr_service.issue_qr_for_ticket(
                cursor, t_id, issuance_state="ISSUED", is_test_ticket=bool(is_test)
            )
            if vurl:
                qr_urls.append(vurl)
        issued_numbers.append(t_num)

    # Notification outbox entry (A3: dispatch e-ticket notification upon genuine issuance)
    if issue_qr:
        cursor.execute(
            """
            INSERT INTO notification_outbox (
                booking_reference, recipient_email, channel, subject, body_summary, status, metadata_json, created_at
            )
            VALUES (?, ?, 'EMAIL', ?, ?, 'DISPATCHED_LOCAL_OUTBOX', ?, ?)
            """,
            (
                booking_ref,
                booking["contact_email"] or "",
                f"FLY E-Ticket Issued — PNR {pnr_code}",
                f"Issued {len(issued_numbers)} e-ticket(s) ({', '.join(issued_numbers)}). Verification links & PDF available.",
                json.dumps({"ticketNumbers": issued_numbers, "verifyUrls": qr_urls}),
                now_iso,
            ),
        )
    return issued_numbers


def issue_deferred_tickets_atomic(booking_ref: str, actor_id: int = None, ip_address: str = None):
    """Transitions a TICKETING_PENDING / AWAITING_ISSUANCE booking to confirmed ISSUED tickets & QRs."""
    from fly.services import qr_service
    conn = get_db(isolation_level=None)
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN IMMEDIATE;")
        now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        booking = cursor.execute(
            """
            SELECT b.*, f.id_airline, da.country as depCountry, aa.country as arrCountry
            FROM bookings b
            JOIN flights f ON b.id_flight = f.id
            JOIN airports da ON f.dep_airport = da.id
            JOIN airports aa ON f.arr_airport = aa.id
            WHERE b.booking_reference = ? OR UPPER(b.pnr_code) = UPPER(?)
            """,
            (booking_ref, booking_ref),
        ).fetchone()
        if not booking:
            cursor.execute("ROLLBACK;")
            return False, "Booking not found.", "NOT_FOUND", None

        ref = booking["booking_reference"]
        if booking["status"] not in ("TICKETING_PENDING", "CONFIRMED"):
            cursor.execute("ROLLBACK;")
            return False, f"Cannot issue tickets for booking in status {booking['status']}.", "INVALID_STATE", None

        paid = cursor.execute(
            "SELECT 1 FROM payments WHERE booking_reference = ? AND status = 'CAPTURED'",
            (ref,),
        ).fetchone()
        if not paid:
            cursor.execute("ROLLBACK;")
            return False, "Cannot issue tickets before captured payment is verified.", "PAYMENT_REQUIRED", None

        pending_rows = cursor.execute(
            "SELECT * FROM tickets WHERE booking_reference = ? AND COALESCE(issuance_state, status) != 'ISSUED'",
            (ref,),
        ).fetchall()
        issued_nums = []
        for row in pending_rows:
            t_num = _generate_unique_ticket_number(cursor) if str(row["ticket_number"]).startswith("PEND-") else row["ticket_number"]
            cursor.execute(
                "UPDATE tickets SET ticket_number = ?, status = 'ISSUED', issuance_state = 'ISSUED', issued_at = ?, updated_at = ? WHERE id = ?",
                (t_num, now_iso, now_iso, row["id"]),
            )
            qr_service.issue_qr_for_ticket(cursor, row["id"], issuance_state="ISSUED", is_test_ticket=bool(row["is_test_ticket"]))
            issued_nums.append(t_num)

        cursor.execute("UPDATE bookings SET status = 'CONFIRMED' WHERE booking_reference = ?", (ref,))
        log_audit_event(
            cursor,
            event_type="DEFERRED_TICKETS_ISSUED",
            result="ISSUED",
            actor_id=actor_id,
            airline_id=booking["id_airline"],
            flight_id=booking["id_flight"],
            reservation_ref=ref,
            details=f"Issued deferred e-tickets: {', '.join(issued_nums)}",
            ip_address=ip_address,
        )
        cursor.execute("COMMIT;")
        return True, "Tickets issued and QR credentials generated.", None, get_ticket_data(ref)
    except Exception as exc:
        try:
            cursor.execute("ROLLBACK;")
        except Exception:
            pass
        return False, str(exc), "SERVER_ERROR", None
    finally:
        conn.close()


def confirm_payment_atomic(
    booking_ref: str,
    account_id: int,
    payment_method: str = "SIMULATED_CARD",
    transaction_ref: str = None,
    idempotency_key: str = None,
    scenario: str = "SIMULATE_SUCCESS",
    issuance_scenario: str = "ISSUED_IMMEDIATELY",
    ip_address: str = None,
):
    """
    Idempotently processes payment scenarios:
      - SIMULATE_SUCCESS + ISSUED_IMMEDIATELY: Captures payment, records ledger, issues per-passenger tickets & cryptographic QR tokens.
      - SIMULATE_SUCCESS + DEFER_ISSUANCE: Captures payment & creates PNR, sets TICKETING_PENDING with NO QR until airline confirms issuance.
      - SIMULATE_FAILURE: Logs failure, cancels hold & releases seats immediately.
      - SIMULATE_TIMEOUT: Logs timeout, expires hold & releases seats immediately.
    """
    cleanup_expired_holds()
    conn = get_db(isolation_level=None)
    cursor = conn.cursor()

    try:
        cursor.execute("BEGIN IMMEDIATE;")
        now_dt = datetime.utcnow()
        now_iso = now_dt.strftime("%Y-%m-%d %H:%M:%S")
        idem_key = (idempotency_key or f"AUTO-{booking_ref}").strip()

        # 1. Idempotency check in payments table
        prior_pay = cursor.execute("SELECT * FROM payments WHERE idempotency_key = ?", (idem_key,)).fetchone()
        if prior_pay:
            if prior_pay["status"] == "CAPTURED":
                cursor.execute("COMMIT;")
                ticket = get_ticket_data(prior_pay["booking_reference"])
                return True, "Payment already processed (idempotent replay).", None, {
                    "alreadyConfirmed": True,
                    "bookingReference": prior_pay["booking_reference"],
                    "paymentRef": prior_pay["transaction_ref"],
                    "pnrCode": ticket.get("pnrCode") if ticket else None,
                    "ticket": ticket,
                }
            cursor.execute("COMMIT;")
            return False, f"Duplicate payment attempt blocked (prior result: {prior_pay['status']}).", "DUPLICATE_PAYMENT_ATTEMPT", None

        booking = cursor.execute(
            """
            SELECT b.*, f.id_airline, da.country as depCountry, aa.country as arrCountry
            FROM bookings b
            JOIN flights f ON b.id_flight = f.id
            JOIN airports da ON f.dep_airport = da.id
            JOIN airports aa ON f.arr_airport = aa.id
            WHERE b.booking_reference = ?
            """,
            (booking_ref,),
        ).fetchone()

        if not booking:
            cursor.execute("ROLLBACK;")
            return False, "Booking not found.", "NOT_FOUND", None

        # 2. Strict ownership & airline isolation check
        acc = cursor.execute("SELECT role, id_airline FROM accounts WHERE id = ?", (account_id,)).fetchone()
        role = (acc["role"] if acc and acc["role"] else "PASSENGER").upper()
        if role == "PASSENGER" and booking["id_account"] != account_id:
            cursor.execute("ROLLBACK;")
            return False, "Access denied: You cannot pay for another customer's booking.", "FORBIDDEN", None
        if role == "AIRLINE_ADMIN" and booking["id_airline"] != acc["id_airline"]:
            cursor.execute("ROLLBACK;")
            return False, "Access denied: Booking belongs to another airline.", "FORBIDDEN", None

        # 3. Already confirmed idempotency
        if booking["status"] in ("CONFIRMED", "TICKETING_PENDING"):
            cursor.execute("COMMIT;")
            ticket = get_ticket_data(booking_ref)
            return True, "Payment already confirmed for this reservation.", None, {
                "alreadyConfirmed": True,
                "bookingReference": booking_ref,
                "pnrCode": booking["pnr_code"],
                "ticket": ticket,
            }

        # 4. Expiration check (rejects delayed callbacks!)
        if booking["status"] == "EXPIRED" or is_expired(booking["expires_at"]):
            cursor.execute("UPDATE bookings SET status = 'EXPIRED' WHERE booking_reference = ?", (booking_ref,))
            cursor.execute("UPDATE reservations SET status = 'EXPIRED' WHERE booking_reference = ?", (booking_ref,))
            log_audit_event(
                cursor,
                event_type="PAYMENT_EXPIRED_REJECTED",
                result="EXPIRED",
                actor_id=account_id,
                airline_id=booking["id_airline"],
                flight_id=booking["id_flight"],
                reservation_ref=booking_ref,
                details="Payment rejected because seat lock expired.",
                ip_address=ip_address,
            )
            cursor.execute("COMMIT;")
            return False, "Seat lock has expired. Seats were released back to inventory.", "RESERVATION_EXPIRED", None

        if booking["status"] in ("CANCELLED", "REFUNDED"):
            cursor.execute("ROLLBACK;")
            return False, "This reservation was already cancelled.", "CANCELLED", None

        scen = (scenario or "SIMULATE_SUCCESS").strip().upper()
        txn_ref = transaction_ref or f"TXN-{int(now_dt.timestamp())}-{secrets.token_hex(3).upper()}"

        # 5. Handle Simulated Failure or Timeout
        if scen == "SIMULATE_FAILURE":
            cursor.execute(
                """
                INSERT INTO payments (booking_reference, id_account, idempotency_key, amount, currency, payment_method, scenario, status, transaction_ref, error_message, created_at)
                VALUES (?, ?, ?, ?, 'BDT', ?, ?, 'FAILED', ?, 'Simulated gateway decline', ?)
                """,
                (booking_ref, account_id, idem_key, booking["total_amount"], payment_method, scen, txn_ref, now_iso),
            )
            cursor.execute("UPDATE bookings SET status = 'CANCELLED', cancelled_at = ?, cancellation_reason = 'Payment failed' WHERE booking_reference = ?", (now_iso, booking_ref))
            cursor.execute("UPDATE reservations SET status = 'CANCELLED' WHERE booking_reference = ?", (booking_ref,))
            log_audit_event(
                cursor,
                event_type="PAYMENT_FAILED",
                result="FAILED",
                actor_id=account_id,
                airline_id=booking["id_airline"],
                flight_id=booking["id_flight"],
                reservation_ref=booking_ref,
                details="Simulated payment failure; temporary seat lock released.",
                ip_address=ip_address,
            )
            cursor.execute("COMMIT;")
            return False, "Simulated payment declined by gateway. Reserved seats were released.", "PAYMENT_FAILED", None

        if scen == "SIMULATE_TIMEOUT":
            cursor.execute(
                """
                INSERT INTO payments (booking_reference, id_account, idempotency_key, amount, currency, payment_method, scenario, status, transaction_ref, error_message, created_at)
                VALUES (?, ?, ?, ?, 'BDT', ?, ?, 'TIMEOUT', ?, 'Simulated gateway timeout', ?)
                """,
                (booking_ref, account_id, idem_key, booking["total_amount"], payment_method, scen, txn_ref, now_iso),
            )
            cursor.execute("UPDATE bookings SET status = 'EXPIRED' WHERE booking_reference = ?", (booking_ref,))
            cursor.execute("UPDATE reservations SET status = 'EXPIRED' WHERE booking_reference = ?", (booking_ref,))
            log_audit_event(
                cursor,
                event_type="PAYMENT_TIMEOUT",
                result="EXPIRED",
                actor_id=account_id,
                airline_id=booking["id_airline"],
                flight_id=booking["id_flight"],
                reservation_ref=booking_ref,
                details="Simulated payment timeout; temporary seat lock expired and released.",
                ip_address=ip_address,
            )
            cursor.execute("COMMIT;")
            return False, "Simulated payment gateway timed out. Seats released back to inventory.", "PAYMENT_TIMEOUT", None

        # 6. SIMULATE_SUCCESS -> Capture payment + PNR + ledger + conditional immediate vs deferred ticket issuance
        defer_issue = (str(issuance_scenario or "").strip().upper() == "DEFER_ISSUANCE")
        pnr_code = booking["pnr_code"] or _generate_unique_pnr(cursor)
        target_b_status = "TICKETING_PENDING" if defer_issue else "CONFIRMED"

        cursor.execute(
            """
            UPDATE bookings
            SET status = ?, pnr_code = ?, payment_ref = ?, payment_method = ?, paid_at = ?, idempotency_key = ?
            WHERE booking_reference = ?
            """,
            (target_b_status, pnr_code, txn_ref, payment_method, now_iso, idem_key, booking_ref),
        )
        cursor.execute(
            "UPDATE reservations SET status = 'CONFIRMED', payment_ref = ? WHERE booking_reference = ?",
            (txn_ref, booking_ref),
        )
        cursor.execute(
            """
            INSERT INTO payments (booking_reference, id_account, idempotency_key, amount, currency, payment_method, scenario, status, transaction_ref, created_at)
            VALUES (?, ?, ?, ?, 'BDT', ?, ?, 'CAPTURED', ?, ?)
            """,
            (booking_ref, account_id, idem_key, booking["total_amount"], payment_method, scen, txn_ref, now_iso),
        )

        # Immutable Ledger Credit Entry (exact integer minor units / paisa)
        cursor.execute(
            """
            INSERT INTO financial_ledger_entries (
                entry_ref, booking_reference, entry_type, direction, amount_minor, currency,
                original_currency, fx_rate, reference_id, description, created_by, created_at
            )
            VALUES (?, ?, 'PAYMENT_CAPTURE', 'CREDIT', ?, 'BDT', 'BDT', '1.0000', ?, ?, ?, ?)
            """,
            (
                f"LED-PAY-{secrets.token_hex(4).upper()}",
                booking_ref,
                _to_minor_units(booking["total_amount"]),
                txn_ref,
                f"Captured payment via {payment_method} for PNR {pnr_code}",
                account_id,
                now_iso,
            ),
        )

        if booking["promo_code"]:
            cursor.execute(
                "UPDATE promo_codes SET used_count = used_count + 1 WHERE UPPER(code) = ? AND used_count < usage_limit AND is_active = 1",
                (booking["promo_code"].upper(),),
            )

        seats = cursor.execute(
            """
            SELECT s.column, s.row, s.type
            FROM reservations r
            JOIN seats s ON r.id_seat = s.id
            WHERE r.booking_reference = ? AND r.id_flight = ?
            """,
            (booking_ref, booking["id_flight"]),
        ).fetchall()
        seat_codes = [f"{s['column']}{s['row']}" for s in seats]
        seat_codes_str = ", ".join(seat_codes) or "Assigned"

        issued_nums = _issue_tickets_and_qr_in_tx(
            cursor, booking, pnr_code, seat_codes, now_iso, issue_qr=(not defer_issue)
        )

        log_audit_event(
            cursor,
            event_type="BOOKING_CONFIRMED" if not defer_issue else "BOOKING_TICKETING_PENDING",
            result=target_b_status,
            actor_id=account_id,
            airline_id=booking["id_airline"],
            flight_id=booking["id_flight"],
            seat_codes=seat_codes_str,
            reservation_ref=booking_ref,
            details=f"PNR {pnr_code} {'issued tickets ' + ','.join(issued_nums) if not defer_issue else 'awaiting airline ticket issuance (no QR generated)'}.",
            ip_address=ip_address,
        )

        cursor.execute("COMMIT;")

        ticket = get_ticket_data(booking_ref)
        msg = "Payment confirmed and e-ticket issued." if not defer_issue else "Payment captured; booking is awaiting airline ticket issuance (QR withheld until issued)."
        return True, msg, None, {
            "bookingReference": booking_ref,
            "pnrCode": pnr_code,
            "paymentRef": txn_ref,
            "paidAt": now_iso,
            "status": target_b_status,
            "ticket": ticket,
        }

    except sqlite3.IntegrityError:
        try:
            cursor.execute("ROLLBACK;")
        except Exception:
            pass
        return False, "Payment could not be completed due to a seat reservation conflict.", "CONFLICT", None
    except Exception:
        try:
            cursor.execute("ROLLBACK;")
        except Exception:
            pass
        return False, "Payment confirmation failed due to an unexpected server error.", "SERVER_ERROR", None
    finally:
        conn.close()


def get_ticket_data(ref_or_pnr: str, ticket_id: int = None):
    """Retrieves full per-passenger tickets, segments, & in-memory QR URLs (never exposes plaintext tokens on non-ISSUED tickets)."""
    from fly.services import qr_service

    key = (ref_or_pnr or "").strip()
    if not key:
        return None

    conn = get_db()
    cursor = conn.cursor()

    b = cursor.execute(
        """
        SELECT b.*,
               a.username, a.emailAddress, a.display_name,
               p.firstName, p.lastName,
               f.id as flightId, f.flight_number, f.aircraft_model, f.dep_datetime, f.arr_datetime,
               f.first_price, f.business_price, f.economy_price,
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
        WHERE b.booking_reference = ? OR UPPER(b.pnr_code) = UPPER(?)
           OR b.booking_reference IN (SELECT booking_reference FROM tickets WHERE ticket_number = ?)
        """,
        (key, key, key),
    ).fetchone()

    if not b:
        conn.close()
        return None

    t_rows = cursor.execute(
        "SELECT * FROM tickets WHERE booking_reference = ? ORDER BY passenger_index ASC, id ASC",
        (b["booking_reference"],),
    ).fetchall()
    selected_row = None
    if ticket_id is not None:
        selected_row = next((r for r in t_rows if int(r["id"]) == int(ticket_id)), None)
    if selected_row is None and t_rows:
        # Match by ticket_number if queried directly by ticket number
        selected_row = next((r for r in t_rows if r["ticket_number"] == key), t_rows[0])

    seats = cursor.execute(
        """
        SELECT s.id, s.column, s.row, s.type
        FROM reservations r
        JOIN seats s ON r.id_seat = s.id
        WHERE r.booking_reference = ? AND r.id_flight = ?
        """,
        (b["booking_reference"], b["id_flight"]),
    ).fetchall()

    is_dom = (b["depCountry"] == "Bangladesh" and b["arrCountry"] == "Bangladesh")
    bpol = get_baggage_policy(b["airlineId"], is_dom, cursor=cursor)

    # Enrich each individual ticket record with segments and active QR credential (only when ISSUED / PARTIALLY_USED)
    enriched_tickets = []
    for tr in t_rows:
        segs = [
            dict(s)
            for s in cursor.execute(
                "SELECT * FROM ticket_segments WHERE ticket_id = ? ORDER BY segment_order ASC",
                (tr["id"],),
            ).fetchall()
        ]
        raw_tok, verify_url = qr_service.resolve_raw_token_for_ticket(cursor, tr)
        tr_dict = {
            "ticketId": tr["id"],
            "ticketNumber": tr["ticket_number"],
            "passengerName": tr["passenger_name"],
            "passengerIndex": tr["passenger_index"] if "passenger_index" in tr.keys() else 1,
            "seatCodes": tr["seat_codes"],
            "cabinClass": tr["cabin_class"],
            "baggageAllowance": tr["baggage_allowance"],
            "ticketStatus": tr["status"],
            "issuanceState": tr["issuance_state"] if "issuance_state" in tr.keys() and tr["issuance_state"] else tr["status"],
            "checkinStatus": tr["checkin_status"] if "checkin_status" in tr.keys() and tr["checkin_status"] else "NOT_CHECKED_IN",
            "checkedInAt": tr["checked_in_at"] if "checked_in_at" in tr.keys() else None,
            "isTestTicket": bool(tr["is_test_ticket"]) if "is_test_ticket" in tr.keys() and tr["is_test_ticket"] is not None else True,
            "fareFamily": tr["fare_family"] if "fare_family" in tr.keys() and tr["fare_family"] else "STANDARD",
            "verificationToken": raw_tok,
            "verifyUrl": verify_url,
            "qrSvg": qr_service.generate_qr_svg(verify_url, size=180) if verify_url else None,
            "segments": segs,
            "issuedAt": tr["issued_at"],
        }
        enriched_tickets.append(tr_dict)

    conn.close()

    lead_enriched = None
    if selected_row:
        lead_enriched = next((x for x in enriched_tickets if x["ticketId"] == selected_row["id"]), None)
    if not lead_enriched and enriched_tickets:
        lead_enriched = enriched_tickets[0]

    passenger_name = f"{b['firstName'] or ''} {b['lastName'] or ''}".strip()
    passenger_names = []
    if b["passenger_data"]:
        try:
            for p_item in json.loads(b["passenger_data"]):
                nm = p_item.get("fullName") or f"{p_item.get('title', '')} {p_item.get('firstName', '')} {p_item.get('lastName', '')}".strip()
                if nm:
                    passenger_names.append(nm)
        except Exception:
            pass
    if passenger_names:
        passenger_name = passenger_names[0]
    elif not passenger_name:
        passenger_name = b["display_name"] or b["username"]

    seat_codes = [f"{s['column']}{s['row']}" for s in seats]
    seat_class = b["cabin_class"] or (seats[0]["type"].capitalize() if seats else "Economy")
    f_num = b["flight_number"] or f"{b['airlineIATA']}-{100 + (b['flightId'] % 900)}"
    baggage_text = (lead_enriched["baggageAllowance"] if lead_enriched else None) or f"Check-in: {bpol['included_checked_kg']} kg ({bpol['included_pieces']} pc) • Cabin: {bpol['cabin_kg']} kg"

    return {
        "ticketId": lead_enriched["ticketId"] if lead_enriched else None,
        "bookingReference": b["booking_reference"],
        "pnrCode": b["pnr_code"] or (selected_row["pnr_code"] if selected_row else None),
        "ticketNumber": lead_enriched["ticketNumber"] if lead_enriched else None,
        "verificationToken": lead_enriched["verificationToken"] if lead_enriched else None,
        "verifyUrl": lead_enriched["verifyUrl"] if lead_enriched else None,
        "qrSvg": lead_enriched["qrSvg"] if lead_enriched else None,
        "ticketStatus": lead_enriched["ticketStatus"] if lead_enriched else b["status"],
        "issuanceState": lead_enriched["issuanceState"] if lead_enriched else b["status"],
        "checkinStatus": lead_enriched["checkinStatus"] if lead_enriched else "NOT_CHECKED_IN",
        "checkedInAt": lead_enriched["checkedInAt"] if lead_enriched else None,
        "isTestTicket": lead_enriched["isTestTicket"] if lead_enriched else True,
        "segments": lead_enriched["segments"] if lead_enriched else [],
        "tickets": enriched_tickets,
        "id_account": b["id_account"],
        "id_airline": b["airlineId"],
        "flightId": b["flightId"],
        "flightNumber": f_num,
        "aircraft": b["aircraft_model"] or "Boeing 737-800",
        "passengerName": lead_enriched["passengerName"] if lead_enriched else passenger_name,
        "passengerNames": passenger_names if passenger_names else [passenger_name],
        "contactEmail": b["contact_email"] or b["emailAddress"],
        "tripType": b["trip_type"] or "one_way",
        "fareFamily": b["fare_family"] if "fare_family" in b.keys() and b["fare_family"] else "STANDARD",
        "feePolicyVersion": b["fee_policy_version"] if "fee_policy_version" in b.keys() and b["fee_policy_version"] else "FLY-POL-V1",
        "fareBreakdown": json.loads(b["fare_breakdown"]) if b["fare_breakdown"] else None,
        "airlineName": b["airlineName"],
        "airlineIATA": b["airlineIATA"],
        "airlineId": b["airlineId"],
        "depAirportName": b["depAirportName"],
        "depIATA": b["depIATA"],
        "depCity": b["depCity"],
        "arrAirportName": b["arrAirportName"],
        "arrIATA": b["arrIATA"],
        "arrCity": b["arrCity"],
        "depDateTime": b["dep_datetime"],
        "arrDateTime": b["arr_datetime"],
        "seatNumbers": ", ".join(seat_codes) if seat_codes else "Assigned",
        "seatClass": seat_class,
        "baggageAllowance": baggage_text,
        "nbrLuggages": b["nbr_luggages"],
        "weight": b["weight"],
        "totalAmount": b["total_amount"],
        "discountAmount": b["discount_amount"] or 0,
        "promoCode": b["promo_code"],
        "paymentRef": b["payment_ref"],
        "paymentMethod": b["payment_method"],
        "paymentStatus": "PAID" if b["status"] in ("CONFIRMED", "TICKETING_PENDING") else b["status"],
        "status": b["status"],
        "gate": f"G{b['flightId'] % 12 + 1}",
        "terminal": f"T{b['flightId'] % 3 + 1}",
        "returnFlightId": b["return_flight_id"],
        "issuedAt": lead_enriched["issuedAt"] if lead_enriched else b["paid_at"],
    }
