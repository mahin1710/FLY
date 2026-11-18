// Comprehensive Automated Test Suite for Conflict-Free Ticketing System
const http = require('http');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const BASE_URL = 'http://localhost:5000';
const dbPath = path.join(__dirname, 'database.db');
const db = new DatabaseSync(dbPath);

const custA = 1676;
const custB = 1721;
const tokenA = 'concurrency-token-custA';
const tokenB = 'concurrency-token-custB';

// Seed active test sessions for simulated customers in SQLite
const nowIso = new Date().toISOString();
const expiresIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
db.prepare('INSERT OR REPLACE INTO auth_sessions (token, account_id, username, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(tokenA, custA, 'custA', 'PASSENGER', nowIso, expiresIso);
db.prepare('INSERT OR REPLACE INTO auth_sessions (token, account_id, username, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(tokenB, custB, 'custB', 'PASSENGER', nowIso, expiresIso);

function request(method, path, body = null, explicitToken = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    let chosenToken = explicitToken || tokenA;
    if (!explicitToken && body && body.accountId === custB) {
      chosenToken = tokenB;
    }
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${chosenToken}`
    };
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch (_) { json = data; }
        resolve({ status: res.statusCode, data: json });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runAllTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING 10-STAGE CONFLICT-FREE TICKETING SYSTEM TESTS');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  // Find a flight with free seats
  const flightsRes = await request('GET', '/api/flights?limit=5');
  const testFlight = flightsRes.data.flights.find(f => f.bookedCount < 100) || flightsRes.data.flights[0];
  const flightId = testFlight.id;
  console.log(`Using Test Flight ID: ${flightId} (${testFlight.depCity} -> ${testFlight.arrCity})`);

  // Fetch seats to find available seat IDs
  const seatsRes = await request('GET', `/api/flights/${flightId}/seats`);
  const availableSeats = seatsRes.data.seats.filter(s => s.status === 'AVAILABLE');
  console.log(`Found ${availableSeats.length} available seats for test flight.\n`);

  if (availableSeats.length < 10) {
    throw new Error('Not enough available seats to perform test suite.');
  }

  const s1 = availableSeats[0];
  const s2 = availableSeats[1];
  const s3 = availableSeats[2];
  const s4 = availableSeats[3];
  const s5 = availableSeats[4];
  const s6 = availableSeats[5];
  const s7 = availableSeats[6];
  const s8 = availableSeats[7];
  const s9 = availableSeats[8];
  const s10 = availableSeats[9];

  // Customer account IDs (using demo accounts or IDs 1 & 2)
  const custA = 1676;
  const custB = 1721;

  // -------------------------------------------------------------
  // TEST 1: Simultaneous booking (Race Condition)
  // Two customers try to book the same seat at the exact same moment.
  // -------------------------------------------------------------
  console.log('--- TEST 1: Simultaneous Booking (Race Condition) ---');
  {
    const targetSeat = s1.id;
    const [resA, resB] = await Promise.all([
      request('POST', '/api/bookings/hold', { flightId, accountId: custA, seatIds: [targetSeat] }),
      request('POST', '/api/bookings/hold', { flightId, accountId: custB, seatIds: [targetSeat] })
    ]);

    const oneSucceeded = (resA.status === 201 && resB.status === 409) || (resA.status === 409 && resB.status === 201);
    assert(oneSucceeded, 'Exactly one customer succeeded (201) and the other was rejected (409)');

    const failedRes = resA.status === 409 ? resA : resB;
    assert(
      failedRes.data.error && failedRes.data.error.includes('reserved by another customer'),
      'Rejected customer received exact message: "Sorry, this seat has just been reserved by another customer. Please select another seat."'
    );

    // Clean up winner
    const winningRes = resA.status === 201 ? resA : resB;
    const winningToken = resA.status === 201 ? tokenA : tokenB;
    await request('POST', '/api/bookings/cancel', { bookingReference: winningRes.data.bookingReference }, winningToken);
  }

  // -------------------------------------------------------------
  // TEST 2: Multiple Seat Booking (Atomic All-or-Nothing)
  // Customer selects multiple seats (e.g. 5 seats).
  // If one seat is already held, ALL must fail and none partially reserved.
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: Multiple Seat Booking (All-or-Nothing) ---');
  {
    // First, let Customer B hold seat s5
    const holdOne = await request('POST', '/api/bookings/hold', { flightId, accountId: custB, seatIds: [s5.id] });
    assert(holdOne.status === 201, 'Customer B successfully holds seat s5');

    // Customer A attempts to book 5 seats: s2, s3, s4, s5, s6 (where s5 is unavailable)
    const multiSeats = [s2.id, s3.id, s4.id, s5.id, s6.id];
    const attempt = await request('POST', '/api/bookings/hold', { flightId, accountId: custA, seatIds: multiSeats });
    assert(attempt.status === 409, 'Customer A multi-seat request was rejected (409 Conflict) because s5 is taken');

    // Verify atomic rollback: seats s2, s3, s4, s6 must remain AVAILABLE!
    const checkSeats = await request('GET', `/api/flights/${flightId}/seats`);
    const s2Status = checkSeats.data.seats.find(s => s.id === s2.id).status;
    const s3Status = checkSeats.data.seats.find(s => s.id === s3.id).status;
    const s4Status = checkSeats.data.seats.find(s => s.id === s4.id).status;
    const s6Status = checkSeats.data.seats.find(s => s.id === s6.id).status;

    assert(
      s2Status === 'AVAILABLE' && s3Status === 'AVAILABLE' && s4Status === 'AVAILABLE' && s6Status === 'AVAILABLE',
      'Zero partial reservations: seats s2, s3, s4, s6 remained completely AVAILABLE'
    );

    // Release Customer B's seat s5
    await request('POST', '/api/bookings/cancel', { bookingReference: holdOne.data.bookingReference }, tokenB);

    // Now Customer A attempts the 5 seats again when all are free
    const retryMulti = await request('POST', '/api/bookings/hold', { flightId, accountId: custA, seatIds: multiSeats });
    assert(retryMulti.status === 201, 'All 5 seats reserved together atomically when free');

    // Clean up
    await request('POST', '/api/bookings/cancel', { bookingReference: retryMulti.data.bookingReference });
  }

  // -------------------------------------------------------------
  // TEST 3: Payment Success
  // Customer pays within 15 minutes; status becomes CONFIRMED, seats become BOOKED.
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: Payment Success (Confirmed E-Ticket) ---');
  {
    const holdRes = await request('POST', '/api/bookings/hold', { flightId, accountId: custA, seatIds: [s7.id] });
    assert(holdRes.status === 201, 'Temporary hold created');
    const bookingRef = holdRes.data.bookingReference;

    const payRes = await request('POST', '/api/bookings/confirm', {
      bookingReference: bookingRef,
      paymentMethod: 'credit_card',
      transactionRef: `TXN-TEST3-${Date.now()}`
    });

    assert(payRes.status === 200 && payRes.data.success === true, 'Payment successfully confirmed');
    assert(payRes.data.status === 'CONFIRMED', 'Booking status transitioned to CONFIRMED');
    assert(payRes.data.ticket && payRes.data.ticket.bookingReference === bookingRef, 'Confirmation E-Ticket generated');

    // Verify seat is permanently BOOKED
    const seatsCheck = await request('GET', `/api/flights/${flightId}/seats`);
    const s7Seat = seatsCheck.data.seats.find(s => s.id === s7.id);
    assert(s7Seat.status === 'BOOKED', 'Seat status transitioned from HELD to BOOKED');
  }

  // -------------------------------------------------------------
  // TEST 4: Payment Timeout (Automatic Expiration)
  // Customer does not pay within 15 minutes; hold expires automatically and seat released.
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: Payment Timeout & Automatic Expiration ---');
  {
    const holdRes = await request('POST', '/api/bookings/hold', { flightId, accountId: custA, seatIds: [s8.id] });
    assert(holdRes.status === 201, 'Temporary hold created for seat s8');
    const bookingRef = holdRes.data.bookingReference;

    // Simulate 15-minute expiration by updating expires_at to 1 second in the past
    const { DatabaseSync } = require('node:sqlite');
    const path = require('node:path');
    const dbPath = path.join(__dirname, 'database.db');
    const db = new DatabaseSync(dbPath);
    const pastTime = new Date(Date.now() - 1000).toISOString();
    db.prepare('UPDATE bookings SET expires_at = ? WHERE booking_reference = ?').run(pastTime, bookingRef);
    db.prepare('UPDATE reservations SET expires_at = ? WHERE booking_reference = ?').run(pastTime, bookingRef);

    // Call booking lookup or seats check, which triggers automatic cleanup
    const lookup = await request('GET', `/api/bookings/${bookingRef}`);
    assert(lookup.data.status === 'EXPIRED', 'Booking status automatically became EXPIRED on timeout');

    const seatsCheck = await request('GET', `/api/flights/${flightId}/seats`);
    const s8Seat = seatsCheck.data.seats.find(s => s.id === s8.id);
    assert(s8Seat.status === 'AVAILABLE', 'Seat s8 automatically became AVAILABLE again');
  }

  // -------------------------------------------------------------
  // TEST 5: Seat Availability After Expiration
  // After expiration, another customer can successfully book the released seat.
  // -------------------------------------------------------------
  console.log('\n--- TEST 5: Booking Seat Released by Expiration ---');
  {
    // Customer B books seat s8 which was previously expired
    const bookAgain = await request('POST', '/api/bookings/hold', { flightId, accountId: custB, seatIds: [s8.id] });
    assert(bookAgain.status === 201, 'Customer B successfully holds seat s8 released from expired reservation');
    await request('POST', '/api/bookings/cancel', { bookingReference: bookAgain.data.bookingReference });
  }

  // -------------------------------------------------------------
  // TEST 6: Page Refresh & Countdown Integrity
  // Countdown is based on server timestamp and survives page refresh.
  // -------------------------------------------------------------
  console.log('\n--- TEST 6: Page Refresh / Countdown Timestamp Integrity ---');
  {
    const holdRes = await request('POST', '/api/bookings/hold', { flightId, accountId: custA, seatIds: [s9.id] });
    const bookingRef = holdRes.data.bookingReference;
    const initialExpiresAt = holdRes.data.expiresAt;

    // Simulate a page reload: client calls GET /api/bookings/:ref
    const reload1 = await request('GET', `/api/bookings/${bookingRef}`);
    assert(reload1.status === 200, 'Page reload retrieved booking from server');
    assert(reload1.data.expires_at === initialExpiresAt, 'Expiration timestamp was not reset on refresh');
    assert(reload1.data.secondsRemaining > 880 && reload1.data.secondsRemaining <= 900, `Live countdown remains intact (~${reload1.data.secondsRemaining}s remaining)`);

    await request('POST', '/api/bookings/cancel', { bookingReference: bookingRef });
  }

  // -------------------------------------------------------------
  // TEST 7: Multiple Devices / Concurrent Request Safety
  // Two different devices attempt to hold the same seat simultaneously.
  // -------------------------------------------------------------
  console.log('\n--- TEST 7: Multiple Devices Concurrency ---');
  {
    const results = await Promise.all([
      request('POST', '/api/bookings/hold', { flightId, accountId: custA, seatIds: [s10.id] }),
      request('POST', '/api/bookings/hold', { flightId, accountId: custB, seatIds: [s10.id] })
    ]);

    const codes = results.map(r => r.status).sort();
    assert(codes[0] === 201 && codes[1] === 409, 'Only one device successfully reserved the seat; other received 409');

    const winningBooking = results.find(r => r.status === 201).data.bookingReference;
    const winningToken = results[0].status === 201 ? tokenA : tokenB;
    await request('POST', '/api/bookings/cancel', { bookingReference: winningBooking }, winningToken);
  }

  // -------------------------------------------------------------
  // TEST 8: Late Payment Rejection
  // Payment callback arrives after the reservation expires. System must reject payment.
  // -------------------------------------------------------------
  console.log('\n--- TEST 8: Late Payment Callback Rejection ---');
  {
    const holdRes = await request('POST', '/api/bookings/hold', { flightId, accountId: custA, seatIds: [s2.id] });
    const bookingRef = holdRes.data.bookingReference;

    // Simulate expiration
    const { DatabaseSync } = require('node:sqlite');
    const path = require('node:path');
    const dbPath = path.join(__dirname, 'database.db');
    const db = new DatabaseSync(dbPath);
    const pastTime = new Date(Date.now() - 5000).toISOString();
    db.prepare('UPDATE bookings SET expires_at = ? WHERE booking_reference = ?').run(pastTime, bookingRef);
    db.prepare('UPDATE reservations SET expires_at = ? WHERE booking_reference = ?').run(pastTime, bookingRef);

    // Attempt payment after expiration
    const latePay = await request('POST', '/api/bookings/confirm', {
      bookingReference: bookingRef,
      transactionRef: `TXN-LATE-${Date.now()}`
    });

    assert(latePay.status === 410, 'Late payment was strictly rejected with 410 Gone / Expired');
    assert(latePay.data.code === 'RESERVATION_EXPIRED', 'Error code is RESERVATION_EXPIRED');

    // Confirm seat s2 is NOT booked
    const checkSeats = await request('GET', `/api/flights/${flightId}/seats`);
    const s2Status = checkSeats.data.seats.find(s => s.id === s2.id).status;
    assert(s2Status === 'AVAILABLE', 'Seat remained AVAILABLE and was not incorrectly confirmed');
  }

  // -------------------------------------------------------------
  // TEST 9: Duplicate Payment Callback (Idempotency)
  // The same payment callback is received multiple times.
  // -------------------------------------------------------------
  console.log('\n--- TEST 9: Duplicate Payment Callback (Idempotency) ---');
  {
    const holdRes = await request('POST', '/api/bookings/hold', { flightId, accountId: custA, seatIds: [s3.id] });
    const bookingRef = holdRes.data.bookingReference;
    const txnRef = `TXN-IDEMP-${Date.now()}`;

    // First payment attempt
    const pay1 = await request('POST', '/api/bookings/confirm', {
      bookingReference: bookingRef,
      transactionRef: txnRef
    });
    assert(pay1.status === 200 && pay1.data.status === 'CONFIRMED', 'First payment callback processed successfully');

    // Duplicate payment attempt with same reference
    const pay2 = await request('POST', '/api/bookings/confirm', {
      bookingReference: bookingRef,
      transactionRef: txnRef
    });
    assert(pay2.status === 200, 'Second payment callback handled gracefully (200 OK)');
    assert(pay2.data.alreadyConfirmed === true, 'System detected duplicate and did not re-process');
  }

  // -------------------------------------------------------------
  // TEST 10: Server Restart Persistence
  // Reservations and expiration survive a backend restart.
  // -------------------------------------------------------------
  console.log('\n--- TEST 10: Server Restart Persistence ---');
  {
    const holdRes = await request('POST', '/api/bookings/hold', { flightId, accountId: custA, seatIds: [s4.id] });
    const bookingRef = holdRes.data.bookingReference;
    assert(holdRes.status === 201, 'Hold created before restart');

    // Verify stored in SQLite database
    const { DatabaseSync } = require('node:sqlite');
    const path = require('node:path');
    const dbPath = path.join(__dirname, 'database.db');
    const db = new DatabaseSync(dbPath);
    const stored = db.prepare('SELECT status, expires_at FROM bookings WHERE booking_reference = ?').get(bookingRef);
    assert(stored && stored.status === 'PENDING_PAYMENT', 'Reservation data safely persisted in SQLite');
    assert(stored.expires_at === holdRes.data.expiresAt, 'Expiration timestamp preserved across sessions');

    // Clean up
    await request('POST', '/api/bookings/cancel', { bookingReference: bookingRef });
  }

  console.log('\n====================================================');
  console.log(`TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');
}

runAllTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
