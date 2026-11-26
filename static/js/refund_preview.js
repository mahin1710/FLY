/* ==========================================================================
   FLY — Customer Refund Preview & Explicit Confirmation Controller
   ========================================================================== */
(function () {
  'use strict';

  const root = document.getElementById('refundPreviewApp');
  if (!root) return;

  const ref = root.getAttribute('data-ref');
  const alertEl = document.getElementById('rpAlert');
  const quoteContainer = document.getElementById('rpQuoteContainer');
  const cancelTypeEl = document.getElementById('rpCancelType');
  const partialWrap = document.getElementById('rpPartialWrap');
  const esc = s => window.FlyApi.escapeHtml(s);

  let currentQuote = null;
  let idempotencyKey = 'CAN-' + ref + '-' + Date.now();

  function showAlert(msg, isError) {
    alertEl.textContent = msg;
    alertEl.className = 'fly-alert ' + (isError ? 'fly-alert-danger' : 'fly-alert-success');
    alertEl.classList.remove('is-hidden');
  }

  function renderPartialSelectors(q) {
    const box = document.getElementById('rpPartialChoices');
    const tList = (q.tickets || []).filter(t => t.status === 'ISSUED');
    const sList = (q.segments || []).filter(s => s.coupon_status === 'OPEN' || s.coupon_status === 'CHECKED_IN');
    let html = '';
    if (tList.length > 1) {
      html += '<div style="display:flex;gap:10px;flex-wrap:wrap;">' + tList.map(t => `
        <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:8px;font-size:0.84rem;cursor:pointer;">
          <input type="checkbox" class="rp-sel-ticket" value="${t.id}">
          <span>${esc(t.passenger_name)} (${esc(t.ticket_number)} • ${esc(t.seat_codes)})</span>
        </label>
      `).join('') + '</div>';
    }
    if (sList.length > 1) {
      html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;">' + sList.map(s => `
        <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:8px;font-size:0.84rem;cursor:pointer;">
          <input type="checkbox" class="rp-sel-segment" value="${s.id}">
          <span>Segment ${s.segment_order}: ${esc(s.origin_iata)} ➔ ${esc(s.dest_iata)} (${esc(s.dep_datetime)})</span>
        </label>
      `).join('') + '</div>';
    }
    if (!html) {
      html = '<div style="font-size:0.84rem;color:var(--text-muted);">Only single passenger / single open segment detected on this booking.</div>';
    }
    box.innerHTML = html;
  }

  async function loadQuote() {
    if (!window.FlyApi.getToken()) {
      window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
      return;
    }
    alertEl.classList.add('is-hidden');

    const ctype = cancelTypeEl.value;
    partialWrap.classList.toggle('is-hidden', ctype !== 'PARTIAL');

    const selectedTicketIds = Array.from(document.querySelectorAll('.rp-sel-ticket:checked')).map(i => Number(i.value));
    const selectedSegmentIds = Array.from(document.querySelectorAll('.rp-sel-segment:checked')).map(i => Number(i.value));

    try {
      const q = await window.FlyApi.post('/api/cancellations/quote', {
        bookingReference: ref,
        cancellationType: ctype,
        selectedTicketIds,
        selectedSegmentIds,
        reason: document.getElementById('rpReasonInput').value.trim()
      });
      currentQuote = q;
      quoteContainer.classList.remove('is-hidden');
      renderPartialSelectors(q);

      const leadTk = (q.tickets || [])[0] || {};
      document.getElementById('rpBookingMeta').innerHTML = `
        <div><span style="color:var(--text-muted);font-size:0.75rem;display:block;">BOOKING REF</span><strong style="font-family:var(--font-mono);">${esc(q.bookingReference)}</strong></div>
        <div><span style="color:var(--text-muted);font-size:0.75rem;display:block;">PNR CODE</span><strong style="font-family:var(--font-mono);">${esc(q.pnrCode || '--')}</strong></div>
        <div><span style="color:var(--text-muted);font-size:0.75rem;display:block;">PASSENGER</span><strong>${esc(leadTk.passenger_name || 'Passenger')}</strong></div>
        <div><span style="color:var(--text-muted);font-size:0.75rem;display:block;">AIRLINE</span><strong>${esc(q.airlineName || '--')}</strong></div>
        <div><span style="color:var(--text-muted);font-size:0.75rem;display:block;">JOURNEY</span><strong>${esc(q.journey || '--')}</strong></div>
        <div><span style="color:var(--text-muted);font-size:0.75rem;display:block;">TICKET / STATUS</span><strong>${esc(leadTk.ticket_number || '--')} (${esc(leadTk.issuance_state || leadTk.status || '--')})</strong></div>
      `;

      document.getElementById('rpCancelMeta').innerHTML = `
        <div><strong>Cancellation Type:</strong> <span class="fly-badge">${esc(q.cancellationType)}</span></div>
        <div><strong>Fare Family:</strong> ${esc(q.fareFamily)} &bull; <strong>Coupon State:</strong> ${esc(q.couponState)}</div>
        <div style="font-size:0.84rem;color:var(--text-secondary);">${esc(q.fareRuleNotes || '')}</div>
        ${q.noShowDetected ? '<div class="fly-alert fly-alert-danger" style="padding:8px 10px;font-size:0.82rem;">Departure passed / No-Show conditions apply. Full refunds are not auto-approved.</div>' : ''}
        ${q.splitPnrRequired ? '<div style="font-size:0.82rem;color:#d97706;">Supplier PNR split workflow applies for partial passenger cancellation.</div>' : ''}
      `;

      const altBox = document.getElementById('rpAlternativesBox');
      if (Array.isArray(q.alternatives) && q.alternatives.length) {
        altBox.classList.remove('is-hidden');
        altBox.innerHTML = `<strong style="font-size:0.86rem;">Eligible Airline Rebooking Alternatives:</strong>` + q.alternatives.map(a => `
          <div style="font-size:0.82rem;padding:6px 0;border-bottom:1px solid var(--border-subtle);">
            ${esc(a.flight_number)} (${esc(a.airlineName)}) &bull; Departs ${esc(a.dep_datetime)}
          </div>
        `).join('');
      } else {
        altBox.classList.add('is-hidden');
      }

      document.getElementById('rpPaymentMeta').innerHTML = `
        <div><strong>Original Method:</strong> ${esc(q.paymentMethod)}</div>
        <div><strong>Masked Payment Ref:</strong> <span style="font-family:var(--font-mono);">${esc(q.maskedPaymentRef)}</span></div>
        <div><strong>Expected Destination:</strong> ${esc(q.refundDestination)}</div>
        <div style="font-size:0.82rem;color:var(--text-muted);">${esc(q.estimatedWindow)}</div>
      `;

      document.getElementById('rpQuoteBadge').textContent = q.quoteRef;
      document.getElementById('rpQuoteExpiryNote').textContent = 'Quote expires (UTC): ' + q.expiresAt;
      document.getElementById('rpWarningBox').textContent = q.irreversibleWarning;
      document.getElementById('rpFinalAmount').textContent = `${q.currency} ${Number(q.finalRefundBDT || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      document.getElementById('rpItemsList').innerHTML = (q.items || []).map(it => {
        const sign = it.category === 'DEDUCTION' ? '-' : '';
        const col = it.category === 'DEDUCTION' ? '#dc2626' : (it.lineCode === 'ESTIMATED_REFUND' ? 'var(--accent-primary)' : 'inherit');
        return `
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding-bottom:6px;border-bottom:1px dashed var(--border-subtle);">
            <div>
              <div>${esc(it.label)}</div>
              <div style="font-size:0.74rem;color:var(--text-muted);">${esc(it.authoritySource)}</div>
            </div>
            <strong style="color:${col};white-space:nowrap;">${sign}${q.currency} ${Number(it.amountBDT || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </div>`;
      }).join('');
    } catch (err) {
      if (err.code === 'PARTIAL_NOT_PERMITTED') {
        showAlert(err.message, true);
      } else {
        showAlert(err.message || 'Could not calculate refund quotation.', true);
      }
    }
  }

  document.getElementById('btnRefreshQuote').addEventListener('click', loadQuote);
  cancelTypeEl.addEventListener('change', () => {
    partialWrap.classList.toggle('is-hidden', cancelTypeEl.value !== 'PARTIAL');
    if (cancelTypeEl.value !== 'PARTIAL') loadQuote();
  });

  document.getElementById('btnConfirmCancelSubmit').addEventListener('click', async () => {
    if (!currentQuote) return;
    if (!document.getElementById('rpConfirmCheck').checked) {
      showAlert('Please check the explicit confirmation box after reviewing the refund breakdown.', true);
      return;
    }
    const btn = document.getElementById('btnConfirmCancelSubmit');
    btn.disabled = true;
    btn.textContent = 'Submitting to Airline...';
    try {
      const res = await window.FlyApi.post('/api/cancellations/confirm', {
        bookingReference: ref,
        quoteId: currentQuote.quoteId,
        quoteRef: currentQuote.quoteRef,
        customerConfirmed: true,
        cancellationType: currentQuote.cancellationType,
        reason: document.getElementById('rpReasonInput').value.trim(),
        idempotencyKey,
        selectedTicketIds: currentQuote.selectedTicketIds || [],
        selectedSegmentIds: currentQuote.selectedSegmentIds || []
      });
      if (res.refundRef) {
        window.location.href = '/refunds/track/' + encodeURIComponent(res.refundRef);
      } else {
        showAlert(res.message || 'Booking cancelled.', false);
      }
    } catch (err) {
      if (err.code === 'QUOTE_EXPIRED') {
        showAlert(err.message + ' Refreshing quote now...', true);
        idempotencyKey = 'CAN-' + ref + '-' + Date.now();
        await loadQuote();
      } else {
        showAlert(err.message || 'Cancellation confirmation failed.', true);
      }
      btn.disabled = false;
      btn.textContent = 'Confirm Cancellation & Submit Refund';
    }
  });

  document.getElementById('btnRejectQuote').addEventListener('click', async () => {
    if (!currentQuote) {
      window.location.href = '/my-bookings';
      return;
    }
    try {
      await window.FlyApi.post('/api/refund-quotes/' + encodeURIComponent(currentQuote.quoteRef) + '/reject', {});
      window.location.href = '/my-bookings';
    } catch (err) {
      showAlert(err.message || 'Could not decline quote.', true);
    }
  });

  loadQuote();
})();
