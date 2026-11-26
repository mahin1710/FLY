/* ==========================================================================
   FLY — Customer Refund Status Tracking Controller
   ========================================================================== */
(function () {
  'use strict';

  const root = document.getElementById('refundTrackApp');
  if (!root) return;

  const alertEl = document.getElementById('rfTrackAlert');
  const bodyEl = document.getElementById('rfTrackBody');
  const inputEl = document.getElementById('rfTrackInput');
  const esc = s => window.FlyApi.escapeHtml(s);

  function showErr(msg) {
    alertEl.textContent = msg;
    alertEl.className = 'fly-alert fly-alert-danger';
    alertEl.classList.remove('is-hidden');
  }

  async function loadRefund(refKey) {
    if (!window.FlyApi.getToken()) {
      window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
      return;
    }
    const q = (refKey || '').trim();
    if (!q) return;

    alertEl.classList.add('is-hidden');
    try {
      const r = await window.FlyApi.get('/api/refunds/track/' + encodeURIComponent(q));
      bodyEl.classList.remove('is-hidden');
      document.getElementById('rtRef').textContent = r.refundRef;
      const badge = document.getElementById('rtStatusBadge');
      badge.textContent = r.status;
      badge.className = 'fly-badge ' + (
        r.status === 'REFUNDED' ? 'fly-badge-success' :
        (r.status === 'FAILED' || r.status === 'NOT_ELIGIBLE' ? 'fly-badge-danger' : 'fly-badge-warning')
      );

      document.getElementById('rtSummaryGrid').innerHTML = `
        <div><span style="color:var(--text-muted);font-size:0.75rem;display:block;">BOOKING REF / PNR</span><strong>${esc(r.bookingReference)} (${esc(r.pnrCode || '--')})</strong></div>
        <div><span style="color:var(--text-muted);font-size:0.75rem;display:block;">REFUND AMOUNT</span><strong style="color:var(--accent-primary);">${esc(r.currency)} ${Number(r.amountBDT || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
        <div><span style="color:var(--text-muted);font-size:0.75rem;display:block;">ORIGINAL METHOD</span><strong>${esc(r.paymentMethod)}</strong></div>
        <div><span style="color:var(--text-muted);font-size:0.75rem;display:block;">DESTINATION</span><strong>${esc(r.refundDestination)}</strong></div>
        <div><span style="color:var(--text-muted);font-size:0.75rem;display:block;">REQUEST DATE (UTC)</span><strong>${esc(r.requestedAt)}</strong></div>
        <div><span style="color:var(--text-muted);font-size:0.75rem;display:block;">LAST UPDATE (UTC)</span><strong>${esc(r.updatedAt)}</strong></div>
        <div><span style="color:var(--text-muted);font-size:0.75rem;display:block;">SUPPLIER / PROVIDER REF</span><strong style="font-family:var(--font-mono);">${esc(r.providerRef || r.supplierRef || 'Pending')}</strong></div>
      `;
      document.getElementById('rtWindowNotice').textContent = r.estimatedWindow;

      document.getElementById('rtTimeline').innerHTML = (r.timelineStages || []).map(st => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;border:1px solid ${st.completed ? '#10b981' : 'var(--border-subtle)'};background:${st.completed ? 'rgba(16,185,129,0.08)' : 'transparent'};">
          <span class="fly-badge ${st.completed ? 'fly-badge-success' : ''}">${st.completed ? 'DONE' : 'WAIT'}</span>
          <span style="font-size:0.9rem;font-weight:${st.completed ? '600' : '400'};">${esc(st.label)}</span>
        </div>
      `).join('');

      document.getElementById('rtHistory').innerHTML = (r.history || []).map(h => `
        <div style="padding:8px 10px;border-left:3px solid var(--accent-primary);background:var(--bg-secondary);border-radius:0 8px 8px 0;">
          <div style="display:flex;justify-content:space-between;font-size:0.78rem;color:var(--text-muted);">
            <strong>${esc(h.stage_label)}</strong>
            <span>${esc(h.created_at)}</span>
          </div>
          <div style="margin-top:2px;">${esc(h.note || h.to_status)}</div>
        </div>
      `).join('') || '<p style="color:var(--text-muted);">No updates recorded yet.</p>';
    } catch (err) {
      bodyEl.classList.add('is-hidden');
      showErr(err.message || 'Refund record not found.');
    }
  }

  document.getElementById('rfTrackSearchForm').addEventListener('submit', e => {
    e.preventDefault();
    loadRefund(inputEl.value);
  });

  const initialRef = root.getAttribute('data-ref');
  if (initialRef) loadRefund(initialRef);
})();
