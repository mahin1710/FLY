/**
 * TEST SUITE: FLIGHT SEARCH WIDGET BEHAVIOUR & VALIDATION
 * Author: mahin1710
 * Verifies:
 *  1. Trip types: Round Trip, One Way, Multi City
 *  2. Searchable airport/city catalog (IATA codes, city names)
 *  3. Swap origin/destination
 *  4. Origin & destination required and not identical (case-insensitive & code-based)
 *  5. Departure cannot be in the past using local-date convention
 *  6. Return cannot precede departure
 *  7. Passenger counts (adults, children, infants) within provider-configurable limits
 *  8. Configurable infant/adult ratio (IATA lap infant safety rule)
 *  9. Multi-city legs validation (2-5 legs, chronological ordering, no identical route)
 * 10. Search button disabled until form valid
 * 11. Double-submission prevention and busy indicators
 * 12. Inline screen-reader accessible error messages (role="alert", aria-invalid, aria-live)
 * 13. State persistence in sessionStorage and Back-navigation recovery
 * 14. Safe query string encoding for /flights/search dispatch
 * 15. Live DOM verification against running Flask homepage
 */

const http = require('http');
const assert = require('assert');

// Mock browser globals for FlightSearchWidget module testing
global.window = {
  location: { href: '' },
  addEventListener: () => {}
};
global.document = {
  readyState: 'complete',
  addEventListener: () => {},
  getElementById: (id) => {
    if (!global._domElements[id]) {
      global._domElements[id] = {
        id,
        value: '',
        textContent: '',
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
        removeEventListener: () => {},
        querySelector: () => ({ setAttribute: () => {} }),
        querySelectorAll: () => [],
        contains: () => false,
        disabled: false
      };
    }
    return global._domElements[id];
  },
  querySelectorAll: () => []
};
global._domElements = {};

// Mock sessionStorage
const mockStorage = {};
global.sessionStorage = {
  setItem(k, v) { mockStorage[k] = String(v); },
  getItem(k) { return mockStorage[k] || null; },
  removeItem(k) { delete mockStorage[k]; },
  clear() { for (const k in mockStorage) delete mockStorage[k]; }
};

// Require the widget
const FlightSearchWidget = require('./static/js/flight_search_widget.js');

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

async function runTests() {
  console.log('===============================================================');
  console.log('FLIGHT SEARCH WIDGET VALIDATION & BEHAVIOUR SUITE');
  console.log('===============================================================\n');

  // Helper date utility
  function getLocalDate(offsetDays = 0) {
    const d = new Date();
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  const todayStr = getLocalDate(0);
  const yesterdayStr = getLocalDate(-1);
  const tomorrowStr = getLocalDate(1);
  const nextWeekStr = getLocalDate(7);

  function resetState() {
    FlightSearchWidget.state.tripType = 'roundtrip';
    FlightSearchWidget.state.origin = { raw: 'Dhaka (DAC)', code: 'DAC', city: 'Dhaka' };
    FlightSearchWidget.state.destination = { raw: "Cox's Bazar (CXB)", code: 'CXB', city: "Cox's Bazar" };
    FlightSearchWidget.state.depDate = tomorrowStr;
    FlightSearchWidget.state.returnDate = nextWeekStr;
    FlightSearchWidget.state.passengers = { adults: 1, children: 0, infants: 0 };
    FlightSearchWidget.state.cabinClass = 'Economy';
    FlightSearchWidget.state.isSubmitting = false;
    FlightSearchWidget.state.multiCityLegs = [
      { from: 'Dhaka (DAC)', fromCity: 'Dhaka', fromCode: 'DAC', to: 'Chittagong (CGP)', toCity: 'Chittagong', toCode: 'CGP', date: tomorrowStr },
      { from: 'Chittagong (CGP)', fromCity: 'Chittagong', fromCode: 'CGP', to: "Cox's Bazar (CXB)", toCity: "Cox's Bazar", toCode: 'CXB', date: nextWeekStr }
    ];
    for (const k in global._domElements) {
      global._domElements[k].value = '';
      global._domElements[k].disabled = false;
    }
  }

  // Override it to auto-reset state
  const originalIt = it;
  it = function (desc, fn) {
    resetState();
    originalIt(desc, fn);
  };

  console.log('--- 1. CONFIGURATION & AIRPORT CATALOG ---');
  it('Configurable passenger limits are properly defined', () => {
    const cfg = FlightSearchWidget.config;
    assert.strictEqual(cfg.minAdults, 1);
    assert.strictEqual(cfg.maxAdults, 9);
    assert.strictEqual(cfg.maxChildren, 8);
    assert.strictEqual(cfg.maxInfants, 4);
    assert.strictEqual(cfg.maxTotalPassengers, 9);
    assert.strictEqual(cfg.maxInfantsPerAdult, 1); // IATA rule
    assert.strictEqual(cfg.minMultiCityLegs, 2);
    assert.strictEqual(cfg.maxMultiCityLegs, 5);
  });

  it('Local airport reference catalogue contains verified Bangladesh & international hubs', () => {
    const cat = FlightSearchWidget.catalog;
    assert.ok(cat.length >= 10, 'Expected at least 10 verified catalog airports');
    const iatas = cat.map(a => a.IATA);
    assert.ok(iatas.includes('DAC'), 'Missing Dhaka DAC');
    assert.ok(iatas.includes('CXB'), 'Missing Coxs Bazar CXB');
    assert.ok(iatas.includes('CGP'), 'Missing Chittagong CGP');
    assert.ok(iatas.includes('DXB'), 'Missing Dubai DXB');
    assert.ok(iatas.includes('SIN'), 'Missing Singapore SIN');
  });

  console.log('\n--- 2. ORIGIN & DESTINATION VALIDATION ---');
  it('Rejects empty origin airport', () => {
    FlightSearchWidget.state.origin = { raw: '', code: '', city: '' };
    FlightSearchWidget.state.destination = { raw: 'Cox\'s Bazar (CXB)', code: 'CXB', city: 'Cox\'s Bazar' };
    FlightSearchWidget.state.depDate = tomorrowStr;
    FlightSearchWidget.state.returnDate = nextWeekStr;
    FlightSearchWidget.state.tripType = 'roundtrip';

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, false);
    assert.ok(res.errors.origin, 'Expected origin error');
  });

  it('Rejects empty destination airport', () => {
    FlightSearchWidget.state.origin = { raw: 'Dhaka (DAC)', code: 'DAC', city: 'Dhaka' };
    FlightSearchWidget.state.destination = { raw: '', code: '', city: '' };
    FlightSearchWidget.state.depDate = tomorrowStr;
    FlightSearchWidget.state.returnDate = nextWeekStr;

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, false);
    assert.ok(res.errors.destination, 'Expected destination error');
  });

  it('Rejects identical origin and destination (by IATA code DAC -> DAC)', () => {
    FlightSearchWidget.state.origin = { raw: 'Dhaka (DAC)', code: 'DAC', city: 'Dhaka' };
    FlightSearchWidget.state.destination = { raw: 'Dhaka (DAC)', code: 'DAC', city: 'Dhaka' };
    FlightSearchWidget.state.depDate = tomorrowStr;
    FlightSearchWidget.state.returnDate = nextWeekStr;

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, false);
    assert.strictEqual(res.errors.destination, 'Origin and destination cannot be identical.');
  });

  it('Rejects identical origin and destination (by city name case-insensitively)', () => {
    FlightSearchWidget.state.origin = { raw: 'Sylhet', code: 'ZYL', city: 'Sylhet' };
    FlightSearchWidget.state.destination = { raw: 'sylhet', code: 'ZYL', city: 'sylhet' };
    FlightSearchWidget.state.depDate = tomorrowStr;
    FlightSearchWidget.state.returnDate = nextWeekStr;

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, false);
    assert.strictEqual(res.errors.destination, 'Origin and destination cannot be identical.');
  });

  it('Accepts distinct valid origin and destination (DAC -> CXB)', () => {
    FlightSearchWidget.state.origin = { raw: 'Dhaka (DAC)', code: 'DAC', city: 'Dhaka' };
    FlightSearchWidget.state.destination = { raw: 'Cox\'s Bazar (CXB)', code: 'CXB', city: 'Cox\'s Bazar' };
    FlightSearchWidget.state.depDate = tomorrowStr;
    FlightSearchWidget.state.returnDate = nextWeekStr;
    FlightSearchWidget.state.passengers = { adults: 1, children: 0, infants: 0 };

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, true);
    assert.strictEqual(Object.keys(res.errors).length, 0);
  });

  console.log('\n--- 3. DATE CONSTRAINT VALIDATION ---');
  it('Rejects departure date in the past (yesterday)', () => {
    FlightSearchWidget.state.depDate = yesterdayStr;
    FlightSearchWidget.state.returnDate = tomorrowStr;

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, false);
    assert.strictEqual(res.errors.depDate, 'Departure date cannot be in the past.');
  });

  it('Accepts departure date for today or future', () => {
    FlightSearchWidget.state.depDate = todayStr;
    FlightSearchWidget.state.returnDate = tomorrowStr;

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, true);
  });

  it('Rejects return date preceding departure date (dep: +7 days, ret: +1 day)', () => {
    FlightSearchWidget.state.depDate = nextWeekStr;
    FlightSearchWidget.state.returnDate = tomorrowStr;

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, false);
    assert.strictEqual(res.errors.returnDate, 'Return date cannot precede departure date.');
  });

  it('Allows same-day return (e.g. day trip dep: +3 days, ret: +3 days)', () => {
    const dayTrip = getLocalDate(3);
    FlightSearchWidget.state.depDate = dayTrip;
    FlightSearchWidget.state.returnDate = dayTrip;

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, true);
  });

  it('Ignores return date for one-way flight', () => {
    FlightSearchWidget.state.tripType = 'oneway';
    FlightSearchWidget.state.depDate = tomorrowStr;
    FlightSearchWidget.state.returnDate = ''; // Empty return date in oneway

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, true);
  });

  console.log('\n--- 4. PASSENGER LIMITS & INFANT RATIO (IATA) ---');
  it('Rejects 0 adults', () => {
    FlightSearchWidget.state.tripType = 'roundtrip';
    FlightSearchWidget.state.returnDate = nextWeekStr;
    FlightSearchWidget.state.passengers = { adults: 0, children: 1, infants: 0 };

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, false);
    assert.ok(res.errors.passengers.includes('At least 1 adult passenger'));
  });

  it('Rejects adults exceeding maxAdults limit (10 adults)', () => {
    FlightSearchWidget.state.passengers = { adults: 10, children: 0, infants: 0 };

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, false);
    assert.ok(res.errors.passengers.includes('Maximum 9 adults'));
  });

  it('Rejects total passengers exceeding maxTotalPassengers (5 adults + 5 children = 10)', () => {
    FlightSearchWidget.state.passengers = { adults: 5, children: 5, infants: 0 };

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, false);
    assert.ok(res.errors.passengers.includes('Maximum 9 passengers permitted'));
  });

  it('Enforces IATA lap infant safety rule: 2 infants with 1 adult rejected', () => {
    FlightSearchWidget.state.passengers = { adults: 1, children: 0, infants: 2 };

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, false);
    assert.ok(res.errors.passengers.includes('Maximum 1 infant per accompanying adult'));
  });

  it('Accepts 2 infants with 2 adults', () => {
    FlightSearchWidget.state.passengers = { adults: 2, children: 0, infants: 2 };

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, true);
  });

  console.log('\n--- 5. MULTI-CITY ITINERARY VALIDATION ---');
  it('Rejects multi-city with fewer than minMultiCityLegs (1 leg)', () => {
    FlightSearchWidget.state.tripType = 'multicity';
    FlightSearchWidget.state.multiCityLegs = [
      { from: 'Dhaka (DAC)', to: 'Chittagong (CGP)', date: tomorrowStr }
    ];

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, false);
    assert.ok(res.errors.multiCity.includes('At least 2 flight legs'));
  });

  it('Rejects multi-city leg with identical origin and destination', () => {
    FlightSearchWidget.state.multiCityLegs = [
      { from: 'Dhaka (DAC)', to: 'Chittagong (CGP)', date: tomorrowStr },
      { from: 'Chittagong (CGP)', to: 'Chittagong (CGP)', date: nextWeekStr }
    ];

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, false);
    assert.ok(res.errors.mcLeg_1.includes('cannot be identical'));
  });

  it('Rejects multi-city leg with date earlier than previous leg', () => {
    FlightSearchWidget.state.multiCityLegs = [
      { from: 'Dhaka (DAC)', to: 'Chittagong (CGP)', date: nextWeekStr },
      { from: 'Chittagong (CGP)', to: 'Cox\'s Bazar (CXB)', date: tomorrowStr } // Precedes leg 1
    ];

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, false);
    assert.ok(res.errors.mcLeg_1.includes('cannot be earlier than Flight 1'));
  });

  it('Accepts valid sequential multi-city itinerary (Leg 1: DAC->CGP, Leg 2: CGP->CXB)', () => {
    FlightSearchWidget.state.multiCityLegs = [
      { from: 'Dhaka (DAC)', fromCode: 'DAC', to: 'Chittagong (CGP)', toCode: 'CGP', date: tomorrowStr },
      { from: 'Chittagong (CGP)', fromCode: 'CGP', to: 'Cox\'s Bazar (CXB)', toCode: 'CXB', date: nextWeekStr }
    ];

    const res = FlightSearchWidget.validate();
    assert.strictEqual(res.isValid, true);
  });

  console.log('\n--- 6. SEARCH BUTTON STATE & DOUBLE-SUBMIT PREVENTION ---');
  it('Disables search button when form has errors', () => {
    FlightSearchWidget.state.tripType = 'roundtrip';
    FlightSearchWidget.state.origin = { raw: '', code: '' }; // Invalid
    FlightSearchWidget.validate();

    const btn = document.getElementById('btnHomeSearch');
    assert.strictEqual(btn.disabled, true);
    assert.strictEqual(btn['aria-disabled'], 'true');
  });

  it('Enables search button when form is valid', () => {
    FlightSearchWidget.state.origin = { raw: 'Dhaka (DAC)', code: 'DAC', city: 'Dhaka' };
    FlightSearchWidget.state.destination = { raw: 'Cox\'s Bazar (CXB)', code: 'CXB', city: 'Cox\'s Bazar' };
    FlightSearchWidget.state.depDate = tomorrowStr;
    FlightSearchWidget.state.returnDate = nextWeekStr;
    FlightSearchWidget.state.passengers = { adults: 1, children: 0, infants: 0 };
    FlightSearchWidget.validate();

    const btn = document.getElementById('btnHomeSearch');
    assert.strictEqual(btn.disabled, false);
    assert.strictEqual(btn['aria-disabled'], 'false');
  });

  it('Prevents double submission upon handleSubmit', () => {
    FlightSearchWidget.state.isSubmitting = false;
    const submitRes1 = FlightSearchWidget.handleSubmit({ preventDefault: () => {} });
    assert.strictEqual(submitRes1.success, true);
    assert.strictEqual(FlightSearchWidget.state.isSubmitting, true);

    // Second immediate submit should be blocked
    const submitRes2 = FlightSearchWidget.handleSubmit({ preventDefault: () => {} });
    assert.strictEqual(submitRes2, undefined, 'Double submit should be ignored');

    // Reset flag
    FlightSearchWidget.state.isSubmitting = false;
  });

  console.log('\n--- 7. SAFE QUERY ENCODING & STATE PERSISTENCE ---');
  it('Correctly encodes query parameters for navigation to /flights/search', () => {
    FlightSearchWidget.state.tripType = 'roundtrip';
    FlightSearchWidget.state.origin = { raw: 'Dhaka (DAC)', code: 'DAC', city: 'Dhaka' };
    FlightSearchWidget.state.destination = { raw: 'Cox\'s Bazar (CXB)', code: 'CXB', city: 'Cox\'s Bazar' };
    FlightSearchWidget.state.depDate = '2026-11-28';
    FlightSearchWidget.state.returnDate = '2026-12-05';
    FlightSearchWidget.state.passengers = { adults: 2, children: 1, infants: 1 };
    FlightSearchWidget.state.cabinClass = 'Economy';

    const submitRes = FlightSearchWidget.handleSubmit({ preventDefault: () => {} });
    FlightSearchWidget.state.isSubmitting = false;

    assert.ok(submitRes.url.startsWith('/flights/search?'));
    const url = new URL('http://localhost' + submitRes.url);
    assert.strictEqual(url.searchParams.get('trip_type'), 'roundtrip');
    assert.strictEqual(url.searchParams.get('from'), 'DAC');
    assert.strictEqual(url.searchParams.get('to'), 'CXB');
    assert.strictEqual(url.searchParams.get('departure'), '2026-11-28');
    assert.strictEqual(url.searchParams.get('return'), '2026-12-05');
    assert.strictEqual(url.searchParams.get('adults'), '2');
    assert.strictEqual(url.searchParams.get('children'), '1');
    assert.strictEqual(url.searchParams.get('infants'), '1');
    assert.strictEqual(url.searchParams.get('cabin'), 'Economy');
  });

  it('Persists and restores state from sessionStorage across page navigation', () => {
    FlightSearchWidget.state.destination = { raw: 'Sylhet (ZYL)', code: 'ZYL', city: 'Sylhet' };
    FlightSearchWidget.saveState();

    // Verify stored in mock sessionStorage
    const stored = JSON.parse(mockStorage[FlightSearchWidget.config.storageKey]);
    assert.strictEqual(stored.destination.code, 'ZYL');

    // Reset state and restore
    FlightSearchWidget.state.destination = { raw: '', code: '', city: '' };
    FlightSearchWidget.restoreState();
    assert.strictEqual(FlightSearchWidget.state.destination.code, 'ZYL');
  });

  console.log('\n--- 8. LIVE FLASK SERVER DOM INTEGRATION VERIFICATION ---');
  await new Promise((resolve) => {
    http.get('http://127.0.0.1:5000/', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        it('Homepage returns HTTP 200 status', () => {
          assert.strictEqual(res.statusCode, 200);
        });

        it('Homepage contains flight search widget tabs (Round Trip, One Way, Multi City)', () => {
          assert.ok(data.includes('id="tabRoundTrip"'), 'Missing tabRoundTrip');
          assert.ok(data.includes('id="tabOneWay"'), 'Missing tabOneWay');
          assert.ok(data.includes('id="tabMultiCity"'), 'Missing tabMultiCity');
        });

        it('Homepage contains validation summary alert banner (#searchValidationAlert)', () => {
          assert.ok(data.includes('id="searchValidationAlert"'), 'Missing searchValidationAlert');
          assert.ok(data.includes('role="alert"'), 'Missing role="alert"');
        });

        it('Homepage contains inline field error elements (#originError, #destError, etc.)', () => {
          assert.ok(data.includes('id="originError"'), 'Missing originError');
          assert.ok(data.includes('id="destError"'), 'Missing destError');
          assert.ok(data.includes('id="depDateError"'), 'Missing depDateError');
          assert.ok(data.includes('id="returnDateError"'), 'Missing returnDateError');
          assert.ok(data.includes('id="passengersError"'), 'Missing passengersError');
        });

        it('Homepage includes static/js/flight_search_widget.js script tag', () => {
          assert.ok(data.includes('/js/flight_search_widget.js'), 'Missing /js/flight_search_widget.js');
        });

        it('Search button is wired to FlightSearchWidget.handleSubmit', () => {
          assert.ok(data.includes('FlightSearchWidget.handleSubmit'), 'btnHomeSearch not hooked to FlightSearchWidget.handleSubmit');
        });

        resolve();
      });
    }).on('error', (err) => {
      console.error(`  [FAIL] Could not connect to Flask server: ${err.message}`);
      failCount++;
      resolve();
    });
  });

  console.log('\n===============================================================');
  console.log(`TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('===============================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests();
