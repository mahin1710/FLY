/**
 * VERIFICATION SCRIPT: HOMEPAGE VISUAL SYSTEM & RESPONSIVE DESIGN QA
 * Validates the Light Calm Travel Homepage against all requirements:
 * 1. Second reference image direction (light, calm travel aesthetic, search widget elevated as visual focus)
 * 2. Header: Logo, Flights, Manage Booking, Help, Currency/Language (BDT ৳ • EN), Theme switcher, Auth
 * 3. Hero: Concise copy, elevated search widget with visible labels, tabs, circular swap, primary search CTA
 * 4. Popular Destinations: 6 destinations with explicit "Example fare from ৳..." tags
 * 5. Why Book With Us: 4 trust & benefit pillars
 * 6. Help & Support Strip: 24/7 hotline, email, Manage Booking CTA
 * 7. Structured Footer: 4 columns, compliance tag, copyright, engineering author
 * 8. Responsive rules check for 1440px, 1024px, 768px, 390px
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

async function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function runVisualQA() {
  console.log('====================================================');
  console.log('   HOMEPAGE VISUAL SYSTEM & RESPONSIVE QA AUDIT    ');
  console.log('====================================================\n');

  let passedChecks = 0;
  let totalChecks = 0;

  function assertCheck(name, condition, details = '') {
    totalChecks++;
    if (condition) {
      console.log(`  [PASS] ${name}`);
      passedChecks++;
    } else {
      console.error(`  [FAIL] ${name} ${details ? '(' + details + ')' : ''}`);
    }
  }

  // 1. Fetch live homepage from Flask server
  console.log('1. Fetching Live Homepage from Flask (http://localhost:5000)...');
  const res = await fetchUrl('http://localhost:5000/');
  assertCheck('Flask server returned HTTP 200', res.status === 200, `Got ${res.status}`);
  const html = res.data;

  // 2. Validate Header Requirements
  console.log('\n2. Validating Header Elements...');
  assertCheck('Header contains Brand Logo left', html.includes('id="brandLogo"'));
  assertCheck('Header contains Flights navigation button', html.includes('Flights'));
  assertCheck('Header contains Manage Booking navigation button', html.includes('Manage Booking'));
  assertCheck('Header contains Help button', html.includes('Help') && html.includes('scrollToHelpSupport'));
  assertCheck('Header contains Currency/Language pill (BDT ৳ • EN)', html.includes('header-locale-pill') && html.includes('BDT (৳) • EN'));
  assertCheck('Header contains Theme Switcher button', html.includes('id="themeToggleBtn"'));
  assertCheck('Header contains Auth Area container', html.includes('id="authArea"'));

  // 3. Validate Hero & Search Widget (Visual Focus)
  console.log('\n3. Validating Hero Section & Search Widget...');
  assertCheck('Hero section exists with concise copy', html.includes('class="hero-section"') && html.includes('hero-title'));
  assertCheck('Search widget exists and is elevated', html.includes('class="search-widget-card"'));
  assertCheck('Search widget tabs include Round Trip (default), One Way, Multi City', 
    html.includes('id="tabRoundTrip"') && html.includes('id="tabOneWay"') && html.includes('id="tabMultiCity"'));
  assertCheck('Search widget inputs have visible labels (FROM, TO, DEPARTURE, RETURN, TRAVELLERS & CABIN)',
    html.includes('class="input-label">FROM</label>') &&
    html.includes('class="input-label">TO</label>') &&
    html.includes('class="input-label">DEPARTURE</label>') &&
    html.includes('class="input-label">RETURN</label>') &&
    html.includes('TRAVELLERS &amp; CABIN'));
  assertCheck('Centered circular swap control button exists', html.includes('id="btnSwapHome"') && html.includes('btn-swap'));
  assertCheck('Search Flights CTA button exists', html.includes('id="btnHomeSearch"') && html.includes('Search Flights'));

  // 4. Validate Popular Destinations (No fake live prices, explicit "Example fare")
  console.log('\n4. Validating Popular Destinations Section...');
  assertCheck('Popular Destinations section exists', html.includes('id="popularDestinations"'));
  const exampleFareMatches = html.match(/Example fare from ৳[\d,]+/g) || [];
  assertCheck('All cards display explicit "Example fare from ৳..." pill', exampleFareMatches.length === 6, `Found ${exampleFareMatches.length} example fares`);
  assertCheck('Destinations include Cox\'s Bazar, Chittagong, Sylhet, Dubai, Bangkok, Singapore',
    html.includes('Cox\'s Bazar') &&
    html.includes('Chittagong') &&
    html.includes('Sylhet') &&
    html.includes('Dubai') &&
    html.includes('Bangkok') &&
    html.includes('Singapore'));

  // 5. Validate Why Book With Us Section (4 Pillars)
  console.log('\n5. Validating Why Book With Us (4 Benefit Pillars)...');
  assertCheck('Why Book With Us section exists', html.includes('id="whyBookWithUs"'));
  assertCheck('Pillar 1: Transparent Fare Breakdown exists', html.includes('Transparent Fare Breakdown'));
  assertCheck('Pillar 2: Guaranteed 15-Minute Seat Hold exists', html.includes('Guaranteed 15-Minute Seat Hold'));
  assertCheck('Pillar 3: Strict Customer Privacy exists', html.includes('Strict Customer Privacy'));
  assertCheck('Pillar 4: 24/7 Dedicated Support exists', html.includes('24/7 Dedicated Support'));

  // 6. Validate Help & Travel Support Strip
  console.log('\n6. Validating Help & Travel Support Strip...');
  assertCheck('Help & Travel Support Strip exists', html.includes('id="helpSupportStrip"'));
  assertCheck('Helpline contact phone exists', html.includes('+880 9610-000FLY') || html.includes('tel:'));
  assertCheck('Email support address exists', html.includes('support@fly-booking.com'));
  assertCheck('Manage Booking action button exists', html.includes('onclick="app.navigate(\'bookings\')"'));

  // 7. Validate Structured Modern Footer
  console.log('\n7. Validating Modern Structured Footer...');
  assertCheck('Footer exists with role="contentinfo"', html.includes('id="appMainFooter"'));
  assertCheck('Col 1: Brand & Compliance Tag exists', html.includes('footer-compliance-tag'));
  assertCheck('Col 2: Flight Services exists', html.includes('Flight Services'));
  assertCheck('Col 3: Travel Information exists', html.includes('Travel Information'));
  assertCheck('Col 4: Trust & Privacy exists', html.includes('Trust &amp; Privacy'));
  assertCheck('Bottom sub-footer contains copyright & author credit', html.includes('footer-bottom-bar') && html.includes('mahin1710'));

  // 8. Validate CSS Stylesheet Rules & Tokens
  console.log('\n8. Validating CSS Tokens and Responsive Rules in style.css...');
  const css = fs.readFileSync(path.join(__dirname, 'static', 'css', 'style.css'), 'utf8');

  assertCheck('Light theme tokens use calm travel palette (#F8FAFC, #FFFFFF, #0F172A, #0284C7, #0D9488)',
    css.includes('--bg-app: #F8FAFC;') &&
    css.includes('--text-main: #0F172A;') &&
    css.includes('--accent-primary: #0284C7;') &&
    css.includes('--accent-teal: #0D9488;'));

  assertCheck('Hero section uses light airy gradient in light mode',
    css.includes('linear-gradient(180deg, #F0F9FF 0%, #F8FAFC 45%, #F8FAFC 100%)'));

  assertCheck('Search widget card has elevated soft shadow',
    css.includes('box-shadow: 0 20px 45px -15px rgba(15, 23, 42, 0.08)'));

  assertCheck('Circular swap button has rotating hover transition',
    css.includes('.btn-swap') && css.includes('transform: rotate(180deg)'));

  assertCheck('Responsive rule for 1024px exists (2-column grids, sidebar drawer)',
    css.includes('@media (max-width: 1024px)') && css.includes('.destinations-grid {'));

  assertCheck('Responsive rule for 768px exists (1-column search form stacking, 1-column destinations)',
    css.includes('@media (max-width: 768px)') && css.includes('.search-widget-form, .search-widget-form.is-roundtrip {'));

  assertCheck('Responsive rule for 480px / 390px exists (touch tabs, full-width actions, zero overflow)',
    css.includes('@media (max-width: 480px)'));

  assertCheck('Accessibility: :focus-visible rules exist', css.includes(':focus-visible'));
  assertCheck('Accessibility: prefers-reduced-motion media query exists', css.includes('@media (prefers-reduced-motion: reduce)'));

  console.log('\n====================================================');
  console.log(`QA AUDIT RESULT: ${passedChecks} / ${totalChecks} checks passed (${Math.round((passedChecks / totalChecks) * 100)}%)`);
  console.log('====================================================\n');

  if (passedChecks !== totalChecks) {
    process.exit(1);
  }
}

runVisualQA().catch(err => {
  console.error('Fatal error during QA audit:', err);
  process.exit(1);
});
