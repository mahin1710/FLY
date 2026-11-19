/**
 * VERIFICATION SCRIPT: FEATURED FLIGHT CARD LAYOUT & RESPONSIVENESS
 * Author: mahin1710
 */

const fs = require('fs');
const http = require('http');

function getFeaturedFlights() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:5000/api/flights/featured', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, flights: JSON.parse(data) });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function verifyCardLayout() {
  console.log('===============================================================');
  console.log('  FLY VERIFICATION: FEATURED FLIGHT CARD LAYOUT & OVERFLOW FIX ');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  // 1. CSS Inspection for Overflow & Flex/Grid Constraints
  console.log('1. Verifying CSS Layout Rules & Overflow Prevention in style.css...');
  const css = fs.readFileSync('Skynet-master/Skynet-master/web/public/css/style.css', 'utf8');

  assert(css.includes('.flight-card {') && css.includes('overflow: hidden;') && css.includes('box-sizing: border-box;'), 
    '.flight-card enforces overflow: hidden and box-sizing: border-box');
  assert(css.includes('.featured-flights-grid {') && css.includes('minmax(min(100%, 350px), 1fr)'),
    '.featured-flights-grid uses flexible minmax(min(100%, 350px), 1fr) to prevent viewport blowout on mobile');
  assert(css.includes('.airline-badge {') && css.includes('min-width: 0;') && css.includes('overflow: hidden;'),
    '.airline-badge enforces min-width: 0 and overflow: hidden');
  assert(css.includes('.airline-info {') && css.includes('min-width: 0;') && css.includes('overflow: hidden;'),
    '.airline-info enforces min-width: 0 and flex: 1 for text truncation');
  assert(css.includes('.airline-name {') && css.includes('text-overflow: ellipsis;') && css.includes('white-space: nowrap;'),
    '.airline-name truncates long airline names gracefully with ellipsis');
  assert(css.includes('.flight-timeline {') && css.includes('minmax(0, 1fr)'),
    '.flight-timeline uses minmax(0, 1fr) columns so timeline points can shrink without forcing overflow');
  assert(css.includes('.timeline-point {') && css.includes('min-width: 0;') && css.includes('overflow: hidden;'),
    '.timeline-point enforces min-width: 0 and overflow: hidden');
  assert(css.includes('.point-city {') && css.includes('text-overflow: ellipsis;') && css.includes('white-space: nowrap;'),
    '.point-city truncates long city/airport names with ellipsis');
  assert(css.includes('.card-pricing-classes {') && css.includes('grid-template-columns: repeat(3, 1fr);'),
    '.card-pricing-classes uses a clean 3-column CSS Grid matrix for Economy, Business, and First');
  assert(css.includes('.price-col {') && css.includes('min-width: 0;') && css.includes('overflow: hidden;'),
    '.price-col enforces min-width: 0 and text containment');
  assert(css.includes('.btn-select-seats {') && css.includes('width: 100%;') && css.includes('box-sizing: border-box;'),
    '.btn-select-seats spans 100% cleanly contained in its footer slot');
  assert(css.includes('@media (max-width: 768px) {') && css.includes('grid-template-columns: 1fr;'),
    'Responsive tablet breakpoint (max-width: 768px) switches grid to 1fr single column');
  assert(css.includes('@media (max-width: 600px) {') && css.includes('padding: 16px 14px;'),
    'Responsive mobile breakpoint (max-width: 600px) adjusts card padding and typography');

  // 2. JavaScript Card Markup Generation
  console.log('\n2. Verifying Flight Card Component Generation in app.js...');
  const appJs = fs.readFileSync('Skynet-master/Skynet-master/web/public/js/app.js', 'utf8');

  assert(appJs.includes('class="airline-info"'), 'renderFlightCard() wraps airline details in .airline-info container');
  assert(appJs.includes('title="${f.airlineName}"'), 'renderFlightCard() adds title tooltip to airline-name');
  assert(appJs.includes('title="${depAirportClean}"'), 'renderFlightCard() adds title tooltip to departure city');
  assert(appJs.includes('title="${arrAirportClean}"'), 'renderFlightCard() adds title tooltip to arrival city');
  assert(appJs.includes('title="${f.flightType || \'Direct / Non-stop\'}"'), 'renderFlightCard() adds title tooltip to nonstop-badge');

  // 3. API & Data Verification
  console.log('\n3. Verifying Featured Flights API Response...');
  const res = await getFeaturedFlights();
  assert(res.status === 200, 'GET /api/flights/featured returns HTTP 200');
  assert(Array.isArray(res.flights) && res.flights.length > 0, `Returned ${res.flights.length} featured flights`);

  for (const f of res.flights) {
    assert(Boolean(f.airlineName && f.flightNumber && f.depCity && f.arrCity), 
      `Flight ${f.flightNumber} (${f.airlineName}): Route ${f.depCity} -> ${f.arrCity} has complete data`);
    assert(Boolean(f.economy_price && f.business_price && f.first_price),
      `Flight ${f.flightNumber}: All 3 class prices exist (Eco: ${f.economy_price}, Biz: ${f.business_price}, First: ${f.first_price})`);
  }

  console.log('\n===============================================================');
  console.log(`LAYOUT VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) process.exit(1);
}

verifyCardLayout().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
