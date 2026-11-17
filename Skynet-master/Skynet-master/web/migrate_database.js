const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbPath = path.join(__dirname, 'database.db');
const db = new DatabaseSync(dbPath);

console.log('Running database schema migration for conflict-free reservations...');

// 1. Enable WAL mode for high concurrency
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

// 2. Check and add columns to `reservations` table
const existingCols = db.prepare('PRAGMA table_info(reservations)').all().map(c => c.name);

if (!existingCols.includes('booking_reference')) {
  console.log('Adding column booking_reference to reservations...');
  db.exec('ALTER TABLE reservations ADD COLUMN booking_reference TEXT;');
}

if (!existingCols.includes('status')) {
  console.log('Adding column status to reservations...');
  db.exec("ALTER TABLE reservations ADD COLUMN status TEXT DEFAULT 'CONFIRMED';");
}

if (!existingCols.includes('created_at')) {
  console.log('Adding column created_at to reservations...');
  db.exec('ALTER TABLE reservations ADD COLUMN created_at TEXT;');
}

if (!existingCols.includes('expires_at')) {
  console.log('Adding column expires_at to reservations...');
  db.exec('ALTER TABLE reservations ADD COLUMN expires_at TEXT;');
}

if (!existingCols.includes('payment_ref')) {
  console.log('Adding column payment_ref to reservations...');
  db.exec('ALTER TABLE reservations ADD COLUMN payment_ref TEXT;');
}

if (!existingCols.includes('total_price')) {
  console.log('Adding column total_price to reservations...');
  db.exec('ALTER TABLE reservations ADD COLUMN total_price REAL DEFAULT 0;');
}

// 3. Ensure any existing rows without status are marked 'CONFIRMED'
db.exec("UPDATE reservations SET status = 'CONFIRMED' WHERE status IS NULL OR status = '';");

// 4. Create `bookings` table for grouping multiple seats under one 15-min reservation
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

// 5. Create the partial unique index to strictly enforce ONE ACTIVE RESERVATION PER SEAT
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_active_seat_reservation 
  ON reservations (id_flight, id_seat) 
  WHERE status IN ('HELD', 'CONFIRMED');
`);

// 6. Create query performance indexes
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_res_flight_status ON reservations(id_flight, status);
  CREATE INDEX IF NOT EXISTS idx_res_booking_ref ON reservations(booking_reference);
  CREATE INDEX IF NOT EXISTS idx_res_status_expires ON reservations(status, expires_at);
  CREATE INDEX IF NOT EXISTS idx_bookings_status_expires ON bookings(status, expires_at);
  CREATE INDEX IF NOT EXISTS idx_bookings_account ON bookings(id_account);
`);

console.log('Database migration completed successfully!');
