"""
FLY Authentication, RBAC & Airline Tenant Isolation Middleware
"""

import time
import threading
from functools import wraps
from datetime import datetime
from flask import request, jsonify, redirect
import database

_RATE_LOCK = threading.Lock()
_RATE_BUCKETS = {}


def check_rate_limit(scope: str, limit: int = 20, window_seconds: int = 300) -> bool:
    """Simple sliding-window IP rate limiter for sensitive auth and lookup endpoints."""
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "local").split(",")[0].strip()
    key = f"{scope}:{ip}"
    now = time.time()
    cutoff = now - window_seconds
    with _RATE_LOCK:
        hits = [t for t in _RATE_BUCKETS.get(key, []) if t > cutoff]
        if len(hits) >= limit:
            _RATE_BUCKETS[key] = hits
            return False
        hits.append(now)
        _RATE_BUCKETS[key] = hits
        return True


def get_auth_token_from_request():
    """Extracts token from Authorization Bearer header or HttpOnly auth_token cookie."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        tok = auth_header[7:].strip()
        if tok:
            return tok
    cookie_tok = request.cookies.get("auth_token", "").strip()
    return cookie_tok or None


def get_current_user():
    """Validates session token against auth_sessions + active account status."""
    token = get_auth_token_from_request()
    if not token:
        return None

    conn = database.get_db()
    cursor = conn.cursor()
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    row = cursor.execute(
        """
        SELECT s.token, s.account_id, s.role, s.airline_id,
               a.username, a.display_name, a.emailAddress, a.location,
               COALESCE(a.is_active, 1) as is_active
        FROM auth_sessions s
        JOIN accounts a ON s.account_id = a.id
        WHERE s.token = ? AND datetime(s.expires_at) > datetime(?)
        """,
        (token, now_iso),
    ).fetchone()
    conn.close()

    if not row or not row["is_active"]:
        return None

    role = (row["role"] or "PASSENGER").upper()
    return {
        "id": row["account_id"],
        "username": row["username"],
        "role": role,
        "displayName": row["display_name"] or row["username"],
        "email": row["emailAddress"],
        "location": row["location"] or "Dhaka, Bangladesh",
        "airlineId": row["airline_id"],
        "id_airline": row["airline_id"],
        "token": row["token"],
    }


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = get_current_user()
        if not user:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Authentication required.", "code": "UNAUTHORIZED"}), 401
            return redirect(f"/login?next={request.path}")
        return fn(*args, **kwargs)
    return wrapper


def require_roles(*allowed_roles):
    normalized = {r.upper() for r in allowed_roles}

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = get_current_user()
            if not user:
                if request.path.startswith("/api/"):
                    return jsonify({"error": "Authentication required.", "code": "UNAUTHORIZED"}), 401
                return redirect(f"/login?next={request.path}")
            if user["role"] not in normalized:
                if request.path.startswith("/api/"):
                    return jsonify({"error": "Forbidden: insufficient role permissions.", "code": "FORBIDDEN"}), 403
                return redirect("/")
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def verify_booking_access(booking_row, user) -> tuple:
    """
    Enforces customer isolation and airline-level tenant isolation:
    - PASSENGER: must own booking (id_account == user['id'])
    - AIRLINE_ADMIN: flight's airline must match user['airlineId']
    - SYSTEM_ADMIN / SUPER_ADMIN: global access
    """
    if not user or not booking_row:
        return False, "Unauthorized access."
    role = (user.get("role") or "PASSENGER").upper()
    if role in ("SYSTEM_ADMIN", "SUPER_ADMIN"):
        return True, None
    if role == "AIRLINE_ADMIN":
        b_airline = booking_row["id_airline"] if "id_airline" in booking_row.keys() else booking_row.get("airlineId")
        if user.get("airlineId") is not None and b_airline == user.get("airlineId"):
            return True, None
        return False, "Forbidden: Booking belongs to another airline."
    # Default: PASSENGER
    if booking_row["id_account"] == user.get("id"):
        return True, None
    return False, "Forbidden: You cannot access another customer's booking."
