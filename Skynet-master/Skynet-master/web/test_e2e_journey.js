// E2E Simulation of Customer & Admin Journey
const http = require('http');

const BASE_URL = 'http://localhost:5000';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json'
      }
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

async function runE2E() {
  console.log('====================================================');
  console.log('🚀 RUNNING COMPLETE END-TO-END RESERVATION JOURNEY');
  console.log('====================================================\n');

  // Step 1: Customer Authentication
  console.log('1. Customer Log In (rahim_bd)...');
  const loginRes = await request('POST', '/api/auth/login', {
    username: 'rahim_bd',
    password: 'rahim123'
  });
  if (loginRes.status !== 200) throw new Error('Login failed: ' + JSON.stringify(loginRes.data));
  const user = loginRes.data.user;
  console.log(`   Logged in as: ${user.passenger.firstName} ${user.passenger.lastName} (ID: ${user.id})\n`);

  // Step 2: Search / Browse Flights
  console.log('2. Browsing Featured Flights...');
  const featuredRes = await request('GET', `/api/flights/featured?accountId=${user.id}`);
  const flight = featuredRes.data[0];
  console.log(`   Selected Flight #${flight.id}: ${flight.depCity} (${flight.depIATA}) ➔ ${flight.arrCity} (${flight.arrIATA}) - ${flight.airlineName}\n`);

  // Step 3: Fetch Seat Map & Availability
  console.log('3. Viewing Real-Time Seat Availability...');
  const seatsRes = await request('GET', `/api/flights/${flight.id}/seats?accountId=${user.id}`);
  const freeSeats = seatsRes.data.seats.filter(s => s.status === 'AVAILABLE');
  console.log(`   Total Seats: ${seatsRes.data.seats.length}, Available: ${freeSeats.length}`);
  if (freeSeats.length < 2) throw new Error('Not enough free seats');
  const seat1 = freeSeats[0];
  const seat2 = freeSeats[1];
  console.log(`   Customer selects: Seat ${seat1.seatCode} and Seat ${seat2.seatCode}\n`);

  // Step 4: Multi-Seat Temporary Hold (15-Minute Expiration)
  console.log('4. Initiating 15-Minute Temporary Hold on Selected Seats...');
  const holdRes = await request('POST', '/api/bookings/hold', {
    flightId: flight.id,
    accountId: user.id,
    seatIds: [seat1.id, seat2.id],
    nbrLuggages: 1,
    weight: 15
  });
  if (holdRes.status !== 201) throw new Error('Hold failed: ' + JSON.stringify(holdRes.data));
  const booking = holdRes.data;
  console.log(`   ✅ Hold Created! Booking Ref: ${booking.bookingReference}`);
  console.log(`   Total Amount: ৳${booking.totalAmount}`);
  console.log(`   Expires At: ${booking.expiresAt} (~${booking.expiresInSeconds}s window)\n`);

  // Step 5: Check Live Availability from Another Customer's Perspective
  console.log('5. Checking Seat Availability for Other Customers...');
  const checkOthers = await request('GET', `/api/flights/${flight.id}/seats?accountId=99999`);
  const s1Others = checkOthers.data.seats.find(s => s.id === seat1.id);
  const s2Others = checkOthers.data.seats.find(s => s.id === seat2.id);
  console.log(`   Seat ${seat1.seatCode} status for others: ${s1Others.status} (isHeldByMe: ${s1Others.isHeldByMe})`);
  console.log(`   Seat ${seat2.seatCode} status for others: ${s2Others.status} (isHeldByMe: ${s2Others.isHeldByMe})`);
  if (s1Others.status !== 'HELD' || s2Others.status !== 'HELD') {
    throw new Error('Seats do not appear as HELD for other customers!');
  }
  console.log('   ✅ Seats are confirmed HELD and locked against other customers!\n');

  // Step 6: Verify Concurrency Block (Another customer tries to book seat1)
  console.log('6. Another Customer Attempts to Reserve Seat ' + seat1.seatCode + '...');
  const conflictAttempt = await request('POST', '/api/bookings/hold', {
    flightId: flight.id,
    accountId: 99999,
    seatIds: [seat1.id]
  });
  console.log(`   Attempt status: ${conflictAttempt.status}`);
  console.log(`   Error returned: "${conflictAttempt.data.error}"`);
  if (conflictAttempt.status !== 409) throw new Error('Concurrent request was not blocked!');
  console.log('   ✅ Concurrency protection successfully blocked double-booking!\n');

  // Step 7: Check Customer's Active Booking & Countdown
  console.log('7. Verifying Booking Lookup & Live Countdown...');
  const lookupRes = await request('GET', `/api/bookings/${booking.bookingReference}`);
  console.log(`   Booking Status: ${lookupRes.data.status}`);
  console.log(`   Seconds Remaining: ${lookupRes.data.secondsRemaining}s`);
  console.log(`   Associated Seats: ${lookupRes.data.seats.map(s => s.code).join(', ')}\n`);

  // Step 8: Payment Verification & Confirmation
  console.log('8. Completing Payment Verification...');
  const payRes = await request('POST', '/api/bookings/confirm', {
    bookingReference: booking.bookingReference,
    paymentMethod: 'instant_verification',
    transactionRef: `TXN-E2E-${Date.now()}`
  });
  if (payRes.status !== 200) throw new Error('Payment confirmation failed: ' + JSON.stringify(payRes.data));
  console.log(`   ✅ Payment Confirmed! Status: ${payRes.data.status}`);
  console.log(`   Transaction Ref: ${payRes.data.paymentRef}`);
  console.log(`   Paid At: ${payRes.data.paidAt}`);
  console.log(`   E-Ticket Boarding Pass Generated for: ${payRes.data.ticket.firstName} ${payRes.data.ticket.lastName}`);
  console.log(`   Confirmed Seats: ${payRes.data.ticket.seatNumber}\n`);

  // Step 9: Verify Seats are Now Permanently BOOKED
  console.log('9. Checking Permanent Seat Status...');
  const finalSeats = await request('GET', `/api/flights/${flight.id}/seats`);
  const finalS1 = finalSeats.data.seats.find(s => s.id === seat1.id);
  const finalS2 = finalSeats.data.seats.find(s => s.id === seat2.id);
  console.log(`   Seat ${seat1.seatCode} status: ${finalS1.status}`);
  console.log(`   Seat ${seat2.seatCode} status: ${finalS2.status}`);
  if (finalS1.status !== 'BOOKED' || finalS2.status !== 'BOOKED') {
    throw new Error('Seats are not permanently BOOKED!');
  }
  console.log('   ✅ Seats transitioned from HELD to BOOKED!\n');

  // Step 10: Admin Dashboard Audit
  console.log('10. Admin Dashboard Verification...');
  const adminRes = await request('GET', `/api/admin/all-bookings?search=${booking.bookingReference}`);
  if (adminRes.data.bookings.length === 0) throw new Error('Booking not found in admin audit!');
  const adminEntry = adminRes.data.bookings[0];
  console.log(`   Admin found booking: ${adminEntry.booking_reference}`);
  console.log(`   Customer: ${adminEntry.firstName} ${adminEntry.lastName} (${adminEntry.username})`);
  console.log(`   Status: ${adminEntry.status}`);
  console.log(`   Seats: ${adminEntry.seatNumbers}`);
  console.log(`   Total Amount: ৳${adminEntry.total_amount}`);
  console.log('   ✅ Admin dashboard correctly tracks the booking and seat status!\n');

  console.log('====================================================');
  console.log('🎉 ALL END-TO-END RESERVATION CHECKS PASSED 100%');
  console.log('====================================================');
}

runE2E().catch(err => {
  console.error('E2E Test Failed:', err);
  process.exit(1);
});
