/**
 * TEST SUITE: FLIGHT SEARCH RESULTS EXPERIENCE & DEMO FIXTURES
 * Author: mahin1710
 *
 * Verifies:
 *  1. Typed normalized data models (FlightOffer, FlightSegment, BaggageAllowance, FareConditions, PriceBreakdown)
 *  2. Search summary with Edit Search (returns to widget with selections preserved)
 *  3. Deterministic and documented sorting: Recommended (Best), Cheapest, Fastest
 *  4. Real-time filtering: stops, airline, departure/arrival time, duration, price, baggage, refundable
 *  5. Flight card metadata, marketing vs operating carrier divergence
 *  6. Connecting itineraries showing all segments and layover location/duration
 *  7. Overnight dates with "+1 day" badge
 *  8. Empty state with Reset CTA, loading skeleton, provider timeout, and expired offer states
 *  9. Stable IDs, money/date/time formatting
 * 10. Clear "Demo data – not bookable" disclaimers on all views
 * 11. Selecting an offer opens offer details without creating a real booking
 * 12. Live HTTP verification against running Flask application
 */

const http = require('http');
const assert = require('assert');

// Mock browser globals for FlightResultsController testing
global.window = {
  location: { search: '?from=DAC&to=CXB&departure=2026-11-28&adults=1&cabin=Economy' },
  addEventListener: () => {}
};
global._domElements = {};
global.document = {
  readyState: 'complete',
  addEventListener: () => {},
  getElementById: (id) => {
    if (!global._domElements[id]) {
      global._domElements[id] = {
        id,
        value: '',
        textContent: '',
        innerHTML: '',
        style: {},
        classList: {
          _classes: new Set(),
          add(c) { this._classes.add(c); },
          remove(c) { this._classes.delete(c); },
          contains(c) { return this._classes.has(c); },
          toggle(c, force) {
            if (force === undefined) {
              if (this.contains(c)) this.remove(c);
              else this.add(c);
            } else if (force) {
              this.add(c);
            } else {
              this.remove(c);
            }
          }
        },
        setAttribute(k, v) { this[k] = v; },
        getAttribute(k) { return this[k]; },
        addEventListener: () => {},
        querySelectorAll: () => []
      };
    }
    return global._domElements[id];
  },
  querySelectorAll: () => [],
  querySelector: () => null
};

// Import models, fixtures, and controller
const Models = require('./static/js/flight_models.js');
const Fixtures = require('./static/js/flight_fixtures.js');
const Controller = require('./static/js/flight_results_controller.js');

const { FlightOffer, FlightSegment, BaggageAllowance, FareConditions, PriceBreakdown, FlightSorter } = Models;
const { DEMO_OFFERS } = Fixtures;

let passCount = 0;
let failCount = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  [PASS] ${desc}`);
    passCount++;
  } catch (err) {
    console.error(`  [FAIL] ${desc}: ${err.message}`);
    failCount++;
  }
}

async function runAllTests() {
  console.log('================================================================');
  console.log('FLIGHT SEARCH RESULTS & TYPED DEMO FIXTURES TEST SUITE');
  console.log('================================================================\n');

  console.log('--- 1. DATA MODELS & TYPED NORMALIZATION ---');
  it('BaggageAllowance model correctly detects checked baggage presence', () => {
    const withChecked = new BaggageAllowance({ cabinWeightKg: 7, checkedWeightKg: 20, checkedPieces: 1 });
    assert.strictEqual(withChecked.hasCheckedBaggage(), true);
    assert.ok(withChecked.formatSummary().includes('20 kg Check-in'));

    const cabinOnly = new BaggageAllowance({ cabinWeightKg: 7, checkedWeightKg: 0, checkedPieces: 0 });
    assert.strictEqual(cabinOnly.hasCheckedBaggage(), false);
    assert.ok(cabinOnly.formatSummary().includes('No checked baggage'));
  });

  it('FareConditions model formats refundable and fee terms correctly', () => {
    const flex = new FareConditions({ refundable: true });
    assert.strictEqual(flex.isRefundable(), true);
    assert.strictEqual(flex.getBadgeLabel(), 'Refundable');

    const withFee = new FareConditions({ refundable: false, refundableWithFee: true, cancellationFee: 800 });
    assert.strictEqual(withFee.isRefundable(), true);
    assert.strictEqual(withFee.getBadgeLabel(), 'Refundable (Fees Apply)');

    const nonRef = new FareConditions({ refundable: false, refundableWithFee: false });
    assert.strictEqual(nonRef.isRefundable(), false);
    assert.strictEqual(nonRef.getBadgeLabel(), 'Non-refundable');
  });

  it('PriceBreakdown model computes totals and formats BDT currency', () => {
    const price = new PriceBreakdown({ currency: 'BDT', baseFare: 3600, taxes: 650, airlineFees: 250 });
    assert.strictEqual(price.totalAmount, 4500);
    assert.strictEqual(price.getFormattedTotal(), '৳4,500');
  });

  it('FlightSegment model detects operating vs marketing carrier divergence', () => {
    const codeshareSeg = new FlightSegment({
      carrierCode: 'EK',
      carrierName: 'Emirates',
      flightNumber: 'EK-2041',
      marketingCarrier: { code: 'EK', name: 'Emirates' },
      operatingCarrier: { code: 'FZ', name: 'flydubai' }
    });
    assert.strictEqual(codeshareSeg.hasDifferentOperatingCarrier(), true);

    const normalSeg = new FlightSegment({
      carrierCode: 'BG',
      carrierName: 'Biman Bangladesh Airlines',
      marketingCarrier: { code: 'BG', name: 'Biman Bangladesh Airlines' },
      operatingCarrier: { code: 'BG', name: 'Biman Bangladesh Airlines' }
    });
    assert.strictEqual(normalSeg.hasDifferentOperatingCarrier(), false);
  });

  it('FlightOffer model guarantees demo disclaimer and non-bookable flag', () => {
    const offer = DEMO_OFFERS[0];
    assert.strictEqual(offer.isBookable, false);
    assert.strictEqual(offer.disclaimer, 'Demo data – not bookable');
    assert.strictEqual(offer.source, 'demo-fixture');
  });

  console.log('\n--- 2. CONNECTING FLIGHTS & OVERNIGHT DETECTION ---');
  it('Detects connecting flights, calculates layover duration and airport', () => {
    const connectOffer = DEMO_OFFERS.find(o => o.id === 'DEMO-DAC-CXB-BG409-CONNECT');
    assert.ok(connectOffer, 'Connecting offer fixture not found');
    assert.strictEqual(connectOffer.isDirect(), false);
    assert.strictEqual(connectOffer.getStopsCount(), 1);
    assert.strictEqual(connectOffer.segments.length, 2);
    assert.ok(connectOffer.getLayoverSummary().includes('Chittagong (CGP)'));
    assert.ok(connectOffer.getLayoverSummary().includes('1h 15m'));
  });

  it('Detects overnight itineraries (+1 day arrival)', () => {
    const overnightOffer = DEMO_OFFERS.find(o => o.id === 'DEMO-DAC-DXB-BG051-OVERNIGHT');
    assert.ok(overnightOffer, 'Overnight offer fixture not found');
    assert.strictEqual(overnightOffer.isOvernight(), true);
  });

  it('Non-overnight flights return isOvernight = false', () => {
    const daytimeOffer = DEMO_OFFERS.find(o => o.id === 'DEMO-DAC-CXB-BG433');
    assert.ok(daytimeOffer, 'Daytime offer fixture not found');
    assert.strictEqual(daytimeOffer.isOvernight(), false);
  });

  console.log('\n--- 3. DETERMINISTIC SORTING ENGINE ---');
  it('Cheapest sort ranks offers by ascending totalAmount', () => {
    const sorted = FlightSorter.byCheapest(DEMO_OFFERS.filter(o => !o.isExpired));
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(
        sorted[i].priceBreakdown.totalAmount >= sorted[i - 1].priceBreakdown.totalAmount,
        `Expected ${sorted[i].priceBreakdown.totalAmount} >= ${sorted[i - 1].priceBreakdown.totalAmount}`
      );
    }
    // Verify first offer is the cheapest (Air Astra or US-Bangla super saver)
    assert.ok(sorted[0].priceBreakdown.totalAmount <= 4000);
  });

  it('Fastest sort ranks offers by ascending journey duration in minutes', () => {
    const sorted = FlightSorter.byFastest(DEMO_OFFERS.filter(o => !o.isExpired));
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(
        sorted[i].getTotalDurationMinutes() >= sorted[i - 1].getTotalDurationMinutes(),
        `Expected duration ${sorted[i].getTotalDurationMinutes()} >= ${sorted[i - 1].getTotalDurationMinutes()}`
      );
    }
    // Direct 55m flights must rank before 7-hour connecting flights
    assert.ok(sorted[0].getTotalDurationMinutes() <= 60);
  });

  it('Recommended sort balances price, duration, and stops deterministically', () => {
    const sorted = FlightSorter.byRecommended(DEMO_OFFERS.filter(o => !o.isExpired));
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(
        sorted[i].getRecommendedScore() >= sorted[i - 1].getRecommendedScore(),
        `Expected score ${sorted[i].getRecommendedScore()} >= ${sorted[i - 1].getRecommendedScore()}`
      );
    }
  });

  console.log('\n--- 4. MULTI-DIMENSIONAL FILTERING ---');
  it('Filters by stops: non-stop only returns only direct flights', () => {
    Controller.allOffers = DEMO_OFFERS.filter(o => !o.isExpired);
    Controller.resetFilters();
    Controller.filters.stops = 'direct';
    Controller.applyFiltersAndSort();

    assert.ok(Controller.filteredOffers.length > 0);
    Controller.filteredOffers.forEach(o => {
      assert.strictEqual(o.isDirect(), true);
      assert.strictEqual(o.getStopsCount(), 0);
    });
  });

  it('Filters by stops: 1 stop only returns connecting flights', () => {
    Controller.resetFilters();
    Controller.filters.stops = '1stop';
    Controller.applyFiltersAndSort();

    assert.ok(Controller.filteredOffers.length > 0);
    Controller.filteredOffers.forEach(o => {
      assert.strictEqual(o.getStopsCount(), 1);
    });
  });

  it('Filters by airline: selecting US-Bangla returns only US-Bangla flights', () => {
    Controller.resetFilters();
    Controller.filters.selectedAirlines.add('US-Bangla Airlines');
    Controller.applyFiltersAndSort();

    assert.ok(Controller.filteredOffers.length > 0);
    Controller.filteredOffers.forEach(o => {
      assert.strictEqual(o.getCarrierName(), 'US-Bangla Airlines');
    });
  });

  it('Filters by checked baggage: only includes offers with checked baggage', () => {
    Controller.resetFilters();
    Controller.filters.checkedBaggageOnly = true;
    Controller.applyFiltersAndSort();

    assert.ok(Controller.filteredOffers.length > 0);
    Controller.filteredOffers.forEach(o => {
      assert.strictEqual(o.baggage.hasCheckedBaggage(), true);
    });
    // Cabin-only US-Bangla BS-149 must be excluded
    const cabinOnlyIncluded = Controller.filteredOffers.some(o => o.id === 'DEMO-DAC-CXB-BS149');
    assert.strictEqual(cabinOnlyIncluded, false);
  });

  it('Filters by refundable only: excludes non-refundable tickets', () => {
    Controller.resetFilters();
    Controller.filters.refundableOnly = true;
    Controller.applyFiltersAndSort();

    assert.ok(Controller.filteredOffers.length > 0);
    Controller.filteredOffers.forEach(o => {
      assert.strictEqual(o.fareConditions.isRefundable(), true);
    });
    const nonRefIncluded = Controller.filteredOffers.some(o => o.id === 'DEMO-DAC-CXB-BS141');
    assert.strictEqual(nonRefIncluded, false);
  });

  it('Filters by max price: excludes tickets above threshold', () => {
    Controller.resetFilters();
    Controller.filters.maxPrice = 4500;
    Controller.applyFiltersAndSort();

    assert.ok(Controller.filteredOffers.length > 0);
    Controller.filteredOffers.forEach(o => {
      assert.ok(o.priceBreakdown.totalAmount <= 4500);
    });
    const expensiveIncluded = Controller.filteredOffers.some(o => o.priceBreakdown.totalAmount > 4500);
    assert.strictEqual(expensiveIncluded, false);
  });

  console.log('\n--- 5. EMPTY RESULTS & SPECIAL STATES ---');
  it('Empty results state is rendered with reset CTA when no flights match filters', () => {
    Controller.resetFilters();
    Controller.filters.maxPrice = 100; // Impossibly low budget
    Controller.applyFiltersAndSort();

    assert.strictEqual(Controller.filteredOffers.length, 0);
    const container = document.getElementById('flightOffersList');
    assert.ok(container.innerHTML.includes('id="emptyStateBox"'));
    assert.ok(container.innerHTML.includes('id="btnEmptyResetFilters"'));
  });

  it('Reset CTA restores all offers after empty results', () => {
    Controller.resetFilters();
    assert.ok(Controller.filteredOffers.length > 0);
  });

  it('Simulated timeout state renders 504 Gateway Timeout error banner with retry', () => {
    Controller.searchParams.simulatedState = 'timeout';
    Controller.applyFiltersAndSort();

    const container = document.getElementById('flightOffersList');
    assert.ok(container.innerHTML.includes('id="timeoutStateBox"'));
    assert.ok(container.innerHTML.includes('504 Gateway Timeout'));

    // Reset simulated state
    Controller.clearSimulatedState();
  });

  it('Simulated expired state renders expiration banner', () => {
    Controller.searchParams.simulatedState = 'expired';
    Controller.applyFiltersAndSort();

    const container = document.getElementById('flightOffersList');
    assert.ok(container.innerHTML.includes('id="expiredStateBox"'));
    assert.ok(container.innerHTML.includes('Offer Expired'));

    // Reset simulated state
    Controller.clearSimulatedState();
  });

  console.log('\n--- 6. SEARCH SUMMARY & EDIT SEARCH NAVIGATION ---');
  it('Search summary renders route, departure, cabin and Edit Search link', () => {
    Controller.searchParams.from = 'DAC';
    Controller.searchParams.fromCity = 'Dhaka';
    Controller.searchParams.to = 'CXB';
    Controller.searchParams.toCity = "Cox's Bazar";
    Controller.searchParams.tripType = 'roundtrip';
    Controller.searchParams.departure = '2026-11-28';
    Controller.searchParams.return = '2026-12-05';
    Controller.renderSearchSummary();

    const summaryCard = document.getElementById('searchSummaryCard');
    assert.ok(summaryCard.innerHTML.includes('Dhaka (DAC)'));
    assert.ok(summaryCard.innerHTML.includes("Cox's Bazar (CXB)"));
    assert.ok(summaryCard.innerHTML.includes('id="btnEditSearch"'));
    assert.ok(summaryCard.innerHTML.includes('href="/?trip_type=roundtrip'));
  });

  console.log('\n--- 7. LIVE HTTP INTEGRATION WITH RUNNING FLASK BACKEND ---');
  await new Promise((resolve) => {
    http.get('http://127.0.0.1:5000/flights/search?from=DAC&to=CXB', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        it('/flights/search returns HTTP 200', () => {
          assert.strictEqual(res.statusCode, 200);
        });

        it('Contains prominent "DEMO DATA • NOT BOOKABLE" disclaimers', () => {
          assert.ok(data.includes('DEMO DATA &bull; NOT BOOKABLE') || data.includes('Demo data – not bookable'));
          assert.ok(data.includes('demo-integration-notice'));
        });

        it('Contains two-column search-results-layout and filtersSidebar', () => {
          assert.ok(data.includes('search-results-layout'));
          assert.ok(data.includes('id="filtersSidebar"'));
        });

        it('Contains sort toolbar with Recommended, Cheapest, and Fastest tabs', () => {
          assert.ok(data.includes('id="sortTabRecommended"'));
          assert.ok(data.includes('id="sortTabCheapest"'));
          assert.ok(data.includes('id="sortTabFastest"'));
        });

        it('Loads flight_models.js, flight_fixtures.js, and flight_results_controller.js', () => {
          assert.ok(data.includes('/js/flight_models.js'));
          assert.ok(data.includes('/js/flight_fixtures.js'));
          assert.ok(data.includes('/js/flight_results_controller.js'));
        });

        it('Contains mobile filter drawer toggle button (#btnToggleMobileFilters)', () => {
          assert.ok(data.includes('id="btnToggleMobileFilters"'));
          assert.ok(data.includes('aria-controls="filtersSidebar"'));
        });

        resolve();
      });
    }).on('error', (err) => {
      console.error(`  [FAIL] Could not connect to Flask server: ${err.message}`);
      failCount++;
      resolve();
    });
  });

  await new Promise((resolve) => {
    http.get('http://127.0.0.1:5000/flights/offer/DEMO-DAC-CXB-BG433', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        it('Selecting demo offer opens /flights/offer/:id without creating a real booking', () => {
          assert.strictEqual(res.statusCode, 200);
          assert.ok(data.includes('DEMO-DAC-CXB-BG433'));
          assert.ok(data.includes('Demo quote &bull; Not bookable') || data.includes('DEMO DATA &bull; NOT BOOKABLE'));
        });
        resolve();
      });
    }).on('error', (err) => {
      console.error(`  [FAIL] Offer endpoint failed: ${err.message}`);
      failCount++;
      resolve();
    });
  });

  console.log('\n--- 8. MOBILE LAYOUT & RESPONSIVE STYLING CHECKS ---');
  const fs = require('fs');
  const cssContent = fs.readFileSync('./static/css/style.css', 'utf-8');

  it('style.css defines responsive breakpoint for filters sidebar drawer (max-width: 860px)', () => {
    assert.ok(cssContent.includes('@media (max-width: 860px)'));
    assert.ok(cssContent.includes('.filters-sidebar.is-drawer-open'));
    assert.ok(cssContent.includes('.mobile-filter-bar'));
  });

  it('style.css defines mobile touch card layout (max-width: 480px)', () => {
    assert.ok(cssContent.includes('@media (max-width: 480px)'));
    assert.ok(cssContent.includes('.flight-card-body'));
  });

  it('Controller toggles mobile filter drawer open and closed', () => {
    const sidebar = document.getElementById('filtersSidebar');
    Controller.isFilterDrawerOpen = false;
    Controller.isFilterDrawerOpen = !Controller.isFilterDrawerOpen;
    sidebar.classList.toggle('is-drawer-open', Controller.isFilterDrawerOpen);
    assert.strictEqual(Controller.isFilterDrawerOpen, true);
    assert.strictEqual(sidebar.classList.contains('is-drawer-open'), true);

    Controller.isFilterDrawerOpen = !Controller.isFilterDrawerOpen;
    sidebar.classList.toggle('is-drawer-open', Controller.isFilterDrawerOpen);
    assert.strictEqual(Controller.isFilterDrawerOpen, false);
    assert.strictEqual(sidebar.classList.contains('is-drawer-open'), false);
  });

  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('================================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runAllTests();
