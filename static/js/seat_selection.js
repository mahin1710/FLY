/* ==========================================================================
   FLY — Interactive Aircraft Seat Map & Atomic 10-Min Seat Lock Controller
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
    paxCount: Math.max(1, Math.min(6, parseInt(params.get('pax') || '1', 10) || 1)),
    cabin: params.get('cabin') || 'Economy',
    tripType: params.get('tripType') || 'oneway',
    pollTimer: null,
    sse: null
  };

  const paxSelect = document.getElementById('seatPaxSelect');
  const cabinSelect = document.getElementById('seatCabinSelect');
  const gridContainer = document.getElementById('cabinGridContainer');
  const holdBtn = document.getElementById('btnHoldSeatsContinue');
  const alertBox = document.getElementById('seatMapAlert');

  if (paxSelect) paxSelect.value = String(state.paxCount);
  if (cabinSelect) {
    const cLower = state.cabin.toLowerCase();
    cabinSelect.value = cLower.includes('first') ? 'First' : (cLower.includes('bus') ? 'Business' : 'Economy');
    state.cabin = cabinSelect.value;
  }

  function esc(s) {
    return window.FlyApi ? window.FlyApi.escapeHtml(s) : String(s || '');
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
    if (cat.includes('exit') || cat.includes('legroom')) return 800;
    return 0;
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
    updateSelectionSummary();
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
    const idx = state.selectedSeatIds.indexOf(seatId);
    if (idx >= 0) {
      state.selectedSeatIds.splice(idx, 1);
    } else {
      if (state.selectedSeatIds.length >= state.paxCount) {
        if (state.paxCount === 1) {
          state.selectedSeatIds = [seatId];
        } else {
          showAlert(`You selected ${state.paxCount} passengers. Deselect a seat or increase passenger count.`, 'info');
          return;
        }
      } else {
        state.selectedSeatIds.push(seatId);
      }
    }
    renderSeatGrid();
    updateSelectionSummary();
  }

  async function updateSelectionSummary() {
    const hint = document.getElementById('seatTargetHint');
    if (hint) {
      hint.textContent = `Selected ${state.selectedSeatIds.length} of ${state.paxCount} required seat(s)`;
    }

    const chosen = state.seats.filter(s => state.selectedSeatIds.includes(s.id));
    const listEl = document.getElementById('selectedSeatsList');
    if (listEl) {
      if (!chosen.length) {
        listEl.innerHTML = '<span style="color: var(--text-muted); font-size: 0.88rem;">No seats selected yet</span>';
      } else {
        listEl.innerHTML = chosen.map(s => `<span class="fly-badge">${esc(s.code)} • ${esc(s.category)}</span>`).join('');
      }
    }

    const upgradeFee = chosen.reduce((sum, s) => sum + getSeatUpgradeFee(s), 0);
    holdBtn.disabled = chosen.length !== state.paxCount;
    holdBtn.textContent = chosen.length === state.paxCount
      ? `Lock ${chosen.length} Seat${chosen.length > 1 ? 's' : ''} for 10 Min & Continue`
      : `Select ${state.paxCount - chosen.length} More Seat${state.paxCount - chosen.length > 1 ? 's' : ''}`;

    try {
      const fb = await window.FlyApi.post('/api/flights/fare-breakdown', {
        flightId: flightId,
        cabinClass: state.cabin,
        adults: state.paxCount,
        seatUpgradeFee: upgradeFee
      });
      document.getElementById('fareBaseVal').textContent = window.FlyApi.formatBDT(fb.baseFare || 0);
      document.getElementById('fareTaxVal').textContent = window.FlyApi.formatBDT(fb.taxesAndFees || 0);
      document.getElementById('fareSeatFeeVal').textContent = window.FlyApi.formatBDT(upgradeFee);
      document.getElementById('fareTotalVal').textContent = window.FlyApi.formatBDT(fb.totalPayable || 0);
    } catch (_) {}
  }

  async function holdSelectedSeats() {
    hideAlert();
    if (!window.FlyApi.getToken()) {
      try {
        sessionStorage.setItem('fly_pending_seats_' + flightId, JSON.stringify(state.selectedSeatIds));
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
        cabinClass: state.cabin,
        tripType: state.tripType,
        seatUpgradeFee: upgradeFee,
        nbrLuggages: state.paxCount
      });
      try {
        sessionStorage.setItem('fly_active_booking_ref', res.bookingReference);
      } catch (_) {}
      window.location.href = '/checkout?ref=' + encodeURIComponent(res.bookingReference);
    } catch (err) {
      showAlert(err.message || 'Seat lock failed. Another traveler may have reserved this seat.', 'danger');
      await loadSeats();
      holdBtn.disabled = state.selectedSeatIds.length !== state.paxCount;
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

  if (paxSelect) {
    paxSelect.addEventListener('change', () => {
      state.paxCount = Math.max(1, parseInt(paxSelect.value, 10) || 1);
      if (state.selectedSeatIds.length > state.paxCount) {
        state.selectedSeatIds = state.selectedSeatIds.slice(0, state.paxCount);
        renderSeatGrid();
      }
      updateSelectionSummary();
    });
  }

  if (cabinSelect) {
    cabinSelect.addEventListener('change', () => {
      state.cabin = cabinSelect.value;
      updateSelectionSummary();
    });
  }

  if (holdBtn) {
    holdBtn.addEventListener('click', holdSelectedSeats);
  }

  // Restore any pre-login seat selection
  try {
    const saved = sessionStorage.getItem('fly_pending_seats_' + flightId);
    if (saved) {
      const ids = JSON.parse(saved);
      if (Array.isArray(ids)) state.selectedSeatIds = ids;
      sessionStorage.removeItem('fly_pending_seats_' + flightId);
    }
  } catch (_) {}

  loadFlightDetails();
  loadSeats();
  startRealtimeSync();
})();
