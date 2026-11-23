/**
 * FLY FLIGHT BOOKING SYSTEM - PAYMENT & CONFIRMATION MODULE
 * Author: mahin1710
 * Technologies: Vanilla JavaScript, Fetch API
 * Description: Clean, beginner-friendly script for verifying and confirming payments
 *              from both My Bookings and the Checkout view.
 */

const paymentModule = {
  activeBookingRef: null,
  timerInterval: null,

  getAuthHeaders() {
    const token = localStorage.getItem('fly_token') || sessionStorage.getItem('fly_token');
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    };
  },

  // 1. Load user's bookings on the My Bookings page
  async loadMyBookings() {
    const container = document.getElementById('myBookingsListContainer');
    if (!container) return;

    try {
      const res = await fetch('/api/reservations/my', {
        headers: this.getAuthHeaders()
      });

      if (!res.ok) {
        container.innerHTML = '<div style="padding: 24px; color: #ef4444;">Please sign in to view your bookings.</div>';
        return;
      }

      const bookings = await res.json();
      if (!bookings || bookings.length === 0) {
        container.innerHTML = `
          <div class="glassmorphism" style="padding: 40px; text-align: center;">
            <h3>No Bookings Found</h3>
            <p style="color: var(--text-secondary); margin-top: 8px;">Explore flights and reserve your seats!</p>
            <a href="/" class="btn-primary" style="display: inline-block; margin-top: 16px;">Search Flights</a>
          </div>
        `;
        return;
      }

      container.innerHTML = bookings.map(b => {
        const isPending = b.status === 'PENDING_PAYMENT';
        const isConfirmed = b.status === 'CONFIRMED';
        const isExpired = b.status === 'EXPIRED';
        const ref = b.bookingReference;

        let statusBadge = '';
        if (isConfirmed) statusBadge = '<span class="badge-status-confirmed">✓ Confirmed</span>';
        else if (isPending) statusBadge = `<span class="badge-status-pending">⏱️ Pending Payment (${Math.max(0, Math.floor((b.secondsRemaining || 900) / 60))}m left)</span>`;
        else if (isExpired) statusBadge = '<span class="badge-status-expired">✕ Expired</span>';
        else statusBadge = '<span class="badge-status-cancelled">Cancelled</span>';

        return `
          <div class="flight-card">
            <div class="flight-card-header">
              <div>
                <span style="font-weight: 800; font-size: 1.1rem;">${b.airlineName || 'FLY Airline'}</span>
                <div style="font-size: 0.8rem; color: var(--text-muted);">REF: ${ref} • FLIGHT #${b.flightId}</div>
              </div>
              <div>${statusBadge}</div>
            </div>

            <div class="flight-timeline" style="margin: 16px 0;">
              <div>
                <div style="font-weight: 700;">${b.depCity} (${b.depIATA})</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${b.dep_datetime}</div>
              </div>
              <div style="text-align: center;">
                <div style="font-size: 1.15rem; font-weight: 800; color: ${isPending ? '#f59e0b' : '#10b981'};">
                  Seat(s): ${b.seatNumbers || 'Assigned'}
                </div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">Fare: ৳${(b.total_amount || 0).toLocaleString()}</div>
              </div>
              <div style="text-align: right;">
                <div style="font-weight: 700;">${b.arrCity} (${b.arrIATA})</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${b.arr_datetime}</div>
              </div>
            </div>

            <div class="booking-card-footer" style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-subtle); padding-top: 12px;">
              <div>
                ${isPending ? `
                  <button class="btn-text-link" style="color: #ef4444;" onclick="paymentModule.cancelBooking('${ref}')">
                    Release Seats
                  </button>
                ` : ''}
              </div>
              <div style="display: flex; gap: 10px;">
                ${isPending ? `
                  <button class="btn-primary" onclick="paymentModule.confirmPaymentDirectly('${ref}')">
                    <span>Confirm Payment</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                  </button>
                ` : ''}
                ${isConfirmed ? `
                  <button class="btn-secondary" onclick="paymentModule.viewBoardingPass('${ref}')">
                    View Boarding Pass
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');

    } catch (err) {
      console.error(err);
      container.innerHTML = '<div style="padding: 24px; color: #ef4444;">Error loading bookings.</div>';
    }
  },

  // 2. Direct payment confirmation from My Bookings
  async confirmPaymentDirectly(bookingRef) {
    if (!confirm(`Confirm simulated test payment for booking ${bookingRef}?`)) {
      return;
    }

    try {
      const res = await fetch('/api/bookings/confirm', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          bookingReference: bookingRef,
          paymentMethod: 'TEST_MODE'
        })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Payment confirmation failed.');
        this.loadMyBookings();
        return;
      }

      alert('Payment confirmed successfully! Seats are now permanently BOOKED.');
      this.loadMyBookings();
    } catch (err) {
      console.error(err);
      alert('Network error confirming payment.');
    }
  },

  // 3. Confirm payment from Checkout view
  async confirmPayment(method = 'TEST_MODE') {
    const ref = this.activeBookingRef;
    if (!ref) {
      alert('No active booking reference found.');
      return;
    }

    const btn = document.getElementById('btnInstantPay');
    if (btn) btn.disabled = true;

    try {
      const res = await fetch('/api/bookings/confirm', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          bookingReference: ref,
          paymentMethod: method
        })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Payment verification failed.');
        if (btn) btn.disabled = false;
        return;
      }

      alert('Payment confirmed! Flight reservation complete.');
      window.location.href = '/my-bookings';
    } catch (err) {
      console.error(err);
      alert('Payment processing error.');
      if (btn) btn.disabled = false;
    }
  },

  // 4. Cancel booking and release seats
  async cancelBooking(bookingRef) {
    if (!confirm('Are you sure you want to release these held seats?')) {
      return;
    }

    try {
      const res = await fetch('/api/bookings/cancel', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ bookingReference: bookingRef })
      });
      if (res.ok) {
        alert('Seats released back to availability.');
        this.loadMyBookings();
      }
    } catch (err) {
      console.error(err);
    }
  },

  // 5. Initialize payment checkout view if on /payment
  async initPaymentPage() {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (!ref) return;

    this.activeBookingRef = ref;
    const refEl = document.getElementById('summaryBookingRef');
    if (refEl) refEl.innerText = ref;

    try {
      const res = await fetch(`/api/bookings/${ref}`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) return;

      const b = await res.json();
      const routeEl = document.getElementById('summaryRoute');
      if (routeEl) {
        routeEl.innerText = `${b.depCity} (${b.depIATA}) ➔ ${b.arrCity} (${b.arrIATA}) • Seats: ${b.seatNumbers || 'Assigned'}`;
      }

      const totalEl = document.getElementById('summaryTotal');
      if (totalEl) {
        totalEl.innerText = `Total Fare: ৳${(b.total_amount || 0).toLocaleString()}`;
      }

      // Start countdown timer
      this.startCountdown(b.expires_at);
    } catch (err) {
      console.error(err);
    }
  },

  startCountdown(expiresAtStr) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    const expiresAt = new Date(expiresAtStr).getTime();

    const tick = () => {
      const remainingSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      const mins = Math.floor(remainingSeconds / 60);
      const secs = remainingSeconds % 60;
      const clockEl = document.getElementById('paymentTimerClock');
      if (clockEl) {
        clockEl.innerText = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      }

      if (remainingSeconds <= 0) {
        clearInterval(this.timerInterval);
        alert('15-minute reservation window expired. Seats have been released.');
        window.location.href = '/my-bookings';
      }
    };

    tick();
    this.timerInterval = setInterval(tick, 1000);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('myBookingsListContainer')) {
    paymentModule.loadMyBookings();
  }
  if (document.getElementById('checkoutSummaryCard')) {
    paymentModule.initPaymentPage();
  }
});
