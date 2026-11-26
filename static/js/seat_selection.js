/* ==========================================================================
   FLY — Travellers Selection, Interactive Seat Map & Atomic 10-Min Lock
   ========================================================================== */
(function () {
  'use strict';

  const root = document.getElementById('seatMapApp');
  if (!root) return;

  const flightId = Number(root.getAttribute('data-flight-id') || '0');
  const params = new URLSearchParams(window.location.search);

  const state = {
    flight: null,
    seats: [],
    selectedSeatIds: [],
    adults: Math.max(1, Math.min(9, parseInt(params.get('adults') || params.get('pax') || '1', 10) || 1)),
    children: Math.max(0, Math.min(8, parseInt(params.get('children') || '0', 10) || 0)),
    infants: Math.max(0, Math.min(4, parseInt(params.get('infants') || '0', 10) || 0)),
    cabin: params.get('cabin') || 'Economy',
    tripType: params.get('tripType') || params.get('trip_type') || 'oneway',
    lastKnownFare: null,
    pollTimer: null,
    sse: null
  };

  if (state.infants > state.adults) state.infants = state.adults;

  const cabinSelect = document.getElementById('seatCabinSelect');
  const gridContainer = document.getElementById('cabinGridContainer');
  const holdBtn = document.getElementById('btnHoldSeatsContinue');
  const alertBox = document.getElementById('seatMapAlert');
  const revalidateNotice = document.getElementById('fareRevalidateNotice');

  if (cabinSelect) {
    const cLower = state.cabin.toLowerCase();
    cabinSelect.value = cLower.includes('first') ? 'First' : (cLower.includes('bus') ? 'Business' : 'Economy');
    state.cabin = cabinSelect.value;
  }

  function esc(s) {
    return window.FlyApi ? window.FlyApi.escapeHtml(s) : String(s || '');
  }

  function requiredSeatCount() {
    return state.adults + state.children;
  }

  function showAlert(msg, type) {
    if (!alertBox) return;
    alertBox.textContent = msg;
    alertBox.className = 'fly-alert ' + (type === 'danger' ? 'fly-alert-danger' : (type === 'info' ? 'fly-alert-info' : 'fly-alert-success'));
    alertBox.classList.remove('is-hidden');
  }

  function hideAlert() {
    if (alertBox) alertBox.classList.add('is-hidden');
  }

  function getSeatUpgradeFee(seat) {
    const cat = String(seat.category || '').toLowerCase();
    return (cat.includes('exit') || cat.includes('legroom')) ? 800 : 0;
  }

  function updateTravellersUI() {
    document.getElementById('valAdults').textContent = String(state.adults);
    document.getElementById('valChildren').textContent = String(state.children);
    document.getElementById('valInfants').textContent = String(state.infants);
    document.getElementById('seatsRequiredLabel').textContent = String(requiredSeatCount());

    const parts = [`${state.adults} Adult${state.adults > 1 ? 's' : ''}`];
    if (state.children > 0) parts.push(`${state.children} Child${state.children > 1 ? 'ren' : ''}`);
    if (state.infants > 0) parts.push(`${state.infants} Infant${state.infants > 1 ? 's' : ''}`);
    document.getElementById('farePaxSummary').textContent = parts.join(', ');
  }

  function adjustTravellers(kind, delta) {
    hideAlert();
    let a = state.adults;
    let c = state.children;
    let i = state.infants;

    if (kind === 'adults') a += delta;
    if (kind === 'children') c += delta;
    if (kind === 'infants') i += delta;

    if (a < 1 || a > 9 || c < 0 || c > 8 || i < 0 || i > 4) return;
    if (a + c + i > 9) {
      showAlert('Maximum 9 passengers permitted per reservation.', 'info');
      return;
    }
    if (i > a) {
      if (kind === 'adults' && delta < 0) {
        i = a;
      } else {
        showAlert('Airline Rule: Each lap infant must be accompanied by an adult (max 1 infant per adult).', 'info');
        return;
      }
    }

    state.adults = a;
    state.children = c;
    state.infants = i;

    const reqSeats = requiredSeatCount();
    if (state.selectedSeatIds.length > reqSeats) {
      state.selectedSeatIds = state.selectedSeatIds.slice(0, reqSeats);
      renderSeatGrid();
    }
    updateTravellersUI();
    updateSelectionSummary(true);
  }

  async function loadFlightDetails() {
    try {
      const f = await window.FlyApi.get('/api/flights/' + flightId);
      state.flight = f;
      document.getElementById('seatFlightAirline').textContent = (f.airlineName || 'FLY Airline') + ' • ' + (f.flightNumber || ('FL-' + f.id));
      document.getElementById('seatFlightRoute').textContent = `${f.depCity || f.depIATA} (${f.depIATA}) ➔ ${f.arrCity || f.arrIATA} (${f.arrIATA})`;
      document.getElementById('seatFlightMeta').textContent = `${f.dep_datetime || ''} • ${f.aircraft || 'Jet'} • Baggage: ${f.baggageAllowance || '23kg Checked'}`;
      document.getElementById('seatAvailableBadge').textContent = `${f.availableSeats != null ? f.availableSeats : '--'} Seats Open`;
    } catch (err) {
      showAlert(err.message || 'Could not load flight details.', 'danger');
    }
  }

  async function loadSeats() {
    try {
      const data = await window.FlyApi.get('/api/flights/' + flightId + '/seats');
      applySeatsSnapshot(data.seats || []);
    } catch (err) {
      showAlert(err.message || 'Unable to fetch seat map.', 'danger');
    }
  }

  function applySeatsSnapshot(seats) {
    state.seats = seats;
    const availMap = new Map(seats.map(s => [s.id, s]));
    state.selectedSeatIds = state.selectedSeatIds.filter(id => {
      const s = availMap.get(id);
      return s && (s.status === 'AVAILABLE' || s.isHeldByMe);
    });
    const openCount = seats.filter(s => s.status === 'AVAILABLE').length;
    const openBadge = document.getElementById('seatAvailableBadge');
    if (openBadge) openBadge.textContent = `${openCount} Seats Open`;
    renderSeatGrid();
    updateSelectionSummary(false);
  }

  function renderSeatGrid() {
    if (!state.seats.length) {
      gridContainer.innerHTML = '<div style="padding:28px;text-align:center;color:var(--text-muted);">No seats configured for this aircraft.</div>';
      return;
    }

    const rowsMap = new Map();
    state.seats.forEach(s => {
      const rNum = Number(s.row || 1);
      if (!rowsMap.has(rNum)) rowsMap.set(rNum, { row: rNum, type: s.type || 'economy', seats: {} });
      rowsMap.get(rNum).seats[String(s.column || '').toUpperCase()] = s;
    });

    const sortedRows = Array.from(rowsMap.values()).sort((a, b) => a.row - b.row);
    const leftCols = ['A', 'B', 'C'];
    const rightCols = ['D', 'E', 'F'];

    let html = '';
    let lastCabin = '';
    sortedRows.forEach(rowObj => {
      const cabinLabel = String(rowObj.type || 'economy').toUpperCase();
      if (cabinLabel !== lastCabin) {
        lastCabin = cabinLabel;
        html += `<div class="cabin-section-title">${esc(cabinLabel)} CABIN</div>`;
      }

      const renderCol = col => {
        const s = rowObj.seats[col];
        if (!s) return '<span></span>';
        const isSel = state.selectedSeatIds.includes(s.id);
        const isExtra = getSeatUpgradeFee(s) > 0;
        const disabled = (s.status === 'BOOKED') || (s.status === 'LOCKED' && !s.isHeldByMe);
        let cls = 'seat-cell';
        if (isSel) cls += ' is-selected';
        else if (s.status === 'BOOKED') cls += ' is-booked';
        else if (s.status === 'LOCKED') cls += s.isHeldByMe ? ' is-locked-mine' : ' is-locked';

        const title = `${s.code} • ${s.category} • ${s.type}${isExtra ? ' (+BDT 800)' : ''} • ${s.status}`;
        return `<button type="button" class="${cls}" data-seat-id="${s.id}" data-extra="${isExtra ? '1' : '0'}" title="${esc(title)}" aria-label="${esc(title)}" ${disabled ? 'disabled' : ''}>
          <span>${esc(s.code)}</span>
          ${isExtra ? '<span style="font-size:0.6rem;opacity:0.85;">XL</span>' : ''}
        </button>`;
      };

      html += `
        <div class="seat-row-grid">
          ${leftCols.map(renderCol).join('')}
          <div class="seat-row-num">${rowObj.row}</div>
          ${rightCols.map(renderCol).join('')}
        </div>`;
    });

    gridContainer.innerHTML = html;
    gridContainer.querySelectorAll('.seat-cell:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => toggleSeat(Number(btn.getAttribute('data-seat-id'))));
    });
  }

  function toggleSeat(seatId) {
    hideAlert();
    const reqSeats = requiredSeatCount();
    const idx = state.selectedSeatIds.indexOf(seatId);
    if (idx >= 0) {
      state.selectedSeatIds.splice(idx, 1);
    } else {
      if (state.selectedSeatIds.length >= reqSeats) {
        if (reqSeats === 1) {
          state.selectedSeatIds = [seatId];
        } else {
          showAlert(`You selected ${reqSeats} seated passenger(s). Deselect a seat or add a traveller.`, 'info');
          return;
        }
      } else {
        state.selectedSeatIds.push(seatId);
      }
    }
    renderSeatGrid();
    updateSelectionSummary(false);
  }

  async function updateSelectionSummary(paxChanged) {
    const reqSeats = requiredSeatCount();
    const hint = document.getElementById('seatTargetHint');
    if (hint) hint.textContent = `Selected ${state.selectedSeatIds.length} of ${reqSeats} required seat(s)`;

    const chosen = state.seats.filter(s => state.selectedSeatIds.includes(s.id));
    const listEl = document.getElementById('selectedSeatsList');
    if (listEl) {
      listEl.innerHTML = chosen.length
        ? chosen.map(s => `<span class="fly-badge">${esc(s.code)} • ${esc(s.category)}</span>`).join('')
        : '<span style="color: var(--text-muted); font-size: 0.88rem;">No seats selected yet</span>';
    }

    const upgradeFee = chosen.reduce((sum, s) => sum + getSeatUpgradeFee(s), 0);
    holdBtn.disabled = chosen.length !== reqSeats;
    holdBtn.textContent = chosen.length === reqSeats
      ? `Lock ${chosen.length} Seat${chosen.length > 1 ? 's' : ''} & Continue`
      : `Select ${reqSeats - chosen.length} More Seat${reqSeats - chosen.length > 1 ? 's' : ''}`;

    try {
      const fb = await window.FlyApi.post('/api/flights/fare-breakdown', {
        flightId: flightId,
        cabinClass: state.cabin,
        adults: state.adults,
        children: state.children,
        infants: state.infants,
        seatUpgradeFee: upgradeFee
      });
      const newTotal = Number(fb.totalPayable || 0);
      if (paxChanged && state.lastKnownFare !== null && newTotal !== state.lastKnownFare && revalidateNotice) {
        revalidateNotice.textContent = `Fare updated for ${document.getElementById('farePaxSummary').textContent} (${state.cabin}): ${window.FlyApi.formatBDT(newTotal)}`;
        revalidateNotice.classList.remove('is-hidden');
      }
      state.lastKnownFare = newTotal;

      document.getElementById('fareBaseVal').textContent = window.FlyApi.formatBDT(fb.baseFare || 0);
      document.getElementById('fareTaxVal').textContent = window.FlyApi.formatBDT((fb.taxes || 0) + (fb.airlineCharges || 0));
      document.getElementById('fareSeatFeeVal').textContent = window.FlyApi.formatBDT(upgradeFee);
      document.getElementById('fareTotalVal').textContent = window.FlyApi.formatBDT(newTotal);
    } catch (_) {}
  }

  async function holdSelectedSeats() {
    hideAlert();
    if (!window.FlyApi.getToken()) {
      try {
        sessionStorage.setItem('fly_pending_booking_' + flightId, JSON.stringify({
          seats: state.selectedSeatIds, adults: state.adults, children: state.children, infants: state.infants, cabin: state.cabin
        }));
      } catch (_) {}
      window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname + window.location.search);
      return;
    }

    const chosen = state.seats.filter(s => state.selectedSeatIds.includes(s.id));
    const upgradeFee = chosen.reduce((sum, s) => sum + getSeatUpgradeFee(s), 0);

    holdBtn.disabled = true;
    holdBtn.textContent = 'Locking seats atomically...';
    try {
      const res = await window.FlyApi.post('/api/bookings/hold', {
        flightId: flightId,
        seatIds: state.selectedSeatIds,
        adults: state.adults,
        children: state.children,
        infants: state.infants,
        cabinClass: state.cabin,
        tripType: state.tripType,
        seatUpgradeFee: upgradeFee,
        nbrLuggages: requiredSeatCount()
      });
      try {
        sessionStorage.setItem('fly_active_booking_ref', res.bookingReference);
      } catch (_) {}
      window.location.href = '/checkout?ref=' + encodeURIComponent(res.bookingReference);
    } catch (err) {
      showAlert(err.message || 'Seat lock failed. Another traveler may have reserved this seat.', 'danger');
      await loadSeats();
      holdBtn.disabled = state.selectedSeatIds.length !== requiredSeatCount();
    }
  }

  function startRealtimeSync() {
    if (typeof EventSource !== 'undefined') {
      try {
        state.sse = new EventSource('/api/flights/' + flightId + '/seats/stream');
        state.sse.onmessage = function (ev) {
          try {
            const payload = JSON.parse(ev.data);
            if (Array.isArray(payload.seats)) applySeatsSnapshot(payload.seats);
          } catch (_) {}
        };
      } catch (_) {}
    }
    state.pollTimer = setInterval(loadSeats, 5000);
  }

  document.getElementById('btnMinusAdults').addEventListener('click', () => adjustTravellers('adults', -1));
  document.getElementById('btnPlusAdults').addEventListener('click', () => adjustTravellers('adults', 1));
  document.getElementById('btnMinusChildren').addEventListener('click', () => adjustTravellers('children', -1));
  document.getElementById('btnPlusChildren').addEventListener('click', () => adjustTravellers('children', 1));
  document.getElementById('btnMinusInfants').addEventListener('click', () => adjustTravellers('infants', -1));
  document.getElementById('btnPlusInfants').addEventListener('click', () => adjustTravellers('infants', 1));

  if (cabinSelect) {
    cabinSelect.addEventListener('change', () => {
      state.cabin = cabinSelect.value;
      updateSelectionSummary(true);
    });
  }

  if (holdBtn) {
    holdBtn.addEventListener('click', holdSelectedSeats);
  }

  try {
    const saved = sessionStorage.getItem('fly_pending_booking_' + flightId);
    if (saved) {
      const obj = JSON.parse(saved);
      if (Array.isArray(obj.seats)) state.selectedSeatIds = obj.seats;
      if (obj.adults) state.adults = obj.adults;
      if (obj.children != null) state.children = obj.children;
      if (obj.infants != null) state.infants = obj.infants;
      if (obj.cabin && cabinSelect) {
        cabinSelect.value = obj.cabin;
        state.cabin = obj.cabin;
      }
      sessionStorage.removeItem('fly_pending_booking_' + flightId);
    }
  } catch (_) {}

  updateTravellersUI();
  loadFlightDetails();
  loadSeats();
  startRealtimeSync();
})();
