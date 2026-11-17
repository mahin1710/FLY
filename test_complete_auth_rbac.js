const http = require('node:http');
const fs = require('node:fs');

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (postData) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
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
        let json = null;
        try { json = JSON.parse(data); } catch (_) { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, data: json });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runVerification() {
  console.log('===============================================================');
  console.log('   FULL END-TO-END VERIFICATION: DEDICATED AUTH & RBAC SYSTEM   ');
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

  // TEST 1: Dedicated routes served by Express
  console.log('1. Verifying Dedicated Routes (/login and /logout)...');
  const loginRoute = await request('GET', '/login');
  assert(loginRoute.status === 200, 'GET /login returns HTTP 200');
  assert(typeof loginRoute.data === 'string' && loginRoute.data.includes('id="pageAuth"'), 'GET /login serves application index page containing pageAuth');

  const logoutRoute = await request('GET', '/logout');
  assert(logoutRoute.status === 200, 'GET /logout returns HTTP 200');

  // TEST 2: Inspect Frontend HTML for Dedicated Login, Demo Accounts & Logout Modal
  console.log('\n2. Verifying Frontend Elements (HTML & CSS)...');
  const html = fs.readFileSync('Skynet-master/Skynet-master/web/public/index.html', 'utf8');
  assert(html.includes('id="pageAuth"'), 'index.html contains dedicated pageAuth container');
  assert(html.includes('id="authPageLoginUsername"') && html.includes('id="authPageLoginPassword"'), 'pageAuth has username and password input fields');
  assert(html.includes('app.togglePasswordVisibility(\'authPageLoginPassword\''), 'pageAuth has Show/Hide password toggle button');
  assert(html.includes('id="authPageRememberMe"'), 'pageAuth has Remember Me checkbox');
  assert(html.includes('id="modalLogoutConfirm"'), 'index.html has Dedicated Logout Confirmation modal (#modalLogoutConfirm)');
  assert(html.includes('app.executeLogout()'), 'Logout Confirmation modal triggers app.executeLogout()');

  // Verify 4 Demo Accounts are present on the dedicated login page
  assert(html.includes('MMH_Mahin') && html.includes('Mahin0'), 'Demo Accounts section contains MMH_Mahin (Mahin0)');
  assert(html.includes('Biman Bangladesh Airlines') && html.includes('Admin_Biman'), 'Demo Accounts section contains Biman Bangladesh Airlines (Admin_Biman)');
  assert(html.includes('US-Bangla Airlines') && html.includes('Admin_USB'), 'Demo Accounts section contains US-Bangla Airlines (Admin_USB)');
  assert(html.includes('Mahin1'), 'Demo Accounts section contains Mahin1');
  assert(html.includes('app.fillDemoAccount') && html.includes('app.instantLogin'), 'Demo accounts provide auto-fill and 1-click login');

  // TEST 3: Seeding and Credentials
  console.log('\n3. Verifying Seeded Credentials and Password Hashing...');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('Skynet-master/Skynet-master/web/database.db');
  const accounts = db.prepare('SELECT username, password, role, display_name, id_airline, id_passenger FROM accounts WHERE username IN (\'Mahin0\', \'Admin_Biman\', \'Admin_USB\', \'Mahin1\')').all();
  
  assert(accounts.length === 4, 'All 4 demo accounts exist in database');
  for (const acc of accounts) {
    assert(acc.password.startsWith('scrypt:'), `Account ${acc.username} has scrypt-hashed password (not plain text)`);
  }

  // TEST 4: Login Authentication for All 4 Accounts
  console.log('\n4. Verifying API Login & Session Tokens for All 4 Accounts...');
  const resMahin0 = await request('POST', '/api/auth/login', { username: 'Mahin0', password: 'Mahin0', rememberMe: true });
  assert(resMahin0.status === 200, 'Mahin0 logged in successfully');
  assert(resMahin0.data.user.role === 'PASSENGER', 'Mahin0 role is PASSENGER');
  assert(resMahin0.data.user.displayName === 'MMH_Mahin', 'Mahin0 display name is MMH_Mahin');
  const tokenMahin0 = resMahin0.data.token;

  const resBiman = await request('POST', '/api/auth/login', { username: 'Admin_Biman', password: 'Admin_Biman' });
  assert(resBiman.status === 200, 'Admin_Biman logged in successfully');
  assert(resBiman.data.user.role === 'AIRLINE_ADMIN', 'Admin_Biman role is AIRLINE_ADMIN');
  assert(resBiman.data.user.id_airline === 839, 'Admin_Biman is bound to Biman Bangladesh Airlines (id: 839)');
  const tokenBiman = resBiman.data.token;

  const resUSB = await request('POST', '/api/auth/login', { username: 'Admin_USB', password: 'Admin_USB' });
  assert(resUSB.status === 200, 'Admin_USB logged in successfully');
  assert(resUSB.data.user.role === 'AIRLINE_ADMIN', 'Admin_USB role is AIRLINE_ADMIN');
  assert(resUSB.data.user.id_airline === 371, 'Admin_USB is bound to US-Bangla Airlines (id: 371)');
  const tokenUSB = resUSB.data.token;

  const resMahin1 = await request('POST', '/api/auth/login', { username: 'Mahin1', password: 'Mahin1' });
  assert(resMahin1.status === 200, 'Mahin1 logged in successfully');
  assert(resMahin1.data.user.role === 'PASSENGER', 'Mahin1 role is PASSENGER');
  const tokenMahin1 = resMahin1.data.token;

  // TEST 5: Role-Based Access Control (RBAC) Enforcement
  console.log('\n5. Verifying Backend-Enforced RBAC & Tenant Isolation...');

  // 5A: Passenger denied admin routes
  const passengerAdminBookings = await request('GET', '/api/admin/all-bookings', null, { Authorization: `Bearer ${tokenMahin0}` });
  assert(passengerAdminBookings.status === 403, 'Passenger blocked from /api/admin/all-bookings (403 Forbidden)');

  const passengerFlights = await request('GET', '/api/airline/flights?airlineId=839', null, { Authorization: `Bearer ${tokenMahin0}` });
  assert(passengerFlights.status === 403, 'Passenger blocked from /api/airline/flights (403 Forbidden)');

  const passengerStats = await request('GET', '/api/airline/stats?airlineId=839', null, { Authorization: `Bearer ${tokenMahin0}` });
  assert(passengerStats.status === 403, 'Passenger blocked from /api/airline/stats (403 Forbidden)');

  // 5B: Biman Admin isolation
  const bimanBookings = await request('GET', '/api/admin/all-bookings', null, { Authorization: `Bearer ${tokenBiman}` });
  assert(bimanBookings.status === 200, 'Biman admin accessed /api/admin/all-bookings');
  assert(bimanBookings.data.airlineId === 839, 'Biman bookings response strictly scoped to Biman (839)');

  const bimanIntrudeUSB = await request('GET', '/api/airline/flights?airlineId=371', null, { Authorization: `Bearer ${tokenBiman}` });
  assert(bimanIntrudeUSB.status === 403, 'Biman admin blocked from viewing US-Bangla flights (403 Forbidden)');

  const bimanIntrudeUSBStats = await request('GET', '/api/airline/stats?airlineId=371', null, { Authorization: `Bearer ${tokenBiman}` });
  assert(bimanIntrudeUSBStats.status === 403, 'Biman admin blocked from viewing US-Bangla stats (403 Forbidden)');

  // 5C: US-Bangla Admin isolation
  const usbBookings = await request('GET', '/api/admin/all-bookings', null, { Authorization: `Bearer ${tokenUSB}` });
  assert(usbBookings.status === 200, 'US-Bangla admin accessed /api/admin/all-bookings');
  assert(usbBookings.data.airlineId === 371, 'US-Bangla bookings response strictly scoped to US-Bangla (371)');

  const usbIntrudeBiman = await request('GET', '/api/airline/flights?airlineId=839', null, { Authorization: `Bearer ${tokenUSB}` });
  assert(usbIntrudeBiman.status === 403, 'US-Bangla admin blocked from viewing Biman flights (403 Forbidden)');

  // 5D: Passenger isolation
  const mahin0AccId = resMahin0.data.user.id;
  const mahin1AccId = resMahin1.data.user.id;
  const passSpy = await request('GET', `/api/reservations/my?accountId=${mahin1AccId}`, null, { Authorization: `Bearer ${tokenMahin0}` });
  assert(passSpy.status === 403, 'Passenger Mahin0 cannot view Passenger Mahin1 bookings (403 Forbidden)');

  const passOwn = await request('GET', `/api/reservations/my?accountId=${mahin0AccId}`, null, { Authorization: `Bearer ${tokenMahin0}` });
  assert(passOwn.status === 200, 'Passenger Mahin0 can view own bookings (200 OK)');

  // TEST 6: Logout Invalidation
  console.log('\n6. Verifying Logout & Server-Side Token Invalidation...');
  const logoutRes = await request('POST', '/api/auth/logout', null, { Authorization: `Bearer ${tokenMahin0}` });
  assert(logoutRes.status === 200, 'Logout request succeeded (200 OK)');

  const verifyDead = await request('GET', '/api/auth/me', null, { Authorization: `Bearer ${tokenMahin0}` });
  assert(verifyDead.status === 401, 'Logged-out token is dead (401 Unauthorized)');

  // TEST 7: Conflict-Free Ticketing System Integration Intact
  console.log('\n7. Verifying Conflict-Free Seat Reservation Remains Fully Functional...');
  const bimanFlight = db.prepare('SELECT id FROM flights WHERE id_airline = 839 LIMIT 1').get();
  // Select seats that are currently AVAILABLE on this flight
  const seats = db.prepare(`
    SELECT id FROM seats 
    WHERE id NOT IN (
      SELECT id_seat FROM reservations WHERE id_flight = ? AND status IN ('HELD', 'CONFIRMED')
    )
    LIMIT 2
  `).all(bimanFlight.id);

  // Test reservation hold
  const holdRes = await request('POST', '/api/bookings/hold', {
    flightId: bimanFlight.id,
    accountId: mahin1AccId,
    seatIds: [seats[0].id]
  }, { Authorization: `Bearer ${tokenMahin1}` });
  assert((holdRes.status === 200 || holdRes.status === 201) && holdRes.data.success === true, 'Seat hold succeeded with 15-minute countdown');
  assert(Boolean(holdRes.data.bookingReference), 'Created booking reference');
  assert(holdRes.data.expiresInSeconds === 900, 'Expires in exactly 900 seconds (15 minutes)');

  // Test concurrent collision on the held seat
  const conflictRes = await request('POST', '/api/bookings/hold', {
    flightId: bimanFlight.id,
    accountId: mahin0AccId,
    seatIds: [seats[0].id]
  });
  assert(conflictRes.status === 409, 'Concurrent seat hold collision rejected with 409 Conflict');
  assert(conflictRes.data.error.includes('Sorry, this seat has just been reserved'), 'Proper conflict message returned');

  // Cancel hold to clean up
  await request('POST', '/api/bookings/cancel', { bookingReference: holdRes.data.bookingReference });

  console.log('\n===============================================================');
  console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runVerification();
