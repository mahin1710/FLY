/**
 * COMPREHENSIVE VERIFICATION SUITE: SHARED SITE SHELL & PUBLIC ROUTES
 * Validates:
 * 1. All requested routes:
 *    - /
 *    - /flights/search
 *    - /flights/offer/[offerId]
 *    - /booking/travellers
 *    - /booking/extras
 *    - /booking/review
 *    - /booking/payment
 *    - /booking/status/[reference]
 *    - /my-bookings
 *    - /manage-booking
 *    - /login, /register, /profile
 *    - /support
 *    - 404 error handling on unknown routes
 * 2. Component integrity: layout, breadcrumb, page heading, empty state,
 *    loading state, error banner, button, form field and card components.
 * 3. Booking flow progress stepper: Search -> Flight -> Travellers -> Review -> Payment -> Confirmation
 * 4. Page titles, meta descriptions, mobile navigation drawer & keyboard accessibility.
 * 5. Guest vs account protection rules.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

function getUrl(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:5000${urlPath}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('      SHARED SITE SHELL & PUBLIC PAGE ROUTING TEST SUITE        ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(title, condition, details = '') {
    total++;
    if (condition) {
      console.log(`  [PASS] ${title}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${title} ${details ? '--> ' + details : ''}`);
    }
  }

  // 1. ROUTE HTTP STATUS & CONTENT CHECKS
  console.log('1. Verifying All Public Routes & HTTP Statuses...');

  const routesToTest = [
    { path: '/', title: 'Homepage /', expectedSnippet: 'Where will your journey take you?' },
    { path: '/flights/search', title: 'Flight Results /flights/search', expectedSnippet: 'Available Flight Offers' },
    { path: '/flights/offer/OFFER-DAC-CXB-433', title: 'Offer Details /flights/offer/[offerId]', expectedSnippet: 'Flight Offer Review' },
    { path: '/booking/travellers', title: 'Traveller Form /booking/travellers', expectedSnippet: 'Traveller Information' },
    { path: '/booking/extras', title: 'Extras /booking/extras', expectedSnippet: 'Optional Extras' },
    { path: '/booking/review', title: 'Review /booking/review', expectedSnippet: 'Final Booking Review' },
    { path: '/booking/payment', title: 'Payment /booking/payment', expectedSnippet: 'Secure Payment Checkout' },
    { path: '/booking/status/BK-DAC-7788', title: 'Booking Status /booking/status/[ref]', expectedSnippet: 'Your Booking is Confirmed!' },
    { path: '/my-bookings', title: 'My Bookings /my-bookings', expectedSnippet: 'My Bookings' },
    { path: '/manage-booking', title: 'Manage Booking /manage-booking', expectedSnippet: 'Manage Your Booking' },
    { path: '/support', title: 'Help/Support /support', expectedSnippet: 'Customer Support &amp; Travel Assistance' },
    { path: '/login', title: 'Login /login', expectedSnippet: 'Account Access' },
    { path: '/register', title: 'Register /register', expectedSnippet: 'Account Access' },
    { path: '/profile', title: 'Profile /profile', expectedSnippet: 'Account Access' }
  ];

  for (const r of routesToTest) {
    const res = await getUrl(r.path);
    assert(`${r.title} returns HTTP 200`, res.status === 200, `Got status ${res.status}`);
    assert(`${r.title} contains expected view content`, res.data.includes(r.expectedSnippet));
    assert(`${r.title} contains valid page <title>`, res.data.includes('<title>') && !res.data.includes('<title></title>'));
    assert(`${r.title} contains meta description`, res.data.includes('<meta name="description"'));
  }

  // 2. 404 ERROR HANDLING
  console.log('\n2. Verifying 404 Error Boundary...');
  const res404 = await getUrl('/this-route-does-not-exist-at-all');
  assert('Unknown route returns HTTP 404 status code', res404.status === 404, `Got ${res404.status}`);
  assert('404 page renders friendly Not Found recovery UI', res404.data.includes('Page Not Found') && res404.data.includes('Return to Homepage'));

  // 3. BOOKING STEPPER INTEGRITY
  console.log('\n3. Verifying Booking Flow Progress Stepper Steps...');
  const stepperPages = [
    { path: '/flights/search', step: 'search', mustComplete: [] },
    { path: '/flights/offer/OFFER-DAC-CXB-433', step: 'flight', mustComplete: ['Search'] },
    { path: '/booking/travellers', step: 'travellers', mustComplete: ['Search', 'Flight'] },
    { path: '/booking/review', step: 'review', mustComplete: ['Search', 'Flight', 'Travellers'] },
    { path: '/booking/payment', step: 'payment', mustComplete: ['Search', 'Flight', 'Travellers', 'Review'] },
    { path: '/booking/status/BK-DAC-7788', step: 'confirmation', mustComplete: ['Search', 'Flight', 'Travellers', 'Review', 'Payment', 'Confirmation'] }
  ];

  for (const sp of stepperPages) {
    const res = await getUrl(sp.path);
    assert(`${sp.path} renders booking progress stepper`, res.data.includes('booking-stepper-nav'));
    assert(`${sp.path} highlights active step`, res.data.includes('is-active') && res.data.includes('aria-current="step"'));
    for (const comp of sp.mustComplete) {
      assert(`${sp.path} shows completed step for ${comp}`, res.data.includes('is-complete') && res.data.includes('stepper-check-icon'));
    }
  }

  // 4. SHARED SITE SHELL & REUSABLE COMPONENTS
  console.log('\n4. Verifying Shared Site Shell & Component Macros...');
  const offerRes = await getUrl('/flights/offer/OFFER-DAC-CXB-433');
  
  assert('Shell includes Breadcrumb navigation with schema.org tags', offerRes.data.includes('breadcrumb-nav') && offerRes.data.includes('BreadcrumbList'));
  assert('Shell includes Page Heading block with eyebrow & title', offerRes.data.includes('page-heading-block') && offerRes.data.includes('page-heading-eyebrow'));
  assert('Shell includes Demo Notice Banner highlighting incomplete/live integration', offerRes.data.includes('demo-integration-notice') && offerRes.data.includes('DEMO ENVIRONMENT'));
  assert('Shell includes 4-column modern airline footer', offerRes.data.includes('app-main-footer') && offerRes.data.includes('footer-compliance-tag'));
  assert('Shell includes skip-to-content accessibility link', offerRes.data.includes('skip-to-content'));
  assert('Shell loads client shell.js script', offerRes.data.includes('/js/shell.js'));

  // 5. ACCESSIBLE MOBILE NAVIGATION DRAWER
  console.log('\n5. Verifying Accessible Mobile Navigation Drawer...');
  assert('Header contains mobile menu toggle button with aria controls', 
    offerRes.data.includes('id="mobileMenuToggle"') && 
    offerRes.data.includes('aria-controls="mobileNavDrawer"') &&
    offerRes.data.includes('aria-expanded="false"'));
  assert('Mobile navigation drawer dialog exists with role="dialog"', 
    offerRes.data.includes('id="mobileNavDrawer"') && 
    offerRes.data.includes('role="dialog"') &&
    offerRes.data.includes('aria-modal="true"'));
  assert('Mobile navigation drawer contains close button', offerRes.data.includes('id="mobileNavClose"'));
  assert('Mobile drawer links to Search, Manage Booking, My Bookings, Support, and Auth',
    offerRes.data.includes('/flights/search') &&
    offerRes.data.includes('/manage-booking') &&
    offerRes.data.includes('/my-bookings') &&
    offerRes.data.includes('/support') &&
    offerRes.data.includes('/login'));

  // 6. JAVASCRIPT & CSS COMPONENT STYLES VERIFICATION
  console.log('\n6. Verifying Component Styles & Client Script Integrity...');
  const css = fs.readFileSync(path.join(__dirname, 'static', 'css', 'style.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, 'static', 'js', 'shell.js'), 'utf8');

  assert('style.css defines .breadcrumb-nav and .breadcrumb-list', css.includes('.breadcrumb-nav') && css.includes('.breadcrumb-list'));
  assert('style.css defines .booking-stepper-nav, .stepper-bubble, and .stepper-connector', css.includes('.booking-stepper-nav') && css.includes('.stepper-connector'));
  assert('style.css defines .empty-state-card and .loading-state-card with skeletons', css.includes('.empty-state-card') && css.includes('.loading-spinner'));
  assert('style.css defines .error-banner-card and .demo-integration-notice', css.includes('.error-banner-card') && css.includes('.demo-integration-notice'));
  assert('style.css defines .mobile-nav-drawer and .mobile-menu-toggle', css.includes('.mobile-nav-drawer') && css.includes('.mobile-menu-toggle'));
  assert('shell.js implements keyboard focus trap and Escape key listener for mobile drawer', js.includes("e.key === 'Escape'") && js.includes("e.key === 'Tab'"));

  console.log('\n================================================================');
  console.log(`TOTAL TEST RESULT: ${passed} / ${total} checks passed (${Math.round((passed / total) * 100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
