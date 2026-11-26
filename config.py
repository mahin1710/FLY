"""
FLY Aviation - Central Application Configuration
Loads environment variables safely (with local .env support) and centralizes
seat lock TTL, QR LAN verification URLs, payment gateway settings, security defaults,
and database settings.
"""

import ipaddress
import os
import re
import secrets
import socket

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_dotenv(dotenv_path: str):
    if not os.path.exists(dotenv_path):
        return
    try:
        with open(dotenv_path, "r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = val
    except Exception:
        pass


_load_dotenv(os.path.join(BASE_DIR, ".env"))


def _get_or_create_dev_secret(name: str) -> str:
    """
    Provides a stable development secret across restarts (stored outside git in
    .fly_dev_secrets.json) so sessions and QR HMAC verification remain valid after restarts.
    Never used in production.
    """
    env_val = os.environ.get(name, "").strip()
    if env_val:
        return env_val
    secret_file = os.path.join(BASE_DIR, "database", ".fly_dev_secrets.json")
    data = {}
    if os.path.exists(secret_file):
        try:
            import json
            with open(secret_file, "r", encoding="utf-8") as f:
                data = json.load(f) or {}
        except Exception:
            data = {}
    if name in data and data[name]:
        return str(data[name])
    data[name] = secrets.token_hex(32)
    try:
        import json
        os.makedirs(os.path.dirname(secret_file), exist_ok=True)
        with open(secret_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception:
        pass
    return data[name]


def _is_loopback_or_link_local(ip_str: str) -> bool:
    try:
        ip_obj = ipaddress.ip_address(ip_str)
        return ip_obj.is_loopback or ip_obj.is_link_local or ip_obj.is_unspecified
    except ValueError:
        return True


def detect_lan_ipv4() -> str:
    """
    Best-effort detection of the host's non-loopback LAN IPv4 address for local Wi-Fi
    mobile QR scanning. Never relies on untrusted HTTP Host headers.
    """
    candidates = []
    # Method 1: OS routing socket probe (no external packets sent)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("192.0.2.1", 80))
            ip = s.getsockname()[0]
            if ip and not _is_loopback_or_link_local(ip):
                candidates.append(ip)
        finally:
            s.close()
    except Exception:
        pass

    # Method 2: Hostname interface resolution
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip and not _is_loopback_or_link_local(ip) and ip not in candidates:
                candidates.append(ip)
    except Exception:
        pass

    # Prefer RFC1918 private LAN addresses (192.168.*, 10.*, 172.16-31.*)
    for ip in candidates:
        try:
            if ipaddress.ip_address(ip).is_private:
                return ip
        except ValueError:
            continue
    return candidates[0] if candidates else ""


def _is_localhost_url(url: str) -> bool:
    if not url:
        return True
    low = url.lower()
    return bool(
        re.search(r"://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:/|$)", low)
    )


class Config:
    APP_NAME = "FLY"
    ENV = os.environ.get("FLASK_ENV", "development").lower()
    DEBUG = os.environ.get("DEBUG", "false").lower() == "true"
    HOST = os.environ.get("HOST", "0.0.0.0")
    PORT = int(os.environ.get("PORT", 5000))

    # Security & Token Signing
    if ENV == "production":
        SECRET_KEY = os.environ.get("FLY_SECRET_KEY") or os.environ.get("SECRET_KEY")
        if not SECRET_KEY:
            raise RuntimeError("SECRET_KEY or FLY_SECRET_KEY must be set in production.")
        QR_TOKEN_PEPPER = os.environ.get("QR_TOKEN_PEPPER") or SECRET_KEY
    else:
        SECRET_KEY = os.environ.get("FLY_SECRET_KEY") or os.environ.get("SECRET_KEY") or _get_or_create_dev_secret("SECRET_KEY")
        QR_TOKEN_PEPPER = os.environ.get("QR_TOKEN_PEPPER") or _get_or_create_dev_secret("QR_TOKEN_PEPPER")

    SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", 7))
    ALLOWED_ORIGINS = [
        o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5000,http://127.0.0.1:5000").split(",")
        if o.strip()
    ]

    # QR Verification URL Configuration (Never derives from untrusted Host headers)
    QR_VERIFY_BASE_URL = os.environ.get("QR_VERIFY_BASE_URL", "").strip().rstrip("/")
    APP_BASE_URL = os.environ.get("APP_BASE_URL", "").strip().rstrip("/")
    QR_TOKEN_EXPIRY_DAYS = int(os.environ.get("QR_TOKEN_EXPIRY_DAYS", 0))
    QR_VERIFY_RATE_LIMIT = int(os.environ.get("QR_VERIFY_RATE_LIMIT", 40))
    QR_VERIFY_RATE_WINDOW = int(os.environ.get("QR_VERIFY_RATE_WINDOW", 60))

    # Database
    DATABASE_PATH = os.environ.get("DATABASE_PATH") or os.path.join(BASE_DIR, "database", "flight_booking.db")
    DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

    # Seat Locking & Concurrency Policy (Central Authority)
    SEAT_LOCK_MINUTES = int(os.environ.get("SEAT_LOCK_MINUTES", 10))
    SEAT_EXTENSION_MINUTES = int(os.environ.get("SEAT_EXTENSION_MINUTES", 2))
    MAX_LOCK_EXTENSIONS = 1
    LOCK_SWEEP_INTERVAL_SECONDS = int(os.environ.get("LOCK_SWEEP_INTERVAL_SECONDS", 30))
    MAX_SEATS_PER_BOOKING = int(os.environ.get("MAX_SEATS_PER_BOOKING", 9))
    BOOKING_TIMEZONE = os.environ.get("BOOKING_TIMEZONE", "Asia/Dhaka")

    # External Providers & Payment Gateways
    FLIGHT_PROVIDER_ACTIVE = os.environ.get("FLIGHT_PROVIDER_ACTIVE", "DEMO_LOCAL").strip().upper()
    PAYMENT_GATEWAY_ACTIVE = os.environ.get("PAYMENT_GATEWAY_ACTIVE", "SIMULATED").strip().upper()
    SSLCOMMERZ_STORE_ID = os.environ.get("SSLCOMMERZ_STORE_ID", "").strip()
    SSLCOMMERZ_STORE_PASS = os.environ.get("SSLCOMMERZ_STORE_PASS", "").strip()
    SSLCOMMERZ_IS_SANDBOX = os.environ.get("SSLCOMMERZ_IS_SANDBOX", "true").lower() == "true"
    BKASH_APP_KEY = os.environ.get("BKASH_APP_KEY", "").strip()
    BKASH_APP_SECRET = os.environ.get("BKASH_APP_SECRET", "").strip()
    NAGAD_MERCHANT_ID = os.environ.get("NAGAD_MERCHANT_ID", "").strip()
    NAGAD_MERCHANT_KEY = os.environ.get("NAGAD_MERCHANT_KEY", "").strip()

    HOTEL_PROVIDER_API_KEY = os.environ.get("HOTEL_PROVIDER_API_KEY", "").strip()
    CAR_RENTAL_PROVIDER_API_KEY = os.environ.get("CAR_RENTAL_PROVIDER_API_KEY", "").strip()

    # Refund & Financial Governance
    DUAL_APPROVAL_THRESHOLD_BDT = int(os.environ.get("DUAL_APPROVAL_THRESHOLD_BDT", 50000))
    REFUND_QUOTE_TTL_MINUTES = int(os.environ.get("REFUND_QUOTE_TTL_MINUTES", 15))
    SUPPORT_PHONE = os.environ.get("SUPPORT_PHONE", "+880-9612-359359")
    SUPPORT_EMAIL = os.environ.get("SUPPORT_EMAIL", "support@fly-booking.com")

    @classmethod
    def get_qr_verify_base_url(cls) -> str:
        """
        Resolves the trusted QR verification base URL without localhost references
        and without trusting HTTP Host headers.
        - Production: requires HTTPS non-localhost domain.
        - Development: uses QR_VERIFY_BASE_URL env if non-localhost, else non-localhost
          APP_BASE_URL, else detected LAN IPv4 address on Config.PORT.
        """
        explicit = cls.QR_VERIFY_BASE_URL
        if explicit:
            if cls.ENV == "production" and (not explicit.lower().startswith("https://") or _is_localhost_url(explicit)):
                raise RuntimeError("Production QR_VERIFY_BASE_URL must be an HTTPS non-localhost URL.")
            if not _is_localhost_url(explicit):
                return explicit

        if cls.APP_BASE_URL and not _is_localhost_url(cls.APP_BASE_URL):
            if cls.ENV != "production" or cls.APP_BASE_URL.lower().startswith("https://"):
                return cls.APP_BASE_URL

        if cls.ENV == "production":
            raise RuntimeError("QR_VERIFY_BASE_URL (or HTTPS APP_BASE_URL) must be configured in production.")

        lan_ip = detect_lan_ipv4()
        if lan_ip:
            return f"http://{lan_ip}:{cls.PORT}"
        return f"http://{cls.HOST if cls.HOST != '0.0.0.0' else 'fly.local'}:{cls.PORT}"

    @classmethod
    def is_allowed_origin(cls, origin: str) -> bool:
        if not origin:
            return False
        if origin in cls.ALLOWED_ORIGINS:
            return True
        qr_base = cls.QR_VERIFY_BASE_URL
        if qr_base and origin.rstrip("/") == qr_base:
            return True
        if cls.ENV != "production":
            # Permit private LAN / localhost origins on configured port in local development
            m = re.match(r"^https?://([0-9a-zA-Z.\-:]+?)(?::(\d+))?$", origin.strip())
            if m:
                host = m.group(1)
                if host in ("localhost", "127.0.0.1"):
                    return True
                try:
                    if ipaddress.ip_address(host).is_private:
                        return True
                except ValueError:
                    pass
        return False
