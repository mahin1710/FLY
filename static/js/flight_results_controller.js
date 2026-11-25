/**
 * FLY — Live Flight Search Results & Filter Controller
 * Queries GET /api/flights from the backend database (no static demo fixtures).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FlightResultsController = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function formatMoney(val) {
    return 'BDT ' + Math.round(Number(val || 0)).toLocaleString('en-US');
  }

  function formatDuration(mins) {
    const m = Math.max(0, Math.round(Number(mins || 0)));
    if (!m) return 'Direct';
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return h > 0 ? (rem > 0 ? `${h}h ${rem}m` : `${h}h`) : `${rem}m`;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseAirportCodeOrCity(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const match = s.match(/\(([A-Za-z]{3})\)/);
    if (match) return match[1].toUpperCase();
    return s;
  }

  function parseIsoDateTime(dtStr) {
    if (!dtStr) return { time: '--:--', date: '' };
    const clean = String(dtStr).replace(' ', 'T');
    const parts = clean.split('T');
    const datePart = parts[0] || '';
    const timePart = (parts[1] || '00:00').slice(0, 5);
    return { time: timePart, date: datePart };
  }

  function matchesTimeSlot(dtStr, slot) {
    if (!slot || slot === 'all') return true;
    const { time } = parseIsoDateTime(dtStr);
    const hour = parseInt((time.split(':')[0] || '12'), 10);
    if (slot === 'morning') return hour >= 0 && hour < 12;
    if (slot === 'afternoon') return hour >= 12 && hour < 18;
    if (slot === 'evening') return hour >= 18 && hour <= 23;
    return true;
  }

  const FlightResultsController = {
    allFlights: [],
    filteredFlights: [],
    currentSort: 'recommended',
    isLoading: false,
    isFilterDrawerOpen: false,
    searchParams: {
      from: '',
      to: '',
      departure: '',
      return: '',
      tripType: 'oneway',
      cabin: 'Economy',
      adults: 1,
      children: 0,
      infants: 0
    },
    filters: {
      stops: 'all',
      selectedAirlines: new Set(),
      depTime: 'all',
      arrTime: 'all',
      maxPrice: 500000,
      maxDuration: 2880,
      checkedBaggageOnly: false,
      refundableOnly: false
    },

    async init() {
      this.parseUrlParams();
      this.renderSummaryHeader();
      this.bindEvents();
      await this.fetchFlights();
    },

    parseUrlParams() {
      const params = new URLSearchParams(window.location.search);
      this.searchParams.from = params.get('from') || '';
      this.searchParams.to = params.get('to') || '';
      this.searchParams.departure = params.get('departure') || '';
      this.searchParams.return = params.get('return') || '';
      this.searchParams.tripType = params.get('tripType') || 'oneway';
      this.searchParams.cabin = params.get('cabin') || params.get('cabinClass') || 'Economy';
      this.searchParams.adults = Math.max(1, parseInt(params.get('adults') || params.get('pax') || '1', 10) || 1);
      this.searchParams.children = Math.max(0, parseInt(params.get('children') || '0', 10) || 0);
      this.searchParams.infants = Math.max(0, parseInt(params.get('infants') || '0', 10) || 0);
    },

    getTotalPax() {
      return this.searchParams.adults + this.searchParams.children;
    },

    renderSummaryHeader() {
      const s = this.searchParams;
      const paxCount = this.getTotalPax();
      const fromText = s.from || 'All Origins';
      const toText = s.to || 'All Destinations';
      const fromEl = document.getElementById('summaryRouteFrom');
      const toEl = document.getElementById('summaryRouteTo');
      const tripEl = document.getElementById('summaryTripTypePill');
      const depEl = document.getElementById('summaryDepPill');
      const paxEl = document.getElementById('summaryPaxPill');
      const cabinEl = document.getElementById('summaryCabinPill');

      if (fromEl) fromEl.textContent = fromText;
      if (toEl) toEl.textContent = toText;
      if (tripEl) tripEl.textContent = s.tripType === 'roundtrip' ? 'Round Trip' : 'One Way';
      if (depEl) depEl.textContent = s.departure ? ('Departure: ' + s.departure) : 'Flexible Dates';
      if (paxEl) paxEl.textContent = paxCount + (paxCount === 1 ? ' Passenger' : ' Passengers');
      if (cabinEl) cabinEl.textContent = s.cabin;
    },

    async fetchFlights() {
      const listEl = document.getElementById('flightOffersList');
      const countEl = document.getElementById('resultsCountText');
      if (listEl) {
        listEl.setAttribute('aria-busy', 'true');
        listEl.innerHTML = '<div class="fly-card" style="padding:28px;text-align:center;">Searching live schedules...</div>';
      }
      if (countEl) countEl.textContent = 'Searching live schedules...';

      const qs = new URLSearchParams();
      const fromQ = parseAirportCodeOrCity(this.searchParams.from);
      const toQ = parseAirportCodeOrCity(this.searchParams.to);
      if (fromQ) qs.set('from', fromQ);
      if (toQ) qs.set('to', toQ);
      if (this.searchParams.departure) qs.set('departure', this.searchParams.departure);
      if (this.searchParams.cabin) qs.set('cabinClass', this.searchParams.cabin);
      qs.set('pax', String(this.getTotalPax()));
      qs.set('limit', '100');

      try {
        const res = await fetch('/api/flights?' + qs.toString(), { credentials: 'same-origin' });
        if (!res.ok) throw new Error('Could not load flight schedules (' + res.status + ')');
        const data = await res.json();
        const flights = Array.isArray(data.flights) ? data.flights : [];
        this.allFlights = flights.map(f => this.normalizeFlight(f));
        this.populateFilterOptions();
        this.applyFiltersAndSort();
      } catch (err) {
        if (listEl) {
          listEl.innerHTML = `
            <div class="fly-card" style="padding:28px;text-align:center;">
              <h3 style="margin-top:0;">Unable to load flights</h3>
              <p style="color:var(--text-muted);">${escapeHtml(err.message || 'Network error')}</p>
              <button type="button" class="fly-btn fly-btn-primary" id="btnRetrySearch">Retry Search</button>
            </div>`;
          const retryBtn = document.getElementById('btnRetrySearch');
          if (retryBtn) retryBtn.addEventListener('click', () => this.fetchFlights());
        }
        if (countEl) countEl.textContent = 'Search unavailable';
      } finally {
        if (listEl) listEl.setAttribute('aria-busy', 'false');
      }
    },

    normalizeFlight(raw) {
      const cabin = String(this.searchParams.cabin || 'Economy').toLowerCase();
      let unitFare = Number(raw.economy_price || 0);
      if (cabin.includes('business') && raw.business_price) unitFare = Number(raw.business_price);
      else if (cabin.includes('first') && raw.first_price) unitFare = Number(raw.first_price);
      const taxPerPax = Math.round(unitFare * 0.12);
      const dep = parseIsoDateTime(raw.dep_datetime);
      const arr = parseIsoDateTime(raw.arr_datetime);
      const durationMins = Number(raw.durationMinutes || raw.duration_minutes || 75);
      const stopsCount = Number(raw.stopsCount != null ? raw.stopsCount : (raw.stops_count || 0));
      const availableSeats = Number(raw.availableSeats != null ? raw.availableSeats : (raw.available_seats || 0));
      const totalSeats = Number(raw.totalSeats != null ? raw.totalSeats : (raw.total_seats || 0));
      const baggageKg = Number(raw.checkedBaggageKg || (raw.baggagePolicy && raw.baggagePolicy.checked_kg) || (raw.depCountry === raw.arrCountry ? 23 : 40));
      const carryOnKg = Number((raw.baggagePolicy && raw.baggagePolicy.carry_on_kg) || 7);

      return {
        raw: raw,
        id: raw.id,
        flightNumber: raw.flightNumber || raw.flight_number || ('FL-' + raw.id),
        airlineName: raw.airlineName || 'FLY Partner Airline',
        airlineIATA: raw.airlineIATA || 'FL',
        airlineId: raw.airlineId || raw.airline_id,
        aircraft: raw.aircraft || raw.aircraft_model || 'Modern Jet',
        depIATA: raw.depIATA || '',
        depCity: raw.depCity || '',
        depAirport: raw.depAirportName || raw.depCity || '',
        depTime: dep.time,
        depDate: dep.date,
        depIso: raw.dep_datetime || '',
        arrIATA: raw.arrIATA || '',
        arrCity: raw.arrCity || '',
        arrAirport: raw.arrAirportName || raw.arrCity || '',
        arrTime: arr.time,
        arrDate: arr.date,
        arrIso: raw.arr_datetime || '',
        durationMinutes: durationMins,
        durationText: raw.durationFormatted || formatDuration(durationMins),
        stopsCount: stopsCount,
        stopsText: stopsCount === 0 ? 'Non-stop' : (stopsCount + ' Stop' + (stopsCount > 1 ? 's' : '')),
        unitFare: unitFare,
        taxPerPax: taxPerPax,
        totalPerPax: unitFare + taxPerPax,
        availableSeats: availableSeats,
        totalSeats: totalSeats,
        baggageKg: baggageKg,
        carryOnKg: carryOnKg,
        baggageSummary: raw.baggageAllowance || (baggageKg + 'kg Checked + ' + carryOnKg + 'kg Cabin'),
        refundPolicy: raw.refundPolicy || raw.refundability || 'Refundable with fee',
        isRefundable: !String(raw.refundPolicy || raw.refundability || '').toLowerCase().includes('non'),
        flightStatus: raw.flightStatus || raw.status || 'SCHEDULED'
      };
    },

    populateFilterOptions() {
      const airlinesListEl = document.getElementById('filterAirlinesList');
      if (airlinesListEl) {
        const counts = {};
        this.allFlights.forEach(f => {
          counts[f.airlineName] = (counts[f.airlineName] || 0) + 1;
        });
        airlinesListEl.innerHTML = Object.entries(counts).map(([name, count]) => `
          <label class="filter-checkbox-item">
            <input type="checkbox" class="filter-airline-checkbox" value="${escapeHtml(name)}">
            <span class="custom-checkbox"></span>
            <span class="filter-label-text">${escapeHtml(name)}</span>
            <span class="filter-count-badge">${count}</span>
          </label>
        `).join('') || '<div style="color:var(--text-muted);font-size:0.85rem;">No airlines available</div>';
      }

      const priceSlider = document.getElementById('priceRangeSlider');
      const priceMaxValText = document.getElementById('priceRangeMaxText');
      if (priceSlider && this.allFlights.length) {
        const maxP = Math.max(...this.allFlights.map(f => f.totalPerPax));
        priceSlider.min = 1000;
        priceSlider.max = Math.max(10000, Math.ceil(maxP * 1.15 / 500) * 500);
        priceSlider.value = priceSlider.max;
        this.filters.maxPrice = Number(priceSlider.value);
        if (priceMaxValText) priceMaxValText.textContent = formatMoney(priceSlider.value);
      }

      const durationSlider = document.getElementById('durationRangeSlider');
      const durationMaxValText = document.getElementById('durationRangeMaxText');
      if (durationSlider && this.allFlights.length) {
        const maxD = Math.max(...this.allFlights.map(f => f.durationMinutes), 120);
        durationSlider.min = 30;
        durationSlider.max = Math.ceil(maxD * 1.25 / 15) * 15;
        durationSlider.value = durationSlider.max;
        this.filters.maxDuration = Number(durationSlider.value);
        if (durationMaxValText) durationMaxValText.textContent = formatDuration(durationSlider.value);
      }
    },

    bindEvents() {
      document.querySelectorAll('.sort-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.sort-tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.currentSort = btn.getAttribute('data-sort') || 'recommended';
          this.applyFiltersAndSort();
        });
      });

      document.querySelectorAll('input[name="filterStops"]').forEach(input => {
        input.addEventListener('change', () => {
          this.filters.stops = input.value;
          this.applyFiltersAndSort();
        });
      });

      const airlinesListEl = document.getElementById('filterAirlinesList');
      if (airlinesListEl) {
        airlinesListEl.addEventListener('change', e => {
          if (e.target && e.target.classList.contains('filter-airline-checkbox')) {
            if (e.target.checked) this.filters.selectedAirlines.add(e.target.value);
            else this.filters.selectedAirlines.delete(e.target.value);
            this.applyFiltersAndSort();
          }
        });
      }

      document.querySelectorAll('.dep-time-slot-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.dep-time-slot-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.filters.depTime = btn.getAttribute('data-slot') || 'all';
          this.applyFiltersAndSort();
        });
      });

      document.querySelectorAll('.arr-time-slot-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.arr-time-slot-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.filters.arrTime = btn.getAttribute('data-slot') || 'all';
          this.applyFiltersAndSort();
        });
      });

      const priceSlider = document.getElementById('priceRangeSlider');
      if (priceSlider) {
        priceSlider.addEventListener('input', () => {
          this.filters.maxPrice = Number(priceSlider.value);
          const el = document.getElementById('priceRangeMaxText');
          if (el) el.textContent = formatMoney(priceSlider.value);
          this.applyFiltersAndSort();
        });
      }

      const durationSlider = document.getElementById('durationRangeSlider');
      if (durationSlider) {
        durationSlider.addEventListener('input', () => {
          this.filters.maxDuration = Number(durationSlider.value);
          const el = document.getElementById('durationRangeMaxText');
          if (el) el.textContent = formatDuration(durationSlider.value);
          this.applyFiltersAndSort();
        });
      }

      const bagEl = document.getElementById('filterBaggageIncluded');
      if (bagEl) bagEl.addEventListener('change', () => { this.filters.checkedBaggageOnly = bagEl.checked; this.applyFiltersAndSort(); });
      const refEl = document.getElementById('filterRefundableOnly');
      if (refEl) refEl.addEventListener('change', () => { this.filters.refundableOnly = refEl.checked; this.applyFiltersAndSort(); });

      const resetBtn = document.getElementById('btnResetFilters');
      if (resetBtn) resetBtn.addEventListener('click', () => this.resetFilters());

      const mobileToggleBtn = document.getElementById('btnToggleMobileFilters');
      const filtersSidebar = document.getElementById('filtersSidebar');
      if (mobileToggleBtn && filtersSidebar) {
        mobileToggleBtn.addEventListener('click', () => {
          this.isFilterDrawerOpen = !this.isFilterDrawerOpen;
          filtersSidebar.classList.toggle('is-drawer-open', this.isFilterDrawerOpen);
          mobileToggleBtn.setAttribute('aria-expanded', String(this.isFilterDrawerOpen));
        });
      }
    },

    applyFiltersAndSort() {
      const f = this.filters;
      let list = this.allFlights.slice();

      if (f.stops === 'direct') list = list.filter(x => x.stopsCount === 0);
      else if (f.stops === '1stop') list = list.filter(x => x.stopsCount === 1);
      else if (f.stops === '2plus') list = list.filter(x => x.stopsCount >= 2);

      if (f.selectedAirlines.size > 0) {
        list = list.filter(x => f.selectedAirlines.has(x.airlineName));
      }
      if (f.depTime !== 'all') list = list.filter(x => matchesTimeSlot(x.depIso, f.depTime));
      if (f.arrTime !== 'all') list = list.filter(x => matchesTimeSlot(x.arrIso, f.arrTime));
      list = list.filter(x => x.durationMinutes <= f.maxDuration);
      list = list.filter(x => x.totalPerPax <= f.maxPrice);
      if (f.checkedBaggageOnly) list = list.filter(x => x.baggageKg > 0);
      if (f.refundableOnly) list = list.filter(x => x.isRefundable);

      if (this.currentSort === 'cheapest') {
        list.sort((a, b) => a.totalPerPax - b.totalPerPax || a.durationMinutes - b.durationMinutes);
      } else if (this.currentSort === 'fastest') {
        list.sort((a, b) => a.durationMinutes - b.durationMinutes || a.totalPerPax - b.totalPerPax);
      } else {
        list.sort((a, b) => (a.stopsCount - b.stopsCount) || (a.totalPerPax + a.durationMinutes * 15) - (b.totalPerPax + b.durationMinutes * 15));
      }

      this.filteredFlights = list;
      this.renderResults();
    },

    renderResults() {
      const container = document.getElementById('flightOffersList');
      const countEl = document.getElementById('resultsCountText');
      if (countEl) {
        countEl.textContent = `Showing ${this.filteredFlights.length} of ${this.allFlights.length} scheduled flights`;
      }
      if (!container) return;

      if (!this.filteredFlights.length) {
        container.innerHTML = `
          <div class="empty-state-card" id="emptyStateBox" role="region" aria-label="No matching flights">
            <h3 class="empty-state-title">No flights match your filters</h3>
            <p class="empty-state-desc">Try widening your price range, departure window, or resetting all active filters.</p>
            <div class="empty-state-action" style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
              <button type="button" class="btn-primary" onclick="FlightResultsController.resetFilters()">Reset All Filters</button>
              <a href="/" class="btn-secondary-sm">Modify Search</a>
            </div>
          </div>`;
        return;
      }

      const paxCount = this.getTotalPax();
      const seatQs = new URLSearchParams({
        pax: String(paxCount),
        cabin: this.searchParams.cabin,
        tripType: this.searchParams.tripType
      });
      if (this.searchParams.return) seatQs.set('return', this.searchParams.return);

      container.innerHTML = this.filteredFlights.map(f => {
        const soldOut = f.availableSeats < paxCount;
        const lowSeats = f.availableSeats > 0 && f.availableSeats <= 8;
        const seatUrl = `/flights/${f.id}/seats?${seatQs.toString()}`;
        return `
          <article class="flight-card" data-flight-id="${f.id}" id="flightCard_${f.id}">
            <div class="flight-card-header">
              <div class="airline-brand-group">
                <div class="airline-logo-box" aria-hidden="true">${escapeHtml(f.airlineIATA)}</div>
                <div>
                  <h4 class="airline-title">${escapeHtml(f.airlineName)}</h4>
                  <div class="flight-metadata-sub">
                    <span class="flight-num-tag">${escapeHtml(f.flightNumber)}</span>
                    <span class="meta-dot">&bull;</span>
                    <span class="aircraft-tag">${escapeHtml(f.aircraft)}</span>
                  </div>
                </div>
              </div>
              <div class="flight-badges-group">
                <span class="dest-badge ${f.stopsCount === 0 ? 'is-direct' : 'is-connecting'}">${escapeHtml(f.stopsText)}</span>
                <span class="dest-fare-pill ${f.isRefundable ? 'is-refundable' : 'is-nonref'}">${escapeHtml(f.refundPolicy)}</span>
                <span class="fly-badge ${soldOut ? 'fly-badge-danger' : (lowSeats ? 'fly-badge-warning' : 'fly-badge-success')}">
                  ${soldOut ? 'Insufficient seats' : (f.availableSeats + ' seats left')}
                </span>
              </div>
            </div>

            <div class="flight-card-body">
              <div class="flight-time-point dep-point">
                <div class="point-time">${escapeHtml(f.depTime)}</div>
                <div class="point-city">${escapeHtml(f.depCity)} (${escapeHtml(f.depIATA)})</div>
                <div class="point-sub">${escapeHtml(f.depAirport)}</div>
                <div class="point-date">${escapeHtml(f.depDate)}</div>
              </div>
              <div class="flight-duration-col">
                <div class="duration-text">${escapeHtml(f.durationText)}</div>
                <div class="flight-track-line ${f.stopsCount > 0 ? 'has-stops' : ''}">
                  <span class="track-dot start-dot"></span>
                  <span class="track-line"></span>
                  ${f.stopsCount > 0 ? '<span class="track-dot stop-dot"></span>' : ''}
                  <span class="track-dot end-dot"></span>
                </div>
                <div class="stops-text">${escapeHtml(f.stopsText)}</div>
              </div>
              <div class="flight-time-point arr-point">
                <div class="point-time">${escapeHtml(f.arrTime)}</div>
                <div class="point-city">${escapeHtml(f.arrCity)} (${escapeHtml(f.arrIATA)})</div>
                <div class="point-sub">${escapeHtml(f.arrAirport)}</div>
                <div class="point-date">${escapeHtml(f.arrDate)}</div>
              </div>
            </div>

            <div class="connecting-accordion-wrapper">
              <button type="button" class="btn-toggle-segments" onclick="FlightResultsController.toggleSegmentDetails('${f.id}')" aria-expanded="false" id="btnToggleSegments_${f.id}">
                <span>Flight Details, Baggage &amp; Fare Breakdown</span>
                <span class="accordion-chevron" aria-hidden="true">&#9662;</span>
              </button>
              <div class="connecting-segments-container" id="segmentsContainer_${f.id}" style="display:none;">
                <div class="segment-timeline-item">
                  <div class="seg-item-header">
                    <strong>${escapeHtml(f.airlineName)} &bull; ${escapeHtml(f.flightNumber)} (${escapeHtml(f.aircraft)})</strong>
                    <span class="seg-aircraft">${escapeHtml(this.searchParams.cabin)} Class</span>
                  </div>
                  <div class="seg-item-times" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:8px;">
                    <div><strong>Base Fare:</strong> ${formatMoney(f.unitFare)} / pax</div>
                    <div><strong>Est. Airport Tax (12%):</strong> ${formatMoney(f.taxPerPax)} / pax</div>
                    <div><strong>Baggage:</strong> ${escapeHtml(f.baggageSummary)}</div>
                    <div><strong>Seat Inventory:</strong> ${f.availableSeats} / ${f.totalSeats} open</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="flight-card-footer">
              <div class="footer-amenities-group">
                <div class="baggage-pill">${escapeHtml(f.baggageSummary)}</div>
                <div class="fare-family-pill">${escapeHtml(this.searchParams.cabin)}</div>
              </div>
              <div class="price-cta-group">
                <div class="price-box">
                  <span class="price-label">Estimated / passenger</span>
                  <span class="price-val">${formatMoney(f.totalPerPax)}</span>
                  <span class="price-sub-note">Includes 12% taxes &amp; fees</span>
                </div>
                ${soldOut
                  ? `<button type="button" class="fly-btn fly-btn-outline" disabled>Sold Out</button>`
                  : `<a href="${seatUrl}" class="btn-primary btn-select-offer" id="btnSelectFlight_${f.id}">
                      <span>Select Seats</span>
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    </a>`
                }
              </div>
            </div>
          </article>
        `;
      }).join('');
    },

    toggleSegmentDetails(flightId) {
      const container = document.getElementById(`segmentsContainer_${flightId}`);
      const btn = document.getElementById(`btnToggleSegments_${flightId}`);
      if (!container || !btn) return;
      const isHidden = container.style.display === 'none';
      container.style.display = isHidden ? 'block' : 'none';
      btn.setAttribute('aria-expanded', String(isHidden));
      btn.classList.toggle('is-open', isHidden);
    },

    resetFilters() {
      this.filters.stops = 'all';
      this.filters.selectedAirlines.clear();
      this.filters.depTime = 'all';
      this.filters.arrTime = 'all';
      this.filters.checkedBaggageOnly = false;
      this.filters.refundableOnly = false;

      const allStops = document.querySelector('input[name="filterStops"][value="all"]');
      if (allStops) allStops.checked = true;
      document.querySelectorAll('.filter-airline-checkbox').forEach(c => { c.checked = false; });
      document.querySelectorAll('.dep-time-slot-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-slot') === 'all'));
      document.querySelectorAll('.arr-time-slot-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-slot') === 'all'));
      const bag = document.getElementById('filterBaggageIncluded');
      if (bag) bag.checked = false;
      const ref = document.getElementById('filterRefundableOnly');
      if (ref) ref.checked = false;

      const priceSlider = document.getElementById('priceRangeSlider');
      if (priceSlider && priceSlider.max) {
        priceSlider.value = priceSlider.max;
        this.filters.maxPrice = Number(priceSlider.max);
        const t = document.getElementById('priceRangeMaxText');
        if (t) t.textContent = formatMoney(priceSlider.max);
      }
      const durationSlider = document.getElementById('durationRangeSlider');
      if (durationSlider && durationSlider.max) {
        durationSlider.value = durationSlider.max;
        this.filters.maxDuration = Number(durationSlider.max);
        const t = document.getElementById('durationRangeMaxText');
        if (t) t.textContent = formatDuration(durationSlider.max);
      }
      this.applyFiltersAndSort();
    }
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => FlightResultsController.init());
    } else {
      setTimeout(() => FlightResultsController.init(), 0);
    }
  }
  return FlightResultsController;
}));
