/* ==========================================================================
   FLY — Airline & System Administration Console (Role & Tenant Guarded)
   ========================================================================== */
(function () {
  'use strict';

  const root = document.getElementById('adminConsoleApp');
  if (!root) return;

  const alertEl = document.getElementById('adminAlert');
  const esc = s => window.FlyApi.escapeHtml(s);
  let activeTab = root.getAttribute('data-initial-tab') || 'dashboard';
  let currentUser = null;

  function showAlert(msg, isError) {
    alertEl.textContent = msg;
    alertEl.className = 'fly-alert ' + (isError ? 'fly-alert-danger' : 'fly-alert-success');
    alertEl.classList.remove('is-hidden');
  }

  function hideAlert() {
    alertEl.classList.add('is-hidden');
  }

  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('#adminNavTabs [data-admin-tab]').forEach(a => {
      const isCur = a.getAttribute('data-admin-tab') === tab;
      a.className = 'fly-btn ' + (isCur ? 'fly-btn-primary' : 'fly-btn-outline');
    });
    document.querySelectorAll('.admin-panel').forEach(p => {
      p.classList.toggle('is-hidden', p.getAttribute('data-panel') !== tab);
    });
    loadTabData(tab);
  }

  document.querySelectorAll('#adminNavTabs [data-admin-tab]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const tab = a.getAttribute('data-admin-tab');
      if (window.history && window.history.pushState) {
        window.history.pushState({}, '', a.getAttribute('href'));
      }
      switchTab(tab);
    });
  });

  async function initAdmin() {
    if (!window.FlyApi.getToken()) {
      window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
      return;
    }
    const u = await window.FlyApi.refreshUser();
    currentUser = u;
    const role = String((u && u.role) || '').toUpperCase();
    if (!u || !['AIRLINE_ADMIN', 'SYSTEM_ADMIN', 'SUPER_ADMIN'].includes(role)) {
      document.getElementById('adminRolePill').textContent = 'ACCESS DENIED';
      document.getElementById('adminRolePill').className = 'fly-badge fly-badge-danger';
      showAlert('Restricted: This console is limited to authorized Airline and System Administrators.', true);
      document.querySelectorAll('.admin-panel').forEach(p => p.classList.add('is-hidden'));
      return;
    }

    document.getElementById('adminRolePill').textContent = role + (u.airlineId ? (' • Airline #' + u.airlineId) : ' • Global');
    document.getElementById('adminRolePill').className = 'fly-badge fly-badge-success';
    document.getElementById('adminScopeSubtitle').textContent =
      role === 'AIRLINE_ADMIN'
        ? `Strict Airline Isolation Active (${u.displayName || u.username} • Airline ID ${u.airlineId})`
        : 'Global System Operations Across All Airlines';

    const cfAir = document.getElementById('cfAirlineField');
    if (cfAir && role !== 'AIRLINE_ADMIN') cfAir.classList.remove('is-hidden');

    switchTab(activeTab);
  }

  async function loadTabData(tab) {
    hideAlert();
    try {
      if (tab === 'dashboard') await loadDashboard();
      else if (tab === 'flights') await loadFlights();
      else if (tab === 'bookings') await loadBookingsAndRefunds();
      else if (tab === 'inventory') await loadInventoryTab();
      else if (tab === 'audit-logs') await loadAuditLogs();
      else if (tab === 'settings') await loadSettings();
    } catch (err) {
      showAlert(err.message || 'Failed to load admin data.', true);
    }
  }

  async function loadDashboard() {
    const d = await window.FlyApi.get('/api/admin/dashboard');
    document.getElementById('admKpiFlights').textContent = String(d.totalFlights || 0);
    document.getElementById('admKpiConfirmed').textContent = String(d.confirmedBookings || 0);
    document.getElementById('admKpiLocks').textContent = String(d.activeLocks || 0);
    document.getElementById('admKpiOcc').textContent = (d.seatOccupancyPct || 0) + '%';
    document.getElementById('admKpiRev').textContent = window.FlyApi.formatBDT(d.totalRevenue || 0);

    const tbody = document.getElementById('admRecentFlightsBody');
    tbody.innerHTML = (d.recentFlights || []).map(f => `
      <tr style="border-bottom:1px solid var(--border-subtle);">
        <td style="padding:8px;"><strong>${esc(f.flightNumber)}</strong><div style="font-size:0.78rem;color:var(--text-muted);">${esc(f.airlineName)}</div></td>
        <td style="padding:8px;">${esc(f.depIATA)} ➔ ${esc(f.arrIATA)}</td>
        <td style="padding:8px;">${esc(f.dep_datetime)}</td>
        <td style="padding:8px;"><span class="fly-badge">${esc(f.status || 'SCHEDULED')}</span></td>
        <td style="padding:8px;">${f.bookedSeats || 0}</td>
        <td style="padding:8px;">${window.FlyApi.formatBDT(f.economy_price)}</td>
      </tr>`).join('') || '<tr><td colspan="6" style="padding:14px;color:var(--text-muted);">No flights found.</td></tr>';
  }

  async function loadFlights() {
    const list = await window.FlyApi.get('/api/airline/flights');
    const tbody = document.getElementById('admFlightsTableBody');
    tbody.innerHTML = (list || []).map(f => `
      <tr style="border-bottom:1px solid var(--border-subtle);">
        <td style="padding:8px;"><strong>${esc(f.flight_number || ('FL-' + f.id))}</strong><div style="font-size:0.76rem;color:var(--text-muted);">${esc(f.airlineIATA)} • ${esc(f.aircraft_model || '')}</div></td>
        <td style="padding:8px;">${esc(f.depIATA)} ➔ ${esc(f.arrIATA)}</td>
        <td style="padding:8px;">${esc(f.dep_datetime)}</td>
        <td style="padding:8px;">${f.bookedCount || 0} booked / ${f.lockedCount || 0} locked</td>
        <td style="padding:8px;">${window.FlyApi.formatBDT(f.economy_price)}</td>
        <td style="padding:8px;">
          <select class="fly-select adm-flight-status" data-fid="${f.id}" style="min-height:34px;padding:4px 8px;">
            ${['SCHEDULED', 'ON_TIME', 'DELAYED', 'CANCELLED'].map(st => `<option value="${st}" ${String(f.status || 'SCHEDULED').toUpperCase() === st ? 'selected' : ''}>${st}</option>`).join('')}
          </select>
        </td>
        <td style="padding:8px;">
          <button type="button" class="fly-btn fly-btn-outline adm-del-flight" data-fid="${f.id}" style="padding:4px 10px;font-size:0.78rem;">Deactivate</button>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('.adm-flight-status').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          await window.FlyApi.put('/api/airline/flights/' + sel.getAttribute('data-fid'), { status: sel.value });
          showAlert('Flight status updated.', false);
        } catch (err) {
          showAlert(err.message, true);
        }
      });
    });

    tbody.querySelectorAll('.adm-del-flight').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fid = btn.getAttribute('data-fid');
        if (!window.confirm('Deactivate flight #' + fid + '?')) return;
        try {
          await window.FlyApi.del('/api/airline/flights/' + fid);
          showAlert('Flight deactivated.', false);
          loadFlights();
        } catch (err) {
          showAlert(err.message, true);
        }
      });
    });
  }

  const createFlightForm = document.getElementById('createFlightForm');
  if (createFlightForm) {
    createFlightForm.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const body = {
          flightNumber: document.getElementById('cfFlightNum').value.trim(),
          depIATA: document.getElementById('cfDepIata').value.trim(),
          arrIATA: document.getElementById('cfArrIata').value.trim(),
          depDateTime: document.getElementById('cfDepDt').value,
          arrDateTime: document.getElementById('cfArrDt').value,
          aircraftModel: document.getElementById('cfAircraft').value.trim(),
          economyPrice: Number(document.getElementById('cfEconPrice').value),
        };
        if (currentUser && currentUser.role !== 'AIRLINE_ADMIN') {
          body.airlineId = Number(document.getElementById('cfAirlineId').value);
        }
        await window.FlyApi.post('/api/airline/flights', body);
        createFlightForm.reset();
        showAlert('New flight scheduled successfully.', false);
        loadFlights();
      } catch (err) {
        showAlert(err.message, true);
      }
    });
  }

  async function loadBookingsAndRefunds() {
    const q = encodeURIComponent(document.getElementById('admBookingSearchInput').value.trim());
    const [bRes, rRes] = await Promise.all([
      window.FlyApi.get('/api/admin/all-bookings' + (q ? ('?q=' + q) : '')),
      window.FlyApi.get('/api/admin/refunds')
    ]);
    const bBody = document.getElementById('admBookingsBody');
    bBody.innerHTML = (bRes.bookings || []).map(b => `
      <tr style="border-bottom:1px solid var(--border-subtle);">
        <td style="padding:8px;"><strong>${esc(b.pnrCode || '--')}</strong><div style="font-size:0.75rem;color:var(--text-muted);">${esc(b.bookingReference)}</div></td>
        <td style="padding:8px;">${esc(b.display_name || b.username)}<div style="font-size:0.75rem;color:var(--text-muted);">${esc(b.emailAddress || '')}</div></td>
        <td style="padding:8px;">${esc(b.flightNumber)} (${esc(b.depIATA)} ➔ ${esc(b.arrIATA)})</td>
        <td style="padding:8px;"><span class="fly-badge">${esc(b.status)}</span></td>
        <td style="padding:8px;">${window.FlyApi.formatBDT(b.total_amount)}</td>
        <td style="padding:8px;">${esc(b.created_at)}</td>
      </tr>`).join('') || '<tr><td colspan="6" style="padding:14px;color:var(--text-muted);">No matching bookings.</td></tr>';

    const rBody = document.getElementById('admRefundsBody');
    rBody.innerHTML = (rRes.refunds || []).map(r => `
      <tr style="border-bottom:1px solid var(--border-subtle);">
        <td style="padding:8px;"><strong>${esc(r.pnr_code || r.booking_reference)}</strong></td>
        <td style="padding:8px;">${esc(r.username)}</td>
        <td style="padding:8px;">${esc(r.reason)}</td>
        <td style="padding:8px;">${window.FlyApi.formatBDT(r.requested_amount)}</td>
        <td style="padding:8px;"><span class="fly-badge">${esc(r.status)}</span></td>
        <td style="padding:8px;">
          ${r.status === 'PENDING'
            ? `<button type="button" class="fly-btn fly-btn-primary adm-ref-dec" data-rid="${r.id}" data-dec="APPROVED" style="padding:4px 10px;font-size:0.78rem;">Approve</button>
               <button type="button" class="fly-btn fly-btn-danger adm-ref-dec" data-rid="${r.id}" data-dec="REJECTED" style="padding:4px 10px;font-size:0.78rem;">Reject</button>`
            : esc(r.review_note || 'Reviewed')}
        </td>
      </tr>`).join('') || '<tr><td colspan="6" style="padding:14px;color:var(--text-muted);">No refund requests.</td></tr>';

    rBody.querySelectorAll('.adm-ref-dec').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await window.FlyApi.post(`/api/admin/refunds/${btn.getAttribute('data-rid')}/decision`, {
            decision: btn.getAttribute('data-dec')
          });
          showAlert('Refund decision processed.', false);
          loadBookingsAndRefunds();
        } catch (err) {
          showAlert(err.message, true);
        }
      });
    });
  }

  const bSearchBtn = document.getElementById('btnAdmBookingSearch');
  if (bSearchBtn) bSearchBtn.addEventListener('click', loadBookingsAndRefunds);

  async function loadInventoryTab() {
    const sel = document.getElementById('admInventoryFlightSelect');
    const flights = await window.FlyApi.get('/api/airline/flights');
    if (!flights.length) {
      document.getElementById('admInventoryGrid').innerHTML = '<p style="color:var(--text-muted);">No flights available.</p>';
      return;
    }
    sel.innerHTML = flights.map(f => `<option value="${f.id}">${esc(f.flight_number || ('FL-' + f.id))} (${esc(f.depIATA)}➔${esc(f.arrIATA)} • ${esc(f.dep_datetime)})</option>`).join('');
    sel.onchange = () => renderFlightInventory(sel.value);
    renderFlightInventory(sel.value);
  }

  async function renderFlightInventory(fid) {
    const res = await window.FlyApi.get('/api/admin/inventory/' + fid);
    const sum = res.summary || {};
    document.getElementById('admInventorySummary').innerHTML = `
      <span class="fly-badge fly-badge-success">AVAILABLE: ${sum.AVAILABLE || 0}</span>
      <span class="fly-badge fly-badge-warning">LOCKED: ${sum.LOCKED || 0}</span>
      <span class="fly-badge fly-badge-danger">BOOKED: ${sum.BOOKED || 0}</span>`;
    const rows = new Map();
    (res.seats || []).forEach(s => {
      if (!rows.has(s.row)) rows.set(s.row, {});
      rows.get(s.row)[s.column] = s;
    });
    const sorted = Array.from(rows.entries()).sort((a, b) => a[0] - b[0]);
    document.getElementById('admInventoryGrid').innerHTML = sorted.map(([r, cols]) => {
      const render = c => {
        const s = cols[c];
        if (!s) return '<span></span>';
        const cls = s.status === 'BOOKED' ? 'is-booked' : (s.status === 'LOCKED' ? 'is-locked' : '');
        return `<span class="seat-cell ${cls}" style="cursor:default;">${esc(s.code)}</span>`;
      };
      return `<div class="seat-row-grid">${['A', 'B', 'C'].map(render).join('')}<div class="seat-row-num">${r}</div>${['D', 'E', 'F'].map(render).join('')}</div>`;
    }).join('');
  }

  async function loadAuditLogs() {
    const res = await window.FlyApi.get('/api/admin/audit-logs');
    const tbody = document.getElementById('admAuditLogsBody');
    tbody.innerHTML = (res.logs || []).map(l => `
      <tr style="border-bottom:1px solid var(--border-subtle);">
        <td style="padding:8px;white-space:nowrap;">${esc(l.created_at)}</td>
        <td style="padding:8px;"><strong>${esc(l.event_type)}</strong></td>
        <td style="padding:8px;"><span class="fly-badge ${l.result === 'CONFLICT' ? 'fly-badge-danger' : 'fly-badge-success'}">${esc(l.result)}</span></td>
        <td style="padding:8px;">${esc(l.reservation_ref || ('Flight #' + (l.flight_id || '--')))}</td>
        <td style="padding:8px;">${esc(l.details)}</td>
      </tr>`).join('') || '<tr><td colspan="5" style="padding:14px;color:var(--text-muted);">No audit events logged yet.</td></tr>';
  }

  async function loadSettings() {
    const res = await window.FlyApi.get('/api/admin/settings');
    const ov = document.getElementById('admSettingsOverview');
    const pols = (res.baggagePolicies || []).map(p =>
      `<div style="padding:10px;border:1px solid var(--border-subtle);border-radius:8px;">
        <strong>${esc(p.route_scope)}</strong> (${p.id_airline ? ('Airline #' + p.id_airline) : 'Global Default'}):
        ${p.included_checked_kg} kg checked, ${p.cabin_kg} kg cabin, BDT ${p.extra_per_kg_fee}/kg extra
      </div>`).join('');
    const promos = (res.promoCodes || []).map(c =>
      `<div style="padding:10px;border:1px solid var(--border-subtle);border-radius:8px;">
        <strong>${esc(c.code)}</strong> — ${esc(c.discount_type)} ${c.discount_value} (min fare BDT ${c.min_fare})
      </div>`).join('');
    ov.innerHTML = `<h3 style="margin:0;font-size:0.95rem;">Baggage Policies</h3>${pols}<h3 style="margin:8px 0 0;font-size:0.95rem;">Promo Codes</h3>${promos}`;
  }

  const bpForm = document.getElementById('admBaggageForm');
  if (bpForm) {
    bpForm.addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await window.FlyApi.put('/api/admin/settings', {
          routeScope: document.getElementById('bpScope').value,
          includedCheckedKg: Number(document.getElementById('bpKg').value),
          extraPerKgFee: Number(document.getElementById('bpPerKg').value)
        });
        showAlert('Baggage policy updated.', false);
        loadSettings();
      } catch (err) {
        showAlert(err.message, true);
      }
    });
  }

  initAdmin();
})();
