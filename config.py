"""
FLY Aviation - Central Application Configuration
Loads environment variables safely (with local .env support) and centralizes
seat lock TTL, extension rules, security defaults, and database settings.
"""

import os
import secrets

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


class Config:
    APP_NAME = "FLY"
    ENV = os.environ.get("FLASK_ENV", "development").lower()
    DEBUG = os.environ.get("DEBUG", "false").lower() == "true"
    HOST = os.environ.get("HOST", "0.0.0.0")
    PORT = int(os.environ.get("PORT", 5000))

    # Security
    SECRET_KEY = os.environ.get("FLY_SECRET_KEY") or os.environ.get("SECRET_KEY")
    if not SECRET_KEY:
        if ENV == "production":
            raise RuntimeError("SECRET_KEY or FLY_SECRET_KEY must be set in production.")
        SECRET_KEY = "fly_dev_local_secret_change_in_prod_" + secrets.token_hex(8)

    SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", 7))
    ALLOWED_ORIGINS = [
        o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5000,http://127.0.0.1:5000").split(",")
        if o.strip()
    ]

    # Database
    DATABASE_PATH = os.environ.get("DATABASE_PATH") or os.path.join(BASE_DIR, "database", "flight_booking.db")
    DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

    # Seat Locking & Concurrency Policy (Central Authority)
    SEAT_LOCK_MINUTES = int(os.environ.get("SEAT_LOCK_MINUTES", 10))
    SEAT_EXTENSION_MINUTES = int(os.environ.get("SEAT_EXTENSION_MINUTES", 2))
    MAX_LOCK_EXTENSIONS = 1
    LOCK_SWEEP_INTERVAL_SECONDS = int(os.environ.get("LOCK_SWEEP_INTERVAL_SECONDS", 30))
    MAX_SEATS_PER_BOOKING = int(os.environ.get("MAX_SEATS_PER_BOOKING", 9))
