/**
 * SKYNET FLIGHT BOOKING SYSTEM — BACKEND API SERVER
 * Author: mahin1710
 */
const express = require('express');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { seedDemoAccounts, hashPassword, verifyPassword } = require('./seed_demo_accounts');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS & JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection
const dbPath = path.join(__dirname, 'database.db');
if (!fs.existsSync(dbPath)) {
  console.error('Database file not found at:', dbPath);
}
const db = new DatabaseSync(dbPath);

// Enable WAL mode & busy timeout for robust concurrency
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

// Self-healing schema migration for conflict-free reservations
(function initDatabaseSchema() {
  try {
    const existingCols = db.prepare('PRAGMA table_info(reservations)').all().map(c => c.name);

    if (!existingCols.includes('booking_reference')) {
      db.exec('ALTER TABLE reservations ADD COLUMN booking_reference TEXT;');
    }
    if (!existingCols.includes('status')) {
      db.exec("ALTER TABLE reservations ADD COLUMN status TEXT DEFAULT 'CONFIRMED';");
    }
    if (!existingCols.includes('created_at')) {
      db.exec('ALTER TABLE reservations ADD COLUMN created_at TEXT;');
    }
    if (!existingCols.includes('expires_at')) {
      db.exec('ALTER TABLE reservations ADD COLUMN expires_at TEXT;');
    }
    if (!existingCols.includes('payment_ref')) {
      db.exec('ALTER TABLE reservations ADD COLUMN payment_ref TEXT;');
    }
    if (!existingCols.includes('total_price')) {
      db.exec('ALTER TABLE reservations ADD COLUMN total_price REAL DEFAULT 0;');
    }

    db.exec("UPDATE reservations SET status = 'CONFIRMED' WHERE status IS NULL OR status = '';");

    db.exec(`
      CREATE TABLE IF NOT EXISTS "bookings" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "booking_reference" TEXT UNIQUE NOT NULL,
        "id_account" INTEGER NOT NULL,
        "id_flight" INTEGER NOT NULL,
        "status" TEXT NOT NULL CHECK(status IN ('PENDING_PAYMENT', 'CONFIRMED', 'EXPIRED', 'CANCELLED')),
        "total_amount" REAL NOT NULL,
        "nbr_luggages" INTEGER DEFAULT 0,
        "weight" REAL DEFAULT 0,
        "created_at" TEXT NOT NULL,
        "expires_at" TEXT NOT NULL,
        "payment_ref" TEXT,
        "payment_method" TEXT,
        "paid_at" TEXT,
        FOREIGN KEY("id_account") REFERENCES "accounts"("id"),
        FOREIGN KEY("id_flight") REFERENCES "flights"("id") ON DELETE CASCADE
      );
    `);

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_active_seat_reservation 
      ON reservations (id_flight, id_seat) 
      WHERE status IN ('HELD', 'CONFIRMED');
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_res_flight_status ON reservations(id_flight, status);
      CREATE INDEX IF NOT EXISTS idx_res_booking_ref ON reservations(booking_reference);
      CREATE INDEX IF NOT EXISTS idx_res_status_expires ON reservations(status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_bookings_status_expires ON bookings(status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_bookings_account ON bookings(id_account);
    `);
  } catch (err) {
    console.error('Database schema init error:', err.message);
  }
})();

// Initialize & Seed 4 Dedicated Demo Accounts (Mahin0, Admin_Biman, Admin_USB, Mahin1)
seedDemoAccounts(db);

// -------------------------------------------------------------
// SESSION MANAGEMENT & AUTH HELPERS
// -------------------------------------------------------------
function createSession(account, rememberMe = true) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const durationDays = rememberMe ? 30 : 1;
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
  const role = account.role || (account.id_airline ? 'AIRLINE_ADMIN' : 'PASSENGER');

  db.prepare(`
    INSERT INTO auth_sessions (token, account_id, username, role, airline_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    token,
    account.id,
    account.username,
    role,
    account.id_airline || null,
    now.toISOString(),
    expiresAt
  );
  return { token, expiresAt, role };
}

function getSession(req) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-session-token']) {
    token = req.headers['x-session-token'];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  } else if (req.body && req.body.token) {
    token = req.body.token;
  }
  if (!token) return null;

  try {
    const session = db.prepare(`
      SELECT s.*, 
             a.username, a.emailAddress, a.role as accountRole, a.display_name, a.location,
             p.firstName, p.lastName, p.country,
             al.name as airlineName, al.IATA as airlineIATA
      FROM auth_sessions s
      JOIN accounts a ON s.account_id = a.id
      LEFT JOIN passengers p ON a.id_passenger = p.id
      LEFT JOIN airLines al ON s.airline_id = al.id
      WHERE s.token = ?
    `).get(token);

    if (!session) return null;
    if (new Date(session.expires_at).getTime() < Date.now()) {
      db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
      return null;
    }
    return session;
  } catch (err) {
    return null;
  }
}

// Automatic server-side expiration mechanism (Idempotent)
function cleanupExpiredReservations() {
  const nowIso = new Date().toISOString();
  try {
    db.exec('BEGIN IMMEDIATE');
    db.prepare(`
      UPDATE bookings 
      SET status = 'EXPIRED' 
      WHERE status = 'PENDING_PAYMENT' AND expires_at <= ?
    `).run(nowIso);

    db.prepare(`
      UPDATE reservations 
      SET status = 'EXPIRED' 
      WHERE status = 'HELD' AND expires_at <= ?
    `).run(nowIso);

    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    // Suppress repeated lock collisions during active transactions
  }
}

// Background cleaner runs every 10 seconds
setInterval(cleanupExpiredReservations, 10000);
// Also run immediately at startup
cleanupExpiredReservations();

// Serve static frontend assets
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Helper to sanitize date/time format if needed
function formatDateTime(dtStr) {
  if (!dtStr) return '';
  return dtStr.replace('T', ' ').substring(0, 16);
}

// Helper to sanitize corrupt characters in airport/city names
function sanitizeAirportRecord(a) {
  if (!a) return a;
  if (a.name) a.name = a.name.replace(/^\?stanbul/i, 'Istanbul').replace(/Da\?oguz/i, 'Dashoguz');
  if (a.city) a.city = a.city.replace(/^\?stanbul/i, 'Istanbul');
  if (a.depAirportName) a.depAirportName = a.depAirportName.replace(/^\?stanbul/i, 'Istanbul').replace(/Da\?oguz/i, 'Dashoguz');
  if (a.arrAirportName) a.arrAirportName = a.arrAirportName.replace(/^\?stanbul/i, 'Istanbul').replace(/Da\?oguz/i, 'Dashoguz');
  return a;
}

// Helper to retrieve detailed ticket info by booking reference
function getTicketDataByBookingRef(bookingRef) {
  const booking = db.prepare(`
    SELECT b.id as bookingId, b.booking_reference as bookingReference, b.status, b.total_amount,
           b.nbr_luggages, b.weight, b.payment_ref, b.paid_at, b.created_at, b.expires_at,
           f.id as flightId, f.dep_datetime, f.arr_datetime,
           f.first_price, f.business_price, f.economy_price, f.luggage_price, f.weight_price,
           al.id as airlineId, al.name as airlineName, al.IATA as airlineIATA,
           da.name as depAirportName, da.IATA as depIATA, da.ICAO as depICAO, da.city as depCity, da.country as depCountry,
           aa.name as arrAirportName, aa.IATA as arrIATA, aa.ICAO as arrICAO, aa.city as arrCity, aa.country as arrCountry,
           p.firstName, p.lastName, p.country as passengerCountry,
           a.emailAddress, a.username
    FROM bookings b
    JOIN flights f ON b.id_flight = f.id
    JOIN airLines al ON f.id_airline = al.id
    JOIN airports da ON f.dep_airport = da.id
    JOIN airports aa ON f.arr_airport = aa.id
    JOIN accounts a ON b.id_account = a.id
    LEFT JOIN passengers p ON a.id_passenger = p.id
    WHERE b.booking_reference = ?
  `).get(bookingRef);

  if (!booking) return null;

  const reservedSeats = db.prepare(`
    SELECT r.id as reservationId, s.id as seatId, s.column as seatColumn, s.row as seatRow, s.type as seatClass
    FROM reservations r
    JOIN seats s ON r.id_seat = s.id
    WHERE r.booking_reference = ?
  `).all(bookingRef);

  const seatCodes = reservedSeats.map(s => `${s.seatColumn}${s.seatRow}`).join(', ');
  const seatClass = reservedSeats.length > 0 ? reservedSeats[0].seatClass : 'economy';

  return sanitizeAirportRecord({
    ...booking,
    seats: reservedSeats.map(s => ({ ...s, code: `${s.seatColumn}${s.seatRow}` })),
    seatNumber: seatCodes,
    seatClass
  });
}

// Helper to retrieve single ticket by reservation ID (legacy support)
function getTicketData(reservationId) {
  const row = db.prepare(`
    SELECT r.id as reservationId, r.nbr_luggages, r.weight, r.status, r.booking_reference as bookingReference,
           s.id as seatId, s.column as seatColumn, s.row as seatRow, s.type as seatClass,
           (s.column || s.row) as seatNumber,
           f.id as flightId, f.dep_datetime, f.arr_datetime, 
           f.first_price, f.business_price, f.economy_price, f.luggage_price, f.weight_price,
           al.id as airlineId, al.name as airlineName, al.IATA as airlineIATA,
           da.name as depAirportName, da.IATA as depIATA, da.ICAO as depICAO, da.city as depCity, da.country as depCountry,
           aa.name as arrAirportName, aa.IATA as arrIATA, aa.ICAO as arrICAO, aa.city as arrCity, aa.country as arrCountry,
           p.firstName, p.lastName, p.country as passengerCountry,
           a.emailAddress, a.username
    FROM reservations r
    JOIN seats s ON r.id_seat = s.id
    JOIN flights f ON r.id_flight = f.id
    JOIN airLines al ON f.id_airline = al.id
    JOIN airports da ON f.dep_airport = da.id
    JOIN airports aa ON f.arr_airport = aa.id
    JOIN accounts a ON r.id_account = a.id
    LEFT JOIN passengers p ON a.id_passenger = p.id
    WHERE r.id = ?
  `).get(reservationId);

  return sanitizeAirportRecord(row);
}

// -------------------------------------------------------------
// 1. AUTHENTICATION & DEMO USERS
// -------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password, rememberMe = true } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const loginIdentifier = username.trim();
    const account = db.prepare(`
      SELECT a.*, 
             p.firstName, p.lastName, p.birthDate, p.gender, p.country,
             al.name as airlineName, al.IATA as airlineIATA
      FROM accounts a
      LEFT JOIN passengers p ON a.id_passenger = p.id
      LEFT JOIN airLines al ON a.id_airline = al.id
      WHERE a.username = ? COLLATE NOCASE OR a.emailAddress = ? COLLATE NOCASE
    `).get(loginIdentifier, loginIdentifier);

    if (!account) {
      return res.status(401).json({ error: 'Invalid username or password. Please verify and try again.' });
    }

    if (!verifyPassword(password, account.password)) {
      return res.status(401).json({ error: 'Invalid username or password. Please verify and try again.' });
    }

    const isAirline = account.id_airline !== null || account.role === 'AIRLINE_ADMIN';
    const role = account.role || (isAirline ? 'AIRLINE_ADMIN' : 'PASSENGER');
    const session = createSession(account, rememberMe);

    // Clean display name resolution
    let displayName = account.display_name;
    if (!displayName) {
      if (isAirline) {
        displayName = account.airlineName || account.username;
      } else {
        displayName = (account.firstName ? `${account.firstName} ${account.lastName || ''}`.trim() : account.username);
      }
    }

    res.json({
      success: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: account.id,
        username: account.username,
        emailAddress: account.emailAddress,
        role: role,
        displayName: displayName,
        location: account.location || (isAirline ? 'Dhaka, Bangladesh' : 'Bangladesh'),
        id_passenger: account.id_passenger,
        id_airline: account.id_airline,
        passenger: isAirline ? null : {
          id: account.id_passenger,
          firstName: account.firstName || '',
          lastName: account.lastName || '',
          birthDate: account.birthDate || '',
          gender: account.gender || '',
          country: account.country || 'Bangladesh'
        },
        airline: isAirline ? {
          id: account.id_airline,
          name: account.airlineName || 'Airline Administration',
          IATA: account.airlineIATA || 'AL'
        } : null
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.headers['x-session-token']) {
      token = req.headers['x-session-token'];
    } else if (req.body && req.body.token) {
      token = req.body.token;
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (token) {
      db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
    }
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Failed to complete logout.' });
  }
});

app.get('/api/auth/me', (req, res) => {
  try {
    const session = getSession(req);
    if (!session) {
      return res.status(401).json({ authenticated: false, error: 'No active session or session expired.' });
    }
    const isAirline = session.airline_id !== null || session.role === 'AIRLINE_ADMIN';
    const role = session.role || (isAirline ? 'AIRLINE_ADMIN' : 'PASSENGER');
    res.json({
      authenticated: true,
      token: session.token,
      user: {
        id: session.account_id,
        username: session.username,
        emailAddress: session.emailAddress,
        role: role,
        displayName: session.display_name || (isAirline ? session.airlineName : session.firstName),
        location: session.location || 'Dhaka, Bangladesh',
        id_passenger: session.id_passenger,
        id_airline: session.airline_id,
        passenger: isAirline ? null : {
          id: session.id_passenger,
          firstName: session.firstName || '',
          lastName: session.lastName || '',
          country: session.country || 'Bangladesh'
        },
        airline: isAirline ? {
          id: session.airline_id,
          name: session.airlineName,
          IATA: session.airlineIATA
        } : null
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/register', (req, res) => {
  try {
    const { username, password, emailAddress, firstName, lastName, birthDate, gender, country = 'Bangladesh' } = req.body;
    if (!username || !password || !emailAddress) {
      return res.status(400).json({ error: 'Username, password, and email are required.' });
    }

    const existing = db.prepare('SELECT id FROM accounts WHERE username = ? COLLATE NOCASE OR emailAddress = ? COLLATE NOCASE').get(username.trim(), emailAddress.trim());
    if (existing) {
      return res.status(409).json({ error: 'Username or email is already registered.' });
    }

    const insPassenger = db.prepare(`
      INSERT INTO passengers (firstName, lastName, birthDate, gender, country)
      VALUES (?, ?, ?, ?, ?)
    `);
    insPassenger.run(
      firstName || username,
      lastName || '',
      birthDate || '1998-01-01',
      gender === 'F' ? 'F' : 'M',
      country
    );
    const passengerId = db.prepare('SELECT last_insert_rowid() as id').get().id;

    const hashedPassword = hashPassword(password);
    const insAccount = db.prepare(`
      INSERT INTO accounts (id_passenger, username, password, emailAddress, role, display_name, location)
      VALUES (?, ?, ?, ?, 'PASSENGER', ?, 'Dhaka, Bangladesh')
    `);
    const dispName = (firstName ? `${firstName} ${lastName || ''}`.trim() : username.trim());
    insAccount.run(passengerId, username.trim(), hashedPassword, emailAddress.trim(), dispName);
    const accountId = db.prepare('SELECT last_insert_rowid() as id').get().id;

    const session = createSession({ id: accountId, username: username.trim(), role: 'PASSENGER' }, true);

    res.status(201).json({
      success: true,
      token: session.token,
      user: {
        id: accountId,
        username: username.trim(),
        emailAddress: emailAddress.trim(),
        role: 'PASSENGER',
        displayName: dispName,
        id_passenger: passengerId,
        passenger: {
          id: passengerId,
          firstName: firstName || username,
          lastName: lastName || '',
          birthDate: birthDate || '1998-01-01',
          gender: gender === 'F' ? 'F' : 'M',
          country
        }
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/demo-users', (req, res) => {
  try {
    const demoAccounts = [
      {
        username: 'Mahin0',
        displayName: 'MMH_Mahin',
        role: 'PASSENGER',
        roleLabel: 'Passenger (Traveler)',
        location: 'Dhaka, Bangladesh',
        airlineName: null,
        description: 'Bangladeshi passenger: search, book seats, view tickets & boarding passes'
      },
      {
        username: 'Admin_Biman',
        displayName: 'Biman Bangladesh Airlines Admin',
        role: 'AIRLINE_ADMIN',
        roleLabel: 'Airline Admin',
        location: 'Dhaka, Bangladesh',
        airlineId: 839,
        airlineName: 'Biman Bangladesh Airlines (BG)',
        description: 'Admin: manage Biman flights, fleet, bookings, inventory & revenue analytics'
      },
      {
        username: 'Admin_USB',
        displayName: 'US-Bangla Airlines Admin',
        role: 'AIRLINE_ADMIN',
        roleLabel: 'Airline Admin',
        location: 'Dhaka, Bangladesh',
        airlineId: 371,
        airlineName: 'US-Bangla Airlines (BS)',
        description: 'Admin: manage US-Bangla domestic & international flights & ticket sales'
      },
      {
        username: 'Mahin1',
        displayName: 'Mahin1',
        role: 'PASSENGER',
        roleLabel: 'Alternative Passenger',
        location: 'Chittagong, Bangladesh',
        airlineName: null,
        description: 'Alternative passenger: test seat selection, concurrent hold & bookings'
      }
    ];

    res.json(demoAccounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 2. AIRPORTS & SEARCH HELPER ENDPOINTS
// -------------------------------------------------------------
app.get('/api/airports/countries', (req, res) => {
  try {
    const countries = db.prepare(`
      SELECT DISTINCT country 
      FROM airports 
      WHERE country IS NOT NULL AND country != '' 
      ORDER BY (CASE WHEN country = 'Bangladesh' THEN 0 ELSE 1 END), country ASC
    `).all();
    res.json(countries.map(c => c.country));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/airports/cities', (req, res) => {
  try {
    const { country } = req.query;
    let query = 'SELECT DISTINCT city, country FROM airports WHERE city IS NOT NULL AND city != ""';
    const params = [];
    if (country) {
      query += ' AND country = ?';
      params.push(country);
    }
    query += ' ORDER BY city ASC';
    const cities = db.prepare(query).all(...params);
    res.json(cities.map(c => sanitizeAirportRecord(c).city));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/airports/all', (req, res) => {
  try {
    const airports = db.prepare(`
      SELECT id, name, city, country, IATA, ICAO 
      FROM airports 
      ORDER BY (CASE WHEN country = 'Bangladesh' THEN 0 ELSE 1 END), name ASC
    `).all();
    res.json(airports.map(sanitizeAirportRecord));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/airports/search', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) {
      const topAirports = db.prepare(`
        SELECT id, name, city, country, IATA, ICAO 
        FROM airports 
        WHERE country = 'Bangladesh' OR IATA IN ('JFK', 'LHR', 'DXB', 'SIN', 'BKK', 'KUL', 'DOH')
        ORDER BY (CASE WHEN country = 'Bangladesh' THEN 0 ELSE 1 END), IATA ASC
        LIMIT 15
      `).all();
      return res.json(topAirports.map(sanitizeAirportRecord));
    }

    const likeQ = `%${q}%`;
    const results = db.prepare(`
      SELECT id, name, city, country, IATA, ICAO 
      FROM airports 
      WHERE name LIKE ? OR city LIKE ? OR country LIKE ? OR IATA LIKE ? OR ICAO LIKE ?
      ORDER BY (CASE WHEN country = 'Bangladesh' THEN 0 ELSE 1 END),
               (CASE WHEN IATA = UPPER(?) THEN 0 ELSE 1 END),
               name ASC
      LIMIT 15
    `).all(likeQ, likeQ, likeQ, likeQ, likeQ, q);

    res.json(results.map(sanitizeAirportRecord));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 3. FLIGHTS SEARCH & FILTERING
// -------------------------------------------------------------
app.get('/api/flights', (req, res) => {
  try {
    cleanupExpiredReservations();
    const {
      depCountry, depCity,
      arrCountry, arrCity,
      dateAfter, dateBefore,
      q,
      sortBy = 'closestDate',
      limit = 12,
      offset = 0,
      accountId
    } = req.query;

    const whereClauses = [];
    const params = [];

    if (depCountry) {
      whereClauses.push('da.country = ?');
      params.push(depCountry);
    }
    if (depCity) {
      whereClauses.push('da.city = ?');
      params.push(depCity);
    }
    if (arrCountry) {
      whereClauses.push('aa.country = ?');
      params.push(arrCountry);
    }
    if (arrCity) {
      whereClauses.push('aa.city = ?');
      params.push(arrCity);
    }
    if (dateAfter) {
      whereClauses.push('f.dep_datetime >= ?');
      params.push(dateAfter + ' 00:00');
    }
    if (dateBefore) {
      whereClauses.push('f.dep_datetime <= ?');
      params.push(dateBefore + ' 23:59');
    }

    if (q && q.trim()) {
      const kw = `%${q.trim()}%`;
      whereClauses.push(`(
        da.name LIKE ? OR da.city LIKE ? OR da.country LIKE ? OR da.IATA LIKE ? OR
        aa.name LIKE ? OR aa.city LIKE ? OR aa.country LIKE ? OR aa.IATA LIKE ? OR
        al.name LIKE ? OR al.IATA LIKE ?
      )`);
      params.push(kw, kw, kw, kw, kw, kw, kw, kw, kw, kw);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    let orderSql = 'ORDER BY f.dep_datetime ASC';
    if (sortBy === 'furthestDate') orderSql = 'ORDER BY f.dep_datetime DESC';
    else if (sortBy === 'priceAsc') orderSql = 'ORDER BY f.economy_price ASC';
    else if (sortBy === 'priceDesc') orderSql = 'ORDER BY f.economy_price DESC';

    const countSql = `
      SELECT COUNT(*) as total
      FROM flights f
      JOIN airLines al ON f.id_airline = al.id
      JOIN airports da ON f.dep_airport = da.id
      JOIN airports aa ON f.arr_airport = aa.id
      ${whereSql}
    `;
    const totalCount = db.prepare(countSql).get(...params).total;

    const dataSql = `
      SELECT f.*,
             al.name as airlineName, al.IATA as airlineIATA,
             da.name as depAirportName, da.IATA as depIATA, da.ICAO as depICAO, da.city as depCity, da.country as depCountry,
             aa.name as arrAirportName, aa.IATA as arrIATA, aa.ICAO as arrICAO, aa.city as arrCity, aa.country as arrCountry,
             (SELECT COUNT(*) FROM reservations r WHERE r.id_flight = f.id AND r.status IN ('CONFIRMED', 'HELD')) as bookedCount,
             ${accountId ? `(SELECT COUNT(*) FROM favorites fav WHERE fav.id_flight = f.id AND fav.id_account = ${Number(accountId)}) > 0 as isFavorite` : '0 as isFavorite'}
      FROM flights f
      JOIN airLines al ON f.id_airline = al.id
      JOIN airports da ON f.dep_airport = da.id
      JOIN airports aa ON f.arr_airport = aa.id
      ${whereSql}
      ${orderSql}
      LIMIT ? OFFSET ?
    `;

    const flights = db.prepare(dataSql).all(...params, Number(limit), Number(offset));

    res.json({
      total: totalCount,
      limit: Number(limit),
      offset: Number(offset),
      flights: flights.map(f => sanitizeAirportRecord({
        ...f,
        isFavorite: Boolean(f.isFavorite)
      }))
    });
  } catch (err) {
    console.error('Flights error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/flights/featured', (req, res) => {
  try {
    cleanupExpiredReservations();
    const accountId = req.query.accountId ? Number(req.query.accountId) : 0;
    const flights = db.prepare(`
      SELECT f.*,
             al.name as airlineName, al.IATA as airlineIATA,
             da.name as depAirportName, da.IATA as depIATA, da.city as depCity, da.country as depCountry,
             aa.name as arrAirportName, aa.IATA as arrIATA, aa.city as arrCity, aa.country as arrCountry,
             (SELECT COUNT(*) FROM reservations r WHERE r.id_flight = f.id AND r.status IN ('CONFIRMED', 'HELD')) as bookedCount,
             (SELECT COUNT(*) FROM favorites fav WHERE fav.id_flight = f.id AND fav.id_account = ?) > 0 as isFavorite
      FROM flights f
      JOIN airLines al ON f.id_airline = al.id
      JOIN airports da ON f.dep_airport = da.id
      JOIN airports aa ON f.arr_airport = aa.id
      WHERE f.economy_price > 0
      ORDER BY (CASE WHEN da.country = 'Bangladesh' OR aa.country = 'Bangladesh' THEN 0 ELSE 1 END),
               (CASE WHEN da.IATA = 'DAC' THEN 0 WHEN da.IATA = 'CGP' THEN 1 WHEN da.IATA = 'CXB' THEN 2 ELSE 3 END),
               f.dep_datetime ASC
      LIMIT 8
    `).all(accountId);

    res.json(flights.map(f => sanitizeAirportRecord({ ...f, isFavorite: Boolean(f.isFavorite) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/flights/:id', (req, res) => {
  try {
    cleanupExpiredReservations();
    const flightId = Number(req.params.id);
    const accountId = req.query.accountId ? Number(req.query.accountId) : 0;
    const flight = db.prepare(`
      SELECT f.*,
             al.name as airlineName, al.IATA as airlineIATA,
             da.name as depAirportName, da.IATA as depIATA, da.ICAO as depICAO, da.city as depCity, da.country as depCountry,
             aa.name as arrAirportName, aa.IATA as arrIATA, aa.ICAO as arrICAO, aa.city as arrCity, aa.country as arrCountry,
             (SELECT COUNT(*) FROM reservations r WHERE r.id_flight = f.id AND r.status IN ('CONFIRMED', 'HELD')) as bookedCount,
             (SELECT COUNT(*) FROM favorites fav WHERE fav.id_flight = f.id AND fav.id_account = ?) > 0 as isFavorite
      FROM flights f
      JOIN airLines al ON f.id_airline = al.id
      JOIN airports da ON f.dep_airport = da.id
      JOIN airports aa ON f.arr_airport = aa.id
      WHERE f.id = ?
    `).get(accountId, flightId);

    if (!flight) return res.status(404).json({ error: 'Flight not found' });
    res.json(sanitizeAirportRecord({ ...flight, isFavorite: Boolean(flight.isFavorite) }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 4. SEATS & CABIN SEAT MAP (REAL-TIME AVAILABILITY)
// -------------------------------------------------------------
app.get('/api/flights/:id/seats', (req, res) => {
  try {
    cleanupExpiredReservations();
    const flightId = Number(req.params.id);
    const accountId = req.query.accountId ? Number(req.query.accountId) : null;

    const allSeats = db.prepare('SELECT id, "column", row, type FROM seats ORDER BY row ASC, "column" ASC').all();

    const reservations = db.prepare(`
      SELECT id, id_seat, id_account, status, expires_at, booking_reference
      FROM reservations 
      WHERE id_flight = ? AND status IN ('HELD', 'CONFIRMED')
    `).all(flightId);

    const resMap = new Map();
    reservations.forEach(r => {
      resMap.set(r.id_seat, r);
    });

    const now = Date.now();
    const seatMap = allSeats.map(seat => {
      const resRecord = resMap.get(seat.id);
      let status = 'AVAILABLE';
      let isHeldByMe = false;
      let isBookedByMe = false;
      let expiresAt = null;
      let secondsRemaining = 0;

      if (resRecord) {
        if (resRecord.status === 'HELD') {
          status = 'HELD';
          isHeldByMe = Boolean(accountId && resRecord.id_account === accountId);
          expiresAt = resRecord.expires_at;
          if (expiresAt) {
            secondsRemaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
          }
        } else if (resRecord.status === 'CONFIRMED') {
          status = 'BOOKED';
          isBookedByMe = Boolean(accountId && resRecord.id_account === accountId);
        }
      }

      return {
        id: seat.id,
        column: seat.column,
        row: seat.row,
        type: seat.type,
        seatCode: `${seat.column}${seat.row}`,
        status, // 'AVAILABLE', 'HELD', 'BOOKED'
        isReserved: status !== 'AVAILABLE',
        isReservedByMe: isHeldByMe || isBookedByMe,
        isHeldByMe,
        isBookedByMe,
        expiresAt,
        secondsRemaining,
        bookingReference: resRecord ? resRecord.booking_reference : null
      };
    });

    res.json({
      flightId,
      serverTime: new Date().toISOString(),
      seats: seatMap
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 5. CONFLICT-FREE TEMPORARY SEAT RESERVATION (15-MIN HOLD)
// -------------------------------------------------------------
app.post('/api/bookings/hold', (req, res) => {
  cleanupExpiredReservations();
  try {
    const { flightId, accountId, seatIds, seatId, nbrLuggages = 0, weight = 0 } = req.body;

    let seatsToReserve = [];
    if (Array.isArray(seatIds) && seatIds.length > 0) {
      seatsToReserve = seatIds.map(Number);
    } else if (seatId) {
      seatsToReserve = [Number(seatId)];
    }

    if (!flightId || !accountId || seatsToReserve.length === 0) {
      return res.status(400).json({ error: 'flightId, accountId, and at least one seatId are required.' });
    }

    // Atomic transaction using write-exclusive lock
    db.exec('BEGIN IMMEDIATE');

    try {
      const nowIso = new Date().toISOString();
      // Invalidate overdue holds first
      db.prepare("UPDATE bookings SET status = 'EXPIRED' WHERE status = 'PENDING_PAYMENT' AND expires_at <= ?").run(nowIso);
      db.prepare("UPDATE reservations SET status = 'EXPIRED' WHERE status = 'HELD' AND expires_at <= ?").run(nowIso);

      // Verify availability of ALL requested seats
      const placeholders = seatsToReserve.map(() => '?').join(',');
      const conflicts = db.prepare(`
        SELECT r.id_seat, s.column, s.row, r.status
        FROM reservations r
        JOIN seats s ON r.id_seat = s.id
        WHERE r.id_flight = ? 
          AND r.id_seat IN (${placeholders}) 
          AND r.status IN ('HELD', 'CONFIRMED')
      `).all(Number(flightId), ...seatsToReserve);

      if (conflicts.length > 0) {
        db.exec('ROLLBACK');
        return res.status(409).json({
          error: 'Sorry, this seat has just been reserved by another customer. Please select another seat.',
          code: 'SEAT_UNAVAILABLE',
          conflicts: conflicts.map(c => `${c.column}${c.row}`)
        });
      }

      // Check flight
      const flight = db.prepare('SELECT * FROM flights WHERE id = ?').get(Number(flightId));
      if (!flight) {
        db.exec('ROLLBACK');
        return res.status(404).json({ error: 'Flight not found.' });
      }

      // Check seat objects
      const seatDetails = db.prepare(`SELECT * FROM seats WHERE id IN (${placeholders})`).all(...seatsToReserve);
      if (seatDetails.length !== seatsToReserve.length) {
        db.exec('ROLLBACK');
        return res.status(400).json({ error: 'One or more selected seats are invalid.' });
      }

      // Price calculation
      let seatsPriceTotal = 0;
      seatDetails.forEach(s => {
        if (s.type === 'first') seatsPriceTotal += flight.first_price;
        else if (s.type === 'business') seatsPriceTotal += flight.business_price;
        else seatsPriceTotal += flight.economy_price;
      });

      const luggageFee = Number(nbrLuggages) * (flight.luggage_price || 0);
      const weightFee = Number(weight) * (flight.weight_price || 0);
      const grandTotal = seatsPriceTotal + luggageFee + weightFee;

      // Unique booking reference & exact 15-minute expiration
      const uniqueSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      const bookingReference = `BK-${flightId}-${Date.now().toString(36).toUpperCase()}-${uniqueSuffix}`;
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      // Insert master booking
      db.prepare(`
        INSERT INTO bookings (
          booking_reference, id_account, id_flight, status, total_amount, nbr_luggages, weight, created_at, expires_at
        ) VALUES (?, ?, ?, 'PENDING_PAYMENT', ?, ?, ?, ?, ?)
      `).run(
        bookingReference,
        Number(accountId),
        Number(flightId),
        grandTotal,
        Number(nbrLuggages),
        Number(weight),
        createdAt,
        expiresAt
      );

      // Insert individual seat reservations (atomic: all or none)
      const insRes = db.prepare(`
        INSERT INTO reservations (
          id_flight, id_account, id_seat, nbr_luggages, weight, booking_reference, status, created_at, expires_at, total_price
        ) VALUES (?, ?, ?, ?, ?, ?, 'HELD', ?, ?, ?)
      `);

      for (const s of seatDetails) {
        let seatPrice = flight.economy_price;
        if (s.type === 'first') seatPrice = flight.first_price;
        else if (s.type === 'business') seatPrice = flight.business_price;

        insRes.run(
          Number(flightId),
          Number(accountId),
          s.id,
          Number(nbrLuggages),
          Number(weight),
          bookingReference,
          createdAt,
          expiresAt,
          seatPrice
        );
      }

      db.exec('COMMIT');

      res.status(201).json({
        success: true,
        bookingReference,
        status: 'PENDING_PAYMENT',
        flightId: Number(flightId),
        seatIds: seatsToReserve,
        seatCodes: seatDetails.map(s => `${s.column}${s.row}`),
        nbrLuggages: Number(nbrLuggages),
        weight: Number(weight),
        totalAmount: grandTotal,
        createdAt,
        expiresAt,
        serverTime: new Date().toISOString(),
        expiresInSeconds: 900
      });

    } catch (innerErr) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      console.error('Reservation hold error:', innerErr);
      if (innerErr.message && innerErr.message.includes('UNIQUE constraint failed')) {
        return res.status(409).json({
          error: 'Sorry, this seat has just been reserved by another customer. Please select another seat.',
          code: 'SEAT_UNAVAILABLE'
        });
      }
      return res.status(500).json({ error: innerErr.message });
    }
  } catch (err) {
    console.error('Hold route error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Retrieve booking details & countdown status
app.get('/api/bookings/:ref', (req, res) => {
  cleanupExpiredReservations();
  try {
    const ref = req.params.ref.trim();
    const booking = db.prepare(`
      SELECT b.*,
             a.username, a.emailAddress,
             p.firstName, p.lastName,
             f.dep_datetime, f.arr_datetime,
             al.name as airlineName, al.IATA as airlineIATA,
             da.name as depAirportName, da.IATA as depIATA, da.city as depCity,
             aa.name as arrAirportName, aa.IATA as arrIATA, aa.city as arrCity
      FROM bookings b
      JOIN accounts a ON b.id_account = a.id
      LEFT JOIN passengers p ON a.id_passenger = p.id
      JOIN flights f ON b.id_flight = f.id
      JOIN airLines al ON f.id_airline = al.id
      JOIN airports da ON f.dep_airport = da.id
      JOIN airports aa ON f.arr_airport = aa.id
      WHERE b.booking_reference = ?
    `).get(ref);

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const seats = db.prepare(`
      SELECT r.id as reservationId, r.id_seat, r.status, s.column, s.row, s.type as seatClass
      FROM reservations r
      JOIN seats s ON r.id_seat = s.id
      WHERE r.booking_reference = ?
    `).all(ref);

    const now = Date.now();
    let secondsRemaining = 0;
    if (booking.status === 'PENDING_PAYMENT' && booking.expires_at) {
      secondsRemaining = Math.max(0, Math.floor((new Date(booking.expires_at).getTime() - now) / 1000));
    }

    res.json({
      ...sanitizeAirportRecord(booking),
      seats: seats.map(s => ({
        ...s,
        code: `${s.column}${s.row}`
      })),
      secondsRemaining,
      serverTime: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Payment Verification and Confirmation (Atomic & Concurrency-Safe)
app.post('/api/bookings/confirm', (req, res) => {
  cleanupExpiredReservations();
  try {
    const { bookingReference, paymentMethod = 'credit_card', transactionRef, cardDetails } = req.body;
    if (!bookingReference) {
      return res.status(400).json({ error: 'bookingReference is required.' });
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const booking = db.prepare('SELECT * FROM bookings WHERE booking_reference = ?').get(bookingReference);
      if (!booking) {
        db.exec('ROLLBACK');
        return res.status(404).json({ error: 'Booking not found.' });
      }

      // 1. Idempotency check: if already confirmed, return success without re-billing
      if (booking.status === 'CONFIRMED') {
        db.exec('ROLLBACK');
        const ticketData = getTicketDataByBookingRef(bookingReference);
        return res.json({
          success: true,
          message: 'Payment already confirmed for this reservation.',
          alreadyConfirmed: true,
          bookingReference,
          paymentRef: booking.payment_ref,
          paidAt: booking.paid_at,
          ticket: ticketData
        });
      }

      // 2. Reject expired or cancelled reservations
      if (booking.status === 'EXPIRED' || booking.status === 'CANCELLED') {
        db.exec('ROLLBACK');
        return res.status(410).json({
          error: 'This reservation has expired or was cancelled. Seats have been released.',
          code: 'RESERVATION_EXPIRED'
        });
      }

      // 3. Server-side expiration timestamp check
      const now = new Date();
      if (now.getTime() > new Date(booking.expires_at).getTime()) {
        const nowIso = now.toISOString();
        db.prepare("UPDATE bookings SET status = 'EXPIRED' WHERE id = ?").run(booking.id);
        db.prepare("UPDATE reservations SET status = 'EXPIRED' WHERE booking_reference = ?").run(bookingReference);
        db.exec('COMMIT');
        return res.status(410).json({
          error: 'Reservation time has expired. Payment rejected and seats released.',
          code: 'RESERVATION_EXPIRED'
        });
      }

      // 4. Secure transaction reference & anti-replay verification
      const txnRef = transactionRef || `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      const duplicateTxn = db.prepare('SELECT id FROM bookings WHERE payment_ref = ? AND booking_reference != ?').get(txnRef, bookingReference);
      if (duplicateTxn) {
        db.exec('ROLLBACK');
        return res.status(409).json({
          error: 'Duplicate payment transaction reference detected.',
          code: 'DUPLICATE_PAYMENT'
        });
      }

      // 5. Optional save credit card for future bookings
      if (cardDetails && cardDetails.saveCard && cardDetails.cardNumber) {
        db.prepare(`
          INSERT INTO creditCards (cardHolder, cardNumber, expirationDate, CVV, id_account)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          cardDetails.cardHolder || 'CARD HOLDER',
          cardDetails.cardNumber,
          cardDetails.expirationDate || '2028-12-31',
          cardDetails.cvv || '123',
          Number(booking.id_account)
        );
      }

      // 6. Confirm booking & seats atomically
      const paidAt = new Date().toISOString();
      db.prepare(`
        UPDATE bookings 
        SET status = 'CONFIRMED', payment_ref = ?, payment_method = ?, paid_at = ?
        WHERE id = ?
      `).run(txnRef, paymentMethod, paidAt, booking.id);

      db.prepare(`
        UPDATE reservations 
        SET status = 'CONFIRMED', payment_ref = ?, expires_at = NULL 
        WHERE booking_reference = ?
      `).run(txnRef, bookingReference);

      db.exec('COMMIT');

      const ticketData = getTicketDataByBookingRef(bookingReference);
      res.json({
        success: true,
        bookingReference,
        status: 'CONFIRMED',
        paymentRef: txnRef,
        paidAt,
        ticket: ticketData
      });

    } catch (innerErr) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      console.error('Confirm error:', innerErr);
      res.status(500).json({ error: innerErr.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Explicit booking cancellation (releases seats immediately)
app.post('/api/bookings/cancel', (req, res) => {
  try {
    const { bookingReference, accountId } = req.body;
    if (!bookingReference) return res.status(400).json({ error: 'bookingReference is required' });

    db.exec('BEGIN IMMEDIATE');
    try {
      let b;
      if (accountId) {
        b = db.prepare('SELECT id, status FROM bookings WHERE booking_reference = ? AND id_account = ?').get(bookingReference, Number(accountId));
      } else {
        b = db.prepare('SELECT id, status FROM bookings WHERE booking_reference = ?').get(bookingReference);
      }

      if (!b) {
        db.exec('ROLLBACK');
        return res.status(404).json({ error: 'Booking not found' });
      }

      db.prepare("UPDATE bookings SET status = 'CANCELLED' WHERE id = ?").run(b.id);
      db.prepare("UPDATE reservations SET status = 'CANCELLED' WHERE booking_reference = ?").run(bookingReference);
      db.exec('COMMIT');

      res.json({ success: true, message: 'Reservation cancelled successfully and seats released.' });
    } catch (inner) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      res.status(500).json({ error: inner.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy reservation POST support (bridges to conflict-free hold & confirm)
app.post('/api/reservations', (req, res) => {
  cleanupExpiredReservations();
  try {
    const { flightId, accountId, seatId, seatIds, nbrLuggages = 0, weight = 0, cardDetails } = req.body;
    const seatsToReserve = Array.isArray(seatIds) && seatIds.length > 0 
      ? seatIds.map(Number) 
      : (seatId ? [Number(seatId)] : []);

    if (!flightId || !accountId || seatsToReserve.length === 0) {
      return res.status(400).json({ error: 'flightId, accountId, and seatId are required.' });
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const nowIso = new Date().toISOString();
      db.prepare("UPDATE reservations SET status = 'EXPIRED' WHERE status = 'HELD' AND expires_at <= ?").run(nowIso);

      const placeholders = seatsToReserve.map(() => '?').join(',');
      const conflicts = db.prepare(`
        SELECT id FROM reservations 
        WHERE id_flight = ? AND id_seat IN (${placeholders}) AND status IN ('HELD', 'CONFIRMED')
      `).all(Number(flightId), ...seatsToReserve);

      if (conflicts.length > 0) {
        db.exec('ROLLBACK');
        return res.status(409).json({ error: 'Sorry, this seat has just been reserved by another customer. Please select another seat.' });
      }

      const flight = db.prepare('SELECT * FROM flights WHERE id = ?').get(Number(flightId));
      const bookingReference = `BK-${flightId}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const createdAt = new Date().toISOString();

      let seatsPrice = 0;
      const seatDetails = db.prepare(`SELECT * FROM seats WHERE id IN (${placeholders})`).all(...seatsToReserve);
      seatDetails.forEach(s => {
        if (s.type === 'first') seatsPrice += flight.first_price;
        else if (s.type === 'business') seatsPrice += flight.business_price;
        else seatsPrice += flight.economy_price;
      });
      const grandTotal = seatsPrice + (Number(nbrLuggages) * (flight.luggage_price || 0)) + (Number(weight) * (flight.weight_price || 0));

      const isConfirmed = Boolean(cardDetails && cardDetails.cardNumber);
      const status = isConfirmed ? 'CONFIRMED' : 'PENDING_PAYMENT';
      const txnRef = isConfirmed ? `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}` : null;

      db.prepare(`
        INSERT INTO bookings (
          booking_reference, id_account, id_flight, status, total_amount, nbr_luggages, weight, created_at, expires_at, payment_ref, paid_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        bookingReference, Number(accountId), Number(flightId), status, grandTotal,
        Number(nbrLuggages), Number(weight), createdAt, expiresAt, txnRef, isConfirmed ? createdAt : null
      );

      let firstResId = null;
      for (const s of seatDetails) {
        db.prepare(`
          INSERT INTO reservations (
            id_flight, id_account, id_seat, nbr_luggages, weight, booking_reference, status, created_at, expires_at, payment_ref, total_price
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          Number(flightId), Number(accountId), s.id, Number(nbrLuggages), Number(weight),
          bookingReference, isConfirmed ? 'CONFIRMED' : 'HELD', createdAt, isConfirmed ? null : expiresAt, txnRef, grandTotal
        );
        if (!firstResId) {
          firstResId = db.prepare('SELECT last_insert_rowid() as id').get().id;
        }
      }

      db.exec('COMMIT');

      const ticketData = getTicketDataByBookingRef(bookingReference) || getTicketData(firstResId);
      res.json({
        success: true,
        reservationId: firstResId,
        bookingReference,
        status,
        ticket: ticketData
      });
    } catch (inner) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      if (inner.message && inner.message.includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'Sorry, this seat has just been reserved by another customer. Please select another seat.' });
      }
      res.status(500).json({ error: inner.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ticket View endpoint (supports both booking reference and reservation ID)
app.get('/api/reservations/ticket/:id', (req, res) => {
  try {
    const param = req.params.id;
    let data;
    if (isNaN(param)) {
      data = getTicketDataByBookingRef(param);
    } else {
      data = getTicketData(Number(param));
    }
    if (!data) return res.status(404).json({ error: 'Ticket not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User's Reservations and Bookings
app.get('/api/reservations/my', (req, res) => {
  cleanupExpiredReservations();
  try {
    const session = getSession(req);
    let accountId = Number(req.query.accountId);

    // RBAC: Verify passenger can only access their own reservations
    if (session) {
      const roleUpper = (session.role || '').toUpperCase();
      if (roleUpper === 'PASSENGER') {
        if (accountId && accountId !== session.account_id) {
          return res.status(403).json({ error: 'Access denied: You cannot view another customer\'s bookings.' });
        }
        accountId = session.account_id;
      }
    }

    if (!accountId) return res.status(400).json({ error: 'accountId is required' });

    const userBookings = db.prepare(`
      SELECT b.id as bookingId, b.booking_reference as bookingReference, b.status,
             b.total_amount, b.nbr_luggages, b.weight, b.created_at, b.expires_at, b.paid_at,
             f.id as flightId, f.dep_datetime, f.arr_datetime,
             al.id as airlineId, al.name as airlineName, al.IATA as airlineIATA,
             da.name as depAirportName, da.IATA as depIATA, da.city as depCity, da.country as depCountry,
             aa.name as arrAirportName, aa.IATA as arrIATA, aa.city as arrCity, aa.country as arrCountry,
             (SELECT GROUP_CONCAT(s.column || s.row, ', ') 
              FROM reservations r 
              JOIN seats s ON r.id_seat = s.id 
              WHERE r.booking_reference = b.booking_reference) as seatNumbers
      FROM bookings b
      JOIN flights f ON b.id_flight = f.id
      JOIN airLines al ON f.id_airline = al.id
      JOIN airports da ON f.dep_airport = da.id
      JOIN airports aa ON f.arr_airport = aa.id
      WHERE b.id_account = ?
      ORDER BY b.created_at DESC
    `).all(accountId);

    const legacyRes = db.prepare(`
      SELECT r.id as reservationId, r.nbr_luggages, r.weight, r.status, r.booking_reference as bookingReference,
             s.column as seatColumn, s.row as seatRow, s.type as seatClass,
             (s.column || s.row) as seatNumbers,
             f.id as flightId, f.dep_datetime, f.arr_datetime, 
             f.first_price, f.business_price, f.economy_price, f.luggage_price, f.weight_price,
             al.id as airlineId, al.name as airlineName, al.IATA as airlineIATA,
             da.name as depAirportName, da.IATA as depIATA, da.city as depCity, da.country as depCountry,
             aa.name as arrAirportName, aa.IATA as arrIATA, aa.city as arrCity, aa.country as arrCountry
      FROM reservations r
      JOIN seats s ON r.id_seat = s.id
      JOIN flights f ON r.id_flight = f.id
      JOIN airLines al ON f.id_airline = al.id
      JOIN airports da ON f.dep_airport = da.id
      JOIN airports aa ON f.arr_airport = aa.id
      WHERE r.id_account = ? AND (r.booking_reference IS NULL OR r.booking_reference = '')
      ORDER BY f.dep_datetime DESC
    `).all(accountId);

    const combined = [
      ...userBookings.map(b => ({
        ...sanitizeAirportRecord(b),
        isBooking: true,
        secondsRemaining: (b.status === 'PENDING_PAYMENT' && b.expires_at)
          ? Math.max(0, Math.floor((new Date(b.expires_at).getTime() - Date.now()) / 1000))
          : 0
      })),
      ...legacyRes.map(r => ({
        ...sanitizeAirportRecord(r),
        isBooking: false,
        total_amount: r.economy_price || 0,
        status: r.status || 'CONFIRMED'
      }))
    ];

    res.json(combined);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/reservations/:id', (req, res) => {
  try {
    const resId = Number(req.params.id);
    const accountId = req.query.accountId ? Number(req.query.accountId) : null;

    db.exec('BEGIN IMMEDIATE');
    try {
      const resRow = db.prepare('SELECT booking_reference FROM reservations WHERE id = ?').get(resId);
      if (resRow && resRow.booking_reference) {
        db.prepare("UPDATE bookings SET status = 'CANCELLED' WHERE booking_reference = ?").run(resRow.booking_reference);
        db.prepare("UPDATE reservations SET status = 'CANCELLED' WHERE booking_reference = ?").run(resRow.booking_reference);
      } else {
        if (accountId) {
          db.prepare('DELETE FROM reservations WHERE id = ? AND id_account = ?').run(resId, accountId);
        } else {
          db.prepare('DELETE FROM reservations WHERE id = ?').run(resId);
        }
      }
      db.exec('COMMIT');
      res.json({ success: true, message: 'Reservation cancelled successfully and seats released.' });
    } catch (inner) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      res.status(500).json({ error: inner.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 6. FAVORITES
// -------------------------------------------------------------
app.get('/api/favorites', (req, res) => {
  try {
    const accountId = Number(req.query.accountId);
    if (!accountId) return res.status(400).json({ error: 'accountId required' });

    const flights = db.prepare(`
      SELECT f.*,
             al.name as airlineName, al.IATA as airlineIATA,
             da.name as depAirportName, da.IATA as depIATA, da.city as depCity, da.country as depCountry,
             aa.name as arrAirportName, aa.IATA as arrIATA, aa.city as arrCity, aa.country as arrCountry,
             1 as isFavorite
      FROM favorites fav
      JOIN flights f ON fav.id_flight = f.id
      JOIN airLines al ON f.id_airline = al.id
      JOIN airports da ON f.dep_airport = da.id
      JOIN airports aa ON f.arr_airport = aa.id
      WHERE fav.id_account = ?
      ORDER BY f.dep_datetime ASC
    `).all(accountId);

    res.json(flights.map(sanitizeAirportRecord));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/favorites/:flightId', (req, res) => {
  try {
    const flightId = Number(req.params.flightId);
    const { accountId } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId required' });

    const exists = db.prepare('SELECT id FROM favorites WHERE id_account = ? AND id_flight = ?').get(accountId, flightId);
    if (!exists) {
      db.prepare('INSERT INTO favorites (id_account, id_flight) VALUES (?, ?)').run(accountId, flightId);
    }
    res.json({ success: true, isFavorite: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/favorites/:flightId', (req, res) => {
  try {
    const flightId = Number(req.params.flightId);
    const { accountId } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId required' });

    db.prepare('DELETE FROM favorites WHERE id_account = ? AND id_flight = ?').run(accountId, flightId);
    res.json({ success: true, isFavorite: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 7. CREDIT CARDS
// -------------------------------------------------------------
app.get('/api/cards', (req, res) => {
  try {
    const accountId = Number(req.query.accountId);
    if (!accountId) return res.status(400).json({ error: 'accountId required' });

    const cards = db.prepare(`
      SELECT id, cardHolder, cardNumber, expirationDate, id_account
      FROM creditCards
      WHERE id_account = ?
    `).all(accountId);

    res.json(cards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cards', (req, res) => {
  try {
    const { cardHolder, cardNumber, expirationDate, cvv, accountId } = req.body;
    if (!cardHolder || !cardNumber || !expirationDate || !cvv || !accountId) {
      return res.status(400).json({ error: 'All card fields are required.' });
    }

    const ins = db.prepare(`
      INSERT INTO creditCards (cardHolder, cardNumber, expirationDate, CVV, id_account)
      VALUES (?, ?, ?, ?, ?)
    `);
    ins.run(cardHolder, cardNumber, expirationDate, cvv, Number(accountId));
    const cardId = db.prepare('SELECT last_insert_rowid() as id').get().id;

    res.status(201).json({ success: true, cardId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/cards/:id', (req, res) => {
  try {
    const cardId = Number(req.params.id);
    const accountId = req.query.accountId ? Number(req.query.accountId) : null;
    let stmt;
    if (accountId) {
      stmt = db.prepare('DELETE FROM creditCards WHERE id = ? AND id_account = ?');
      stmt.run(cardId, accountId);
    } else {
      stmt = db.prepare('DELETE FROM creditCards WHERE id = ?');
      stmt.run(cardId);
    }
    res.json({ success: true, message: 'Card removed successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 8. PASSENGER PROFILE MANAGEMENT
// -------------------------------------------------------------
app.get('/api/profile', (req, res) => {
  try {
    const accountId = Number(req.query.accountId);
    if (!accountId) return res.status(400).json({ error: 'accountId required' });

    const account = db.prepare(`
      SELECT a.id, a.username, a.emailAddress, a.id_passenger,
             p.firstName, p.lastName, p.birthDate, p.gender, p.country
      FROM accounts a
      LEFT JOIN passengers p ON a.id_passenger = p.id
      WHERE a.id = ?
    `).get(accountId);

    if (!account) return res.status(404).json({ error: 'User not found' });
    res.json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/profile', (req, res) => {
  try {
    const { accountId, firstName, lastName, birthDate, gender, country, emailAddress } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId required' });

    const account = db.prepare('SELECT id, id_passenger FROM accounts WHERE id = ?').get(Number(accountId));
    if (!account) return res.status(404).json({ error: 'Account not found' });

    if (emailAddress) {
      db.prepare('UPDATE accounts SET emailAddress = ? WHERE id = ?').run(emailAddress.trim(), account.id);
    }

    if (account.id_passenger) {
      db.prepare(`
        UPDATE passengers 
        SET firstName = ?, lastName = ?, birthDate = ?, gender = ?, country = ?
        WHERE id = ?
      `).run(
        firstName || '',
        lastName || '',
        birthDate || '1998-01-01',
        gender === 'F' ? 'F' : 'M',
        country || 'Bangladesh',
        account.id_passenger
      );
    } else {
      const ins = db.prepare(`
        INSERT INTO passengers (firstName, lastName, birthDate, gender, country)
        VALUES (?, ?, ?, ?, ?)
      `);
      ins.run(firstName || '', lastName || '', birthDate || '1998-01-01', gender === 'F' ? 'F' : 'M', country || 'Bangladesh');
      const passengerId = db.prepare('SELECT last_insert_rowid() as id').get().id;
      db.prepare('UPDATE accounts SET id_passenger = ? WHERE id = ?').run(passengerId, account.id);
    }

    res.json({ success: true, message: 'Profile updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/profile/password', (req, res) => {
  try {
    const { accountId, currentPassword, newPassword } = req.body;
    if (!accountId || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const account = db.prepare('SELECT id, password FROM accounts WHERE id = ?').get(Number(accountId));
    if (!account) return res.status(404).json({ error: 'Account not found' });

    if (account.password !== currentPassword && account.password !== currentPassword.trim()) {
      return res.status(401).json({ error: 'Current password does not match.' });
    }

    db.prepare('UPDATE accounts SET password = ? WHERE id = ?').run(newPassword, account.id);
    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 9. ADMIN DASHBOARD & BOOKINGS MANAGEMENT (WITH STRICT RBAC)
// -------------------------------------------------------------
app.get('/api/admin/all-bookings', (req, res) => {
  cleanupExpiredReservations();
  try {
    const session = getSession(req);
    // RBAC: Verify authenticated admin
    if (!session) {
      return res.status(401).json({ error: 'Authentication required to access administrative bookings.' });
    }
    const roleUpper = (session.role || '').toUpperCase();
    if (roleUpper !== 'AIRLINE_ADMIN' && roleUpper !== 'AIRLINE') {
      return res.status(403).json({ error: 'Access denied: Passenger accounts cannot access administrative bookings data.' });
    }

    const { status = 'all', search = '', limit = 50, offset = 0 } = req.query;

    const whereClauses = [];
    const params = [];

    // STRICT TENANT ISOLATION: Airline admins ONLY access their own airline bookings
    if (session.airline_id) {
      whereClauses.push('f.id_airline = ?');
      params.push(session.airline_id);
    }

    if (status && status !== 'all') {
      whereClauses.push('b.status = ?');
      params.push(status);
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      whereClauses.push(`(
        b.booking_reference LIKE ? OR 
        a.username LIKE ? OR 
        p.firstName LIKE ? OR 
        p.lastName LIKE ? OR 
        al.name LIKE ? OR 
        da.city LIKE ? OR 
        aa.city LIKE ?
      )`);
      params.push(q, q, q, q, q, q, q);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countSql = `
      SELECT COUNT(*) as total 
      FROM bookings b 
      JOIN accounts a ON b.id_account = a.id
      LEFT JOIN passengers p ON a.id_passenger = p.id
      JOIN flights f ON b.id_flight = f.id
      JOIN airLines al ON f.id_airline = al.id
      JOIN airports da ON f.dep_airport = da.id
      JOIN airports aa ON f.arr_airport = aa.id
      ${whereSql}
    `;
    const totalCount = db.prepare(countSql).get(...params).total;

    const dataSql = `
      SELECT b.*,
             a.username, a.emailAddress,
             p.firstName, p.lastName,
             al.name as airlineName, al.IATA as airlineIATA,
             da.city as depCity, da.IATA as depIATA,
             aa.city as arrCity, aa.IATA as arrIATA,
             f.dep_datetime, f.arr_datetime,
             (SELECT GROUP_CONCAT(s.column || s.row, ', ') 
              FROM reservations r 
              JOIN seats s ON r.id_seat = s.id 
              WHERE r.booking_reference = b.booking_reference) as seatNumbers
      FROM bookings b
      JOIN accounts a ON b.id_account = a.id
      LEFT JOIN passengers p ON a.id_passenger = p.id
      JOIN flights f ON b.id_flight = f.id
      JOIN airLines al ON f.id_airline = al.id
      JOIN airports da ON f.dep_airport = da.id
      JOIN airports aa ON f.arr_airport = aa.id
      ${whereSql}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const bookings = db.prepare(dataSql).all(...params, Number(limit), Number(offset));

    // Scoped statistics strictly for the authorized airline
    let stats;
    if (session.airline_id) {
      stats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN b.status = 'CONFIRMED' THEN 1 ELSE 0 END) as confirmed,
          SUM(CASE WHEN b.status = 'PENDING_PAYMENT' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN b.status = 'EXPIRED' THEN 1 ELSE 0 END) as expired,
          SUM(CASE WHEN b.status = 'CONFIRMED' THEN b.total_amount ELSE 0 END) as confirmedRevenue
        FROM bookings b
        JOIN flights f ON b.id_flight = f.id
        WHERE f.id_airline = ?
      `).get(session.airline_id);
    } else {
      stats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) as confirmed,
          SUM(CASE WHEN status = 'PENDING_PAYMENT' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END) as expired,
          SUM(CASE WHEN status = 'CONFIRMED' THEN total_amount ELSE 0 END) as confirmedRevenue
        FROM bookings
      `).get();
    }

    res.json({
      total: totalCount,
      airlineId: session.airline_id,
      airlineName: session.airlineName || 'All Airlines',
      stats: {
        total: stats.total || 0,
        confirmed: stats.confirmed || 0,
        pending: stats.pending || 0,
        expired: stats.expired || 0,
        revenue: Math.round(stats.confirmedRevenue || 0)
      },
      bookings: bookings.map(b => ({
        ...sanitizeAirportRecord(b),
        secondsRemaining: (b.status === 'PENDING_PAYMENT' && b.expires_at) 
          ? Math.max(0, Math.floor((new Date(b.expires_at).getTime() - Date.now()) / 1000))
          : 0
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Airline Flights Manager (WITH STRICT RBAC)
app.get('/api/airline/flights', (req, res) => {
  cleanupExpiredReservations();
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Authentication required.' });
    const roleUpper = (session.role || '').toUpperCase();
    if (roleUpper !== 'AIRLINE_ADMIN' && roleUpper !== 'AIRLINE') {
      return res.status(403).json({ error: 'Access denied: Passenger accounts cannot view airline management flights.' });
    }

    const requestedAirlineId = Number(req.query.airlineId) || session.airline_id;
    if (session.airline_id && requestedAirlineId !== session.airline_id) {
      return res.status(403).json({ error: 'Access denied: You cannot view flight management data for another airline.' });
    }

    const airlineId = session.airline_id || requestedAirlineId;
    if (!airlineId) return res.status(400).json({ error: 'airlineId is required' });

    const flights = db.prepare(`
      SELECT f.*,
             da.name as depAirportName, da.IATA as depIATA, da.city as depCity, da.country as depCountry,
             aa.name as arrAirportName, aa.IATA as arrIATA, aa.city as arrCity, aa.country as arrCountry,
             (SELECT COUNT(*) FROM reservations r WHERE r.id_flight = f.id AND r.status IN ('CONFIRMED', 'HELD')) as bookedCount,
             (SELECT SUM(
                CASE 
                  WHEN s.type = 'first' THEN f.first_price 
                  WHEN s.type = 'business' THEN f.business_price 
                  ELSE f.economy_price 
                END + (r.nbr_luggages * f.luggage_price) + (r.weight * f.weight_price)
              ) FROM reservations r JOIN seats s ON r.id_seat = s.id WHERE r.id_flight = f.id AND r.status = 'CONFIRMED') as revenue
      FROM flights f
      JOIN airports da ON f.dep_airport = da.id
      JOIN airports aa ON f.arr_airport = aa.id
      WHERE f.id_airline = ?
      ORDER BY f.dep_datetime DESC
    `).all(airlineId);

    res.json(flights.map(sanitizeAirportRecord));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/airline/flights', (req, res) => {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Authentication required.' });
    const roleUpper = (session.role || '').toUpperCase();
    if (roleUpper !== 'AIRLINE_ADMIN' && roleUpper !== 'AIRLINE') {
      return res.status(403).json({ error: 'Access denied: Airline administrator privileges required.' });
    }

    const targetAirlineId = Number(req.body.airlineId) || session.airline_id;
    if (session.airline_id && targetAirlineId !== session.airline_id) {
      return res.status(403).json({ error: 'Access denied: You cannot create flight schedules for another airline.' });
    }

    const {
      depAirport, arrAirport,
      depDatetime, arrDatetime,
      firstPrice, businessPrice, economyPrice,
      luggagePrice = 350, weightPrice = 120
    } = req.body;

    if (!targetAirlineId || !depAirport || !arrAirport || !depDatetime || !arrDatetime) {
      return res.status(400).json({ error: 'Required flight details are missing.' });
    }

    const ins = db.prepare(`
      INSERT INTO flights (
        id_airline, dep_airport, arr_airport, 
        dep_datetime, arr_datetime, 
        first_price, business_price, economy_price, 
        luggage_price, weight_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    ins.run(
      Number(targetAirlineId),
      Number(depAirport),
      Number(arrAirport),
      formatDateTime(depDatetime),
      formatDateTime(arrDatetime),
      Number(firstPrice || 15000),
      Number(businessPrice || 8000),
      Number(economyPrice || 4500),
      Number(luggagePrice || 350),
      Number(weightPrice || 120)
    );

    const flightId = db.prepare('SELECT last_insert_rowid() as id').get().id;
    res.status(201).json({ success: true, flightId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/airline/flights/:id', (req, res) => {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Authentication required.' });
    const roleUpper = (session.role || '').toUpperCase();
    if (roleUpper !== 'AIRLINE_ADMIN' && roleUpper !== 'AIRLINE') {
      return res.status(403).json({ error: 'Access denied: Airline administrator privileges required.' });
    }

    const flightId = Number(req.params.id);
    const existingFlight = db.prepare('SELECT id, id_airline FROM flights WHERE id = ?').get(flightId);
    if (!existingFlight) return res.status(404).json({ error: 'Flight schedule not found.' });

    if (session.airline_id && existingFlight.id_airline !== session.airline_id) {
      return res.status(403).json({ error: 'Access denied: You cannot modify schedules for another airline.' });
    }

    const {
      depAirport, arrAirport,
      depDatetime, arrDatetime,
      firstPrice, businessPrice, economyPrice,
      luggagePrice, weightPrice
    } = req.body;

    db.prepare(`
      UPDATE flights 
      SET dep_airport = ?, arr_airport = ?,
          dep_datetime = ?, arr_datetime = ?,
          first_price = ?, business_price = ?, economy_price = ?,
          luggage_price = ?, weight_price = ?
      WHERE id = ?
    `).run(
      Number(depAirport),
      Number(arrAirport),
      formatDateTime(depDatetime),
      formatDateTime(arrDatetime),
      Number(firstPrice),
      Number(businessPrice),
      Number(economyPrice),
      Number(luggagePrice),
      Number(weightPrice),
      flightId
    );

    res.json({ success: true, message: 'Flight schedule updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/airline/flights/:id', (req, res) => {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Authentication required.' });
    const roleUpper = (session.role || '').toUpperCase();
    if (roleUpper !== 'AIRLINE_ADMIN' && roleUpper !== 'AIRLINE') {
      return res.status(403).json({ error: 'Access denied: Airline administrator privileges required.' });
    }

    const flightId = Number(req.params.id);
    const existingFlight = db.prepare('SELECT id, id_airline FROM flights WHERE id = ?').get(flightId);
    if (!existingFlight) return res.status(404).json({ error: 'Flight schedule not found.' });

    if (session.airline_id && existingFlight.id_airline !== session.airline_id) {
      return res.status(403).json({ error: 'Access denied: You cannot delete schedules for another airline.' });
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM bookings WHERE id_flight = ?').run(flightId);
      db.prepare('DELETE FROM reservations WHERE id_flight = ?').run(flightId);
      db.prepare('DELETE FROM favorites WHERE id_flight = ?').run(flightId);
      db.prepare('DELETE FROM flights WHERE id = ?').run(flightId);
      db.exec('COMMIT');
      res.json({ success: true, message: 'Flight deleted successfully.' });
    } catch (inner) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      res.status(500).json({ error: inner.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/airline/stats', (req, res) => {
  cleanupExpiredReservations();
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Authentication required.' });
    const roleUpper = (session.role || '').toUpperCase();
    if (roleUpper !== 'AIRLINE_ADMIN' && roleUpper !== 'AIRLINE') {
      return res.status(403).json({ error: 'Access denied: Passenger accounts cannot view airline revenue stats.' });
    }

    const requestedAirlineId = Number(req.query.airlineId) || session.airline_id;
    if (session.airline_id && requestedAirlineId !== session.airline_id) {
      return res.status(403).json({ error: 'Access denied: You cannot view analytics for another airline.' });
    }

    const airlineId = session.airline_id || requestedAirlineId;
    if (!airlineId) return res.status(400).json({ error: 'airlineId is required' });

    const flightStats = db.prepare(`
      SELECT COUNT(*) as totalFlights,
             (SELECT COUNT(*) FROM reservations r JOIN flights f ON r.id_flight = f.id WHERE f.id_airline = ? AND r.status = 'CONFIRMED') as totalBookings
      FROM flights 
      WHERE id_airline = ?
    `).get(airlineId, airlineId);

    const revenueStat = db.prepare(`
      SELECT SUM(
        CASE 
          WHEN s.type = 'first' THEN f.first_price 
          WHEN s.type = 'business' THEN f.business_price 
          ELSE f.economy_price 
        END + (r.nbr_luggages * f.luggage_price) + (r.weight * f.weight_price)
      ) as totalRevenue
      FROM reservations r
      JOIN flights f ON r.id_flight = f.id
      JOIN seats s ON r.id_seat = s.id
      WHERE f.id_airline = ? AND r.status = 'CONFIRMED'
    `).get(airlineId);

    res.json({
      airlineId,
      totalFlights: flightStats.totalFlights || 0,
      totalBookings: flightStats.totalBookings || 0,
      totalRevenue: Math.round(revenueStat.totalRevenue || 0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 10. AIRLINE LOGO & PASSENGER PICTURE BLOB STREAMING
// -------------------------------------------------------------
app.get('/api/airlines/:id/logo', (req, res) => {
  try {
    const airline = db.prepare('SELECT logo FROM airLines WHERE id = ?').get(Number(req.params.id));
    if (airline && airline.logo && airline.logo.length > 0) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(Buffer.from(airline.logo));
    }
  } catch (e) {
    // fallback
  }
  res.sendFile(path.join(__dirname, 'public', 'images', 'default_logo.png'));
});

app.get('/api/passengers/:id/picture', (req, res) => {
  try {
    const passenger = db.prepare('SELECT profilePicture FROM passengers WHERE id = ?').get(Number(req.params.id));
    if (passenger && passenger.profilePicture && passenger.profilePicture.length > 0) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(Buffer.from(passenger.profilePicture));
    }
  } catch (e) {
    // fallback
  }
  res.sendFile(path.join(__dirname, 'public', 'images', 'ProfilePicture.png'));
});

// Dedicated Auth Routes for clean URL navigation
app.get(['/login', '/logout'], (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Fallback all SPA routes to index.html
app.use((req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`✈️  SKYNET CONFLICT-FREE FLIGHT BOOKING SYSTEM`);
  console.log(`👤 Author:        mahin1710`);
  console.log(`🌐 Frontend App:  http://localhost:${PORT}`);
  console.log(`🔌 Backend API:   http://localhost:${PORT}/api`);
  console.log(`⏱️  15-min auto-release worker: ACTIVE`);
  console.log(`====================================================`);
});
