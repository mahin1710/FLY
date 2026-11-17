const http = require('node:http');

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
        resolve({ status: res.statusCode, data: json });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('=== STARTING RBAC & AUTHENTICATION API TEST SUITE ===\n');
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

  try {
    // 1. Test Demo Users Endpoint
    console.log('1. Testing GET /api/auth/demo-users...');
    const demoRes = await request('GET', '/api/auth/demo-users');
    assert(demoRes.status === 200, 'GET /api/auth/demo-users returned 200');
    assert(Array.isArray(demoRes.data) && demoRes.data.length === 4, 'Returned 4 seeded demo accounts');
    assert(demoRes.data.some(u => u.username === 'Mahin0' && u.role === 'PASSENGER'), 'Contains Mahin0 as PASSENGER');
    assert(demoRes.data.some(u => u.username === 'Admin_Biman' && u.role === 'AIRLINE_ADMIN'), 'Contains Admin_Biman as AIRLINE_ADMIN');
    assert(demoRes.data.some(u => u.username === 'Admin_USB' && u.role === 'AIRLINE_ADMIN'), 'Contains Admin_USB as AIRLINE_ADMIN');
    assert(demoRes.data.some(u => u.username === 'Mahin1' && u.role === 'PASSENGER'), 'Contains Mahin1 as PASSENGER');

    // 2. Test Login for all 4 accounts
    console.log('\n2. Testing POST /api/auth/login for all 4 accounts...');
    
    // 2A. Mahin0
    const loginMahin0 = await request('POST', '/api/auth/login', { username: 'Mahin0', password: 'Mahin0' });
    assert(loginMahin0.status === 200, 'Mahin0 login succeeded (200)');
    assert(Boolean(loginMahin0.data.token), 'Mahin0 received session token');
    assert(loginMahin0.data.user.role === 'PASSENGER', 'Mahin0 user role is PASSENGER');
    assert(loginMahin0.data.user.displayName === 'MMH_Mahin', 'Mahin0 displayName is MMH_Mahin');
    const mahin0Token = loginMahin0.data.token;
    const mahin0Id = loginMahin0.data.user.id;

    // 2B. Admin_Biman
    const loginBiman = await request('POST', '/api/auth/login', { username: 'Admin_Biman', password: 'Admin_Biman' });
    assert(loginBiman.status === 200, 'Admin_Biman login succeeded (200)');
    assert(Boolean(loginBiman.data.token), 'Admin_Biman received session token');
    assert(loginBiman.data.user.role === 'AIRLINE_ADMIN', 'Admin_Biman role is AIRLINE_ADMIN');
    assert(loginBiman.data.user.id_airline === 839, 'Admin_Biman airlineId is 839 (Biman)');
    const bimanToken = loginBiman.data.token;

    // 2C. Admin_USB
    const loginUSB = await request('POST', '/api/auth/login', { username: 'Admin_USB', password: 'Admin_USB' });
    assert(loginUSB.status === 200, 'Admin_USB login succeeded (200)');
    assert(Boolean(loginUSB.data.token), 'Admin_USB received session token');
    assert(loginUSB.data.user.role === 'AIRLINE_ADMIN', 'Admin_USB role is AIRLINE_ADMIN');
    assert(loginUSB.data.user.id_airline === 371, 'Admin_USB airlineId is 371 (US-Bangla)');
    const usbToken = loginUSB.data.token;

    // 2D. Mahin1
    const loginMahin1 = await request('POST', '/api/auth/login', { username: 'Mahin1', password: 'Mahin1' });
    assert(loginMahin1.status === 200, 'Mahin1 login succeeded (200)');
    assert(Boolean(loginMahin1.data.token), 'Mahin1 received session token');
    assert(loginMahin1.data.user.role === 'PASSENGER', 'Mahin1 role is PASSENGER');
    const mahin1Token = loginMahin1.data.token;
    const mahin1Id = loginMahin1.data.user.id;

    // 2E. Incorrect password
    const badLogin = await request('POST', '/api/auth/login', { username: 'Mahin0', password: 'WrongPassword' });
    assert(badLogin.status === 401, 'Bad password rejected with 401 Unauthorized');

    // 3. Test Session Validation via GET /api/auth/me
    console.log('\n3. Testing GET /api/auth/me session validation...');
    const meMahin0 = await request('GET', '/api/auth/me', null, { Authorization: `Bearer ${mahin0Token}` });
    assert(meMahin0.status === 200 && meMahin0.data.authenticated === true, 'Mahin0 session validated via Bearer token');
    assert(meMahin0.data.user.username === 'Mahin0', 'Session belongs to Mahin0');

    const meNoToken = await request('GET', '/api/auth/me');
    assert(meNoToken.status === 401, 'Unauthenticated request to /api/auth/me rejected with 401');

    // 4. Test RBAC: Passenger cannot access Admin endpoints
    console.log('\n4. Testing RBAC restrictions on PASSENGER account...');
    const passAllBookings = await request('GET', '/api/admin/all-bookings', null, { Authorization: `Bearer ${mahin0Token}` });
    assert(passAllBookings.status === 403, 'Passenger access to /api/admin/all-bookings rejected with 403 Forbidden');

    const passFlights = await request('GET', '/api/airline/flights?airlineId=839', null, { Authorization: `Bearer ${mahin0Token}` });
    assert(passFlights.status === 403, 'Passenger access to /api/airline/flights rejected with 403 Forbidden');

    const passStats = await request('GET', '/api/airline/stats?airlineId=839', null, { Authorization: `Bearer ${mahin0Token}` });
    assert(passStats.status === 403, 'Passenger access to /api/airline/stats rejected with 403 Forbidden');

    // 5. Test RBAC & Tenant Isolation: Biman Admin vs US-Bangla Admin
    console.log('\n5. Testing Tenant Isolation between Airline Admins...');
    // Biman Admin reading all bookings
    const bimanBookings = await request('GET', '/api/admin/all-bookings', null, { Authorization: `Bearer ${bimanToken}` });
    assert(bimanBookings.status === 200, 'Biman Admin accessed /api/admin/all-bookings successfully (200)');
    assert(bimanBookings.data.airlineId === 839, 'Biman Admin response scoped to Biman airlineId (839)');

    // Biman Admin attempting to query US-Bangla (371) flights
    const bimanSneakUSB = await request('GET', '/api/airline/flights?airlineId=371', null, { Authorization: `Bearer ${bimanToken}` });
    assert(bimanSneakUSB.status === 403, 'Biman Admin attempting to access US-Bangla flights rejected with 403 Forbidden');

    // Biman Admin attempting to query US-Bangla stats
    const bimanSneakUSBStats = await request('GET', '/api/airline/stats?airlineId=371', null, { Authorization: `Bearer ${bimanToken}` });
    assert(bimanSneakUSBStats.status === 403, 'Biman Admin attempting to access US-Bangla stats rejected with 403 Forbidden');

    // US-Bangla Admin reading all bookings
    const usbBookings = await request('GET', '/api/admin/all-bookings', null, { Authorization: `Bearer ${usbToken}` });
    assert(usbBookings.status === 200, 'US-Bangla Admin accessed /api/admin/all-bookings successfully (200)');
    assert(usbBookings.data.airlineId === 371, 'US-Bangla Admin response scoped to US-Bangla airlineId (371)');

    // US-Bangla Admin attempting to query Biman (839) flights
    const usbSneakBiman = await request('GET', '/api/airline/flights?airlineId=839', null, { Authorization: `Bearer ${usbToken}` });
    assert(usbSneakBiman.status === 403, 'US-Bangla Admin attempting to access Biman flights rejected with 403 Forbidden');

    // US-Bangla Admin accessing own flights
    const usbOwnFlights = await request('GET', '/api/airline/flights?airlineId=371', null, { Authorization: `Bearer ${usbToken}` });
    assert(usbOwnFlights.status === 200 && Array.isArray(usbOwnFlights.data), 'US-Bangla Admin accessed own flights (200)');
    assert(usbOwnFlights.data.every(f => f.id_airline === 371), 'All flights belong to US-Bangla (371)');

    // 6. Test Passenger isolation: Cannot access another passenger's reservations
    console.log('\n6. Testing Passenger Data Isolation...');
    const sneakPassenger = await request('GET', `/api/reservations/my?accountId=${mahin1Id}`, null, { Authorization: `Bearer ${mahin0Token}` });
    assert(sneakPassenger.status === 403, 'Mahin0 cannot access Mahin1 reservations (403 Forbidden)');

    const ownPassenger = await request('GET', `/api/reservations/my?accountId=${mahin0Id}`, null, { Authorization: `Bearer ${mahin0Token}` });
    assert(ownPassenger.status === 200, 'Mahin0 can access own reservations (200)');

    // 7. Test Logout & Token Invalidation
    console.log('\n7. Testing POST /api/auth/logout & token invalidation...');
    const logoutRes = await request('POST', '/api/auth/logout', null, { Authorization: `Bearer ${mahin0Token}` });
    assert(logoutRes.status === 200, 'Logout request succeeded (200)');

    // Verify token is now dead
    const checkDeadToken = await request('GET', '/api/auth/me', null, { Authorization: `Bearer ${mahin0Token}` });
    assert(checkDeadToken.status === 401, 'Logged out token rejected with 401 Unauthorized');

    console.log(`\n========================================`);
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
}

runTests();
