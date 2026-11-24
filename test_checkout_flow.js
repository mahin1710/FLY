/**
 * FLY AVIATION - CUSTOMER CHECKOUT & BOOKING FLOW AUTOMATED TEST SUITE
 * Author: mahin1710
 *
 * Comprehensive unit and integration verification for:
 *  1. Offer Details & Itinerary Breakdown (Segments, Operating Carrier, Layover, Baggage, Expiry)
 *  2. Traveller Forms & Route-Aware Validation (Domestic vs International, Age Brackets)
 *  3. Provider-Supported vs Unsupported Extras (Seat, Baggage, Meals, Insurance)
 *  4. Price Change Revalidation & Explicit Acknowledgment Gate
 *  5. Strict Security & Privacy Rule (Zero passport or payment data in localStorage)
 *  6. Demo Confirmation Integrity (Zero Fake Airline PNRs or Fake E-Tickets)
 *  7. All 6 Lifecycle States (Confirmed, Payment Pending, Ticket Pending, Expired, Provider Unavailable 504, Failed)
 *  8. HTML Template Syntax & Component Structure Check
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Load normalized models, fixtures, and checkout store
const Models = require('./static/js/flight_models');
const Fixtures = require('./static/js/flight_fixtures');
const StoreModule = require('./static/js/checkout_store');
const { CheckoutStore, calculateAge, formatMoney } = StoreModule;

console.log('===============================================================');
console.log('✈️  STARTING CUSTOMER CHECKOUT FLOW VERIFICATION SUITE');
console.log('===============================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

// ============================================================================
// SUITE 1: OFFER DETAILS & SEGMENT DATA MODEL INTEGRITY
// ============================================================================
console.log('--- SECTION 1: OFFER DETAILS & SEGMENT ITINERARY ---');

runTest('1.1 Biman BG-433 fixture hydrates with direct segments and flexible fare rules', () => {
  const offer = Fixtures.getOfferById('DEMO-DAC-CXB-BG433');
  assert(offer, 'Offer BG-433 must exist in fixtures');
  assert.strictEqual(offer.isDirect(), true);
  assert.strictEqual(offer.segments.length, 1);
  assert.strictEqual(offer.segments[0].flightNumber, 'BG-433');
  assert.strictEqual(offer.fareConditions.refundable, true);
  assert.strictEqual(offer.baggage.checkedWeightKg, 20);
  assert.strictEqual(offer.isBookable, false, 'Typed demo offer must have isBookable = false');
});

runTest('1.2 Connecting flight BG-409 has 2 segments with Chittagong (CGP) layover', () => {
  const offer = Fixtures.getOfferById('DEMO-DAC-CXB-BG409-CONNECT');
  assert(offer, 'Connecting offer must exist');
  assert.strictEqual(offer.segments.length, 2);
  assert.strictEqual(offer.getStopsCount(), 1);
  assert.strictEqual(offer.segments[0].destination.code, 'CGP');
  assert.strictEqual(offer.segments[0].layoverAfterMinutes, 75);
  assert.strictEqual(offer.segments[1].origin.code, 'CGP');
});

runTest('1.3 Operating carrier divergence detected on codeshare flight (FZ-584)', () => {
  const offer = Fixtures.getOfferById('DEMO-DAC-DXB-FZ584-CODESHARE');
  assert(offer, 'Codeshare offer must exist');
  const seg = offer.segments[0];
  assert.strictEqual(seg.hasDifferentOperatingCarrier(), true);
  assert.strictEqual(seg.marketingCarrier.name, 'Emirates');
  assert.strictEqual(seg.operatingCarrier.name, 'flydubai');
});

runTest('1.4 Overnight flight (+1d arrival) correctly identified (BG-051)', () => {
  const offer = Fixtures.getOfferById('DEMO-DAC-DXB-BG051-OVERNIGHT');
  assert(offer, 'Overnight offer must exist');
  assert.strictEqual(offer.segments[0].isNextDayArrival(), true);
});

// ============================================================================
// SUITE 2: TRAVELLER VALIDATION & AGE BRACKETS
// ============================================================================
console.log('\n--- SECTION 2: TRAVELLER FORMS & AGE VALIDATION ---');

runTest('2.1 Age calculation utility correctly computes exact age in years', () => {
  const ref = new Date(2026, 4, 15); // May 15, 2026
  assert.strictEqual(calculateAge('1998-05-15', ref), 28);
  assert.strictEqual(calculateAge('2018-05-15', ref), 8);
  assert.strictEqual(calculateAge('2025-05-15', ref), 1);
  assert.strictEqual(calculateAge('2025-06-01', ref), 0); // Under 1 year
});

runTest('2.2 Adult passenger age validation (Adult must be 12+)', () => {
  const store = new CheckoutStore();
  const validAdult = {
    id: 'pax-1',
    type: 'adult',
    firstName: 'Mahin',
    lastName: 'Rahman',
    dob: '1998-05-15',
    nationality: 'BD'
  };
  const val1 = store.validateTraveller(validAdult, false);
  assert.strictEqual(val1.isValid, true);

  const underAgeAdult = {
    id: 'pax-1',
    type: 'adult',
    firstName: 'Junior',
    lastName: 'Rahman',
    dob: '2020-01-01', // ~6 years old
    nationality: 'BD'
  };
  const val2 = store.validateTraveller(underAgeAdult, false);
  assert.strictEqual(val2.isValid, false);
  assert(val2.errors['pax-1_dob'].includes('12 years or older'));
});

runTest('2.3 Child passenger age validation (Child must be 2 to 11)', () => {
  const store = new CheckoutStore();
  const validChild = {
    id: 'pax-child-1',
    type: 'child',
    firstName: 'Rayhan',
    lastName: 'Rahman',
    dob: '2018-05-15', // ~8 years
    nationality: 'BD'
  };
  const val1 = store.validateTraveller(validChild, false);
  assert.strictEqual(val1.isValid, true);

  const infantAsChild = {
    id: 'pax-child-1',
    type: 'child',
    firstName: 'Baby',
    lastName: 'Rahman',
    dob: '2025-06-01', // Under 2
    nationality: 'BD'
  };
  const val2 = store.validateTraveller(infantAsChild, false);
  assert.strictEqual(val2.isValid, false);
  assert(val2.errors['pax-child-1_dob'].includes('between 2 and 11'));
});

runTest('2.4 Infant passenger age validation (Infant must be under 2)', () => {
  const store = new CheckoutStore();
  const validInfant = {
    id: 'pax-infant-1',
    type: 'infant',
    firstName: 'Ayla',
    lastName: 'Rahman',
    dob: '2025-08-01',
    nationality: 'BD'
  };
  const val1 = store.validateTraveller(validInfant, false);
  assert.strictEqual(val1.isValid, true);

  const overageInfant = {
    id: 'pax-infant-1',
    type: 'infant',
    firstName: 'Toddler',
    lastName: 'Rahman',
    dob: '2022-01-01', // 4 years old
    nationality: 'BD'
  };
  const val2 = store.validateTraveller(overageInfant, false);
  assert.strictEqual(val2.isValid, false);
  assert(val2.errors['pax-infant-1_dob'].includes('under 2 years old'));
});

// ============================================================================
// SUITE 3: ROUTE-AWARE PASSPORT VALIDATION (DOMESTIC VS INTERNATIONAL)
// ============================================================================
console.log('\n--- SECTION 3: ROUTE-SENSITIVE PASSPORT VALIDATION ---');

runTest('3.1 Domestic Route (DAC-CXB): Passport is optional', () => {
  const store = new CheckoutStore();
  store.initOffer('DEMO-DAC-CXB-BG433');
  assert.strictEqual(store.isInternationalRoute(), false);

  const travellerWithoutPassport = {
    id: 'pax-1',
    type: 'adult',
    firstName: 'Mahin',
    lastName: 'Rahman',
    dob: '1998-05-15',
    nationality: 'BD',
    passportNumber: '', // Empty passport
    passportCountry: '',
    passportExpiry: ''
  };

  const res = store.validateTraveller(travellerWithoutPassport, false);
  assert.strictEqual(res.isValid, true, 'Domestic route must pass without passport');
});

runTest('3.2 International Route (DAC-DXB): Passport is strictly required', () => {
  const store = new CheckoutStore();
  store.initOffer('DEMO-DAC-DXB-BG051-OVERNIGHT');
  assert.strictEqual(store.isInternationalRoute(), true);

  const travellerWithoutPassport = {
    id: 'pax-1',
    type: 'adult',
    firstName: 'Mahin',
    lastName: 'Rahman',
    dob: '1998-05-15',
    nationality: 'BD',
    passportNumber: '', // Empty
    passportCountry: '',
    passportExpiry: ''
  };

  const res = store.validateTraveller(travellerWithoutPassport, true);
  assert.strictEqual(res.isValid, false, 'International route must reject missing passport');
  assert(res.errors['pax-1_passportNumber'], 'Must require passport number');
  assert(res.errors['pax-1_passportCountry'], 'Must require passport issuing country');
  assert(res.errors['pax-1_passportExpiry'], 'Must require passport expiry date');
});

runTest('3.3 International Route: Expired passport is rejected', () => {
  const store = new CheckoutStore();
  const travellerWithExpiredPassport = {
    id: 'pax-1',
    type: 'adult',
    firstName: 'Mahin',
    lastName: 'Rahman',
    dob: '1998-05-15',
    nationality: 'BD',
    passportNumber: 'A12345678',
    passportCountry: 'BD',
    passportExpiry: '2020-01-01' // Past date
  };

  const res = store.validateTraveller(travellerWithExpiredPassport, true);
  assert.strictEqual(res.isValid, false);
  assert(res.errors['pax-1_passportExpiry'].includes('expired'));
});

// ============================================================================
// SUITE 4: SECURITY & STORAGE PRIVACY RULE
// ============================================================================
console.log('\n--- SECTION 4: SECURITY & STORAGE PRIVACY RULES ---');

runTest('4.1 CheckoutStore strictly forbids writing passport or payment to localStorage', () => {
  // Mock localStorage
  const mockLocalStorage = {
    data: {},
    getItem(k) { return this.data[k] || null; },
    setItem(k, v) { this.data[k] = String(v); },
    removeItem(k) { delete this.data[k]; },
    key(i) { return Object.keys(this.data)[i]; },
    get length() { return Object.keys(this.data).length; }
  };

  global.window = {
    localStorage: mockLocalStorage,
    sessionStorage: {
      data: {},
      getItem(k) { return this.data[k] || null; },
      setItem(k, v) { this.data[k] = String(v); },
      removeItem(k) { delete this.data[k]; }
    }
  };

  const store = new CheckoutStore();
  store.initOffer('DEMO-DAC-CXB-BG433');
  store.setTravellers([{
    id: 'pax-1',
    type: 'adult',
    firstName: 'Mahin',
    lastName: 'Rahman',
    dob: '1998-05-15',
    nationality: 'BD',
    passportNumber: 'CONFIDENTIAL-PASSPORT-123'
  }]);
  store.save();

  // Verify localStorage contains ZERO sensitive keys
  const audit = store.verifyZeroSensitiveDataInLocalStorage();
  assert.strictEqual(audit.passed, true);
  assert.strictEqual(mockLocalStorage.getItem('fly_passport'), null);
  assert.strictEqual(mockLocalStorage.getItem('fly_card'), null);
  assert.strictEqual(mockLocalStorage.getItem('fly_checkout_state_v1'), null);

  // Clean up
  delete global.window;
});

// ============================================================================
// SUITE 5: PROVIDER-SUPPORTED VS UNAVAILABLE EXTRAS
// ============================================================================
console.log('\n--- SECTION 5: PROVIDER-SUPPORTED VS UNAVAILABLE EXTRAS ---');

runTest('5.1 Biman BG-433 supports seat selection, extra baggage, and meals', () => {
  const store = new CheckoutStore();
  store.initOffer('DEMO-DAC-CXB-BG433');
  const offer = store.getOffer();
  assert.strictEqual(offer.supportedExtras.seatSelection, true);
  assert.strictEqual(offer.supportedExtras.extraBaggage, true);
  assert.strictEqual(offer.supportedExtras.mealSelection, true);

  store.setExtras({
    selectedSeat: '1A',
    seatFee: 800,
    extraBaggage: '10kg',
    mealOption: 'hot_biryani',
    insurance: true
  });

  const extras = store.getExtras();
  assert.strictEqual(extras.selectedSeat, '1A');
  assert.strictEqual(extras.baggageFee, 1200);
  assert.strictEqual(extras.mealFee, 650);
  assert.strictEqual(extras.insuranceFee, 450);
});

runTest('5.2 Air Astra 2A-441 explicitly disables meal upgrades on regional ATR flight', () => {
  const store = new CheckoutStore();
  store.initOffer('DEMO-DAC-CXB-2A441');
  const offer = store.getOffer();
  assert.strictEqual(offer.supportedExtras.mealSelection, false);

  // Attempting to select a hot meal must be reset to standard / fee 0
  store.setExtras({ mealOption: 'hot_biryani' });
  const extras = store.getExtras();
  assert.strictEqual(extras.mealFee, 0, 'Meal fee must be 0 when provider does not support it');
});

runTest('5.3 US-Bangla BS-149 Light Fare explicitly disables seat selection & extra baggage', () => {
  const store = new CheckoutStore();
  store.initOffer('DEMO-DAC-CXB-BS149');
  const offer = store.getOffer();
  assert.strictEqual(offer.supportedExtras.seatSelection, false);
  assert.strictEqual(offer.supportedExtras.extraBaggage, false);
  assert.strictEqual(offer.supportedExtras.mealSelection, false);

  store.setExtras({
    selectedSeat: '1A',
    extraBaggage: '10kg',
    mealOption: 'hot_biryani'
  });

  const extras = store.getExtras();
  assert.strictEqual(extras.selectedSeat, null, 'Seat selection must be null');
  assert.strictEqual(extras.seatFee, 0);
  assert.strictEqual(extras.extraBaggage, null, 'Extra baggage must be null');
  assert.strictEqual(extras.baggageFee, 0);
  assert.strictEqual(extras.mealFee, 0);
});

// ============================================================================
// SUITE 6: PRICE CHANGE REVALIDATION & EXPLICIT ACCEPTANCE GATE
// ============================================================================
console.log('\n--- SECTION 6: PRICE CHANGE REVALIDATION GATE ---');

runTest('6.1 Simulating a fare increase marks price change active and unaccepted', () => {
  const store = new CheckoutStore();
  store.initOffer('DEMO-DAC-CXB-BG433');
  const initialBreakdown = store.calculateBreakdown();
  const oldPrice = initialBreakdown.grandTotal;

  store.simulatePriceChange(oldPrice + 300, 'Seat bucket changed in carrier inventory.');
  assert.strictEqual(store.hasPendingPriceChange(), true);
  assert.strictEqual(store.state.priceChange.hasChanged, true);
  assert.strictEqual(store.state.priceChange.accepted, false);
  assert.strictEqual(store.state.priceChange.difference, 300);
});

runTest('6.2 Explicitly accepting the price change resolves the gate and updates grand total', () => {
  const store = new CheckoutStore();
  store.initOffer('DEMO-DAC-CXB-BG433');
  const initialBreakdown = store.calculateBreakdown();
  const oldPrice = initialBreakdown.grandTotal;

  store.simulatePriceChange(oldPrice + 300, 'Seat bucket changed.');
  assert.strictEqual(store.hasPendingPriceChange(), true);

  store.acceptPriceChange();
  assert.strictEqual(store.hasPendingPriceChange(), false);
  assert.strictEqual(store.state.priceChange.accepted, true);

  const updatedBreakdown = store.calculateBreakdown();
  assert.strictEqual(updatedBreakdown.grandTotal, oldPrice + 300);
});

// ============================================================================
// SUITE 7: DEMO CONFIRMATION INTEGRITY (NO FAKE PNR / NO FAKE E-TICKET)
// ============================================================================
console.log('\n--- SECTION 7: NO FAKE AIRLINE PNR / NO FAKE E-TICKET INTEGRITY ---');

runTest('7.1 Completing demo payment emits clear Demo Reference without fake PNR or fake ticket', () => {
  const store = new CheckoutStore();
  store.initOffer('DEMO-DAC-CXB-BG433');
  const booking = store.completeDemoPayment('instant');

  assert(booking.reference.startsWith('DEMO-REQ-'), 'Booking reference must be explicitly marked as DEMO-REQ');
  assert.strictEqual(booking.airlinePnr, '<Pending Provider Connection>', 'Airline PNR must NEVER be a fake 6-char string');
  assert.strictEqual(booking.eTicketNumber, '<Not Issued - Provider Integration Required>', 'E-Ticket must NEVER be a fake 13-digit number');
  assert.strictEqual(booking.isSimulated, true);
});

runTest('7.2 All 6 lifecycle states are supported by the booking state machine', () => {
  const store = new CheckoutStore();
  const expectedStates = ['idle', 'hold_active', 'payment_pending', 'ticket_pending', 'confirmed', 'failed', 'expired', 'provider_unavailable'];

  expectedStates.forEach(state => {
    store.setBookingState(state);
    assert.strictEqual(store.getBookingState(), state, `Store must support state: ${state}`);
  });
});

// ============================================================================
// SUITE 8: HTML TEMPLATES & ACCESSIBILITY AUDIT
// ============================================================================
console.log('\n--- SECTION 8: HTML TEMPLATES ACCESSIBILITY & TAGS ---');

const pagesToCheck = [
  { file: 'templates/pages/offer_details.html', keywords: ['offerCountdownTimer', 'offerExpiredAlert', 'baggageTableBody', 'cancellationRuleText'] },
  { file: 'templates/pages/travellers.html', keywords: ['travellerForm', 'passengersFormList', 'routeDocBadge', 'role="alert"'] },
  { file: 'templates/pages/extras.html', keywords: ['seatOptionContainer', 'baggageOptionContainer', 'mealOptionContainer', 'chkInsurance'] },
  { file: 'templates/pages/review.html', keywords: ['priceChangeAlert', 'chkAcceptPriceChange', 'btnSimulatePriceIncrease', 'btnProceedToPayment'] },
  { file: 'templates/pages/payment.html', keywords: ['DEMO MODE', 'NO REAL FINANCIAL TRANSACTIONS', 'paymentCountdownTimer', 'simulatedCardContainer'] },
  { file: 'templates/pages/booking_status.html', keywords: ['Pending Provider Connection', 'Not Issued - Integration Required', 'stateSimulatorButtons', 'stateView_provider_unavailable'] }
];

pagesToCheck.forEach(page => {
  runTest(`8.${totalTests + 1} Template ${path.basename(page.file)} has required components`, () => {
    const fullPath = path.join(__dirname, page.file);
    assert(fs.existsSync(fullPath), `File ${page.file} must exist`);
    const content = fs.readFileSync(fullPath, 'utf8');
    page.keywords.forEach(kw => {
      assert(content.includes(kw), `File ${page.file} must contain keyword: "${kw}"`);
    });
  });
});

// ============================================================================
// SUMMARY
// ============================================================================
console.log('\n===============================================================');
console.log(`🏁 CHECKOUT FLOW TEST RESULTS: ${passedTests} / ${totalTests} TESTS PASSED (${Math.round((passedTests / totalTests) * 100)}%)`);
console.log('===============================================================');

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
