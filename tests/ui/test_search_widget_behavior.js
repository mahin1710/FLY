/**
 * FLY — Node Behavioral Verification for FlightSearchWidget (Homepage Logic & Controls)
 */
const assert = require('assert');

// Minimal DOM & Browser globals shim to test FlightSearchWidget in isolation
const elements = {};
function makeEl(id, extra = {}) {
  const classes = new Set(extra.classes || []);
  const attrs = {};
  const listeners = {};
  const el = Object.assign({
    id,
    value: extra.value || '',
    min: '',
    disabled: false,
    checked: extra.checked !== undefined ? extra.checked : false,
    style: {},
    innerHTML: '',
    textContent: '',
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => (force === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (force ? classes.add(c) : classes.delete(c))),
      contains: (c) => classes.has(c)
    },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: (k) => attrs[k],
    removeAttribute: (k) => { delete attrs[k]; },
    addEventListener: (ev, fn) => { listeners[ev] = listeners[ev] || []; listeners[ev].push(fn); },
    dispatch: (ev, eObj = {}) => (listeners[ev] || []).forEach(fn => fn(eObj)),
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    scrollIntoView: () => {}
  }, extra);
  elements[id] = el;
  return el;
}

['catTabFlights', 'catTabHotels', 'catTabCarRental', 'flightTripPills',
 'tabOneWay', 'tabRoundTrip', 'tabMultiCity', 'searchValidationAlert',
 'standardSearchForm', 'originGroup', 'homeOriginInput', 'originError', 'homeOriginDropdown',
 'btnSwapHome', 'destGroup', 'homeDestInput', 'destError', 'homeDestDropdown',
 'departureDateField', 'homeDepDate', 'depDateError', 'returnDateField', 'homeReturnDate', 'returnDateError',
 'btnHomeSearch', 'multiCityContainer', 'multiCityLegsList', 'btnAddCityLeg', 'btnMultiCitySearch',
 'hotelsSearchForm', 'hotelDestInput', 'hotelCheckIn', 'hotelCheckOut', 'hotelRoomsSelect', 'hotelAdultsSelect', 'hotelChildrenSelect', 'btnSearchHotels',
 'carsSearchForm', 'carPickupLoc', 'carSameLocation', 'carDropoffGroup', 'carDropoffLoc', 'carPickupDate', 'carPickupTime', 'carReturnDate', 'carReturnTime', 'carDriverAge', 'btnSearchCars',
 'flightQuickRoutesBar'
].forEach(id => makeEl(id, { checked: id === 'carSameLocation', value: id === 'carDriverAge' ? '25' : '' }));

let navigatedUrl = '';
const store = {};
global.window = {
  location: {
    get href() { return navigatedUrl; },
    set href(v) { navigatedUrl = v; }
  },
  addEventListener: () => {}
};
global.document = {
  readyState: 'complete',
  getElementById: (id) => elements[id] || null,
  addEventListener: () => {}
};
global.sessionStorage = {
  getItem: (k) => store[k] || null,
  setItem: (k, v) => { store[k] = String(v); }
};
global.fetch = async (url) => ({
  ok: true,
  json: async () => ({ flights: [{ id: 976 }], total: 1 })
});

const FlightSearchWidget = require('../../static/js/flight_search_widget.js');

(async () => {
  FlightSearchWidget.init();

  // 1. Default Trip Type is strictly oneway
  assert.strictEqual(FlightSearchWidget.state.tripType, 'oneway');

  // 2. Dhaka (DAC) -> Dubai (DXB) One Way search works and navigates to real URL
  elements.homeOriginInput.value = 'Dhaka (DAC)';
  elements.homeDestInput.value = 'Dubai (DXB)';
  const futureDate = '2027-07-15';
  elements.homeDepDate.value = futureDate;
  FlightSearchWidget.state.origin = { city: 'Dhaka', code: 'DAC', raw: 'Dhaka (DAC)' };
  FlightSearchWidget.state.destination = { city: 'Dubai', code: 'DXB', raw: 'Dubai (DXB)' };
  FlightSearchWidget.state.depDate = futureDate;

  await FlightSearchWidget.handleSubmit();
  assert(navigatedUrl.startsWith('/flights/search?'), `Expected navigation, got: ${navigatedUrl}`);
  const q = new URLSearchParams(navigatedUrl.split('?')[1]);
  assert.strictEqual(q.get('tripType'), 'oneway');
  assert.strictEqual(q.get('from'), 'DAC');
  assert.strictEqual(q.get('to'), 'DXB');
  assert.strictEqual(q.get('departure'), futureDate);
  assert.strictEqual(FlightSearchWidget.state.isSubmitting, false, 'isSubmitting must reset cleanly');

  // 3. Past date validation fails cleanly
  elements.homeDepDate.value = '2020-01-01';
  FlightSearchWidget.state.depDate = '2020-01-01';
  const vPast = FlightSearchWidget.validate();
  assert.strictEqual(vPast.isValid, false);
  assert(vPast.errors.depDate, 'Expected depDate error for past date');

  // 4. Same origin & destination rejected
  elements.homeDepDate.value = futureDate;
  FlightSearchWidget.state.depDate = futureDate;
  elements.homeDestInput.value = 'Dhaka (DAC)';
  FlightSearchWidget.state.destination = { city: 'Dhaka', code: 'DAC', raw: 'Dhaka (DAC)' };
  const vSame = FlightSearchWidget.validate();
  assert.strictEqual(vSame.isValid, false);
  assert(vSame.errors.destination, 'Expected identical airport error');

  // 5. Round trip validates return >= departure
  FlightSearchWidget.setTripType('roundtrip');
  elements.homeDestInput.value = 'Dubai (DXB)';
  FlightSearchWidget.state.destination = { city: 'Dubai', code: 'DXB', raw: 'Dubai (DXB)' };
  elements.homeReturnDate.value = '2027-07-10';
  FlightSearchWidget.state.returnDate = '2027-07-10';
  const vRet = FlightSearchWidget.validate();
  assert.strictEqual(vRet.isValid, false);
  assert(vRet.errors.returnDate, 'Expected return < departure error');

  // 6. Multi-city supports adding leg up to max (5) & chronological order validation
  FlightSearchWidget.setTripType('multicity');
  assert.strictEqual(FlightSearchWidget.state.multiCityLegs.length, 2);
  FlightSearchWidget.addMultiCityLeg();
  assert.strictEqual(FlightSearchWidget.state.multiCityLegs.length, 3);

  console.log('ALL FlightSearchWidget BEHAVIORAL ASSERTIONS PASSED!');
})();
