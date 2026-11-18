/**
 * Comprehensive Security & Privacy Test Suite for FLY
 * Tests all 10 Security & Data Privacy Scenarios
 */

const http = require('http');
const assert = require('assert');

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'Content-Type': 'application/json'
    };
    const reqHeaders = { ...defaultHeaders, ...headers };
    if (body) {
      reqHeaders['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    }

    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path,
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, data: parsed, headers: res.headers });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runSecurityTests() {
  console.log('===============================================================');
  console.log('🔒 FLY APPLICATION: COMPLETE CUSTOMER DATA PRIVACY & RBAC TESTS');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function testPass(msg) {
    console.log(`  ✓ PASS: ${msg}`);
    passed++;
  }

  function testFail(msg, err) {
    console.error(`  ❌ FAIL: ${msg}`, err || '');
    failed++;
  }

  try {
    // 0. Setup: Log in demo accounts
    console.log('0. Authenticating Test Accounts...');
    const loginA = await request('POST', '/api/auth/login', { username: 'Mahin0', password: 'Mahin0' });
    assert.strictEqual(loginA.status, 200, 'Customer A (Mahin0) login failed');
    const tokenA = loginA.data.token;
    const userA = loginA.data.user;
    testPass(`Customer A logged in (ID: ${userA.id}, Username: ${userA.username})`);

    const loginB = await request('POST', '/api/auth/login', { username: 'Mahin1', password: 'Mahin1' });
    assert.strictEqual(loginB.status, 200, 'Customer B (Mahin1) login failed');
    const tokenB = loginB.data.token;
    const userB = loginB.data.user;
    testPass(`Customer B logged in (ID: ${userB.id}, Username: ${userB.username})`);

    const loginBiman = await request('POST', '/api/auth/login', { username: 'Admin_Biman', password: 'Admin_Biman' });
    assert.strictEqual(loginBiman.status, 200, 'Biman Admin login failed');
    const tokenBiman = loginBiman.data.token;
    testPass('Biman Admin logged in');

    const loginUSB = await request('POST', '/api/auth/login', { username: 'Admin_USB', password: 'Admin_USB' });
    assert.strictEqual(loginUSB.status, 200, 'US-Bangla Admin login failed');
    const tokenUSB = loginUSB.data.token;
    testPass('US-Bangla Admin logged in');

    // Create a real booking for Customer A to test isolation
    console.log('\n--- Creating Test Reservation for Customer A ---');
    const flightsRes = await request('GET', '/api/flights?limit=1');
    const testFlight = flightsRes.data.flights[0];
    const seatsRes = await request('GET', `/api/flights/${testFlight.id}/seats`);
    const freeSeats = seatsRes.data.seats.filter(s => s.status === 'AVAILABLE');
    assert(freeSeats.length >= 2, 'Not enough free seats for security test');
    const seatA = freeSeats[0];
    const seatB = freeSeats[1];

    const holdResA = await request('POST', '/api/bookings/hold', {
      flightId: testFlight.id,
      seatIds: [seatA.id]
    }, { Authorization: `Bearer ${tokenA}` });
    assert.strictEqual(holdResA.status, 201, 'Customer A hold failed');
    const bookingRefA = holdResA.data.bookingReference;
    testPass(`Customer A held Seat ${seatA.column}${seatA.row} (Ref: ${bookingRefA})`);

    // -------------------------------------------------------------
    // TEST 1: Customer A cannot view Customer B's bookings
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Booking History Isolation ---');
    // Customer A attempts to view Customer B's bookings via ?accountId tampering
    const spyRes = await request('GET', `/api/reservations/my?accountId=${userB.id}`, null, {
      Authorization: `Bearer ${tokenA}`
    });
    assert.strictEqual(spyRes.status, 403, 'Expected 403 when Customer A queries Customer B accountId');
    testPass('Customer A blocked with 403 Forbidden when requesting Customer B bookings');

    // Customer A views own bookings
    const ownBookings = await request('GET', `/api/reservations/my?accountId=${userA.id}`, null, {
      Authorization: `Bearer ${tokenA}`
    });
    assert.strictEqual(ownBookings.status, 200);
    const hasMyRef = ownBookings.data.some(b => b.bookingReference === bookingRefA);
    assert.strictEqual(hasMyRef, true, 'Customer A can view their own booking');
    testPass('Customer A successfully views own booking history');

    // -------------------------------------------------------------
    // TEST 2: Customer B cannot access Customer A's booking via URL
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Direct Booking URL Access Control ---');
    const urlTamper = await request('GET', `/api/bookings/${bookingRefA}`, null, {
      Authorization: `Bearer ${tokenB}`
    });
    assert.strictEqual(urlTamper.status, 403, 'Expected 403 when Customer B accesses Customer A booking');
    testPass('Customer B denied with 403 Forbidden when navigating directly to Customer A booking URL');

    const unauthTamper = await request('GET', `/api/bookings/${bookingRefA}`);
    assert.strictEqual(unauthTamper.status, 401, 'Expected 401 for unauthenticated direct URL access');
    testPass('Unauthenticated visitor denied with 401 Unauthorized for direct booking URL access');

    // -------------------------------------------------------------
    // TEST 3: Customer B cannot retrieve Customer A's personal info
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Personal Information Privacy ---');
    const profileSpy = await request('GET', `/api/profile?accountId=${userA.id}`, null, {
      Authorization: `Bearer ${tokenB}`
    });
    assert.strictEqual(profileSpy.status, 403, 'Expected 403 when Customer B queries Customer A profile');
    testPass('Customer B denied with 403 Forbidden when requesting Customer A personal profile');

    const profileMod = await request('PUT', '/api/profile', {
      accountId: userA.id,
      firstName: 'HackedName',
      lastName: 'HackedLast'
    }, { Authorization: `Bearer ${tokenB}` });
    assert.strictEqual(profileMod.status, 403, 'Expected 403 when Customer B tries to modify Customer A profile');
    testPass('Customer B denied with 403 Forbidden when attempting to modify Customer A profile');

    // -------------------------------------------------------------
    // TEST 4: Customer A cannot download Customer B's boarding pass
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Boarding Pass & Ticket Download Privacy ---');
    // Customer B holds seatB
    const holdResB = await request('POST', '/api/bookings/hold', {
      flightId: testFlight.id,
      seatIds: [seatB.id]
    }, { Authorization: `Bearer ${tokenB}` });
    assert.strictEqual(holdResB.status, 201);
    const bookingRefB = holdResB.data.bookingReference;

    // Customer A attempts to download Customer B's ticket / boarding pass
    const bpSpy = await request('GET', `/api/reservations/ticket/${bookingRefB}`, null, {
      Authorization: `Bearer ${tokenA}`
    });
    assert.strictEqual(bpSpy.status, 403, 'Expected 403 when Customer A tries to view Customer B boarding pass');
    testPass('Customer A denied with 403 Forbidden when attempting to download Customer B boarding pass');

    // Customer B can view own boarding pass
    const bpOwn = await request('GET', `/api/reservations/ticket/${bookingRefB}`, null, {
      Authorization: `Bearer ${tokenB}`
    });
    assert.strictEqual(bpOwn.status, 200, 'Customer B should view own ticket');
    testPass('Customer B can view and download their own boarding pass');

    // -------------------------------------------------------------
    // TEST 5: Customer A cannot cancel or modify Customer B's booking
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Booking Cancellation & Mutation Protection ---');
    const cancelAttack = await request('POST', '/api/bookings/cancel', {
      bookingReference: bookingRefB
    }, { Authorization: `Bearer ${tokenA}` });
    assert.strictEqual(cancelAttack.status, 403, 'Expected 403 when Customer A attempts to cancel Customer B booking');
    testPass('Customer A denied with 403 Forbidden when attempting to cancel Customer B booking');

    // Verify Customer B's booking remains intact
    const verifyIntact = await request('GET', `/api/bookings/${bookingRefB}`, null, {
      Authorization: `Bearer ${tokenB}`
    });
    assert.strictEqual(verifyIntact.status, 200);
    assert.strictEqual(verifyIntact.data.status, 'PENDING_PAYMENT');
    testPass('Customer B booking verified untouched and active');

    // -------------------------------------------------------------
    // TEST 6: Payment Privacy & Masked Card Details
    // -------------------------------------------------------------
    console.log('\n--- TEST 6: Payment Privacy & Saved Card Protection ---');
    // Save a card for Customer A
    await request('POST', '/api/cards', {
      cardHolder: 'MMH Mahin',
      cardNumber: '4532112233445566',
      expirationDate: '12/28',
      cvv: '999'
    }, { Authorization: `Bearer ${tokenA}` });

    // Customer B attempts to view Customer A cards
    const cardSpy = await request('GET', `/api/cards?accountId=${userA.id}`, null, {
      Authorization: `Bearer ${tokenB}`
    });
    assert.strictEqual(cardSpy.status, 403, 'Expected 403 when Customer B queries Customer A cards');
    testPass('Customer B denied with 403 Forbidden when requesting Customer A payment cards');

    // Customer A views own cards -> Verify raw card number and CVV are never exposed
    const ownCards = await request('GET', `/api/cards?accountId=${userA.id}`, null, {
      Authorization: `Bearer ${tokenA}`
    });
    assert.strictEqual(ownCards.status, 200);
    assert(ownCards.data.length > 0, 'Customer A should have at least 1 card');
    const c = ownCards.data[0];
    assert(!c.cardNumber.includes('45321122'), 'Full 16-digit card number must NEVER be exposed');
    assert(c.cardNumber.includes('••••'), 'Card number must be masked (e.g. •••• •••• •••• 5566)');
    assert(!c.CVV || c.CVV === '•••', 'Raw CVV must never be returned in API response');
    testPass('Payment details strictly masked with least-privilege tokens (•••• •••• •••• 5566)');

    // -------------------------------------------------------------
    // TEST 7: Logout Invalidation & Client Cache Protection
    // -------------------------------------------------------------
    console.log('\n--- TEST 7: Logout Session Revocation & Client Cache Clean ---');
    const tempLogin = await request('POST', '/api/auth/login', { username: 'Mahin0', password: 'Mahin0' });
    const tempToken = tempLogin.data.token;
    // Verify token works
    const checkBefore = await request('GET', '/api/auth/me', null, { Authorization: `Bearer ${tempToken}` });
    assert.strictEqual(checkBefore.status, 200);

    // Perform logout
    const logoutRes = await request('POST', '/api/auth/logout', null, { Authorization: `Bearer ${tempToken}` });
    assert.strictEqual(logoutRes.status, 200);

    // Verify token is permanently dead
    const checkAfter = await request('GET', '/api/auth/me', null, { Authorization: `Bearer ${tempToken}` });
    assert.strictEqual(checkAfter.status, 401, 'Logged out token must be rejected with 401');
    testPass('Session token successfully invalidated on server upon logout (401 Unauthorized)');

    // -------------------------------------------------------------
    // TEST 8: Passenger accounts cannot access Airline Admin APIs
    // -------------------------------------------------------------
    console.log('\n--- TEST 8: Role-Based Admin Protection ---');
    const adminBookingsSpy = await request('GET', '/api/admin/all-bookings', null, { Authorization: `Bearer ${tokenA}` });
    assert.strictEqual(adminBookingsSpy.status, 403, 'Passenger must receive 403 on admin bookings');
    testPass('Passenger denied with 403 Forbidden from accessing /api/admin/all-bookings');

    const adminFlightsSpy = await request('GET', '/api/airline/flights?airlineId=839', null, { Authorization: `Bearer ${tokenA}` });
    assert.strictEqual(adminFlightsSpy.status, 403, 'Passenger must receive 403 on airline flights');
    testPass('Passenger denied with 403 Forbidden from accessing /api/airline/flights');

    const adminStatsSpy = await request('GET', '/api/airline/stats?airlineId=839', null, { Authorization: `Bearer ${tokenA}` });
    assert.strictEqual(adminStatsSpy.status, 403, 'Passenger must receive 403 on airline statistics');
    testPass('Passenger denied with 403 Forbidden from accessing /api/airline/stats');

    // -------------------------------------------------------------
    // TEST 9: Airline Admin Multi-Tenant Isolation
    // -------------------------------------------------------------
    console.log('\n--- TEST 9: Multi-Tenant Airline Isolation ---');
    // Biman Admin (id: 839) accesses Biman data
    const bimanOwnFlights = await request('GET', '/api/airline/flights?airlineId=839', null, { Authorization: `Bearer ${tokenBiman}` });
    assert.strictEqual(bimanOwnFlights.status, 200);
    testPass('Biman Admin can access Biman Bangladesh Airlines flights');

    // Biman Admin attempts to access US-Bangla Airlines (id: 371)
    const bimanSneakUSB = await request('GET', '/api/airline/flights?airlineId=371', null, { Authorization: `Bearer ${tokenBiman}` });
    assert.strictEqual(bimanSneakUSB.status, 403, 'Biman Admin must not access US-Bangla flights');
    testPass('Biman Admin blocked with 403 Forbidden from accessing US-Bangla Airlines data');

    // US-Bangla Admin attempts to access Biman data
    const usbSneakBiman = await request('GET', '/api/airline/flights?airlineId=839', null, { Authorization: `Bearer ${tokenUSB}` });
    assert.strictEqual(usbSneakBiman.status, 403, 'US-Bangla Admin must not access Biman flights');
    testPass('US-Bangla Admin blocked with 403 Forbidden from accessing Biman Airlines data');

    // -------------------------------------------------------------
    // TEST 10: 15-Minute Conflict-Free Reservation & Payment Workflow
    // -------------------------------------------------------------
    console.log('\n--- TEST 10: 15-Minute Seat Hold & Payment Confirmation ---');
    // Check remaining time on Customer A booking
    const holdCheck = await request('GET', `/api/bookings/${bookingRefA}`, null, { Authorization: `Bearer ${tokenA}` });
    assert.strictEqual(holdCheck.status, 200);
    assert(holdCheck.data.secondsRemaining > 0 && holdCheck.data.secondsRemaining <= 900, 'Countdown must be between 1 and 900 seconds');
    testPass(`15-Minute Countdown active: ${holdCheck.data.secondsRemaining}s remaining`);

    // Complete payment
    const confirmRes = await request('POST', '/api/bookings/confirm', {
      bookingReference: bookingRefA,
      paymentMethod: 'credit_card',
      transactionRef: `TXN-SEC-${Date.now()}`
    }, { Authorization: `Bearer ${tokenA}` });
    assert.strictEqual(confirmRes.status, 200);
    assert.strictEqual(confirmRes.data.status, 'CONFIRMED');
    assert.strictEqual(confirmRes.data.ticket.status, 'CONFIRMED');
    testPass(`Booking ${bookingRefA} successfully confirmed and ticket issued`);

    // Clean up Customer B hold
    await request('POST', '/api/bookings/cancel', { bookingReference: bookingRefB }, { Authorization: `Bearer ${tokenB}` });
    testPass('Test booking cleaned up safely');

    console.log('\n===============================================================');
    console.log(`SECURITY VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
    console.log('===============================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    testFail('Unexpected test suite error', err);
    process.exit(1);
  }
}

runSecurityTests();
