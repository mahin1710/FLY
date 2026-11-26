"""
FLY Travel Product Provider Adapters (Hotels & Car Rentals)
Implements strict input validation and honest provider configuration checks.
Never returns fabricated hotel or rental availability as live inventory.
"""

import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

_TZ_OFFSETS = {
    "Asia/Dhaka": timedelta(hours=6),
    "UTC": timedelta(hours=0),
}


def get_booking_tz(tz_name: str = "Asia/Dhaka"):
    try:
        return ZoneInfo(tz_name)
    except Exception:
        offset = _TZ_OFFSETS.get(tz_name, timedelta(hours=6))
        return timezone(offset)


def get_booking_today_str(tz_name: str = "Asia/Dhaka") -> str:
    return datetime.now(get_booking_tz(tz_name)).strftime("%Y-%m-%d")


def _parse_iso_date(val: str):
    try:
        return datetime.strptime((val or "").strip()[:10], "%Y-%m-%d").date()
    except Exception:
        return None


class HotelProviderAdapter:
    """Adapter boundary for external Hospitality/Hotel GDS & Consolidator APIs."""

    REQUIRED_ENV = ("HOTEL_PROVIDER_NAME", "HOTEL_PROVIDER_API_KEY", "HOTEL_PROVIDER_ENDPOINT")

    @classmethod
    def is_configured(cls) -> bool:
        return bool(os.environ.get("HOTEL_PROVIDER_API_KEY", "").strip())

    @classmethod
    def validate_query(cls, params: dict, tz_name: str = "Asia/Dhaka"):
        dest = (params.get("destination") or "").strip()
        check_in_s = (params.get("checkIn") or "").strip()
        check_out_s = (params.get("checkOut") or "").strip()

        if not dest or len(dest) < 2:
            return False, "Destination city or airport is required.", None

        try:
            rooms = int(params.get("rooms") or 1)
            adults = int(params.get("adults") or 2)
            children = int(params.get("children") or 0)
        except (ValueError, TypeError):
            return False, "Rooms and guest counts must be valid integers.", None

        if rooms < 1 or rooms > 8:
            return False, "Rooms must be between 1 and 8.", None
        if adults < 1 or adults > 16:
            return False, "Adult count must be between 1 and 16.", None
        if children < 0 or children > 10:
            return False, "Child count must be between 0 and 10.", None
        if rooms > adults:
            return False, "Number of rooms cannot exceed adult guests.", None

        ci = _parse_iso_date(check_in_s)
        co = _parse_iso_date(check_out_s)
        today = _parse_iso_date(get_booking_today_str(tz_name))
        if not ci or not co:
            return False, "Valid check-in and check-out dates (YYYY-MM-DD) are required.", None
        if ci < today:
            return False, f"Check-in date cannot be in the past (earliest: {today}).", None
        if co <= ci:
            return False, "Check-out date must be strictly after check-in date.", None

        nights = (co - ci).days
        return True, None, {
            "destination": dest,
            "checkIn": check_in_s[:10],
            "checkOut": check_out_s[:10],
            "nights": nights,
            "rooms": rooms,
            "adults": adults,
            "children": children,
        }

    @classmethod
    def search(cls, params: dict, tz_name: str = "Asia/Dhaka"):
        ok, err, clean = cls.validate_query(params, tz_name)
        if not ok:
            return 400, {"valid": False, "error": err, "code": "INVALID_HOTEL_SEARCH"}

        if not cls.is_configured():
            return 200, {
                "valid": True,
                "providerConfigured": False,
                "code": "PROVIDER_NOT_CONFIGURED",
                "providerName": os.environ.get("HOTEL_PROVIDER_NAME") or "Not Configured",
                "message": "No live Hotel inventory provider credentials are configured on this server. Live room rates cannot be displayed until a hospitality API adapter is connected.",
                "requiredEnv": list(cls.REQUIRED_ENV),
                "query": clean,
                "hotels": [],
            }

        return 200, {
            "valid": True,
            "providerConfigured": True,
            "providerName": os.environ.get("HOTEL_PROVIDER_NAME"),
            "query": clean,
            "hotels": [],
        }


class CarRentalProviderAdapter:
    """Adapter boundary for external Car Rental Aggregator APIs."""

    REQUIRED_ENV = ("CAR_RENTAL_PROVIDER_NAME", "CAR_RENTAL_PROVIDER_API_KEY", "CAR_RENTAL_PROVIDER_ENDPOINT")

    @classmethod
    def is_configured(cls) -> bool:
        return bool(os.environ.get("CAR_RENTAL_PROVIDER_API_KEY", "").strip())

    @classmethod
    def validate_query(cls, params: dict, tz_name: str = "Asia/Dhaka"):
        pickup_loc = (params.get("pickupLocation") or "").strip()
        same_loc = str(params.get("sameLocation", "true")).lower() in ("true", "1", "yes")
        dropoff_loc = pickup_loc if same_loc else (params.get("dropoffLocation") or "").strip()
        pickup_date_s = (params.get("pickupDate") or "").strip()
        return_date_s = (params.get("returnDate") or "").strip()
        pickup_time = (params.get("pickupTime") or "10:00").strip()
        return_time = (params.get("returnTime") or "10:00").strip()

        if not pickup_loc or len(pickup_loc) < 2:
            return False, "Pickup location is required.", None
        if not dropoff_loc or len(dropoff_loc) < 2:
            return False, "Drop-off location is required.", None

        try:
            driver_age = int(params.get("driverAge") or 25)
        except (ValueError, TypeError):
            return False, "Driver age must be a valid number.", None
        if driver_age < 21 or driver_age > 85:
            return False, "Driver must be between 21 and 85 years old for rental eligibility.", None

        pd = _parse_iso_date(pickup_date_s)
        rd = _parse_iso_date(return_date_s)
        today = _parse_iso_date(get_booking_today_str(tz_name))
        if not pd or not rd:
            return False, "Valid pickup and return dates (YYYY-MM-DD) are required.", None
        if pd < today:
            return False, f"Pickup date cannot be in the past (earliest: {today}).", None
        if rd < pd:
            return False, "Return date cannot be earlier than pickup date.", None
        if rd == pd and return_time <= pickup_time:
            return False, "For same-day rentals, return time must be after pickup time.", None

        return True, None, {
            "pickupLocation": pickup_loc,
            "dropoffLocation": dropoff_loc,
            "sameLocation": same_loc,
            "pickupDate": pickup_date_s[:10],
            "pickupTime": pickup_time,
            "returnDate": return_date_s[:10],
            "returnTime": return_time,
            "driverAge": driver_age,
        }

    @classmethod
    def search(cls, params: dict, tz_name: str = "Asia/Dhaka"):
        ok, err, clean = cls.validate_query(params, tz_name)
        if not ok:
            return 400, {"valid": False, "error": err, "code": "INVALID_CAR_SEARCH"}

        if not cls.is_configured():
            return 200, {
                "valid": True,
                "providerConfigured": False,
                "code": "PROVIDER_NOT_CONFIGURED",
                "providerName": os.environ.get("CAR_RENTAL_PROVIDER_NAME") or "Not Configured",
                "message": "No live Car Rental supplier API credentials are configured on this server. Live fleet availability and rental pricing require a configured provider adapter.",
                "requiredEnv": list(cls.REQUIRED_ENV),
                "query": clean,
                "cars": [],
            }

        return 200, {
            "valid": True,
            "providerConfigured": True,
            "providerName": os.environ.get("CAR_RENTAL_PROVIDER_NAME"),
            "query": clean,
            "cars": [],
        }
