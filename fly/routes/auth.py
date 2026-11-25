"""
FLY Authentication & Profile API Blueprint
"""

import secrets
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, redirect, make_response, session
import database
from config import Config
from fly.middleware.auth import (
    check_rate_limit,
    get_auth_token_from_request,
    get_current_user,
    require_auth,
)

auth_bp = Blueprint("auth", __name__)


def _issue_session_response(acc_row, display_name: str, status_code: int = 200):
    token = secrets.token_hex(32)
    now_dt = datetime.utcnow()
    expires_dt = now_dt + timedelta(days=Config.SESSION_TTL_DAYS)
    created_at = now_dt.strftime("%Y-%m-%d %H:%M:%S")
    expires_at = expires_dt.strftime("%Y-%m-%d %H:%M:%S")
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "local").split(",")[0].strip()
    ua = (request.headers.get("User-Agent") or "")[:200]

    conn = database.get_db()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO auth_sessions (token, account_id, username, role, airline_id, ip_address, user_agent, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (token, acc_row["id"], acc_row["username"], acc_row["role"], acc_row["id_airline"], ip, ua, created_at, expires_at),
    )
    conn.commit()
    conn.close()

    role_norm = (acc_row["role"] or "PASSENGER").upper()
    payload = {
        "success": True,
        "token": token,
        "user": {
            "id": acc_row["id"],
            "username": acc_row["username"],
            "role": role_norm,
            "displayName": display_name,
            "email": acc_row["emailAddress"],
            "location": acc_row["location"] or "Dhaka, Bangladesh",
            "airlineId": acc_row["id_airline"],
            "id_airline": acc_row["id_airline"],
        },
    }
    resp = make_response(jsonify(payload), status_code)
    resp.set_cookie(
        "auth_token",
        token,
        max_age=Config.SESSION_TTL_DAYS * 86400,
        httponly=True,
        samesite="Lax",
        secure=(Config.ENV == "production"),
        path="/",
    )
    return resp


@auth_bp.route("/api/auth/login", methods=["POST"])
def api_login():
    if not check_rate_limit("login", limit=25, window_seconds=300):
        return jsonify({"error": "Too many login attempts. Please wait a few minutes.", "code": "RATE_LIMITED"}), 429

    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    if not username or not password:
        return jsonify({"error": "Username or email and password are required."}), 400

    conn = database.get_db()
    cursor = conn.cursor()
    acc = cursor.execute(
        """
        SELECT a.*, p.firstName, p.lastName
        FROM accounts a
        LEFT JOIN passengers p ON a.id_passenger = p.id
        WHERE (a.username = ? COLLATE NOCASE OR a.emailAddress = ? COLLATE NOCASE)
        """,
        (username, username),
    ).fetchone()

    if not acc or not database.verify_password(password, acc["password"]):
        conn.close()
        return jsonify({"error": "Invalid credentials."}), 401

    if "is_active" in acc.keys() and acc["is_active"] == 0:
        conn.close()
        return jsonify({"error": "Account is deactivated."}), 403

    # Upgrade plaintext legacy password transparently upon valid login
    if acc["password"] and not str(acc["password"]).startswith("scrypt:"):
        cursor.execute("UPDATE accounts SET password = ? WHERE id = ?", (database.hash_password(password), acc["id"]))
        conn.commit()
    conn.close()

    display_name = acc["display_name"]
    if not display_name and (acc["firstName"] or acc["lastName"]):
        display_name = f"{acc['firstName'] or ''} {acc['lastName'] or ''}".strip()
    if not display_name:
        display_name = acc["username"]

    return _issue_session_response(acc, display_name, 200)


@auth_bp.route("/api/auth/register", methods=["POST"])
def api_register():
    if not check_rate_limit("register", limit=15, window_seconds=300):
        return jsonify({"error": "Too many registration attempts. Please try again later.", "code": "RATE_LIMITED"}), 429

    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    email = (data.get("email") or "").strip()
    first_name = (data.get("firstName") or "").strip()
    last_name = (data.get("lastName") or "").strip()
    location = (data.get("location") or "Dhaka, Bangladesh").strip()

    if not username or len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters."}), 400
    if not password or len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters."}), 400
    if not email or "@" not in email:
        return jsonify({"error": "A valid email address is required."}), 400
    if not first_name or not last_name:
        return jsonify({"error": "First name and last name are required."}), 400

    conn = database.get_db(isolation_level=None)
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN IMMEDIATE;")
        dup = cursor.execute(
            "SELECT id FROM accounts WHERE username = ? COLLATE NOCASE OR emailAddress = ? COLLATE NOCASE",
            (username, email),
        ).fetchone()
        if dup:
            cursor.execute("ROLLBACK;")
            return jsonify({"error": "Username or email is already registered.", "code": "DUPLICATE_ACCOUNT"}), 409

        cursor.execute(
            "INSERT INTO passengers (firstName, lastName, country) VALUES (?, ?, 'Bangladesh')",
            (first_name, last_name),
        )
        pax_id = cursor.lastrowid
        display_name = f"{first_name} {last_name}".strip()
        cursor.execute(
            """
            INSERT INTO accounts (id_passenger, id_airline, username, password, emailAddress, role, display_name, location, is_active)
            VALUES (?, NULL, ?, ?, ?, 'PASSENGER', ?, ?, 1)
            """,
            (pax_id, username, database.hash_password(password), email, display_name, location),
        )
        acc_id = cursor.lastrowid
        cursor.execute("COMMIT;")

        acc_row = conn.execute("SELECT * FROM accounts WHERE id = ?", (acc_id,)).fetchone()
        return _issue_session_response(acc_row, display_name, 201)
    except Exception:
        try:
            cursor.execute("ROLLBACK;")
        except Exception:
            pass
        return jsonify({"error": "Registration failed due to a server error. Please try again."}), 500
    finally:
        conn.close()


@auth_bp.route("/api/auth/me", methods=["GET"])
def api_auth_me():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized", "code": "UNAUTHORIZED"}), 401
    user_data = dict(user)
    user_data.pop("token", None)
    return jsonify({"authenticated": True, "user": user_data})


@auth_bp.route("/api/auth/profile", methods=["GET", "PUT"])
@require_auth
def api_auth_profile():
    user = get_current_user()
    conn = database.get_db()
    cursor = conn.cursor()

    if request.method == "GET":
        row = cursor.execute(
            """
            SELECT a.id, a.username, a.emailAddress, a.role, a.display_name, a.location, a.id_airline,
                   p.firstName, p.lastName, p.birthDate, p.gender, p.country
            FROM accounts a
            LEFT JOIN passengers p ON a.id_passenger = p.id
            WHERE a.id = ?
            """,
            (user["id"],),
        ).fetchone()
        conn.close()
        if not row:
            return jsonify({"error": "Account not found"}), 404
        return jsonify({"profile": dict(row)})

    data = request.get_json() or {}
    display_name = (data.get("displayName") or "").strip()
    email = (data.get("email") or "").strip()
    location = (data.get("location") or "").strip()
    first_name = (data.get("firstName") or "").strip()
    last_name = (data.get("lastName") or "").strip()
    current_password = (data.get("currentPassword") or "").strip()
    new_password = (data.get("newPassword") or "").strip()

    acc = cursor.execute("SELECT * FROM accounts WHERE id = ?", (user["id"],)).fetchone()
    if not acc:
        conn.close()
        return jsonify({"error": "Account not found"}), 404

    if new_password:
        if len(new_password) < 6:
            conn.close()
            return jsonify({"error": "New password must be at least 6 characters."}), 400
        if not database.verify_password(current_password, acc["password"]):
            conn.close()
            return jsonify({"error": "Current password is incorrect."}), 400
        cursor.execute("UPDATE accounts SET password = ? WHERE id = ?", (database.hash_password(new_password), user["id"]))

    if display_name:
        cursor.execute("UPDATE accounts SET display_name = ? WHERE id = ?", (display_name, user["id"]))
    if email:
        dup_email = cursor.execute(
            "SELECT id FROM accounts WHERE emailAddress = ? COLLATE NOCASE AND id != ?",
            (email, user["id"]),
        ).fetchone()
        if dup_email:
            conn.close()
            return jsonify({"error": "Email address already in use."}), 409
        cursor.execute("UPDATE accounts SET emailAddress = ? WHERE id = ?", (email, user["id"]))
    if location:
        cursor.execute("UPDATE accounts SET location = ? WHERE id = ?", (location, user["id"]))

    if acc["id_passenger"] and (first_name or last_name):
        if first_name:
            cursor.execute("UPDATE passengers SET firstName = ? WHERE id = ?", (first_name, acc["id_passenger"]))
        if last_name:
            cursor.execute("UPDATE passengers SET lastName = ? WHERE id = ?", (last_name, acc["id_passenger"]))

    conn.commit()
    updated = cursor.execute("SELECT id, username, emailAddress, role, display_name, location, id_airline FROM accounts WHERE id = ?", (user["id"],)).fetchone()
    conn.close()
    return jsonify({
        "success": True,
        "message": "Profile updated successfully.",
        "user": {
            "id": updated["id"],
            "username": updated["username"],
            "role": (updated["role"] or "PASSENGER").upper(),
            "displayName": updated["display_name"] or updated["username"],
            "email": updated["emailAddress"],
            "location": updated["location"] or "Dhaka, Bangladesh",
            "airlineId": updated["id_airline"],
        },
    })


@auth_bp.route("/logout", methods=["GET", "POST"])
def web_logout():
    token = get_auth_token_from_request()
    if token:
        try:
            conn = database.get_db()
            conn.execute("DELETE FROM auth_sessions WHERE token = ?", (token,))
            conn.commit()
            conn.close()
        except Exception:
            pass
    try:
        session.clear()
    except Exception:
        pass
    resp = make_response(redirect("/login"))
    resp.set_cookie("auth_token", "", expires=0, max_age=0, path="/")
    resp.set_cookie("session", "", expires=0, max_age=0, path="/")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, private"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


@auth_bp.route("/api/auth/logout", methods=["POST"])
def api_logout():
    token = get_auth_token_from_request()
    if token:
        try:
            conn = database.get_db()
            conn.execute("DELETE FROM auth_sessions WHERE token = ?", (token,))
            conn.commit()
            conn.close()
        except Exception:
            pass
    try:
        session.clear()
    except Exception:
        pass
    resp = jsonify({"success": True, "message": "Logged out successfully."})
    resp.set_cookie("auth_token", "", expires=0, max_age=0, path="/")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, private"
    return resp
