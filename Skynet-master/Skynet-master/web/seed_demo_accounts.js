/**
 * DATABASE SEEDER: DEMO ACCOUNTS & RBAC INITIALIZATION
 * Seeds the 4 required demo accounts with secure scrypt password hashing.
 * Safe & idempotent: does NOT overwrite existing passwords on restart.
 */
const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  if (storedHash.startsWith('scrypt:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 3) return false;
    const [, salt, originalKey] = parts;
    const derivedKey = crypto.scryptSync(password, salt, 64);
    const keyBuf = Buffer.from(derivedKey.toString('hex'));
    const origBuf = Buffer.from(originalKey);
    if (keyBuf.length !== origBuf.length) return false;
    return crypto.timingSafeEqual(keyBuf, origBuf);
  }
  // Fallback for plain text accounts
  return storedHash === password || storedHash === password.trim();
}

function seedDemoAccounts(dbInstance) {
  const db = dbInstance || new DatabaseSync(path.join(__dirname, 'database.db'));

  // 1. Ensure table columns exist
  try {
    const accCols = db.prepare('PRAGMA table_info(accounts)').all().map(c => c.name);
    if (!accCols.includes('role')) {
      db.exec("ALTER TABLE accounts ADD COLUMN role TEXT DEFAULT 'PASSENGER'");
    }
    if (!accCols.includes('display_name')) {
      db.exec("ALTER TABLE accounts ADD COLUMN display_name TEXT");
    }
    if (!accCols.includes('location')) {
      db.exec("ALTER TABLE accounts ADD COLUMN location TEXT DEFAULT 'Dhaka, Bangladesh'");
    }
  } catch (err) {
    console.warn('Schema upgrade note:', err.message);
  }

  // 2. Ensure auth_sessions table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      airline_id INTEGER,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON auth_sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_account ON auth_sessions(account_id);
  `);

  // 3. Define Demo Accounts
  const demoAccounts = [
    {
      username: 'Mahin0',
      passwordPlain: 'Mahin0',
      displayName: 'MMH_Mahin',
      role: 'PASSENGER',
      location: 'Dhaka, Bangladesh',
      email: 'mahin0@flight.bd',
      passenger: {
        firstName: 'MMH',
        lastName: 'Mahin',
        birthDate: '1996-03-15',
        gender: 'M',
        country: 'Bangladesh'
      },
      airlineId: null
    },
    {
      username: 'Admin_Biman',
      passwordPlain: 'Admin_Biman',
      displayName: 'Biman Bangladesh Airlines Admin',
      role: 'AIRLINE_ADMIN',
      location: 'Dhaka, Bangladesh',
      email: 'admin.biman@biman-airlines.com',
      passenger: null,
      airlineId: 839 // Biman Bangladesh Airlines
    },
    {
      username: 'Admin_USB',
      passwordPlain: 'Admin_USB',
      displayName: 'US-Bangla Airlines Admin',
      role: 'AIRLINE_ADMIN',
      location: 'Dhaka, Bangladesh',
      email: 'admin.usb@usbair.com',
      passenger: null,
      airlineId: 371 // US-Bangla Airlines
    },
    {
      username: 'Mahin1',
      passwordPlain: 'Mahin1',
      displayName: 'Mahin1',
      role: 'PASSENGER',
      location: 'Chittagong, Bangladesh',
      email: 'mahin1@flight.bd',
      passenger: {
        firstName: 'Mahin',
        lastName: 'Traveler',
        birthDate: '1998-07-22',
        gender: 'M',
        country: 'Bangladesh'
      },
      airlineId: null
    }
  ];

  console.log('Seeding demo accounts into database...');
  for (const acc of demoAccounts) {
    const existing = db.prepare('SELECT id, password, role FROM accounts WHERE username = ? COLLATE NOCASE').get(acc.username);

    if (existing) {
      // Account exists: do NOT overwrite password if already set!
      // Only update role and metadata
      db.prepare(`
        UPDATE accounts 
        SET role = ?, display_name = ?, location = ?, id_airline = COALESCE(?, id_airline)
        WHERE id = ?
      `).run(acc.role, acc.displayName, acc.location, acc.airlineId, existing.id);
      console.log(`✓ Account ${acc.username} exists (id=${existing.id}, role=${acc.role}) - Password preserved.`);
    } else {
      let passengerId = null;
      if (acc.passenger) {
        db.prepare(`
          INSERT INTO passengers (firstName, lastName, birthDate, gender, country)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          acc.passenger.firstName,
          acc.passenger.lastName,
          acc.passenger.birthDate,
          acc.passenger.gender,
          acc.passenger.country
        );
        passengerId = db.prepare('SELECT last_insert_rowid() as id').get().id;
      }

      const secureHashedPassword = hashPassword(acc.passwordPlain);
      db.prepare(`
        INSERT INTO accounts (id_passenger, id_airline, username, password, emailAddress, role, display_name, location)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        passengerId,
        acc.airlineId,
        acc.username,
        secureHashedPassword,
        acc.email,
        acc.role,
        acc.displayName,
        acc.location
      );
      const newAccountId = db.prepare('SELECT last_insert_rowid() as id').get().id;
      console.log(`+ Created Demo Account: ${acc.username} (id=${newAccountId}, role=${acc.role}, hashed=true)`);
    }
  }

  // 4. Ensure sample confirmed bookings exist for Mahin0 on Biman (flight 967) and US-Bangla (flight 968)
  try {
    const mahin0Acc = db.prepare("SELECT id FROM accounts WHERE username = 'Mahin0'").get();
    if (mahin0Acc) {
      const existingBooking = db.prepare("SELECT id FROM bookings WHERE id_account = ?").get(mahin0Acc.id);
      if (!existingBooking) {
        console.log('Creating initial confirmed demo booking for Mahin0 on Biman Bangladesh Airlines...');
        const bimanFlight = db.prepare("SELECT id, economy_price FROM flights WHERE id_airline = 839 LIMIT 1").get();
        if (bimanFlight) {
          const seat = db.prepare("SELECT id FROM seats LIMIT 1").get();
          const bookingRef = 'BG-MH0' + Math.floor(1000 + Math.random() * 9000);
          const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

          db.prepare(`
            INSERT INTO bookings (
              booking_reference, id_account, id_flight, status, total_amount,
              nbr_luggages, weight, created_at, expires_at, payment_ref, payment_method, paid_at
            ) VALUES (?, ?, ?, 'CONFIRMED', ?, 1, 15, ?, ?, ?, 'BKASH', ?)
          `).run(
            bookingRef, mahin0Acc.id, bimanFlight.id, bimanFlight.economy_price + 350,
            nowStr, nowStr, 'PAY-' + Date.now(), nowStr
          );

          if (seat) {
            db.prepare(`
              INSERT INTO reservations (
                id_flight, id_account, id_seat, nbr_luggages, weight,
                booking_reference, status, created_at, expires_at, payment_ref, total_price
              ) VALUES (?, ?, ?, 1, 15, ?, 'CONFIRMED', ?, ?, ?, ?)
            `).run(
              bimanFlight.id, mahin0Acc.id, seat.id, bookingRef,
              nowStr, nowStr, 'PAY-' + Date.now(), bimanFlight.economy_price + 350
            );
          }
          console.log(`✓ Seeded Biman flight booking ${bookingRef} for Mahin0.`);
        }

        // Also add one for US-Bangla so Admin_USB has real revenue/stats to view
        const mahin1Acc = db.prepare("SELECT id FROM accounts WHERE username = 'Mahin1'").get();
        const usbFlight = db.prepare("SELECT id, economy_price FROM flights WHERE id_airline = 371 LIMIT 1").get();
        if (mahin1Acc && usbFlight) {
          const seat2 = db.prepare("SELECT id FROM seats LIMIT 1 OFFSET 2").get() || { id: 2 };
          const usbBookingRef = 'BS-MH1' + Math.floor(1000 + Math.random() * 9000);
          const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

          db.prepare(`
            INSERT INTO bookings (
              booking_reference, id_account, id_flight, status, total_amount,
              nbr_luggages, weight, created_at, expires_at, payment_ref, payment_method, paid_at
            ) VALUES (?, ?, ?, 'CONFIRMED', ?, 1, 12, ?, ?, ?, 'NAGAD', ?)
          `).run(
            usbBookingRef, mahin1Acc.id, usbFlight.id, usbFlight.economy_price + 350,
            nowStr, nowStr, 'PAY-' + Date.now(), nowStr
          );

          db.prepare(`
            INSERT INTO reservations (
              id_flight, id_account, id_seat, nbr_luggages, weight,
              booking_reference, status, created_at, expires_at, payment_ref, total_price
            ) VALUES (?, ?, ?, 1, 12, ?, 'CONFIRMED', ?, ?, ?, ?)
          `).run(
            usbFlight.id, mahin1Acc.id, seat2.id, usbBookingRef,
            nowStr, nowStr, 'PAY-' + Date.now(), usbFlight.economy_price + 350
          );
          console.log(`✓ Seeded US-Bangla flight booking ${usbBookingRef} for Mahin1.`);
        }
      }
    }
  } catch (err) {
    console.warn('Sample booking seeding note:', err.message);
  }

  console.log('Database demo accounts initialization complete.');
}

if (require.main === module) {
  seedDemoAccounts();
}

module.exports = {
  seedDemoAccounts,
  hashPassword,
  verifyPassword
};
