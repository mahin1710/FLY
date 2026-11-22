// Netlify Serverless Function for FLY Flight Booking API
// Author: mahin1710

const serverless = require('serverless-http');
const path = require('node:path');
const fs = require('node:fs');

// Prepare SQLite database in /tmp for write-capable serverless execution
const targetDb = path.join('/tmp', 'database.db');
if (!fs.existsSync(targetDb)) {
  const candidates = [
    path.join(__dirname, 'database.db'),
    path.join(__dirname, '..', '..', 'Skynet-master', 'Skynet-master', 'web', 'database.db'),
    path.join(process.cwd(), 'Skynet-master', 'Skynet-master', 'web', 'database.db'),
    path.join(process.cwd(), 'database.db')
  ];

  for (const src of candidates) {
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, targetDb);
        break;
      } catch (err) {
        console.warn('Notice copying database:', err.message);
      }
    }
  }
}

process.env.NETLIFY = 'true';

let app;
try {
  app = require('../../Skynet-master/Skynet-master/web/server');
} catch (e1) {
  try {
    app = require(path.join(process.cwd(), 'Skynet-master', 'Skynet-master', 'web', 'server'));
  } catch (e2) {
    app = require('./server');
  }
}

module.exports.handler = serverless(app);
