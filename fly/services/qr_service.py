"""
FLY Cryptographic QR E-Ticket Verification & Staff Check-In Service

Guarantees:
1. QR tokens are derived via high-entropy nonces + HMAC-SHA256 pepper and ONLY hashed
   values (SHA-256/HMAC) are stored in `ticket_qr_tokens` (never plaintext tokens).
2. QR codes contain ONLY the configured LAN/HTTPS verification URL + opaque token (zero PII).
3. Valid QR credentials are created strictly AFTER ticket issuance (`ISSUED` state), never
   for unpaid, pending, or awaiting-issuance bookings.
4. Public mobile/web scans are idempotent read-only verifications logged in `ticket_scan_logs`;
   authorized staff check-in uses atomic database locking to prevent duplicate consumption.
"""

import base64
import hashlib
import hmac
import io
import secrets
from datetime import datetime, timedelta
import qrcode
from qrcode.constants import ERROR_CORRECT_M
import database
from config import Config


def generate_qr_nonce() -> str:
    """Generates a cryptographically random 144-bit URL-safe nonce."""
    return secrets.token_urlsafe(18)


def derive_raw_token(ticket_id: int, token_version: int, token_nonce: str) -> str:
    """
    Deterministically derives the high-entropy public verification token in memory
    using the server-only QR_TOKEN_PEPPER. Cannot be derived from a DB dump alone.
    """
    msg = f"FLY-QR-V{int(token_version)}:{int(ticket_id)}:{token_nonce}".encode("utf-8")
    digest = hmac.new(Config.QR_TOKEN_PEPPER.encode("utf-8"), msg, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def hash_token(raw_token: str) -> str:
    """One-way HMAC-SHA256 digest stored in ticket_qr_tokens.token_hash."""
    return hmac.new(
        Config.QR_TOKEN_PEPPER.encode("utf-8"),
        (raw_token or "").strip().encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def build_verification_url(raw_token: str) -> str:
    """Returns full LAN (dev) or HTTPS (prod) verification URL — never localhost."""
    base = Config.get_qr_verify_base_url().rstrip("/")
    return f"{base}/ticket/verify/{raw_token}"


def mask_passenger_name(full_name: str) -> str:
    """Masks passenger full name for public verification display while preserving recognition."""
    parts = [p for p in str(full_name or "Passenger").strip().split() if p]
    masked = []
    for p in parts:
        if len(p) <= 2:
            masked.append(p[0] + "*")
        elif len(p) <= 4:
            masked.append(p[0] + ("*" * (len(p) - 2)) + p[-1])
        else:
            masked.append(p[0] + ("*" * (len(p) - 2)) + p[-1])
    return " ".join(masked) if masked else "Passenger"


def make_qr_matrix(payload_url: str):
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(payload_url)
    qr.make(fit=True)
    return qr


def generate_qr_svg(payload_url: str, size: int = 200) -> str:
    """Generates a crisp, ISO-18004 standard camera-scannable SVG QR code."""
    qr = make_qr_matrix(payload_url)
    matrix = qr.get_matrix()
    n = len(matrix)
    cell = size / n
    rects = []
    for r in range(n):
        for c in range(n):
            if matrix[r][c]:
                rects.append(
                    f'<rect x="{c * cell:.2f}" y="{r * cell:.2f}" '
                    f'width="{cell + 0.15:.2f}" height="{cell + 0.15:.2f}" fill="#0F172A"/>'
                )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'width="{size}" height="{size}" role="img" aria-label="FLY Ticket Verification QR">'
        f'<rect width="{size}" height="{size}" fill="#FFFFFF"/>'
        f'{"".join(rects)}</svg>'
    )


def generate_qr_png_bytes(payload_url: str, target_px: int = 360) -> bytes:
    """Generates high-resolution camera-ready PNG QR bytes using Pillow."""
    qr = make_qr_matrix(payload_url)
    img = qr.make_image(fill_color="#0F172A", back_color="#FFFFFF").convert("RGB")
    if target_px and img.size[0] < target_px:
        from PIL import Image
        scale = max(1, target_px // img.size[0])
        new_sz = img.size[0] * scale
        img = img.resize((new_sz, new_sz), resample=Image.NEAREST)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def generate_qr_rgb_image(payload_url: str, box_pixels: int = 8):
    """Returns a lossless Pillow RGB image suitable for high-DPI PDF FlateDecode embedding."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=box_pixels,
        border=4,
    )
    qr.add_data(payload_url)
    qr.make(fit=True)
    return qr.make_image(fill_color="#000000", back_color="#FFFFFF").convert("RGB")


def issue_qr_for_ticket(cursor, ticket_id: int, issuance_state: str = "ISSUED", is_test_ticket: bool = True, expires_at: str = None):
    """
    Issues a new versioned QR token hash for a genuinely ISSUED ticket.
    Refuses issuance if ticket is not in ISSUED state.
    Returns (raw_token, verification_url, qr_token_id) or (None, None, None).
    """
    if str(issuance_state or "").upper() != "ISSUED":
        return None, None, None

    now_dt = datetime.utcnow()
    now_iso = now_dt.strftime("%Y-%m-%d %H:%M:%S")

    if expires_at is None and Config.QR_TOKEN_EXPIRY_DAYS > 0:
        expires_at = (now_dt + timedelta(days=Config.QR_TOKEN_EXPIRY_DAYS)).strftime("%Y-%m-%d %H:%M:%S")

    # Revoke any previously active token version cleanly without deleting history
    prev = cursor.execute(
        "SELECT MAX(token_version) as max_ver FROM ticket_qr_tokens WHERE ticket_id = ?",
        (ticket_id,),
    ).fetchone()
    next_ver = int(prev["max_ver"] or 0) + 1 if prev else 1
    cursor.execute(
        """
        UPDATE ticket_qr_tokens
        SET revoked_at = COALESCE(revoked_at, ?),
            revoke_reason = COALESCE(revoke_reason, 'SUPERSEDED_BY_NEW_VERSION'),
            updated_at = ?
        WHERE ticket_id = ? AND revoked_at IS NULL
        """,
        (now_iso, now_iso, ticket_id),
    )

    nonce = generate_qr_nonce()
    raw_token = derive_raw_token(ticket_id, next_ver, nonce)
    tok_hash = hash_token(raw_token)

    cursor.execute(
        """
        INSERT INTO ticket_qr_tokens (
            ticket_id, token_hash, token_nonce, token_version, is_test_token,
            issued_at, expires_at, revoked_at, revoke_reason, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
        """,
        (
            ticket_id,
            tok_hash,
            nonce,
            next_ver,
            1 if is_test_ticket else 0,
            now_iso,
            expires_at,
            now_iso,
            now_iso,
        ),
    )
    qr_token_id = cursor.lastrowid
    # Keep tickets.verification_token opaque (hashed) rather than plaintext
    cursor.execute("UPDATE tickets SET verification_token = ? WHERE id = ?", (tok_hash, ticket_id))
    return raw_token, build_verification_url(raw_token), qr_token_id


def revoke_qr_tokens(cursor, booking_reference: str = None, ticket_id: int = None, reason: str = "TICKET_CANCELLED"):
    """Revokes active QR tokens while preserving token & audit history."""
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    if ticket_id is not None:
        cursor.execute(
            """
            UPDATE ticket_qr_tokens
            SET revoked_at = ?, revoke_reason = ?, updated_at = ?
            WHERE ticket_id = ? AND revoked_at IS NULL
            """,
            (now_iso, reason, now_iso, int(ticket_id)),
        )
    elif booking_reference:
        cursor.execute(
            """
            UPDATE ticket_qr_tokens
            SET revoked_at = ?, revoke_reason = ?, updated_at = ?
            WHERE ticket_id IN (SELECT id FROM tickets WHERE booking_reference = ?)
              AND revoked_at IS NULL
            """,
            (now_iso, reason, now_iso, booking_reference),
        )


def resolve_raw_token_for_ticket(cursor, ticket_row):
    """
    Re-derives the raw verification URL/token in memory for authorized owner/admin
    viewing & PDF generation ONLY when an active unrevoked ISSUED token exists.
    Never reads plaintext tokens from DB.
    """
    if not ticket_row:
        return None, None
    t_id = ticket_row["id"]
    t_state = str(ticket_row["issuance_state"] if "issuance_state" in ticket_row.keys() and ticket_row["issuance_state"] else ticket_row["status"]).upper()
    if t_state not in ("ISSUED", "PARTIALLY_USED"):
        return None, None
    tok_row = cursor.execute(
        """
        SELECT * FROM ticket_qr_tokens
        WHERE ticket_id = ? AND revoked_at IS NULL
        ORDER BY token_version DESC, id DESC LIMIT 1
        """,
        (t_id,),
    ).fetchone()
    if not tok_row:
        return None, None
    if tok_row["expires_at"] and database.is_expired(tok_row["expires_at"]):
        return None, None
    raw_token = derive_raw_token(t_id, int(tok_row["token_version"]), tok_row["token_nonce"])
    return raw_token, build_verification_url(raw_token)


def _record_scan_log(cursor, ticket_id, qr_token_id, scan_result: str, scan_source: str, scanned_by=None, ip_address=None, user_agent=None, device_ref=None, checkin_event: int = 0):
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute(
        """
        INSERT INTO ticket_scan_logs (
            ticket_id, qr_token_id, scan_result, scan_source, scanned_by,
            ip_address, user_agent, device_ref, checkin_event, scanned_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            ticket_id,
            qr_token_id,
            scan_result,
            scan_source,
            scanned_by,
            (ip_address or "")[:64],
            (user_agent or "")[:200],
            (device_ref or "")[:120],
            int(checkin_event),
            now_iso,
        ),
    )


def verify_ticket_token(
    raw_token: str,
    scan_source: str = "PUBLIC_MOBILE",
    actor_user=None,
    ip_address: str = None,
    user_agent: str = None,
    device_ref: str = None,
) -> tuple:
    """
    Authoritative server-side QR credential verification.
    Never modifies ticket validity or consumes check-in entitlement.
    Returns (http_status, payload_dict).
    """
    clean_token = (raw_token or "").strip()
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    if len(clean_token) < 16 or " " in clean_token:
        conn = database.get_db()
        try:
            _record_scan_log(
                conn.cursor(),
                None,
                None,
                "INVALID_FORMAT",
                scan_source,
                actor_user["id"] if actor_user else None,
                ip_address,
                user_agent,
                device_ref,
            )
            conn.commit()
        finally:
            conn.close()
        return 404, {
            "valid": False,
            "verdict": "INVALID",
            "headline": "INVALID TICKET",
            "reason": "Unrecognized or invalid verification credential.",
            "verifiedAt": now_iso,
        }

    tok_hash = hash_token(clean_token)
    conn = database.get_db()
    cursor = conn.cursor()
    try:
        row = cursor.execute(
            """
            SELECT qt.id as qrTokenId, qt.ticket_id, qt.token_version, qt.is_test_token,
                   qt.issued_at as tokenIssuedAt, qt.expires_at as tokenExpiresAt,
                   qt.revoked_at as revokedAt, qt.revoke_reason as revokeReason,
                   t.ticket_number, t.pnr_code, t.booking_reference, t.passenger_name,
                   t.seat_codes, t.cabin_class, t.baggage_allowance, t.status as ticketStatus,
                   COALESCE(t.issuance_state, t.status) as issuanceState,
                   COALESCE(t.checkin_status, 'NOT_CHECKED_IN') as checkinStatus,
                   t.checked_in_at as checkedInAt,
                   COALESCE(t.is_test_ticket, 1) as isTestTicket,
                   b.status as bookingStatus, b.refund_status as bookingRefundStatus,
                   al.name as airlineName, al.IATA as airlineIATA,
                   f.id as flightId, f.flight_number, f.dep_datetime, f.arr_datetime, f.status as flightStatus,
                   da.IATA as depIATA, da.city as depCity, aa.IATA as arrIATA, aa.city as arrCity
            FROM ticket_qr_tokens qt
            JOIN tickets t ON qt.ticket_id = t.id
            JOIN bookings b ON t.booking_reference = b.booking_reference
            JOIN airLines al ON t.id_airline = al.id
            JOIN flights f ON t.id_flight = f.id
            JOIN airports da ON f.dep_airport = da.id
            JOIN airports aa ON f.arr_airport = aa.id
            WHERE qt.token_hash = ?
            LIMIT 1
            """,
            (tok_hash,),
        ).fetchone()

        if not row:
            _record_scan_log(
                cursor,
                None,
                None,
                "UNKNOWN_TOKEN",
                scan_source,
                actor_user["id"] if actor_user else None,
                ip_address,
                user_agent,
                device_ref,
            )
            conn.commit()
            return 404, {
                "valid": False,
                "verdict": "INVALID",
                "headline": "INVALID TICKET",
                "reason": "Verification credential does not match any active ticket.",
                "verifiedAt": now_iso,
            }

        t_status = str(row["ticketStatus"] or "").upper()
        i_state = str(row["issuanceState"] or t_status).upper()
        b_status = str(row["bookingStatus"] or "").upper()
        revoked_at = row["revokedAt"]
        token_expired = bool(row["tokenExpiresAt"] and database.is_expired(row["tokenExpiresAt"]))

        segments = [
            dict(s)
            for s in cursor.execute(
                """
                SELECT segment_order, origin_iata, dest_iata, dep_datetime, arr_datetime, coupon_status, seat_code, cabin_class
                FROM ticket_segments
                WHERE ticket_id = ?
                ORDER BY segment_order ASC
                """,
                (row["ticket_id"],),
            ).fetchall()
        ]

        if not segments:
            segments = [
                {
                    "segment_order": 1,
                    "origin_iata": row["depIATA"],
                    "dest_iata": row["arrIATA"],
                    "dep_datetime": row["dep_datetime"],
                    "arr_datetime": row["arr_datetime"],
                    "coupon_status": "CANCELLED" if t_status in ("CANCELLED", "REFUNDED") else "OPEN",
                    "seat_code": row["seat_codes"],
                    "cabin_class": row["cabin_class"],
                }
            ]

        scan_count_row = cursor.execute(
            "SELECT COUNT(*) as cnt FROM ticket_scan_logs WHERE ticket_id = ? AND checkin_event = 0",
            (row["ticket_id"],),
        ).fetchone()
        prior_scans = int(scan_count_row["cnt"] if scan_count_row else 0)

        # Determine authoritative travel verdict
        valid_for_travel = False
        verdict = "INVALID"
        headline = "INVALID TICKET"
        reason = None
        http_status = 200

        if t_status == "VOID" or i_state == "VOID":
            verdict = "VOID"
            headline = "VOID — TICKET INVALID FOR TRAVEL"
            reason = "This ticket has been voided by an authorized issuer and is not valid for travel."
        elif t_status == "REFUNDED" or i_state == "REFUNDED" or b_status == "REFUNDED":
            verdict = "REFUNDED"
            headline = "REFUNDED — TICKET NOT VALID FOR TRAVEL"
            reason = "This ticket has been refunded and invalidated."
        elif t_status == "CANCELLED" or i_state == "CANCELLED" or b_status == "CANCELLED":
            # Check if a refund settlement is currently pending after confirmed cancellation
            rf_row = cursor.execute(
                "SELECT refund_ref, status FROM refunds WHERE booking_reference = ? ORDER BY id DESC LIMIT 1",
                (row["booking_reference"],),
            ).fetchone()
            if rf_row and str(rf_row["status"]).upper() in ("APPROVAL_PENDING", "SUBMITTED_TO_SUPPLIER", "SUPPLIER_APPROVED", "GATEWAY_REFUND_PENDING", "GATEWAY_PROCESSING"):
                verdict = "REFUND_PENDING"
                headline = "CANCELLED (REFUND PENDING) — NOT VALID FOR TRAVEL"
                reason = f"Ticket cancelled; refund {rf_row['refund_ref']} is currently {rf_row['status']}."
            else:
                verdict = "CANCELLED"
                headline = "CANCELLED — NOT VALID FOR TRAVEL"
                reason = "This ticket was cancelled and is no longer valid for travel."
        elif i_state in ("TICKETING_PENDING", "AWAITING_ISSUANCE", "CANCELLATION_PENDING", "REFUND_PENDING", "UNDER_REVIEW"):
            label_map = {
                "TICKETING_PENDING": "Ticketing Pending",
                "AWAITING_ISSUANCE": "Ticketing Pending",
                "CANCELLATION_PENDING": "Cancellation Pending",
                "REFUND_PENDING": "Refund Pending",
                "UNDER_REVIEW": "Under Review",
            }
            verdict = i_state
            headline = label_map[i_state].upper()
            reason = f"Ticket is currently {label_map[i_state]} and not cleared as valid for travel."
        elif revoked_at:
            verdict = "REVOKED"
            headline = "REVOKED — INVALID TICKET"
            reason = "This verification QR code has been revoked."
            http_status = 410
        elif token_expired:
            verdict = "EXPIRED"
            headline = "INVALID TICKET"
            reason = "Verification credential has expired."
            http_status = 410
        elif i_state == "USED":
            verdict = "USED"
            headline = "FULLY USED — COUPONS CONSUMED"
            reason = "All flight segments for this ticket have already been used."
        elif i_state == "PARTIALLY_USED":
            valid_for_travel = True
            verdict = "PARTIALLY_USED"
            headline = "PARTIALLY USED — REMAINING COUPON OPEN"
            reason = "Part of the itinerary has been flown; remaining unused segment(s) remain open."
        elif t_status == "ISSUED" and i_state == "ISSUED":
            valid_for_travel = True
            verdict = "VALID_ISSUED"
            headline = "VALID — TICKET ISSUED"
            reason = "Ticket is verified against FLY issuance records."
        else:
            verdict = "INVALID"
            headline = "INVALID TICKET"
            reason = "Ticket issuance status could not be confirmed."

        checkin_status = row["checkinStatus"]
        if verdict in ("VALID_ISSUED", "PARTIALLY_USED"):
            if checkin_status == "FLY_CHECKED_IN":
                checkin_label = "Checked in through authorized FLY staff workflow"
            else:
                checkin_label = "Issued — Not checked in through FLY (Airport airline check-in required separately)"
        elif verdict == "USED":
            checkin_label = "Used"
        else:
            checkin_label = verdict.replace("_", " ").title()

        _record_scan_log(
            cursor,
            row["ticket_id"],
            row["qrTokenId"],
            verdict,
            scan_source,
            actor_user["id"] if actor_user else None,
            ip_address,
            user_agent,
            device_ref,
            checkin_event=0,
        )
        conn.commit()

        # Sanitized payload: zero passport, raw email, phone, payment card details, or DB internals
        return http_status, {
            "valid": valid_for_travel,
            "verdict": verdict,
            "headline": headline,
            "reason": reason,
            "bookingReference": row["booking_reference"],
            "pnrCode": row["pnr_code"],
            "ticketNumber": row["ticket_number"],
            "maskedPassengerName": mask_passenger_name(row["passenger_name"]),
            "airlineName": row["airlineName"],
            "airlineIATA": row["airlineIATA"],
            "flightNumber": row["flight_number"] or f"{row['airlineIATA']}-{100 + (int(row['flightId']) % 900)}",
            "depIATA": row["depIATA"],
            "depCity": row["depCity"],
            "arrIATA": row["arrIATA"],
            "arrCity": row["arrCity"],
            "departureDateTime": row["dep_datetime"],
            "arrivalDateTime": row["arr_datetime"],
            "cabinClass": row["cabin_class"],
            "seatCodes": row["seat_codes"],
            "baggageAllowance": row["baggage_allowance"],
            "issuanceStatus": i_state,
            "ticketStatus": t_status,
            "checkinStatus": checkin_status,
            "checkinLabel": checkin_label,
            "checkedInAt": row["checkedInAt"],
            "segments": segments,
            "isTestTicket": bool(row["isTestTicket"]),
            "testFixtureBadge": "TEST FIXTURE TICKET (NON-LIVE)" if row["isTestTicket"] else None,
            "verificationAuthority": (
                "FLY Record Verification (Sandbox / Local Issuance)"
                if Config.FLIGHT_PROVIDER_ACTIVE in ("DEMO_LOCAL", "")
                else f"Provider Synchronized Verification ({Config.FLIGHT_PROVIDER_ACTIVE})"
            ),
            "verifiedAt": now_iso,
            "publicScanCount": prior_scans + 1,
            "note": "Public QR verification is read-only and does not consume travel entitlement. Not an airline airport boarding pass.",
        }
    finally:
        conn.close()


def staff_checkin_ticket(raw_token: str, staff_user: dict, ip_address: str = None, device_ref: str = None) -> tuple:
    """
    Authorized atomic staff FLY check-in operation.
    Strictly prevents duplicate/concurrent check-ins via BEGIN IMMEDIATE + conditional UPDATE.
    Returns (http_status, payload_dict).
    """
    if not staff_user or str(staff_user.get("role") or "").upper() not in ("AIRLINE_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN"):
        return 403, {"error": "Forbidden: Authorized FLY staff credentials required.", "code": "FORBIDDEN"}

    clean_token = (raw_token or "").strip()
    tok_hash = hash_token(clean_token)
    conn = database.get_db(isolation_level=None)
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN IMMEDIATE;")
        now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        row = cursor.execute(
            """
            SELECT qt.id as qrTokenId, qt.revoked_at, qt.expires_at,
                   t.*, b.status as bookingStatus
            FROM ticket_qr_tokens qt
            JOIN tickets t ON qt.ticket_id = t.id
            JOIN bookings b ON t.booking_reference = b.booking_reference
            WHERE qt.token_hash = ?
            LIMIT 1
            """,
            (tok_hash,),
        ).fetchone()

        if not row:
            cursor.execute("ROLLBACK;")
            return 404, {"error": "Unknown verification token.", "code": "INVALID_TOKEN"}

        if str(staff_user.get("role")).upper() == "AIRLINE_ADMIN" and int(row["id_airline"]) != int(staff_user.get("airlineId") or -1):
            cursor.execute("ROLLBACK;")
            return 403, {"error": "Forbidden: Cannot check in a ticket for another airline.", "code": "FORBIDDEN"}

        if row["revoked_at"] or str(row["status"]).upper() != "ISSUED" or str(row["bookingStatus"]).upper() != "CONFIRMED":
            cursor.execute("ROLLBACK;")
            return 409, {"error": f"Ticket is not eligible for check-in (status: {row['status']}).", "code": "NOT_ELIGIBLE"}

        if str(row["issuance_state"] or "ISSUED").upper() not in ("ISSUED", "PARTIALLY_USED"):
            cursor.execute("ROLLBACK;")
            return 409, {"error": f"Ticket state {row['issuance_state']} cannot be checked in.", "code": "PENDING_STATE"}

        if row["expires_at"] and database.is_expired(row["expires_at"]):
            cursor.execute("ROLLBACK;")
            return 410, {"error": "QR verification token has expired.", "code": "TOKEN_EXPIRED"}

        cursor.execute(
            """
            UPDATE tickets
            SET checkin_status = 'FLY_CHECKED_IN',
                checked_in_at = ?,
                checked_in_by = ?,
                updated_at = ?
            WHERE id = ?
              AND status = 'ISSUED'
              AND COALESCE(checkin_status, 'NOT_CHECKED_IN') = 'NOT_CHECKED_IN'
            """,
            (now_iso, staff_user["id"], now_iso, row["id"]),
        )
        if cursor.rowcount != 1:
            _record_scan_log(
                cursor,
                row["id"],
                row["qrTokenId"],
                "DUPLICATE_CHECKIN_BLOCKED",
                "STAFF_CHECKIN",
                staff_user["id"],
                ip_address,
                None,
                device_ref,
                checkin_event=0,
            )
            cursor.execute("COMMIT;")
            return 409, {
                "error": "Duplicate check-in prevented: ticket is already checked in via FLY.",
                "code": "ALREADY_CHECKED_IN",
                "checkedInAt": row["checked_in_at"],
            }

        cursor.execute(
            """
            UPDATE ticket_segments
            SET coupon_status = 'CHECKED_IN'
            WHERE ticket_id = ? AND coupon_status = 'OPEN' AND segment_order = (
                SELECT MIN(segment_order) FROM ticket_segments WHERE ticket_id = ? AND coupon_status = 'OPEN'
            )
            """,
            (row["id"], row["id"]),
        )
        _record_scan_log(
            cursor,
            row["id"],
            row["qrTokenId"],
            "CHECKED_IN_SUCCESS",
            "STAFF_CHECKIN",
            staff_user["id"],
            ip_address,
            None,
            device_ref,
            checkin_event=1,
        )
        database.log_audit_event(
            cursor,
            event_type="STAFF_TICKET_CHECKIN",
            result="CHECKED_IN",
            actor_id=staff_user["id"],
            actor_role=staff_user["role"],
            airline_id=row["id_airline"],
            flight_id=row["id_flight"],
            seat_codes=row["seat_codes"],
            reservation_ref=row["booking_reference"],
            details=f"Ticket {row['ticket_number']} checked in via FLY staff workflow.",
            ip_address=ip_address,
        )
        cursor.execute("COMMIT;")
        return 200, {
            "success": True,
            "ticketNumber": row["ticket_number"],
            "bookingReference": row["booking_reference"],
            "checkinStatus": "FLY_CHECKED_IN",
            "checkedInAt": now_iso,
            "checkedInBy": staff_user["username"],
            "note": "Checked in through authorized FLY staff workflow (separate from airline airport DCS check-in).",
        }
    except Exception as exc:
        try:
            cursor.execute("ROLLBACK;")
        except Exception:
            pass
        return 500, {"error": f"Check-in failed: {exc}", "code": "SERVER_ERROR"}
    finally:
        conn.close()


def staff_void_ticket(raw_token: str, staff_user: dict, reason: str = "Voided by authorized issuer", ip_address: str = None) -> tuple:
    """Authorized staff void operation: sets issuance_state='VOID' and revokes active QR tokens."""
    if not staff_user or str(staff_user.get("role") or "").upper() not in ("AIRLINE_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN"):
        return 403, {"error": "Forbidden: Authorized staff role required."}
    tok_hash = hash_token((raw_token or "").strip())
    conn = database.get_db(isolation_level=None)
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN IMMEDIATE;")
        now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        row = cursor.execute(
            "SELECT qt.ticket_id, t.ticket_number, t.booking_reference, t.id_airline, t.id_flight FROM ticket_qr_tokens qt JOIN tickets t ON qt.ticket_id = t.id WHERE qt.token_hash = ? LIMIT 1",
            (tok_hash,),
        ).fetchone()
        if not row:
            cursor.execute("ROLLBACK;")
            return 404, {"error": "Verification token not found."}
        if str(staff_user.get("role")).upper() == "AIRLINE_ADMIN" and int(row["id_airline"]) != int(staff_user.get("airlineId") or -1):
            cursor.execute("ROLLBACK;")
            return 403, {"error": "Forbidden: Cannot void another airline's ticket."}
        cursor.execute("UPDATE tickets SET status = 'CANCELLED', issuance_state = 'VOID', updated_at = ? WHERE id = ?", (now_iso, row["ticket_id"]))
        cursor.execute("UPDATE ticket_segments SET coupon_status = 'VOID' WHERE ticket_id = ?", (row["ticket_id"],))
        revoke_qr_tokens(cursor, ticket_id=row["ticket_id"], reason="TICKET_VOIDED")
        database.log_audit_event(cursor, "TICKET_VOIDED", "VOID", staff_user["id"], staff_user["role"], row["id_airline"], row["id_flight"], reservation_ref=row["booking_reference"], details=f"Voided ticket {row['ticket_number']}: {reason}", ip_address=ip_address)
        cursor.execute("COMMIT;")
        return 200, {"success": True, "ticketNumber": row["ticket_number"], "issuanceState": "VOID"}
    except Exception as exc:
        try:
            cursor.execute("ROLLBACK;")
        except Exception:
            pass
        return 500, {"error": str(exc)}
    finally:
        conn.close()
