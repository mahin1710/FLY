/* ==========================================================================
   FLY — Public Guest PNR / Reference Lookup Controller
   ========================================================================== */
(function () {
  'use strict';

  const form = document.getElementById('manageBookingForm');
  if (!form) return;

  const alertEl = document.getElementById('lookupAlert');
  const resultEl = document.getElementById('lookupResultCard');
  const btn = document.getElementById('btnLookupPnr');
  const esc = s => window.FlyApi.escapeHtml(s);

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    alertEl.classList.add('is-hidden');
    resultEl.classList.add('is-hidden');

    const reference = document.getElementById('pnrInput').value.trim();
    const verifier = document.getElementById('verifierInput').value.trim();
    if (!reference || !verifier) {
      alertEl.textContent = 'Please enter both PNR/Booking Reference and Email or Last Name.';
      alertEl.className = 'fly-alert fly-alert-danger';
      alertEl.classList.remove('is-hidden');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Searching...';
    try {
      const res = await window.FlyApi.post('/api/bookings/lookup', { reference, verifier });
      const b = res.booking;
      const pdfUrl = `/api/tickets/${encodeURIComponent(b.pnrCode || b.bookingReference)}/pdf?vtoken=${encodeURIComponent(b.verificationToken || '')}`;
      const verifyUrl = `/ticket/verify/${encodeURIComponent(b.verificationToken || b.pnrCode)}`;

      resultEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
          <div>
            <div style="font-size:0.78rem;color:var(--text-muted);">PNR: <strong style="font-family:var(--font-mono);">${esc(b.pnrCode || '--')}</strong> &bull; Ref: ${esc(b.bookingReference)}</div>
            <h2 style="margin:4px 0 0;font-size:1.25rem;">${esc(b.depCity)} (${esc(b.depIATA)}) ➔ ${esc(b.arrCity)} (${esc(b.arrIATA)})</h2>
          </div>
          <span class="fly-badge ${b.status === 'CONFIRMED' ? 'fly-badge-success' : 'fly-badge-warning'}">${esc(b.status)}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:12px;margin-bottom:16px;font-size:0.9rem;">
          <div><span style="color:var(--text-muted);display:block;font-size:0.78rem;">Airline &amp; Flight</span><strong>${esc(b.airlineName)} (${esc(b.flightNumber)})</strong></div>
          <div><span style="color:var(--text-muted);display:block;font-size:0.78rem;">Departure</span><strong>${esc(b.depDateTime)}</strong></div>
          <div><span style="color:var(--text-muted);display:block;font-size:0.78rem;">Passenger</span><strong>${esc(b.passengerName)}</strong></div>
          <div><span style="color:var(--text-muted);display:block;font-size:0.78rem;">Seats &amp; Cabin</span><strong>${esc(b.seatClass)} (${esc(b.seatNumbers)})</strong></div>
          <div><span style="color:var(--text-muted);display:block;font-size:0.78rem;">Baggage</span><strong>${esc(b.baggageAllowance)}</strong></div>
          <div><span style="color:var(--text-muted);display:block;font-size:0.78rem;">Total Fare</span><strong>${window.FlyApi.formatBDT(b.totalAmount)}</strong></div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          ${b.status === 'CONFIRMED' ? `<a href="${pdfUrl}" class="fly-btn fly-btn-primary">Download E-Ticket PDF</a>` : ''}
          <a href="${verifyUrl}" class="fly-btn fly-btn-outline">Verify Boarding Pass</a>
        </div>
      `;
      resultEl.classList.remove('is-hidden');
    } catch (err) {
      alertEl.textContent = err.message || 'No matching reservation found.';
      alertEl.className = 'fly-alert fly-alert-danger';
      alertEl.classList.remove('is-hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Find Reservation';
    }
  });
})();
