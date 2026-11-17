const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbPath = path.join(__dirname, 'database.db');
const db = new DatabaseSync(dbPath);

console.log('Updating flights to current timeline (2026)...');
db.exec(`
  UPDATE flights 
  SET dep_datetime = replace(dep_datetime, '2023-', '2026-'),
      arr_datetime = replace(arr_datetime, '2023-', '2026-');
`);

const count = db.prepare("SELECT count(*) as count FROM flights WHERE dep_datetime LIKE '2026-%'").get();
console.log('2026 flights count:', count);

const sample = db.prepare('SELECT id, dep_datetime, arr_datetime FROM flights LIMIT 3').all();
console.log('Sample:', sample);
