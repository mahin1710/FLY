"""
FLY Web Pages Blueprint
Separates Public Passenger, Registered Passenger, and Administration HTML routes.
"""

from flask import Blueprint, render_template, request, redirect

pages_bp = Blueprint("pages", __name__)


@pages_bp.route("/")
def home_page():
    return render_template("pages/home.html")


@pages_bp.route("/flights")
@pages_bp.route("/flights/search")
@pages_bp.route("/flight/search")
@pages_bp.route("/flight/list")
def flight_search_page():
    return render_template("pages/flight_search.html")


@pages_bp.route("/flights/<int:flight_id>/seats")
def flight_seat_selection_page(flight_id):
    return render_template("pages/seat_map.html", flight_id=flight_id)


@pages_bp.route("/flights/offer/<offer_id>")
def flight_offer_page(offer_id):
    return redirect("/flights/search")


@pages_bp.route("/checkout")
def checkout_page():
    return render_template("pages/checkout.html")


@pages_bp.route("/booking/travellers")
@pages_bp.route("/booking/extras")
@pages_bp.route("/booking/review")
@pages_bp.route("/booking/payment")
@pages_bp.route("/payment")
def legacy_checkout_steps_redirect():
    ref = request.args.get("ref") or request.args.get("booking_ref") or ""
    if ref:
        return redirect(f"/checkout?ref={ref}")
    return redirect("/checkout")


@pages_bp.route("/payment/result")
@pages_bp.route("/booking/payment/result")
def payment_result_page():
    status = request.args.get("status", "success").lower()
    tran_id = request.args.get("tran_id") or request.args.get("transaction_id")
    booking_ref = request.args.get("booking_ref") or request.args.get("reference")
    amount = request.args.get("amount")
    currency = request.args.get("currency", "BDT")
    gateway = request.args.get("gateway", "FLY Simulated Gateway")
    return render_template(
        "pages/payment_result.html",
        result_status=status,
        transaction_id=tran_id,
        booking_ref=booking_ref,
        amount=amount,
        currency=currency,
        gateway_provider=gateway,
    )


@pages_bp.route("/booking/status/<reference>")
def booking_status_page(reference):
    return render_template("pages/booking_status.html", reference=reference)


@pages_bp.route("/ticket/<pnr>")
def ticket_view_page(pnr):
    return render_template("pages/ticket.html", pnr=pnr)


@pages_bp.route("/ticket/verify/<token>")
def ticket_verify_page(token):
    return render_template("pages/ticket_verify.html", token=token)


@pages_bp.route("/my-bookings")
def my_bookings_page():
    return render_template("pages/my_bookings.html")


@pages_bp.route("/manage-booking")
def manage_booking_page():
    return render_template("pages/manage_booking.html")


@pages_bp.route("/support")
@pages_bp.route("/help")
def support_page():
    return render_template("pages/support.html")


@pages_bp.route("/login")
@pages_bp.route("/auth")
def login_page():
    return render_template("pages/auth.html", auth_mode="login")


@pages_bp.route("/register")
def register_page():
    return render_template("pages/auth.html", auth_mode="register")


@pages_bp.route("/profile")
def profile_page():
    return render_template("pages/auth.html", auth_mode="profile")


@pages_bp.route("/admin")
@pages_bp.route("/admin/operations")
def admin_dashboard_page():
    return render_template("pages/admin_operations.html", admin_tab="dashboard")


@pages_bp.route("/admin/flights")
def admin_flights_page():
    return render_template("pages/admin_operations.html", admin_tab="flights")


@pages_bp.route("/admin/bookings")
def admin_bookings_page():
    return render_template("pages/admin_operations.html", admin_tab="bookings")


@pages_bp.route("/admin/inventory")
def admin_inventory_page():
    return render_template("pages/admin_operations.html", admin_tab="inventory")


@pages_bp.route("/admin/audit-logs")
def admin_audit_logs_page():
    return render_template("pages/admin_operations.html", admin_tab="audit-logs")


@pages_bp.route("/admin/settings")
def admin_settings_page():
    return render_template("pages/admin_operations.html", admin_tab="settings")


@pages_bp.route("/spa")
def legacy_spa_redirect():
    return redirect("/")


@pages_bp.route("/seat-selection")
def legacy_seat_redirect():
    fid = request.args.get("flightId", "1")
    return redirect(f"/flights/{fid}/seats")
