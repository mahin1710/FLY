// test_seat_holding_responsive_and_payment.js
// Automated verification suite for FLY: Responsive Screen Fit, Seat Holding/Locking, and My Bookings Payment

const BASE_URL = 'http://localhost:5000';

async function runTests() {
  console.log('================================================================');
  console.log('FLY - RESPONSIVE FIT, SEAT HOLDING & MY BOOKINGS PAYMENT TESTS');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${details}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // 1. AUTHENTICATE TWO SEPARATE CUSTOMERS (User A & User B)
    // -------------------------------------------------------------
    console.log('>>> 1. Authenticating User A (Mahin0) and User B (Mahin1)...');
    
    const loginResA = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Mahin0', password: 'Mahin0' })
    });
    const authA = await loginResA.json();
    assert(loginResA.status === 200 && authA.token, 'User A (Mahin0) logged in successfully');

    const loginResB = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Mahin1', password: 'Mahin1' })
    });
    const authB = await loginResB.json();
    assert(loginResB.status === 200 && authB.token, 'User B (Mahin1) logged in successfully');

    const headersA = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authA.token}` };
    const headersB = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authB.token}` };

    // -------------------------------------------------------------
    // 2. FIND AVAILABLE SEATS ON A TEST FLIGHT
    // -------------------------------------------------------------
    console.log('\n>>> 2. Inspecting Seat Map for Flight 1...');
    const seatsRes = await fetch(`${BASE_URL}/api/flights/1/seats?accountId=${authA.user.id}`, { headers: headersA });
    assert(seatsRes.status === 200, 'GET /api/flights/1/seats returns 200');
    const seatsData = await seatsRes.json();
    
    const availableSeats = seatsData.seats.filter(s => s.status === 'AVAILABLE');
    assert(availableSeats.length >= 3, `Sufficient available seats found (${availableSeats.length} available)`);

    const targetSeatA = availableSeats[0];
    const targetSeatCancel = availableSeats[1];
    const targetSeatExpire = availableSeats[2];

    // -------------------------------------------------------------
    // 3. SEAT HOLDING / LOCKING: USER A HOLDS A SEAT
    // -------------------------------------------------------------
    console.log(`\n>>> 3. User A holding seat ${targetSeatA.seatCode} (ID: ${targetSeatA.id})...`);
    const holdResA = await fetch(`${BASE_URL}/api/bookings/hold`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        flightId: 1,
        seatIds: [targetSeatA.id],
        nbrLuggages: 1,
        weight: 15
      })
    });
    assert(holdResA.status === 201, 'User A hold returned HTTP 201 Created');
    const holdDataA = await holdResA.json();
    assert(holdDataA.bookingReference && holdDataA.status === 'PENDING_PAYMENT', 'Booking created with PENDING_PAYMENT status and reference: ' + holdDataA.bookingReference);

    // -------------------------------------------------------------
    // 4. CONCURRENCY CONFLICT: USER B ATTEMPTS TO HOLD SAME SEAT
    // -------------------------------------------------------------
    console.log(`\n>>> 4. User B attempting to hold same seat ${targetSeatA.seatCode}...`);
    const holdResB = await fetch(`${BASE_URL}/api/bookings/hold`, {
      method: 'POST',
      headers: headersB,
      body: JSON.stringify({
        flightId: 1,
        seatIds: [targetSeatA.id],
        nbrLuggages: 0,
        weight: 0
      })
    });
    assert(holdResB.status === 409, 'User B request rejected with HTTP 409 Conflict');
    const conflictData = await holdResB.json();
    assert(conflictData.code === 'SEAT_UNAVAILABLE', 'Server returned error code SEAT_UNAVAILABLE');

    // -------------------------------------------------------------
    // 5. REAL-TIME AVAILABILITY & IS_HELD_BY_ME CHECK
    // -------------------------------------------------------------
    console.log('\n>>> 5. Checking seat map visibility for both users...');
    const userBSeatMapRes = await fetch(`${BASE_URL}/api/flights/1/seats?accountId=${authB.user.id}`, { headers: headersB });
    const userBSeats = await userBSeatMapRes.json();
    const seatForB = userBSeats.seats.find(s => s.id === targetSeatA.id);
    assert(seatForB.status === 'HELD' && seatForB.isHeldByMe === false, `User B sees seat as HELD and NOT held by them (isHeldByMe=false)`);

    const userASeatMapRes = await fetch(`${BASE_URL}/api/flights/1/seats?accountId=${authA.user.id}`, { headers: headersA });
    const userASeats = await userASeatMapRes.json();
    const seatForA = userASeats.seats.find(s => s.id === targetSeatA.id);
    assert(seatForA.status === 'HELD' && seatForA.isHeldByMe === true, `User A sees seat as HELD and held by them (isHeldByMe=true)`);

    // -------------------------------------------------------------
    // 6. MY BOOKINGS PAYMENT FLOW: RETRIEVE BY REF WITH AUTH
    // -------------------------------------------------------------
    console.log('\n>>> 6. User A retrieving pending booking from My Bookings via GET /api/bookings/:ref...');
    const getBookingRes = await fetch(`${BASE_URL}/api/bookings/${holdDataA.bookingReference}`, { headers: headersA });
    assert(getBookingRes.status === 200, 'GET /api/bookings/:ref with auth headers returned HTTP 200');
    const bookingDetails = await getBookingRes.json();
    assert(bookingDetails.status === 'PENDING_PAYMENT', 'Booking status is PENDING_PAYMENT');
    assert(bookingDetails.secondsRemaining > 0, `Booking has positive secondsRemaining: ${bookingDetails.secondsRemaining}s`);
    assert(bookingDetails.seats && bookingDetails.seats.length > 0, 'Booking details contain reserved seat information');
    assert(bookingDetails.depCity && bookingDetails.arrCity, `Booking details include route: ${bookingDetails.depCity} -> ${bookingDetails.arrCity}`);

    // Verify unauthenticated / wrong user privacy check
    const unauthorizedGet = await fetch(`${BASE_URL}/api/bookings/${holdDataA.bookingReference}`);
    assert(unauthorizedGet.status === 401, 'Unauthenticated GET /api/bookings/:ref is rejected with HTTP 401 Unauthorized');

    const wrongUserGet = await fetch(`${BASE_URL}/api/bookings/${holdDataA.bookingReference}`, { headers: headersB });
    assert(wrongUserGet.status === 403, 'User B attempting to view User A booking is rejected with HTTP 403 Forbidden');

    // -------------------------------------------------------------
    // 7. CONFIRM PAYMENT: ATOMIC TRANSITION TO CONFIRMED
    // -------------------------------------------------------------
    console.log('\n>>> 7. User A completing payment via POST /api/bookings/confirm...');
    const confirmRes = await fetch(`${BASE_URL}/api/bookings/confirm`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        bookingReference: holdDataA.bookingReference,
        paymentMethod: 'instant_verification',
        transactionRef: `TXN-TEST-${Date.now()}`
      })
    });
    assert(confirmRes.status === 200, 'Payment confirmation returned HTTP 200 OK');
    const confirmData = await confirmRes.json();
    assert(confirmData.status === 'CONFIRMED' && confirmData.success === true, 'Booking status updated to CONFIRMED');
    assert(confirmData.ticket && confirmData.ticket.bookingReference === holdDataA.bookingReference, 'Digital boarding pass ticket returned');

    // Verify seat is now BOOKED for everyone
    const postPaymentSeats = await (await fetch(`${BASE_URL}/api/flights/1/seats?accountId=${authB.user.id}`)).json();
    const confirmedSeat = postPaymentSeats.seats.find(s => s.id === targetSeatA.id);
    assert(confirmedSeat.status === 'BOOKED', 'Seat permanently transitioned from HELD to BOOKED');

    // -------------------------------------------------------------
    // 8. CANCELLATION FLOW: IMMEDIATE RELEASE OF HELD SEATS
    // -------------------------------------------------------------
    console.log(`\n>>> 8. Testing immediate seat release on cancellation for seat ${targetSeatCancel.seatCode}...`);
    const holdCancelRes = await fetch(`${BASE_URL}/api/bookings/hold`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({ flightId: 1, seatIds: [targetSeatCancel.id] })
    });
    const holdCancelData = await holdCancelRes.json();

    const cancelRes = await fetch(`${BASE_URL}/api/bookings/cancel`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({ bookingReference: holdCancelData.bookingReference })
    });
    assert(cancelRes.status === 200, 'POST /api/bookings/cancel returned HTTP 200 OK');

    const postCancelSeats = await (await fetch(`${BASE_URL}/api/flights/1/seats?accountId=${authB.user.id}`)).json();
    const cancelledSeat = postCancelSeats.seats.find(s => s.id === targetSeatCancel.id);
    assert(cancelledSeat.status === 'AVAILABLE', 'Cancelled hold immediately restored seat to AVAILABLE');

    // -------------------------------------------------------------
    // 9. EXPIRATION FLOW: PAYMENT REJECTED IF WINDOW EXPIRED
    // -------------------------------------------------------------
    console.log(`\n>>> 9. Testing expiration handling for seat ${targetSeatExpire.seatCode}...`);
    const holdExpireRes = await fetch(`${BASE_URL}/api/bookings/hold`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({ flightId: 1, seatIds: [targetSeatExpire.id] })
    });
    const holdExpireData = await holdExpireRes.json();

    // Directly set expires_at in DB to past to simulate timeout
    const path = require('node:path');
    const fs = require('fs');
    const { DatabaseSync } = require('node:sqlite');
    const canonicalDb = path.join(__dirname, 'database', 'flight_booking.db');
    const fallbackDb = path.join(__dirname, 'Skynet-master', 'Skynet-master', 'web', 'database.db');
    const dbPath = fs.existsSync(canonicalDb) ? canonicalDb : fallbackDb;
    const db = new DatabaseSync(dbPath);
    
    const pastTime = new Date(Date.now() - 60000).toISOString();
    db.prepare('UPDATE bookings SET expires_at = ? WHERE booking_reference = ?').run(pastTime, holdExpireData.bookingReference);
    db.prepare('UPDATE reservations SET expires_at = ? WHERE booking_reference = ?').run(pastTime, holdExpireData.bookingReference);
    db.close();

    // Attempt payment on expired booking
    const expiredPaymentRes = await fetch(`${BASE_URL}/api/bookings/confirm`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        bookingReference: holdExpireData.bookingReference,
        paymentMethod: 'credit_card'
      })
    });
    assert(expiredPaymentRes.status === 410, 'Payment on expired reservation rejected with HTTP 410 Gone');
    const expData = await expiredPaymentRes.json();
    assert(expData.code === 'RESERVATION_EXPIRED', 'Server returned code RESERVATION_EXPIRED');

    // Verify seat is available again
    const postExpireSeats = await (await fetch(`${BASE_URL}/api/flights/1/seats?accountId=${authB.user.id}`)).json();
    const expiredSeat = postExpireSeats.seats.find(s => s.id === targetSeatExpire.id);
    assert(expiredSeat.status === 'AVAILABLE', 'Expired hold cleanly released seat back to AVAILABLE');

    // -------------------------------------------------------------
    // 10. FRONTEND RESPONSIVE CODE INTEGRITY CHECKS
    // -------------------------------------------------------------
    console.log('\n>>> 10. Checking Frontend CSS & JS Responsive Layout Integrity...');
    const canonicalCss = path.join(__dirname, 'static', 'css', 'style.css');
    const fallbackCss = path.join(__dirname, 'Skynet-master', 'Skynet-master', 'web', 'public', 'css', 'style.css');
    const cssContent = fs.readFileSync(fs.existsSync(canonicalCss) ? canonicalCss : fallbackCss, 'utf8');

    const canonicalJs = path.join(__dirname, 'static', 'js', 'app.js');
    const fallbackJs = path.join(__dirname, 'Skynet-master', 'Skynet-master', 'web', 'public', 'js', 'app.js');
    const jsContent = fs.readFileSync(fs.existsSync(canonicalJs) ? canonicalJs : fallbackJs, 'utf8');

    assert(cssContent.includes('.booking-card-footer'), 'style.css contains .booking-card-footer responsive styling');
    assert(cssContent.includes('@media (max-width: 480px)'), 'style.css contains 480px mobile breakpoint');
    assert(cssContent.includes('@media (max-width: 360px)'), 'style.css contains 360px small mobile breakpoint');
    assert(cssContent.includes('grid-template-columns: 34px 34px 34px 20px 34px 34px 34px'), 'style.css contains responsive mobile seat cabin row grid');
    assert(jsContent.includes('openPaymentModalForBooking'), 'app.js defines openPaymentModalForBooking method');
    assert(jsContent.includes('resumePendingPaymentByRef'), 'app.js defines resumePendingPaymentByRef');
    assert(jsContent.includes("headers: this.getAuthHeaders()"), 'app.js passes auth headers in API calls');

    console.log('\n================================================================');
    console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('================================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

runTests();
