/**
 * FLY AVIATION - FLIGHT SEARCH RESULTS CONTROLLER
 * Author: mahin1710
 *
 * Implements:
 *  1. Search summary with Edit Search (returns to widget with selections preserved)
 *  2. Real-time deterministic sorting: Recommended (Best), Cheapest, Fastest
 *  3. Real-time multi-dimensional filtering:
 *     - Stops (All, Direct/Non-stop, 1 stop, 2+ stops)
 *     - Airlines (Multi-select)
 *     - Departure time window (Morning, Afternoon, Evening)
 *     - Arrival time window (Morning, Afternoon, Evening)
 *     - Max flight duration
 *     - Max ticket price
 *     - Included checked baggage
 *     - Refundable only
 *  4. Flight card with full metadata, connecting itineraries accordion, and overnight indicator
 *  5. Prominent "Demo data – not bookable" disclaimers on every card and header
 *  6. Empty, loading, provider-timeout, and expired-offer states
 *  7. Mobile responsive filter drawer toggle
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./flight_models', './flight_fixtures'], factory);
  } else if (typeof module === 'object' && module.exports) {
    const Models = require('./flight_models');
    const Fixtures = require('./flight_fixtures');
    module.exports = factory(Models, Fixtures);
  } else {
    root.FlightResultsController = factory(root.FlightModels, root.FlightFixtures);
  }
}(typeof self !== 'undefined' ? self : this, function (Models, Fixtures) {
  'use strict';

  const { FlightSorter, formatMoney, formatMinutesToHoursMinutes } = Models;
  const { DEMO_OFFERS, queryDemoOffers } = Fixtures;

  const FlightResultsController = {
    searchParams: {
      tripType: 'roundtrip',
      from: 'DAC',
      fromCity: 'Dhaka',
      to: 'CXB',
      toCity: "Cox's Bazar",
      departure: '',
      return: '',
      adults: 1,
      children: 0,
      infants: 0,
      cabin: 'Economy',
      simulatedState: 'normal' // 'normal', 'loading', 'timeout', 'expired'
    },

    allOffers: [],
    filteredOffers: [],

    filters: {
      stops: 'all', // 'all', 'direct', '1stop', '2plus'
      selectedAirlines: new Set(),
      depTime: 'all', // 'all', 'morning', 'afternoon', 'evening'
      arrTime: 'all',
      maxDuration: 1440,
      maxPrice: 200000,
      checkedBaggageOnly: false,
      refundableOnly: false
    },

    currentSort: 'recommended', // 'recommended', 'cheapest', 'fastest'
    isFilterDrawerOpen: false,

    // -----------------------------------------------------------
    // INITIALIZATION
    // -----------------------------------------------------------
    init() {
      this.parseUrlParams();
      this.loadOffers();
      this.renderSearchSummary();
      this.populateFilterOptions();
      this.bindEvents();
      this.applyFiltersAndSort();
    },

    // -----------------------------------------------------------
    // URL QUERY PARSING
    // -----------------------------------------------------------
    parseUrlParams() {
      if (typeof window === 'undefined' || !window.location) return;

      const params = new URLSearchParams(window.location.search);
      const s = this.searchParams;

      s.tripType = params.get('trip_type') || 'roundtrip';
      s.from = params.get('from') || 'DAC';
      s.fromCity = params.get('fromCity') || 'Dhaka';
      s.to = params.get('to') || 'CXB';
      s.toCity = params.get('toCity') || "Cox's Bazar";
      s.departure = params.get('departure') || '';
      s.return = params.get('return') || '';
      s.adults = parseInt(params.get('adults'), 10) || 1;
      s.children = parseInt(params.get('children'), 10) || 0;
      s.infants = parseInt(params.get('infants'), 10) || 0;
      s.cabin = params.get('cabin') || 'Economy';
      s.simulatedState = params.get('simulated_state') || 'normal';
    },

    // -----------------------------------------------------------
    // LOAD FIXTURES
    // -----------------------------------------------------------
    loadOffers() {
      if (this.searchParams.simulatedState === 'expired') {
        this.allOffers = DEMO_OFFERS.filter(o => o.isExpired);
        return;
      }

      // Query matching demo fixtures
      const matches = queryDemoOffers({
        from: this.searchParams.from,
        to: this.searchParams.to
      });

      this.allOffers = matches;
    },

    // -----------------------------------------------------------
    // RENDER SEARCH SUMMARY & "EDIT SEARCH" LINK
    // -----------------------------------------------------------
    renderSearchSummary() {
      const summaryCard = document.getElementById('searchSummaryCard');
      if (!summaryCard) return;

      const s = this.searchParams;
      const totalPax = s.adults + s.children + s.infants;
      const paxDesc = `${totalPax} Traveler${totalPax > 1 ? 's' : ''} (${s.adults}A${s.children ? `, ${s.children}C` : ''}${s.infants ? `, ${s.infants}I` : ''})`;

      // Build Edit Search return URL with exact state preservation
      const editParams = new URLSearchParams();
      editParams.set('trip_type', s.tripType);
      editParams.set('from', s.from);
      editParams.set('fromCity', s.fromCity);
      editParams.set('to', s.to);
      editParams.set('toCity', s.toCity);
      if (s.departure) editParams.set('departure', s.departure);
      if (s.return && s.tripType === 'roundtrip') editParams.set('return', s.return);
      editParams.set('adults', s.adults);
      editParams.set('children', s.children);
      editParams.set('infants', s.infants);
      editParams.set('cabin', s.cabin);
      const editSearchUrl = `/?${editParams.toString()}`;

      summaryCard.innerHTML = `
        <div class="summary-left-col">
          <div class="summary-route-header">
            <span class="summary-route-city" id="summaryRouteFrom">${s.fromCity} (${s.from})</span>
            <span class="summary-plane-icon" aria-hidden="true">➔</span>
            <span class="summary-route-city" id="summaryRouteTo">${s.toCity} (${s.to})</span>
            <span class="demo-tag-pill" title="This flight results page displays demo data only">Simulated schedule</span>
          </div>
          <div class="summary-pills-row">
            <span class="summary-pill" id="summaryTripTypePill">${s.tripType === 'roundtrip' ? 'Round Trip' : (s.tripType === 'oneway' ? 'One Way' : 'Multi-City')}</span>
            <span class="summary-pill" id="summaryDepPill">Departure: ${s.departure || 'Flexible Date'}</span>
            ${s.tripType === 'roundtrip' && s.return ? `<span class="summary-pill" id="summaryRetPill">Return: ${s.return}</span>` : ''}
            <span class="summary-pill" id="summaryPaxPill">${paxDesc}</span>
            <span class="summary-pill" id="summaryCabinPill">${s.cabin}</span>
          </div>
        </div>
        <div class="summary-actions-col">
          <a href="${editSearchUrl}" class="btn-secondary-sm edit-search-btn" id="btnEditSearch" title="Return to flight search form with your selections intact">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            <span>Edit Search</span>
          </a>
        </div>
      `;
    },

    // -----------------------------------------------------------
    // POPULATE DYNAMIC FILTER OPTIONS FROM FIXTURES
    // -----------------------------------------------------------
    populateFilterOptions() {
      // 1. Airline filter checkboxes
      const airlinesListEl = document.getElementById('filterAirlinesList');
      if (airlinesListEl && this.allOffers.length > 0) {
        const airlineCounts = {};
        this.allOffers.forEach(o => {
          const name = o.getCarrierName();
          airlineCounts[name] = (airlineCounts[name] || 0) + 1;
        });

        airlinesListEl.innerHTML = Object.entries(airlineCounts).map(([name, count]) => `
          <label class="filter-checkbox-item">
            <input type="checkbox" class="filter-airline-checkbox" value="${name}">
            <span class="custom-checkbox"></span>
            <span class="filter-label-text">${name}</span>
            <span class="filter-count-badge">${count}</span>
          </label>
        `).join('');
      }

      // 2. Set min/max bounds for price slider
      const priceSlider = document.getElementById('priceRangeSlider');
      const priceMaxValText = document.getElementById('priceRangeMaxText');
      if (priceSlider && this.allOffers.length > 0) {
        const prices = this.allOffers.map(o => o.priceBreakdown.totalAmount);
        const maxP = Math.max(...prices);
        priceSlider.max = Math.ceil(maxP * 1.1);
        priceSlider.value = priceSlider.max;
        this.filters.maxPrice = Number(priceSlider.value);
        if (priceMaxValText) priceMaxValText.textContent = formatMoney(priceSlider.value);
      }

      // 3. Set min/max bounds for duration slider
      const durationSlider = document.getElementById('durationRangeSlider');
      const durationMaxValText = document.getElementById('durationRangeMaxText');
      if (durationSlider && this.allOffers.length > 0) {
        const durations = this.allOffers.map(o => o.getTotalDurationMinutes());
        const maxD = Math.max(...durations);
        durationSlider.max = Math.ceil(maxD * 1.15);
        durationSlider.value = durationSlider.max;
        this.filters.maxDuration = Number(durationSlider.value);
        if (durationMaxValText) durationMaxValText.textContent = formatMinutesToHoursMinutes(durationSlider.value);
      }
    },

    // -----------------------------------------------------------
    // BIND EVENT LISTENERS
    // -----------------------------------------------------------
    bindEvents() {
      // Sort buttons
      const sortBtns = document.querySelectorAll('.sort-tab-btn');
      sortBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          sortBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.currentSort = btn.getAttribute('data-sort') || 'recommended';
          this.applyFiltersAndSort();
        });
      });

      // Stops filter radio buttons
      const stopsInputs = document.querySelectorAll('input[name="filterStops"]');
      stopsInputs.forEach(input => {
        input.addEventListener('change', () => {
          this.filters.stops = input.value;
          this.applyFiltersAndSort();
        });
      });

      // Airline filter checkboxes
      const airlinesListEl = document.getElementById('filterAirlinesList');
      if (airlinesListEl) {
        airlinesListEl.addEventListener('change', (e) => {
          if (e.target && e.target.classList.contains('filter-airline-checkbox')) {
            const val = e.target.value;
            if (e.target.checked) {
              this.filters.selectedAirlines.add(val);
            } else {
              this.filters.selectedAirlines.delete(val);
            }
            this.applyFiltersAndSort();
          }
        });
      }

      // Time slot buttons
      const depTimeBtns = document.querySelectorAll('.dep-time-slot-btn');
      depTimeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          depTimeBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.filters.depTime = btn.getAttribute('data-slot') || 'all';
          this.applyFiltersAndSort();
        });
      });

      const arrTimeBtns = document.querySelectorAll('.arr-time-slot-btn');
      arrTimeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          arrTimeBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.filters.arrTime = btn.getAttribute('data-slot') || 'all';
          this.applyFiltersAndSort();
        });
      });

      // Price slider
      const priceSlider = document.getElementById('priceRangeSlider');
      const priceMaxValText = document.getElementById('priceRangeMaxText');
      if (priceSlider) {
        priceSlider.addEventListener('input', () => {
          this.filters.maxPrice = Number(priceSlider.value);
          if (priceMaxValText) priceMaxValText.textContent = formatMoney(priceSlider.value);
          this.applyFiltersAndSort();
        });
      }

      // Duration slider
      const durationSlider = document.getElementById('durationRangeSlider');
      const durationMaxValText = document.getElementById('durationRangeMaxText');
      if (durationSlider) {
        durationSlider.addEventListener('input', () => {
          this.filters.maxDuration = Number(durationSlider.value);
          if (durationMaxValText) durationMaxValText.textContent = formatMinutesToHoursMinutes(Number(durationSlider.value));
          this.applyFiltersAndSort();
        });
      }

      // Baggage & Refundable checkboxes
      const baggageCheck = document.getElementById('filterBaggageIncluded');
      if (baggageCheck) {
        baggageCheck.addEventListener('change', () => {
          this.filters.checkedBaggageOnly = baggageCheck.checked;
          this.applyFiltersAndSort();
        });
      }

      const refundableCheck = document.getElementById('filterRefundableOnly');
      if (refundableCheck) {
        refundableCheck.addEventListener('change', () => {
          this.filters.refundableOnly = refundableCheck.checked;
          this.applyFiltersAndSort();
        });
      }

      // Reset filters button
      const resetBtn = document.getElementById('btnResetFilters');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => this.resetFilters());
      }

      // Mobile filter drawer toggle
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

    // -----------------------------------------------------------
    // TIME SLOT MATCHING HELPER
    // -----------------------------------------------------------
    matchesTimeSlot(isoString, slot) {
      if (!slot || slot === 'all') return true;
      try {
        const parts = isoString.split('T');
        if (parts.length > 1) {
          const hour = parseInt(parts[1].slice(0, 2), 10);
          if (slot === 'morning') return hour >= 0 && hour < 12;
          if (slot === 'afternoon') return hour >= 12 && hour < 18;
          if (slot === 'evening') return hour >= 18 && hour < 24;
        }
      } catch (_) { }
      return true;
    },

    // -----------------------------------------------------------
    // APPLY FILTERS & DETERMINISTIC SORTING
    // -----------------------------------------------------------
    applyFiltersAndSort() {
      // Handle simulated timeout state
      if (this.searchParams.simulatedState === 'timeout') {
        this.renderTimeoutState();
        return;
      }

      // Handle simulated expired state
      if (this.searchParams.simulatedState === 'expired') {
        this.renderExpiredState();
        return;
      }

      const f = this.filters;
      let results = [...this.allOffers];

      // 1. Stops Filter
      if (f.stops === 'direct') {
        results = results.filter(o => o.isDirect());
      } else if (f.stops === '1stop') {
        results = results.filter(o => o.getStopsCount() === 1);
      } else if (f.stops === '2plus') {
        results = results.filter(o => o.getStopsCount() >= 2);
      }

      // 2. Airlines Filter
      if (f.selectedAirlines.size > 0) {
        results = results.filter(o => f.selectedAirlines.has(o.getCarrierName()));
      }

      // 3. Departure Time Filter
      if (f.depTime !== 'all') {
        results = results.filter(o => this.matchesTimeSlot(o.getDepartureTime(), f.depTime));
      }

      // 4. Arrival Time Filter
      if (f.arrTime !== 'all') {
        results = results.filter(o => this.matchesTimeSlot(o.getArrivalTime(), f.arrTime));
      }

      // 5. Max Duration Filter
      results = results.filter(o => o.getTotalDurationMinutes() <= f.maxDuration);

      // 6. Max Price Filter
      results = results.filter(o => o.priceBreakdown.totalAmount <= f.maxPrice);

      // 7. Checked Baggage Included Filter
      if (f.checkedBaggageOnly) {
        results = results.filter(o => o.baggage.hasCheckedBaggage());
      }

      // 8. Refundable Only Filter
      if (f.refundableOnly) {
        results = results.filter(o => o.fareConditions.isRefundable());
      }

      // Sort results deterministically
      results = FlightSorter.sort(results, this.currentSort);

      this.filteredOffers = results;
      this.renderResults();
    },

    // -----------------------------------------------------------
    // RENDER RESULTS LIST OR EMPTY STATE
    // -----------------------------------------------------------
    renderResults() {
      const container = document.getElementById('flightOffersList');
      const countEl = document.getElementById('resultsCountText');
      const stateCardContainer = document.getElementById('searchStateContainer');

      if (stateCardContainer) stateCardContainer.style.display = 'none';

      if (countEl) {
        countEl.textContent = `Showing ${this.filteredOffers.length} of ${this.allOffers.length} available demo flight offers`;
      }

      if (!container) return;

      if (this.filteredOffers.length === 0) {
        container.innerHTML = `
          <div class="empty-state-card" id="emptyStateBox" role="region" aria-label="No matching flights">
            <div class="empty-state-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </div>
            <h3 class="empty-state-title">No flights match the current criteria</h3>
            <p class="empty-state-desc">
              No flights matched your active filters for stops, airline, price, or departure windows.
              Clear filters to view all scheduled options.
            </p>
            <div class="empty-state-action">
              <button type="button" class="btn-primary" id="btnEmptyResetFilters" onclick="FlightResultsController.resetFilters()">
                <span>Reset all filters</span>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              </button>
            </div>
          </div>
        `;
        return;
      }

      container.innerHTML = this.filteredOffers.map((offer, idx) => this.renderOfferCard(offer, idx)).join('');
    },

    // -----------------------------------------------------------
    // FLIGHT CARD HTML BUILDER
    // -----------------------------------------------------------
    renderOfferCard(offer, index) {
      const stops = offer.getStopsCount();
      const stopsText = stops === 0 ? 'Non-stop' : `${stops} Stop${stops > 1 ? 's' : ''}`;
      const operatingNote = offer.getOperatingCarrierNote();
      const isOvernight = offer.isOvernight();
      const isConnecting = !offer.isDirect();

      return `
        <article class="flight-card" data-offer-id="${offer.id}" id="offerCard_${offer.id}" aria-label="Flight offer from ${offer.getCarrierName()}">
          <!-- Card Header -->
          <div class="flight-card-header">
            <div class="airline-brand-group">
              <div class="airline-logo-box" aria-hidden="true">${offer.getCarrierLogo()}</div>
              <div>
                <h4 class="airline-title">${offer.getCarrierName()}</h4>
                <div class="flight-metadata-sub">
                  <span class="flight-num-tag">${offer.getFlightNumberSummary()}</span>
                  <span class="meta-dot">&bull;</span>
                  <span class="aircraft-tag">${offer.getAircraftSummary()}</span>
                  ${operatingNote ? `<span class="operating-carrier-tag">(${operatingNote})</span>` : ''}
                </div>
              </div>
            </div>

            <div class="flight-badges-group">
              <span class="dest-badge ${stops === 0 ? 'is-direct' : 'is-connecting'}">${stopsText}</span>
              <span class="dest-fare-pill ${offer.fareConditions.isRefundable() ? 'is-refundable' : 'is-nonref'}">
                ${offer.fareConditions.getBadgeLabel()}
              </span>
              <span class="demo-card-tag" title="Demonstration fixture - not a live reservation">Simulated schedule</span>
            </div>
          </div>

          <!-- Card Body: Times, Route & Duration Track -->
          <div class="flight-card-body">
            <!-- Departure Point -->
            <div class="flight-time-point dep-point">
              <div class="point-time">${offer.getDepartureTimeString()}</div>
              <div class="point-city">${offer.getOrigin().city} (${offer.getOrigin().code})</div>
              <div class="point-sub">${offer.getOrigin().airport}</div>
              <div class="point-date">${offer.getDepartureDateString()}</div>
            </div>

            <!-- Duration & Layover Track Line -->
            <div class="flight-duration-col">
              <div class="duration-text">${offer.getFormattedDuration()}</div>
              <div class="flight-track-line ${isConnecting ? 'has-stops' : ''}">
                <span class="track-dot start-dot"></span>
                <span class="track-line"></span>
                ${isConnecting ? '<span class="track-dot stop-dot" title="Layover stop"></span>' : ''}
                <span class="track-dot end-dot"></span>
              </div>
              <div class="stops-text ${isConnecting ? 'text-layover' : ''}">${offer.getLayoverSummary()}</div>
              ${isOvernight ? `<span class="badge-overnight" title="Arrives on next calendar day">+1 Day</span>` : ''}
            </div>

            <!-- Arrival Point -->
            <div class="flight-time-point arr-point">
              <div class="point-time">
                ${offer.getArrivalTimeString()}
                ${isOvernight ? `<span class="overnight-sup">+1d</span>` : ''}
              </div>
              <div class="point-city">${offer.getDestination().city} (${offer.getDestination().code})</div>
              <div class="point-sub">${offer.getDestination().airport}</div>
              <div class="point-date">${offer.getArrivalDateString()}</div>
            </div>
          </div>

          <!-- Connecting Itinerary Accordion (If 1+ stops) -->
          ${isConnecting ? `
            <div class="connecting-accordion-wrapper">
              <button type="button" class="btn-toggle-segments" onclick="FlightResultsController.toggleSegmentDetails('${offer.id}')" aria-expanded="false" id="btnToggleSegments_${offer.id}">
                <span class="accordion-icon">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.3c.4-.2.6-.6.5-1.1z"/></svg>
                </span>
                <span>Flight Details &amp; Layover (${offer.segments.length} Segments)</span>
                <span class="accordion-chevron" aria-hidden="true">▾</span>
              </button>

              <div class="connecting-segments-container" id="segmentsContainer_${offer.id}" style="display: none;">
                ${offer.segments.map((seg, sIdx) => `
                  <div class="segment-timeline-item">
                    <div class="seg-item-header">
                      <strong>Segment ${sIdx + 1}: ${seg.carrierName} (${seg.flightNumber})</strong>
                      <span class="seg-aircraft">${seg.aircraft} &bull; ${seg.cabinClass}</span>
                    </div>
                    <div class="seg-item-times">
                      <span><strong>${seg.getDepartureTimeString()}</strong> ${seg.origin.city} (${seg.origin.code}) — ${seg.origin.terminal}</span>
                      <span class="seg-duration">${seg.getFormattedDuration()}</span>
                      <span><strong>${seg.getArrivalTimeString()}</strong> ${seg.destination.city} (${seg.destination.code}) — ${seg.destination.terminal}</span>
                    </div>
                    ${seg.hasDifferentOperatingCarrier() ? `
                      <div class="seg-operating-note">Note: Operated by <strong>${seg.operatingCarrier.name}</strong></div>
                    ` : ''}
                  </div>

                  ${sIdx < offer.segments.length - 1 && seg.layoverAirport ? `
                    <div class="layover-divider-strip">
                      <span class="layover-icon">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      </span>
                      <span>Layover in <strong>${seg.layoverAirport.city} (${seg.layoverAirport.code})</strong> &bull; ${formatMinutesToHoursMinutes(seg.layoverAfterMinutes)} transit &bull; Baggage checked through</span>
                    </div>
                  ` : ''}
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Card Footer: Baggage, Policy & Price CTA -->
          <div class="flight-card-footer">
            <div class="footer-amenities-group">
              <div class="baggage-pill" title="Included Baggage Allowance">
                ${offer.baggage.formatSummary()}
              </div>
              <div class="fare-family-pill" title="Fare Brand Family">
                ${offer.fareConditions.fareFamily}
              </div>
            </div>

            <div class="price-cta-group">
              <div class="price-box">
                <span class="price-label">Total per passenger</span>
                <span class="price-val">${offer.priceBreakdown.getFormattedTotal()}</span>
                <span class="price-sub-note">Simulated fare &bull; Not bookable</span>
              </div>
              <a href="/flights/offer/${offer.id}" class="btn-primary btn-select-offer" id="btnSelectOffer_${offer.id}" title="View demo offer breakdown (does not create booking)">
                <span>Select Offer</span>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </a>
            </div>
          </div>
        </article>
      `;
    },

    // -----------------------------------------------------------
    // SEGMENT ACCORDION TOGGLE
    // -----------------------------------------------------------
    toggleSegmentDetails(offerId) {
      const container = document.getElementById(`segmentsContainer_${offerId}`);
      const btn = document.getElementById(`btnToggleSegments_${offerId}`);
      if (!container || !btn) return;

      const isHidden = container.style.display === 'none';
      container.style.display = isHidden ? 'block' : 'none';
      btn.setAttribute('aria-expanded', String(isHidden));
      btn.classList.toggle('is-open', isHidden);
    },

    // -----------------------------------------------------------
    // SIMULATED STATES: TIMEOUT & EXPIRED
    // -----------------------------------------------------------
    renderTimeoutState() {
      const container = document.getElementById('flightOffersList');
      if (!container) return;

      container.innerHTML = `
        <div class="error-banner-card alert-error" id="timeoutStateBox" role="alert" style="padding: 24px;">
          <div class="error-banner-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div class="error-banner-body">
            <strong class="error-banner-title" style="font-size: 1.1rem;">Provider response timed out</strong>
            <p class="error-banner-message" style="margin: 8px 0 16px;">
              The simulated flight schedule query timed out. You can retry the search or return to the search form.
            </p>
            <div style="display: flex; gap: 12px; align-items: center;">
              <button type="button" class="btn-primary" onclick="FlightResultsController.clearSimulatedState()">
                <span>Retry search</span>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              </button>
              <a href="/" class="btn-secondary-sm">Return to search form</a>
            </div>
          </div>
        </div>
      `;
    },

    renderExpiredState() {
      const container = document.getElementById('flightOffersList');
      if (!container) return;

      container.innerHTML = `
        <div class="alert alert-warning" id="expiredStateBox" role="alert" style="padding: 24px; border-left: 4px solid var(--border-medium);">
          <div style="margin-bottom: 8px;">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <h3 style="font-size: 1.1rem; font-weight: 600; color: var(--text-main); margin-bottom: 8px;">Offer expired</h3>
          <p style="color: var(--text-secondary); margin-bottom: 16px;">
            The flight offer you inspected has expired. Please refresh to load updated schedules and fares.
          </p>
          <button type="button" class="btn-primary" onclick="FlightResultsController.clearSimulatedState()">
            <span>Refresh offers</span>
          </button>
        </div>
      `;
    },

    clearSimulatedState() {
      this.searchParams.simulatedState = 'normal';
      this.loadOffers();
      this.applyFiltersAndSort();
    },

    // -----------------------------------------------------------
    // RESET ALL FILTERS
    // -----------------------------------------------------------
    resetFilters() {
      this.filters.stops = 'all';
      this.filters.selectedAirlines.clear();
      this.filters.depTime = 'all';
      this.filters.arrTime = 'all';
      this.filters.checkedBaggageOnly = false;
      this.filters.refundableOnly = false;

      // Reset DOM inputs
      const allStops = document.querySelector('input[name="filterStops"][value="all"]');
      if (allStops) allStops.checked = true;

      const airlineChecks = document.querySelectorAll('.filter-airline-checkbox');
      airlineChecks.forEach(c => c.checked = false);

      const depBtns = document.querySelectorAll('.dep-time-slot-btn');
      depBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-slot') === 'all'));

      const arrBtns = document.querySelectorAll('.arr-time-slot-btn');
      arrBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-slot') === 'all'));

      const baggageCheck = document.getElementById('filterBaggageIncluded');
      if (baggageCheck) baggageCheck.checked = false;

      const refundableCheck = document.getElementById('filterRefundableOnly');
      if (refundableCheck) refundableCheck.checked = false;

      const priceSlider = document.getElementById('priceRangeSlider');
      if (priceSlider && priceSlider.max) {
        priceSlider.value = priceSlider.max;
        this.filters.maxPrice = Number(priceSlider.max) || 200000;
        const text = document.getElementById('priceRangeMaxText');
        if (text) text.textContent = formatMoney(this.filters.maxPrice);
      } else {
        this.filters.maxPrice = 200000;
      }

      const durationSlider = document.getElementById('durationRangeSlider');
      if (durationSlider && durationSlider.max) {
        durationSlider.value = durationSlider.max;
        this.filters.maxDuration = Number(durationSlider.max) || 1440;
        const text = document.getElementById('durationRangeMaxText');
        if (text) text.textContent = formatMinutesToHoursMinutes(this.filters.maxDuration);
      } else {
        this.filters.maxDuration = 1440;
      }

      this.applyFiltersAndSort();
    }
  };

  // Auto-init in browser if DOM ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => FlightResultsController.init());
    } else {
      setTimeout(() => FlightResultsController.init(), 0);
    }
  }

  return FlightResultsController;
}));
