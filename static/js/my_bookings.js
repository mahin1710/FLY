/* ==========================================================================
   FLY — Passenger Dashboard & Reservations Portal
   ========================================================================== */
(function () {
  'use strict';

  const root = document.getElementById('myBookingsApp');
  if (!root) return;

  const listEl = document.getElementById('myBookingsList');
  const alertEl = document.getElementById('myBookingsAlert');
  const esc = s => window.FlyApi.escapeHtml(s);

  let allBookings = [];
  let activeTab = 'all';

  function showAlert(msg, isError) {
    alertEl.textContent = msg;
    alertEl.className = 'fly-alert ' + (isError ? 'fly-alert-danger' : 'fly-alert-success');
    alertEl.classList.remove('is-hidden');
  }

  function classify(b) {
    const st = String(b.status || '').toUpperCase();
    if (st === 'PENDING_PAYMENT') return 'pending';
    if (st === 'CANCELLED' || st === 'EXPIRED' || st === 'REFUNDED') return 'cancelled';
    const dep = new Date(String(b.dep_datetime || '').replace(' ', 'T'));
    if (st === 'CONFIRMED' && !isNaN(dep.getTime()) && dep < new Date()) return 'past';
    return 'upcoming';
  }

  async function loadBookings() {
    if (!window.FlyApi.getToken()) {
      window.location.href = '/login?next=' + encodeURIComponent('/my-bookings');
      return;
    }

    try {
      const data = await window.FlyApi.get('/api/reservations/my');
      allBookings = Array.isArray(data) ? data : [];

      const counts = { upcoming: 0, pending: 0, past: 0, cancelled: 0 };
      allBookings.forEach(b => { counts[classify(b)] += 1; });

      document.getElementById('kpiConfirmed').textContent = String(counts.upcoming + counts.past);
      document.getElementById('kpiPending').textContent = String(counts.pending);
      document.getElementById('kpiPast').textContent = String(counts.past);
      document.getElementById('kpiCancelled').textContent = String(counts.cancelled);

      renderBookings();
    } catch (err) {
      showAlert(err.message || 'Unable to load bookings.', true);
    }
  }

  function renderBookings() {
    if (activeTab === 'cancelled') {
      loadAndRenderMyRefundsSection();
    }
    const filtered = activeTab === 'all' ? allBookings : allBookings.filter(b => classify(b) === activeTab);
    if (!filtered.length) {
      listEl.innerHTML = `
        <div class="fly-card" style="padding:30px;text-align:center;">
          <h3 style="margin-top:0;">No reservations in this view</h3>
          <p style="color:var(--text-muted);">Search live flights to lock your seats and issue a boarding pass.</p>
          <a href="/flights/search" class="fly-btn fly-btn-primary">Search Flights</a>
        </div>`;
      return;
    }

    listEl.innerHTML = filtered.map(b => {
      const st = String(b.status || '').toUpperCase();
      const badgeCls = st === 'CONFIRMED' ? 'fly-badge-success' : (st === 'PENDING_PAYMENT' ? 'fly-badge-warning' : 'fly-badge-danger');
      const ref = b.bookingReference || b.booking_reference;
      const pnr = b.pnrCode || b.pnr_code || ref;

      let actions = '';
      if (st === 'CONFIRMED' || st === 'PARTIALLY_CANCELLED') {
        actions += `<a href="/ticket/${encodeURIComponent(pnr)}" class="fly-btn fly-btn-primary">E-Ticket &amp; QR</a>`;
        actions += `<a href="/api/tickets/${encodeURIComponent(pnr)}/pdf" class="fly-btn fly-btn-outline">Download PDF</a>`;
        actions += `<a href="/cancel-booking/${encodeURIComponent(ref)}" class="fly-btn fly-btn-danger">Cancel &amp; Refund Quote</a>`;
      } else if (st === 'TICKETING_PENDING') {
        actions += `<a href="/booking/status/${encodeURIComponent(ref)}" class="fly-btn fly-btn-outline">Ticketing Pending</a>`;
        actions += `<a href="/cancel-booking/${encodeURIComponent(ref)}" class="fly-btn fly-btn-danger">Cancel Before Issuance</a>`;
      } else if (st === 'PENDING_PAYMENT') {
        actions += `<a href="/checkout?ref=${encodeURIComponent(ref)}" class="fly-btn fly-btn-primary">Complete Checkout (${b.secondsRemaining || 0}s left)</a>`;
        actions += `<button type="button" class="fly-btn fly-btn-outline" data-cancel-ref="${esc(ref)}">Release Lock</button>`;
      } else {
        actions += `<a href="/booking/status/${encodeURIComponent(ref)}" class="fly-btn fly-btn-outline">Booking Details</a>`;
        if (b.refundRef || st === 'CANCELLED' || st === 'REFUNDED') {
          actions += `<a href="/refunds/track/${encodeURIComponent(b.refundRef || ref)}" class="fly-btn fly-btn-primary">Track Refund</a>`;
        }
      }

      return `
        <article class="fly-card" style="padding:20px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:16px;">
          <div style="min-width:260px;flex:1;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
              <span class="fly-badge ${badgeCls}">${esc(st)}</span>
              ${b.pnrCode ? `<span class="fly-badge">PNR: ${esc(b.pnrCode)}</span>` : ''}
              <span style="font-size:0.8rem;color:var(--text-muted);font-family:var(--font-mono);">${esc(ref)}</span>
            </div>
            <h3 style="margin:2px 0 4px;font-size:1.15rem;">${esc(b.depCity)} (${esc(b.depIATA)}) ➔ ${esc(b.arrCity)} (${esc(b.arrIATA)})</h3>
            <div style="font-size:0.88rem;color:var(--text-secondary);">
              ${esc(b.airlineName)} &bull; ${esc(b.flight_number || ('FL-' + b.flightId))} &bull; Departs: <strong>${esc(b.dep_datetime)}</strong>
            </div>
            <div style="font-size:0.84rem;color:var(--text-muted);margin-top:4px;">
              Cabin: ${esc(b.cabin_class || 'Economy')} &bull; Seats: <strong>${esc(b.seatNumbers || '--')}</strong>
              ${b.refund_amount ? ` &bull; Refund: ${window.FlyApi.formatBDT(b.refund_amount)} (${esc(b.refund_status || '')})` : ''}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.15rem;font-weight:800;margin-bottom:10px;color:var(--accent-primary);">${window.FlyApi.formatBDT(b.total_amount)}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
              ${actions}
            </div>
          </div>
        </article>`;
    }).join('');

    listEl.querySelectorAll('[data-cancel-ref]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ref = btn.getAttribute('data-cancel-ref');
        if (!window.confirm(`Cancel reservation ${ref} and release seats?`)) return;
        try {
          const res = await window.FlyApi.post('/api/bookings/cancel', { bookingReference: ref });
          showAlert(res.message || 'Reservation cancelled.', false);
          loadBookings();
        } catch (err) {
          showAlert(err.message || 'Cancellation failed.', true);
        }
      });
    });
  }

  async function loadAndRenderMyRefundsSection() {
    try {
      const res = await window.FlyApi.get('/api/refunds/my');
      const items = (res && res.refunds) || [];
      if (!items.length) return;
      const box = document.createElement('div');
      box.className = 'fly-card';
      box.style.padding = '18px';
      box.innerHTML = `<h3 style="margin:0 0 12px;font-size:1.05rem;">My Refund Requests &amp; Settlements</h3>` + items.map(rf => `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-subtle);font-size:0.88rem;">
          <div>
            <strong style="font-family:var(--font-mono);">${esc(rf.refund_ref)}</strong> &bull; Can: ${esc(rf.cancellation_ref || '--')} &bull; PNR: ${esc(rf.pnr_code || '--')}
            <div style="font-size:0.78rem;color:var(--text-muted);">Original: ${window.FlyApi.formatBDT(rf.originalBookingAmount)} &bull; Eligible Refund: ${window.FlyApi.formatBDT(rf.amountBDT)} &bull; Method: ${esc(rf.payment_method)}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span class="fly-badge ${rf.status === 'REFUNDED' ? 'fly-badge-success' : 'fly-badge-warning'}">${esc(rf.status)}</span>
            <a href="/refunds/track/${encodeURIComponent(rf.refund_ref)}" class="fly-btn fly-btn-outline" style="padding:4px 10px;font-size:0.78rem;">9-Stage Timeline</a>
          </div>
        </div>
      `).join('');
      listEl.prepend(box);
    } catch (_) {}
  }

  document.querySelectorAll('#myBookingsTabs [data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.getAttribute('data-tab');
      document.querySelectorAll('#myBookingsTabs [data-tab]').forEach(b => {
        b.className = 'fly-btn ' + (b === btn ? 'fly-btn-primary' : 'fly-btn-outline');
      });
      renderBookings();
    });
  });

  loadBookings();
})();
