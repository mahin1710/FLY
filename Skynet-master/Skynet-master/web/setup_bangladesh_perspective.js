const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbPath = path.join(__dirname, 'database.db');
const db = new DatabaseSync(dbPath);

console.log('--- Setting up Bangladesh Perspective & Taka Prices ---');

// 1. Scale existing international flight prices so they reflect realistic Bangladeshi Taka amounts
// (e.g. $1,500 becomes approx ৳30,000 to ৳60,000)
const checkOldPrices = db.prepare('SELECT avg(economy_price) as avgP FROM flights WHERE economy_price < 5000').get();
if (checkOldPrices && checkOldPrices.avgP) {
  console.log('Scaling older prices into realistic Taka amounts...');
  db.exec(`
    UPDATE flights 
    SET economy_price = round(economy_price * 25),
        business_price = round(business_price * 25),
        first_price = round(first_price * 25),
        luggage_price = round(CASE WHEN luggage_price <= 50 THEN luggage_price * 15 ELSE luggage_price END),
        weight_price = round(CASE WHEN weight_price <= 20 THEN weight_price * 15 ELSE weight_price END)
    WHERE economy_price < 5000;
  `);
}

// 2. Add high-profile domestic & international Bangladesh flights for 2026
const bdFlights = [
  // Domestic Routes
  {
    id_airline: 839, // Biman Bangladesh Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 1853, // Cox's Bazar (CXB)
    dep_datetime: '2026-10-28 09:30',
    arr_datetime: '2026-10-28 10:35',
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
    dep_datetime: '2026-10-28 08:00',
    arr_datetime: '2026-10-28 08:50',
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
    dep_datetime: '2026-10-28 11:15',
    arr_datetime: '2026-10-28 12:05',
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
    dep_datetime: '2026-10-28 14:00',
    arr_datetime: '2026-10-28 15:00',
    economy_price: 3400,
    business_price: 6200,
    first_price: 9500,
    luggage_price: 250,
    weight_price: 90
  },
  {
    id_airline: 839, // Biman Bangladesh Airlines
    dep_airport: 1853, // Cox's Bazar (CXB)
    arr_airport: 185, // Dhaka (DAC)
    dep_datetime: '2026-10-29 16:30',
    arr_datetime: '2026-10-29 17:35',
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
    dep_datetime: '2026-10-29 19:00',
    arr_datetime: '2026-10-29 19:50',
    economy_price: 3800,
    business_price: 7200,
    first_price: 11000,
    luggage_price: 300,
    weight_price: 100
  },
  {
    id_airline: 1015, // Novoair
    dep_airport: 3762, // Sylhet (ZYL)
    arr_airport: 185, // Dhaka (DAC)
    dep_datetime: '2026-10-29 17:30',
    arr_datetime: '2026-10-29 18:20',
    economy_price: 3500,
    business_price: 6800,
    first_price: 10500,
    luggage_price: 300,
    weight_price: 100
  },
  {
    id_airline: 371, // US-Bangla Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 2885, // Jessore (JSR)
    dep_datetime: '2026-10-30 07:45',
    arr_datetime: '2026-10-30 08:30',
    economy_price: 3200,
    business_price: 5800,
    first_price: 8900,
    luggage_price: 250,
    weight_price: 80
  },
  {
    id_airline: 1015, // Novoair
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 3758, // Rajshahi (RJH)
    dep_datetime: '2026-10-30 10:00',
    arr_datetime: '2026-10-30 10:45',
    economy_price: 3300,
    business_price: 6000,
    first_price: 9000,
    luggage_price: 250,
    weight_price: 80
  },
  {
    id_airline: 371, // US-Bangla Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 1502, // Barisal (BZL)
    dep_datetime: '2026-10-30 12:30',
    arr_datetime: '2026-10-30 13:10',
    economy_price: 3100,
    business_price: 5500,
    first_price: 8500,
    luggage_price: 250,
    weight_price: 80
  },

  // International Routes Departing from Dhaka (DAC)
  {
    id_airline: 839, // Biman Bangladesh Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 234, // Dubai (DXB)
    dep_datetime: '2026-10-29 18:30',
    arr_datetime: '2026-10-29 22:15',
    economy_price: 48500,
    business_price: 88000,
    first_price: 145000,
    luggage_price: 1500,
    weight_price: 350
  },
  {
    id_airline: 839, // Biman Bangladesh Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 429, // London Heathrow (LHR)
    dep_datetime: '2026-10-29 10:15',
    arr_datetime: '2026-10-29 16:30',
    economy_price: 82500,
    business_price: 165000,
    first_price: 265000,
    luggage_price: 2500,
    weight_price: 500
  },
  {
    id_airline: 371, // US-Bangla Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 630, // Singapore (SIN)
    dep_datetime: '2026-10-30 23:45',
    arr_datetime: '2026-10-31 06:15',
    economy_price: 42000,
    business_price: 75000,
    first_price: 115000,
    luggage_price: 1200,
    weight_price: 300
  },
  {
    id_airline: 839, // Biman Bangladesh Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 404, // Kuala Lumpur (KUL)
    dep_datetime: '2026-10-30 00:30',
    arr_datetime: '2026-10-30 06:20',
    economy_price: 38000,
    business_price: 68000,
    first_price: 98000,
    luggage_price: 1200,
    weight_price: 300
  },
  {
    id_airline: 839, // Biman Bangladesh Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 368, // Jeddah (JED)
    dep_datetime: '2026-10-31 15:00',
    arr_datetime: '2026-10-31 19:30',
    economy_price: 65000,
    business_price: 110000,
    first_price: 175000,
    luggage_price: 2000,
    weight_price: 400
  },
  {
    id_airline: 839, // Biman Bangladesh Airlines
    dep_airport: 185, // Dhaka (DAC)
    arr_airport: 76, // Bangkok (BKK)
    dep_datetime: '2026-10-31 09:00',
    arr_datetime: '2026-10-31 12:30',
    economy_price: 32000,
    business_price: 58000,
    first_price: 88000,
    luggage_price: 1000,
    weight_price: 250
  },
  {
    id_airline: 839, // Biman Bangladesh Airlines
    dep_airport: 234, // Dubai (DXB)
    arr_airport: 185, // Dhaka (DAC)
    dep_datetime: '2026-11-02 23:45',
    arr_datetime: '2026-11-03 06:30',
    economy_price: 48500,
    business_price: 88000,
    first_price: 145000,
    luggage_price: 1500,
    weight_price: 350
  },
  {
    id_airline: 839, // Biman Bangladesh Airlines
    dep_airport: 429, // London Heathrow (LHR)
    arr_airport: 185, // Dhaka (DAC)
    dep_datetime: '2026-11-03 18:00',
    arr_datetime: '2026-11-04 10:30',
    economy_price: 82500,
    business_price: 165000,
    first_price: 265000,
    luggage_price: 2500,
    weight_price: 500
  }
];

const insStmt = db.prepare(`
  INSERT INTO flights (
    id_airline, dep_airport, arr_airport, 
    dep_datetime, arr_datetime, 
    first_price, business_price, economy_price, 
    luggage_price, weight_price
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let inserted = 0;
for (const f of bdFlights) {
  // Check if exists
  const existing = db.prepare(`
    SELECT id FROM flights 
    WHERE id_airline = ? AND dep_airport = ? AND arr_airport = ? AND dep_datetime = ?
  `).get(f.id_airline, f.dep_airport, f.arr_airport, f.dep_datetime);

  if (!existing) {
    insStmt.run(
      f.id_airline, f.dep_airport, f.arr_airport,
      f.dep_datetime, f.arr_datetime,
      f.first_price, f.business_price, f.economy_price,
      f.luggage_price, f.weight_price
    );
    inserted++;
  }
}

console.log(`Inserted ${inserted} new Bangladesh perspective flights.`);
const totalBdFlights = db.prepare(`
  SELECT count(*) as c 
  FROM flights f
  JOIN airports da ON f.dep_airport = da.id
  JOIN airports aa ON f.arr_airport = aa.id
  WHERE da.country = 'Bangladesh' OR aa.country = 'Bangladesh'
`).get().c;
console.log(`Total active flights connected to Bangladesh: ${totalBdFlights}`);
