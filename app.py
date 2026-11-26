"""
FLY FLIGHT BOOKING & TICKET MANAGEMENT SYSTEM — PYTHON FLASK ENTRYPOINT
Author: mahin1710

Modular Blueprint Architecture:
- pages_bp:     Public, Passenger, and Administration HTML routes
- auth_bp:      scrypt authentication, registration, profile, logout
- catalog_bp:   Airports, live flight search, SSE/polling seat map, fares, promos
- bookings_bp:  Atomic 10-min seat locks, extensions, mock payment, PNR/PDF/QR tickets
- admin_bp:     Tenant-isolated Airline Admin & System Admin operations
"""

import os
import threading
from flask import Flask, render_template, send_from_directory, request
from config import Config
import database
from fly.routes.pages import pages_bp
from fly.routes.auth import auth_bp
from fly.routes.catalog import catalog_bp
from fly.routes.bookings import bookings_bp
from fly.routes.admin import admin_bp

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static"),
    static_url_path="",
)
app.secret_key = Config.SECRET_KEY
app.config["TEMPLATES_AUTO_RELOAD"] = True

# Non-destructive database schema migration & seed check
database.init_db()

# Register modular Blueprints
app.register_blueprint(pages_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(catalog_bp)
app.register_blueprint(bookings_bp)
app.register_blueprint(admin_bp)


@app.after_request
def apply_security_and_cors_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")

    origin = request.headers.get("Origin")
    if origin and Config.is_allowed_origin(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, Idempotency-Key"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return response


@app.errorhandler(404)
def page_not_found(e):
    return render_template("404.html"), 404


@app.route("/css/<path:filename>")
def serve_css(filename):
    return send_from_directory(os.path.join(app.static_folder, "css"), filename)


@app.route("/js/<path:filename>")
def serve_js(filename):
    return send_from_directory(os.path.join(app.static_folder, "js"), filename)


@app.route("/images/<path:filename>")
def serve_images(filename):
    return send_from_directory(os.path.join(app.static_folder, "images"), filename)


def _start_lock_expiry_scheduler():
    """Background daemon that automatically releases expired temporary seat locks and polls pending gateway refunds."""
    interval = max(10, Config.LOCK_SWEEP_INTERVAL_SECONDS)

    def _sweep_loop():
        try:
            database.cleanup_expired_holds()
            from fly.services import cancellation_refund_service
            cancellation_refund_service.run_background_reconciliation_sweep()
        except Exception:
            pass
        timer = threading.Timer(interval, _sweep_loop)
        timer.daemon = True
        timer.start()

    timer = threading.Timer(interval, _sweep_loop)
    timer.daemon = True
    timer.start()


if __name__ == "__main__":
    _start_lock_expiry_scheduler()
    print("========================================================")
    print("  FLY Flight Booking & Ticket Management System")
    print("  Author: mahin1710")
    print(f"  Server running on http://{Config.HOST}:{Config.PORT}")
    print(f"  Local URL: http://localhost:{Config.PORT}")
    print(f"  QR Verify Base URL ({Config.ENV}): {Config.get_qr_verify_base_url()}")
    print("========================================================")
    app.run(host=Config.HOST, port=Config.PORT, debug=Config.DEBUG, threaded=True)
