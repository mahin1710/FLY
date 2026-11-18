const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbPath = path.join(__dirname, 'database.db');
const db = new DatabaseSync(dbPath);

console.log('--- Updating Flight Dates & Scheduling to Current Timeline (Nov 2026+) ---');

// 1. Shift all existing 982 flights forward by 60 days
db.exec(`
  UPDATE flights
  SET dep_datetime = strftime('%Y-%m-%d %H:%M', dep_datetime, '+60 days'),
      arr_datetime = strftime('%Y-%m-%d %H:%M', arr_datetime, '+60 days');
`);

console.log('Shifted all flight dates forward by 60 days.');

// Check new range
const range = db.prepare('SELECT MIN(dep_datetime) as minDep, MAX(dep_datetime) as maxDep FROM flights').get();
console.log('New Dep Range:', range);

// 2. Ensure prominent Bangladesh domestic and international flights are active today (2026-11-18) and tomorrow (2026-11-19)
const keyUpcomingFlights = [
  // Today (2026-11-18) Evening Flights
  {
    id_airline: 839, // Biman Bangladesh Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 1853, // Cox's Bazar (CXB)
    dep_datetime: '2026-11-18 18:30',
    arr_datetime: '2026-11-18 19:35',
    economy_price: 4500,
    business_price: 8500,
    first_price: 13500,
    luggage_price: 350,
    weight_price: 120
  },
  {
    id_airline: 371, // US-Bangla Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 1626, // Chittagong (CGP)
    dep_datetime: '2026-11-18 19:15',
    arr_datetime: '2026-11-18 20:05',
    economy_price: 3800,
    business_price: 7200,
    first_price: 11000,
    luggage_price: 300,
    weight_price: 100
  },
  {
    id_airline: 839, // Biman Bangladesh Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 234, // Dubai (DXB)
    dep_datetime: '2026-11-18 21:00',
    arr_datetime: '2026-11-19 00:45',
    economy_price: 48500,
    business_price: 88000,
    first_price: 145000,
    luggage_price: 1500,
    weight_price: 350
  },
  // Tomorrow (2026-11-19) Morning & Afternoon Flights
  {
    id_airline: 839, // Biman Bangladesh Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 1853, // Cox's Bazar (CXB)
    dep_datetime: '2026-11-19 09:30',
    arr_datetime: '2026-11-19 10:35',
    economy_price: 4500,
    business_price: 8500,
    first_price: 13500,
    luggage_price: 350,
    weight_price: 120
  },
  {
    id_airline: 371, // US-Bangla Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 1626, // Chittagong (CGP)
    dep_datetime: '2026-11-19 08:00',
    arr_datetime: '2026-11-19 08:50',
    economy_price: 3800,
    business_price: 7200,
    first_price: 11000,
    luggage_price: 300,
    weight_price: 100
  },
  {
    id_airline: 1015, // Novoair
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 3762, // Sylhet (ZYL)
    dep_datetime: '2026-11-19 11:15',
    arr_datetime: '2026-11-19 12:05',
    economy_price: 3500,
    business_price: 6800,
    first_price: 10500,
    luggage_price: 300,
    weight_price: 100
  },
  {
    id_airline: 371, // US-Bangla Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 3760, // Saidpur (SPD)
    dep_datetime: '2026-11-19 14:00',
    arr_datetime: '2026-11-19 15:00',
    economy_price: 3400,
    business_price: 6200,
    first_price: 9500,
    luggage_price: 250,
    weight_price: 90
  },
  {
    id_airline: 839, // Biman Bangladesh Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 1478, // London Heathrow (LHR)
    dep_datetime: '2026-11-19 10:15',
    arr_datetime: '2026-11-19 16:30',
    economy_price: 82500,
    business_price: 165000,
    first_price: 245000,
    luggage_price: 2000,
    weight_price: 450
  },
  {
    id_airline: 1040, // Singapore Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 3108, // Singapore Changi (SIN)
    dep_datetime: '2026-11-19 23:55',
    arr_datetime: '2026-11-20 06:05',
    economy_price: 52000,
    business_price: 105000,
    first_price: 175000,
    luggage_price: 1500,
    weight_price: 350
  },
  // Day After Tomorrow (2026-11-20)
  {
    id_airline: 839, // Biman Bangladesh Airlines
    dep_airport: 1853, // Cox's Bazar (CXB)
    arr_airport: 185, // Dhaka (DAC)
    dep_datetime: '2026-11-20 16:30',
    arr_datetime: '2026-11-20 17:35',
    economy_price: 4500,
    business_price: 8500,
    first_price: 13500,
    luggage_price: 350,
    weight_price: 120
  },
  {
    id_airline: 371, // US-Bangla Airlines
    dep_airport: 1626, // Chittagong (CGP)
    arr_airport: 185, // Dhaka (DAC)
    dep_datetime: '2026-11-20 19:00',
    arr_datetime: '2026-11-20 19:50',
    economy_price: 3800,
    business_price: 7200,
    first_price: 11000,
    luggage_price: 300,
    weight_price: 100
  }
];

const insertFlight = db.prepare(`
  INSERT INTO flights (id_airline, dep_airport, arr_airport, dep_datetime, arr_datetime, economy_price, business_price, first_price, luggage_price, weight_price)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const kf of keyUpcomingFlights) {
  const existing = db.prepare(`
    SELECT id FROM flights
    WHERE id_airline = ? AND dep_airport = ? AND arr_airport = ? AND dep_datetime = ?
  `).get(kf.id_airline, kf.dep_airport, kf.arr_airport, kf.dep_datetime);

  if (!existing) {
    insertFlight.run(
      kf.id_airline, kf.dep_airport, kf.arr_airport, kf.dep_datetime, kf.arr_datetime,
      kf.economy_price, kf.business_price, kf.first_price, kf.luggage_price, kf.weight_price
    );
  }
}

const totalCount = db.prepare('SELECT COUNT(*) as c FROM flights').get();
const upcoming = db.prepare("SELECT COUNT(*) as c FROM flights WHERE dep_datetime >= '2026-11-18'").get();
console.log('Total flights:', totalCount.c);
console.log('Upcoming flights (>= 2026-11-18):', upcoming.c);

// Verify sample upcoming flights
const sample = db.prepare(`
  SELECT f.id, al.name as airline, da.city as depCity, aa.city as arrCity, f.dep_datetime, f.arr_datetime, f.economy_price
  FROM flights f
  JOIN airLines al ON f.id_airline = al.id
  JOIN airports da ON f.dep_airport = da.id
  JOIN airports aa ON f.arr_airport = aa.id
  WHERE f.dep_datetime >= '2026-11-18'
  ORDER BY f.dep_datetime ASC
  LIMIT 8
`).all();

console.log('Sample upcoming flights:');
console.table(sample);
