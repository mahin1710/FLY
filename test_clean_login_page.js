/**
 * VERIFICATION SUITE: CLEAN LOGIN PAGE & CREDENTIAL SECURITY
 * Author: mahin1710
 */

const fs = require('fs');
const http = require('http');
const { DatabaseSync } = require('node:sqlite');

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (postData) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path,
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, data: parsed });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runCleanLoginVerification() {
  console.log('===============================================================');
  console.log('  FLY VERIFICATION: CLEAN LOGIN PAGE & CREDENTIAL PRIVACY      ');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  // 1. Inspect Frontend HTML
  console.log('1. Verifying Complete Removal of Demo Accounts from Frontend HTML...');
  const html = fs.readFileSync('Skynet-master/Skynet-master/web/public/index.html', 'utf8');

  assert(!html.includes('class="demo-accounts-section"'), 'No demo-accounts-section container in HTML');
  assert(!html.includes('demo-accounts-grid'), 'No demo-accounts-grid in HTML');
  assert(!html.includes('demo-acc-card'), 'No demo-acc-card elements in HTML');
  assert(!html.includes('Demo Accounts'), 'No "Demo Accounts" text anywhere in HTML');
  assert(!html.includes('demo-pill-btn'), 'Quick Demo pill button removed from navigation header');
  assert(!html.includes('Demo Mode Enabled'), '"Demo Mode Enabled" label removed from login form');
  assert(!html.includes('Demo Mode'), '"Demo Mode" label removed from modal');

  // Verify none of the demo usernames appear anywhere on the login page
  const pageAuthMatch = html.match(/<section[^>]*id="pageAuth"[\s\S]*?<\/section>/i);
  const pageAuthHtml = pageAuthMatch ? pageAuthMatch[0] : '';

  assert(!pageAuthHtml.includes('Mahin0'), 'Username "Mahin0" is NOT displayed on the login page');
  assert(!pageAuthHtml.includes('Mahin1'), 'Username "Mahin1" is NOT displayed on the login page');
  assert(!pageAuthHtml.includes('Admin_Biman'), 'Username "Admin_Biman" is NOT displayed on the login page');
  assert(!pageAuthHtml.includes('Admin_USB'), 'Username "Admin_USB" is NOT displayed on the login page');
  assert(!pageAuthHtml.includes('MMH_Mahin'), 'Display name "MMH_Mahin" is NOT displayed on the login page');

  // 2. Form Autocomplete and Security Attributes
  console.log('\n2. Verifying Autocomplete & Security Attributes...');
  assert(pageAuthHtml.includes('id="authPageLoginForm"') && pageAuthHtml.includes('autocomplete="off"'), 'Login form specifies autocomplete="off"');
  assert(pageAuthHtml.includes('id="authPageLoginUsername"') && pageAuthHtml.includes('autocomplete="off"'), 'Username input specifies autocomplete="off"');
  assert(pageAuthHtml.includes('id="authPageLoginPassword"') && pageAuthHtml.includes('autocomplete="new-password"'), 'Password input specifies autocomplete="new-password"');
  assert(pageAuthHtml.includes('placeholder="Enter your username or email"'), 'Username input has clean generic placeholder');
  assert(pageAuthHtml.includes('placeholder="Enter your password"'), 'Password input has clean generic placeholder');
  assert(pageAuthHtml.includes('app.togglePasswordVisibility(\'authPageLoginPassword\''), 'Show/Hide password toggle button is present');
  assert(pageAuthHtml.includes('Forgot Password?'), 'Subtle Forgot Password assistance link is present');

  // 3. Application Logic (app.js) Input Sanitization & Password Protection
  console.log('\n3. Verifying Frontend State Sanitization (app.js)...');
  const appJs = fs.readFileSync('Skynet-master/Skynet-master/web/public/js/app.js', 'utf8');

  assert(appJs.includes('clearAuthInputs()'), 'app.js defines dedicated clearAuthInputs() method');
  assert(appJs.includes('this.clearAuthInputs();'), 'clearAuthInputs() is called during state initialization & route transitions');
  assert(!appJs.includes('localStorage.setItem(\'fly_password\''), 'Password is NEVER saved to localStorage');
  assert(!appJs.includes('sessionStorage.setItem(\'fly_password\''), 'Password is NEVER saved to sessionStorage');
  assert(!appJs.includes('localStorage.setItem(\'password\''), 'No generic password in localStorage');
  assert(!appJs.includes('sessionStorage.setItem(\'password\''), 'No generic password in sessionStorage');

  // 4. Database Seeded Accounts Verification
  console.log('\n4. Verifying Existing Database Demo Accounts Remain Intact...');
  const db = new DatabaseSync('Skynet-master/Skynet-master/web/database.db');
  const accounts = db.prepare('SELECT id, username, password, role, display_name FROM accounts WHERE username IN (\'Mahin0\', \'Admin_Biman\', \'Admin_USB\', \'Mahin1\')').all();

  assert(accounts.length === 4, 'All 4 demo accounts safely preserved in database');
  const mahin0 = accounts.find(a => a.username === 'Mahin0');
  const adminBiman = accounts.find(a => a.username === 'Admin_Biman');
  const adminUsb = accounts.find(a => a.username === 'Admin_USB');
  const mahin1 = accounts.find(a => a.username === 'Mahin1');

  assert(Boolean(mahin0 && mahin0.password.startsWith('scrypt:')), 'Mahin0 preserved with scrypt hash in DB');
  assert(Boolean(adminBiman && adminBiman.password.startsWith('scrypt:')), 'Admin_Biman preserved with scrypt hash in DB');
  assert(Boolean(adminUsb && adminUsb.password.startsWith('scrypt:')), 'Admin_USB preserved with scrypt hash in DB');
  assert(Boolean(mahin1 && mahin1.password.startsWith('scrypt:')), 'Mahin1 preserved with scrypt hash in DB');

  // 5. Authentication Execution
  console.log('\n5. Verifying Authentication Works Securely via API...');
  const loginRes0 = await request('POST', '/api/auth/login', { username: 'Mahin0', password: 'Mahin0', rememberMe: true });
  assert(loginRes0.status === 200, 'Mahin0 successfully authenticates (HTTP 200)');
  assert(loginRes0.data.token && !loginRes0.data.user.password, 'Session token issued without exposing password in response');

  const loginResAdmin = await request('POST', '/api/auth/login', { username: 'Admin_Biman', password: 'Admin_Biman', rememberMe: true });
  assert(loginResAdmin.status === 200, 'Admin_Biman successfully authenticates (HTTP 200)');
  assert(loginResAdmin.data.user.role.toUpperCase() === 'AIRLINE_ADMIN', 'Admin_Biman role confirmed (AIRLINE_ADMIN)');

  // 6. Logout and Session Invalidation
  console.log('\n6. Verifying Logout Session Invalidation & State Cleanup...');
  const logoutRes = await request('POST', '/api/auth/logout', {}, { 'Authorization': `Bearer ${loginRes0.data.token}` });
  assert(logoutRes.status === 200, 'Logout successfully processed by server');

  const verifyDeadToken = await request('GET', '/api/auth/me', null, { 'Authorization': `Bearer ${loginRes0.data.token}` });
  assert(verifyDeadToken.data.authenticated === false, 'Dead session token strictly rejected on /api/auth/me');

  // 7. Route and Page Accessibility
  console.log('\n7. Verifying Dedicated Routes...');
  const loginPageRes = await request('GET', '/login');
  assert(loginPageRes.status === 200, 'GET /login serves application with HTTP 200');
  assert(!loginPageRes.data.includes('Mahin0'), 'Response body on /login does NOT contain "Mahin0"');

  console.log('\n===============================================================');
  console.log(`CLEAN LOGIN VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) process.exit(1);
}

runCleanLoginVerification().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
