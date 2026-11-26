/* ==========================================================================
   FLY — Connected Checkout, Seat Lock Timer, Promo Validation & Payment
   ========================================================================== */
(function () {
  'use strict';

  const root = document.getElementById('checkoutApp');
  if (!root) return;

  const params = new URLSearchParams(window.location.search);
  let bookingRef = params.get('ref') || '';
  if (!bookingRef) {
    try { bookingRef = sessionStorage.getItem('fly_active_booking_ref') || ''; } catch (_) {}
  }

  const state = {
    booking: null,
    secondsLeft: 0,
    timerHandle: null,
    promoCode: '',
    idempotencyKey: 'PAY-' + (bookingRef || 'NEW') + '-' + Date.now()
  };

  const alertBox = document.getElementById('checkoutAlert');
  const clockEl = document.getElementById('lockCountdownClock');
  const payBtn = document.getElementById('btnConfirmPay');
  const extendBtn = document.getElementById('btnExtendLock');

  function esc(s) {
    return window.FlyApi ? window.FlyApi.escapeHtml(s) : String(s || '');
  }

  function showAlert(msg, isError) {
    if (!alertBox) return;
    alertBox.textContent = msg;
    alertBox.className = 'fly-alert ' + (isError ? 'fly-alert-danger' : 'fly-alert-success');
    alertBox.classList.remove('is-hidden');
  }

  function formatMMSS(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  function startCountdown() {
    if (state.timerHandle) clearInterval(state.timerHandle);
    clockEl.textContent = formatMMSS(state.secondsLeft);
    state.timerHandle = setInterval(() => {
      if (state.secondsLeft <= 0) {
        clearInterval(state.timerHandle);
        clockEl.textContent = '00:00';
        clockEl.style.color = '#dc2626';
        document.getElementById('lockStatusBadge').textContent = 'Expired';
        document.getElementById('lockStatusBadge').className = 'fly-badge fly-badge-danger';
        if (payBtn) payBtn.disabled = true;
        if (extendBtn) extendBtn.disabled = true;
        showAlert('Your 10-minute seat lock has expired and seats were released. Please select seats again.', true);
        return;
      }
      state.secondsLeft -= 1;
      clockEl.textContent = formatMMSS(state.secondsLeft);
    }, 1000);
  }

  async function initCheckout() {
    if (!window.FlyApi.getToken()) {
      window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname + window.location.search);
      return;
    }
    if (!bookingRef) {
      showAlert('No active seat hold found. Please choose a flight and seats first.', true);
      if (payBtn) payBtn.disabled = true;
      return;
    }

    try {
      const b = await window.FlyApi.get('/api/bookings/' + encodeURIComponent(bookingRef));
      state.booking = b;
      if (b.status === 'CONFIRMED' && b.pnrCode) {
        window.location.href = '/ticket/' + encodeURIComponent(b.pnrCode);
        return;
      }
      if (b.status !== 'PENDING_PAYMENT' || (b.secondsRemaining || 0) <= 0) {
        state.secondsLeft = 0;
        startCountdown();
        return;
      }

      document.getElementById('checkoutRefLabel').textContent = 'Ref: ' + b.booking_reference;
      document.getElementById('checkoutFlightSummary').textContent =
        `${b.airlineName} (${b.flight_number || ('FL-' + b.flightId)}) • ${b.depCity} (${b.depIATA}) ➔ ${b.arrCity} (${b.arrIATA}) • ${b.dep_datetime}`;
      document.getElementById('checkoutSeatsBadge').textContent =
        `Locked Seats (${b.cabin_class || 'Economy'}): ${b.seatNumbers || '--'}`;

      const user = window.FlyApi.getUser() || {};
      document.getElementById('contactEmail').value = b.contact_email || b.emailAddress || user.email || '';
      document.getElementById('contactPhone').value = b.contact_phone || '';

      const paxList = Array.isArray(b.passengerData) ? b.passengerData : [];
      const totalPaxForms = Math.max(1, (b.seatCodes || []).length, paxList.length);
      renderPassengerInputs(totalPaxForms, paxList);
      renderFareSummary(b.fareBreakdown || { baseFare: b.total_amount, taxes: 0, totalPayable: b.total_amount });

      if (extendBtn && Number(b.lock_extensions || 0) >= 1) {
        extendBtn.disabled = true;
        extendBtn.textContent = 'Extension Used';
      }

      state.secondsLeft = Number(b.secondsRemaining || 0);
      startCountdown();
      loadSavedTravelers();
    } catch (err) {
      showAlert(err.message || 'Unable to load booking lock.', true);
      if (payBtn) payBtn.disabled = true;
    }
  }

  function renderPassengerInputs(count, existingList) {
    const container = document.getElementById('passengersFormsList');
    const seats = (state.booking && state.booking.seatCodes) || [];
    const user = window.FlyApi.getUser() || {};
    let html = '';
    let seatIdx = 0;
    for (let i = 0; i < count; i++) {
      const p = existingList[i] || (i === 0 ? { type: 'adult', firstName: user.firstName || '', lastName: user.lastName || '' } : { type: 'adult' });
      const pType = String(p.type || 'adult').toLowerCase();
      const typeLabel = pType === 'infant' ? 'Infant (<2 yrs • Lap)' : (pType === 'child' ? 'Child (2-11 yrs)' : 'Adult (12+ yrs)');
      const seatCode = pType === 'infant' ? '' : (seats[seatIdx++] || '');
      const seatTag = seatCode ? ` — Seat ${esc(seatCode)}` : (pType === 'infant' ? ' — Shared Adult Lap Seat' : '');
      html += `
        <div class="pax-form-block" data-pax-idx="${i}" data-pax-type="${esc(pType)}" data-seat-code="${esc(seatCode)}" style="padding:14px;background:var(--bg-secondary);border-radius:10px;">
          <div style="font-weight:700;margin-bottom:10px;">Passenger ${i + 1}: ${esc(typeLabel)}${seatTag}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">
            <div class="fly-field">
              <label class="fly-label">First Name *</label>
              <input type="text" class="fly-input pax-fn" value="${esc(p.firstName || '')}" required>
            </div>
            <div class="fly-field">
              <label class="fly-label">Last Name *</label>
              <input type="text" class="fly-input pax-ln" value="${esc(p.lastName || '')}" required>
            </div>
            <div class="fly-field">
              <label class="fly-label">Passport / NID</label>
              <input type="text" class="fly-input pax-doc" value="${esc(p.passportNumber || p.documentNumber || '')}">
            </div>
            <div class="fly-field">
              <label class="fly-label">Date of Birth</label>
              <input type="date" class="fly-input pax-dob" value="${esc(p.dob || p.dateOfBirth || '')}">
            </div>
          </div>
        </div>`;
    }
    container.innerHTML = html;
  }

  async function loadSavedTravelers() {
    const picker = document.getElementById('savedTravelerPicker');
    if (!picker) return;
    try {
      const list = await window.FlyApi.get('/api/travelers');
      if (!Array.isArray(list) || !list.length) return;
      list.forEach((t, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = [t.first_name, t.last_name].filter(Boolean).join(' ') + (t.document_number_masked ? ` (${t.document_number_masked})` : '');
        picker.appendChild(opt);
      });
      picker.addEventListener('change', () => {
        const t = list[parseInt(picker.value, 10)];
        if (!t) return;
        const firstBlock = document.querySelector('.pax-form-block');
        if (!firstBlock) return;
        firstBlock.querySelector('.pax-fn').value = t.first_name || '';
        firstBlock.querySelector('.pax-ln').value = t.last_name || '';
        firstBlock.querySelector('.pax-dob').value = t.date_of_birth || '';
      });
    } catch (_) {}
  }

  function renderFareSummary(fb) {
    const base = Number(fb.baseFare || 0);
    const tax = Number(fb.taxes != null ? fb.taxes : (fb.taxesAndFees || 0)) + Number(fb.airlineCharges || 0);
    const extras = Number(fb.baggageFee || fb.luggageFee || 0) + Number(fb.mealFee || 0) + Number(fb.insuranceFee || 0) + Number(fb.seatUpgradeFee || 0);
    const disc = Number(fb.discount || 0);
    const total = Number(fb.totalPayable || (base + tax + extras - disc));

    document.getElementById('coBase').textContent = window.FlyApi.formatBDT(base);
    document.getElementById('coTaxes').textContent = window.FlyApi.formatBDT(tax);
    document.getElementById('coExtras').textContent = window.FlyApi.formatBDT(extras);
    document.getElementById('coDiscount').textContent = '-' + window.FlyApi.formatBDT(disc);
    document.getElementById('coTotal').textContent = window.FlyApi.formatBDT(total);
  }

  function collectExtrasPayload() {
    const bagKg = Number(document.getElementById('extraBaggageSelect').value || 0);
    const bagPieces = bagKg > 0 ? Math.ceil(bagKg / 10) : 0;
    const mealFee = Number(document.getElementById('mealSelect').value || 0);
    const insurance = Boolean(document.getElementById('insuranceCheck').checked);
    return { bagKg, bagPieces, mealFee, insurance };
  }

  async function syncDetailsToServer(showOk) {
    if (!state.booking) return null;
    const paxBlocks = Array.from(document.querySelectorAll('.pax-form-block'));
    const passengerData = paxBlocks.map((blk) => {
      const fn = blk.querySelector('.pax-fn').value.trim();
      const ln = blk.querySelector('.pax-ln').value.trim();
      const doc = blk.querySelector('.pax-doc').value.trim();
      const dob = blk.querySelector('.pax-dob').value;
      return {
        type: blk.getAttribute('data-pax-type') || 'adult',
        firstName: fn,
        lastName: ln,
        fullName: (fn + ' ' + ln).trim(),
        passportNumber: doc,
        dob: dob,
        seatCode: blk.getAttribute('data-seat-code') || ''
      };
    });

    const extras = collectExtrasPayload();
    const res = await window.FlyApi.put('/api/bookings/' + encodeURIComponent(bookingRef) + '/details', {
      passengerData: passengerData,
      contactEmail: document.getElementById('contactEmail').value.trim(),
      contactPhone: document.getElementById('contactPhone').value.trim(),
      nbrLuggages: extras.bagPieces,
      weight: extras.bagKg,
      mealFee: extras.mealFee,
      insurance: extras.insurance,
      promoCode: state.promoCode
    });
    if (res && res.fareBreakdown) renderFareSummary(res.fareBreakdown);
    if (showOk) showAlert('Checkout details and pricing updated.', false);
    return res;
  }

  ['extraBaggageSelect', 'mealSelect', 'insuranceCheck'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { syncDetailsToServer(false).catch(() => {}); });
  });

  const promoBtn = document.getElementById('btnApplyPromo');
  if (promoBtn) {
    promoBtn.addEventListener('click', async () => {
      const msgEl = document.getElementById('promoStatusMsg');
      const code = document.getElementById('promoCodeInput').value.trim().toUpperCase();
      if (!code) {
        state.promoCode = '';
        msgEl.textContent = '';
        await syncDetailsToServer(false).catch(() => {});
        return;
      }
      try {
        const fb = state.booking.fareBreakdown || {};
        const v = await window.FlyApi.post('/api/promos/validate', {
          code: code,
          baseFare: Number(fb.baseFare || state.booking.total_amount || 0),
          airlineId: state.booking.airlineId
        });
        state.promoCode = v.code || code;
        msgEl.style.color = '#059669';
        msgEl.textContent = v.message || ('Promo applied: -BDT ' + v.discount);
        await syncDetailsToServer(false);
      } catch (err) {
        state.promoCode = '';
        msgEl.style.color = '#dc2626';
        msgEl.textContent = err.message || 'Invalid promo code.';
      }
    });
  }

  if (extendBtn) {
    extendBtn.addEventListener('click', async () => {
      try {
        const res = await window.FlyApi.post('/api/bookings/' + encodeURIComponent(bookingRef) + '/extend-lock', {});
        state.secondsLeft = Number(res.secondsRemaining || state.secondsLeft);
        extendBtn.disabled = true;
        extendBtn.textContent = 'Extension Used';
        showAlert(res.message || 'Seat lock extended by 2 minutes.', false);
      } catch (err) {
        showAlert(err.message || 'Could not extend seat lock.', true);
      }
    });
  }

  const releaseBtn = document.getElementById('btnReleaseHold');
  if (releaseBtn) {
    releaseBtn.addEventListener('click', async () => {
      try {
        await window.FlyApi.post('/api/bookings/cancel', { bookingReference: bookingRef, reason: 'Released during checkout' });
        try { sessionStorage.removeItem('fly_active_booking_ref'); } catch (_) {}
        window.location.href = '/flights/search';
      } catch (err) {
        showAlert(err.message || 'Could not release reservation.', true);
      }
    });
  }

  if (payBtn) {
    payBtn.addEventListener('click', async () => {
      const paxBlocks = Array.from(document.querySelectorAll('.pax-form-block'));
      for (let i = 0; i < paxBlocks.length; i++) {
        if (!paxBlocks[i].querySelector('.pax-fn').value.trim() || !paxBlocks[i].querySelector('.pax-ln').value.trim()) {
          showAlert(`Please enter First Name and Last Name for Passenger ${i + 1}.`, true);
          return;
        }
      }
      if (!document.getElementById('contactEmail').value.trim()) {
        showAlert('Booking contact email is required.', true);
        return;
      }

      payBtn.disabled = true;
      payBtn.textContent = 'Authorizing Payment...';
      try {
        await syncDetailsToServer(false);
        const method = document.getElementById('paymentMethodSelect').value;
        const scenario = document.getElementById('paymentScenarioSelect').value;
        const res = await window.FlyApi.post('/api/bookings/confirm', {
          bookingReference: bookingRef,
          paymentMethod: method,
          scenario: scenario,
          idempotencyKey: state.idempotencyKey
        });
        try { sessionStorage.removeItem('fly_active_booking_ref'); } catch (_) {}
        const pnr = res.pnrCode || (res.ticket && res.ticket.pnrCode) || bookingRef;
        window.location.href = '/ticket/' + encodeURIComponent(pnr);
      } catch (err) {
        state.idempotencyKey = 'PAY-' + bookingRef + '-' + Date.now();
        showAlert(err.message || 'Payment failed or timed out. Seats were released.', true);
        payBtn.disabled = false;
        payBtn.textContent = 'Complete Payment & Issue E-Ticket';
      }
    });
  }

  initCheckout();
})();
