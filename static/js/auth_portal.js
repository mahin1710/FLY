/* ==========================================================================
   FLY — Authentication, Registration & Profile Portal Controller
   ========================================================================== */
(function () {
  'use strict';

  const root = document.querySelector('[data-auth-mode]');
  if (!root) return;

  const initialMode = root.getAttribute('data-auth-mode') || 'login';
  const guestBox = document.getElementById('authGuestContainer');
  const profileBox = document.getElementById('profileContainer');
  const tabLoginBtn = document.getElementById('tabLoginBtn');
  const tabRegisterBtn = document.getElementById('tabRegisterBtn');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const authFeedback = document.getElementById('authFeedback');
  const profileFeedback = document.getElementById('profileFeedback');

  function showAlert(el, msg, isError) {
    if (!el) return;
    el.textContent = msg;
    el.className = 'fly-alert ' + (isError ? 'fly-alert-danger' : 'fly-alert-success');
    el.classList.remove('is-hidden');
  }

  function hideAlert(el) {
    if (el) el.classList.add('is-hidden');
  }

  function switchTab(mode) {
    hideAlert(authFeedback);
    const isReg = mode === 'register';
    loginForm.classList.toggle('is-hidden', isReg);
    registerForm.classList.toggle('is-hidden', !isReg);
    tabLoginBtn.className = 'fly-btn ' + (isReg ? 'fly-btn-outline' : 'fly-btn-primary');
    tabRegisterBtn.className = 'fly-btn ' + (isReg ? 'fly-btn-primary' : 'fly-btn-outline');
    tabLoginBtn.setAttribute('aria-selected', String(!isReg));
    tabRegisterBtn.setAttribute('aria-selected', String(isReg));
  }

  function safeNextUrl(user) {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    if (next && next.startsWith('/') && !next.startsWith('//')) {
      return next;
    }
    const role = String((user && user.role) || '').toUpperCase();
    if (role === 'AIRLINE_ADMIN' || role === 'SYSTEM_ADMIN' || role === 'SUPER_ADMIN') {
      return '/admin';
    }
    return '/my-bookings';
  }

  if (tabLoginBtn) tabLoginBtn.addEventListener('click', function () { switchTab('login'); });
  if (tabRegisterBtn) tabRegisterBtn.addEventListener('click', function () { switchTab('register'); });

  if (loginForm) {
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      hideAlert(authFeedback);
      const username = document.getElementById('loginUsername').value.trim();
      const password = document.getElementById('loginPassword').value;
      if (!username || !password) {
        showAlert(authFeedback, 'Please enter both username and password.', true);
        return;
      }
      const btn = document.getElementById('loginSubmitBtn');
      btn.disabled = true;
      btn.textContent = 'Signing in...';
      try {
        const res = await window.FlyApi.post('/api/auth/login', { username: username, password: password });
        window.FlyApi.setSession(res.token, res.user);
        window.location.href = safeNextUrl(res.user);
      } catch (err) {
        showAlert(authFeedback, err.message || 'Sign in failed.', true);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      hideAlert(authFeedback);
      const payload = {
        firstName: document.getElementById('regFirstName').value.trim(),
        lastName: document.getElementById('regLastName').value.trim(),
        username: document.getElementById('regUsername').value.trim(),
        email: document.getElementById('regEmail').value.trim(),
        location: document.getElementById('regLocation').value.trim(),
        password: document.getElementById('regPassword').value,
      };
      const confirmPw = document.getElementById('regPasswordConfirm').value;
      if (!payload.username || !payload.email || !payload.password) {
        showAlert(authFeedback, 'Please fill in all required fields.', true);
        return;
      }
      if (payload.password !== confirmPw) {
        showAlert(authFeedback, 'Passwords do not match.', true);
        return;
      }
      const btn = document.getElementById('registerSubmitBtn');
      btn.disabled = true;
      btn.textContent = 'Creating account...';
      try {
        const res = await window.FlyApi.post('/api/auth/register', payload);
        window.FlyApi.setSession(res.token, res.user);
        window.location.href = safeNextUrl(res.user);
      } catch (err) {
        showAlert(authFeedback, err.message || 'Registration failed.', true);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Create Passenger Account';
      }
    });
  }

  async function loadProfileView() {
    try {
      const data = await window.FlyApi.get('/api/auth/profile');
      const u = data.user || {};
      window.FlyApi.setSession(window.FlyApi.getToken(), u);
      document.getElementById('profFirstName').value = u.firstName || '';
      document.getElementById('profLastName').value = u.lastName || '';
      document.getElementById('profDisplayName').value = u.displayName || '';
      document.getElementById('profEmail').value = u.email || '';
      document.getElementById('profLocation').value = u.location || '';
      document.getElementById('profileRoleBadge').textContent = u.role || 'PASSENGER';
      await loadTravelers();
    } catch (err) {
      window.location.href = '/login?next=' + encodeURIComponent('/profile');
    }
  }

  async function loadTravelers() {
    const listEl = document.getElementById('savedTravelersList');
    if (!listEl) return;
    try {
      const items = await window.FlyApi.get('/api/travelers');
      const list = Array.isArray(items) ? items : (items.travelers || []);
      if (!list.length) {
        listEl.innerHTML = '<p style="margin:0;color:var(--text-muted);font-size:0.875rem;">No saved travelers yet.</p>';
        return;
      }
      listEl.innerHTML = list.map(function (t) {
        const name = [t.first_name || t.firstName, t.last_name || t.lastName].filter(Boolean).join(' ') || t.fullName || 'Traveler';
        const doc = t.document_number_masked || t.passportNumber || 'No document';
        return (
          '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border:1px solid var(--border-subtle);border-radius:8px;">' +
            '<div>' +
              '<strong>' + window.FlyApi.escapeHtml(name) + '</strong>' +
              '<div style="font-size:0.8rem;color:var(--text-muted);">' +
                window.FlyApi.escapeHtml([t.nationality || '', doc].filter(Boolean).join(' • ')) +
              '</div>' +
            '</div>' +
            '<button type="button" class="fly-btn fly-btn-outline" data-del-traveler="' + t.id + '" style="padding:4px 10px;font-size:0.8rem;">Remove</button>' +
          '</div>'
        );
      }).join('');
      listEl.querySelectorAll('[data-del-traveler]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          try {
            await window.FlyApi.del('/api/travelers/' + btn.getAttribute('data-del-traveler'));
            loadTravelers();
          } catch (e) {
            showAlert(profileFeedback, e.message, true);
          }
        });
      });
    } catch (_) {}
  }

  const profileForm = document.getElementById('profileForm');
  if (profileForm) {
    profileForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      hideAlert(profileFeedback);
      const body = {
        firstName: document.getElementById('profFirstName').value.trim(),
        lastName: document.getElementById('profLastName').value.trim(),
        displayName: document.getElementById('profDisplayName').value.trim(),
        email: document.getElementById('profEmail').value.trim(),
        location: document.getElementById('profLocation').value.trim(),
      };
      const curPw = document.getElementById('profCurrentPassword').value;
      const newPw = document.getElementById('profNewPassword').value;
      if (newPw) {
        body.currentPassword = curPw;
        body.newPassword = newPw;
      }
      try {
        const res = await window.FlyApi.put('/api/auth/profile', body);
        window.FlyApi.setSession(window.FlyApi.getToken(), res.user);
        document.getElementById('profCurrentPassword').value = '';
        document.getElementById('profNewPassword').value = '';
        showAlert(profileFeedback, 'Profile updated successfully.', false);
      } catch (err) {
        showAlert(profileFeedback, err.message || 'Could not update profile.', true);
      }
    });
  }

  const addTravelerForm = document.getElementById('addTravelerForm');
  if (addTravelerForm) {
    addTravelerForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      try {
        await window.FlyApi.post('/api/travelers', {
          firstName: document.getElementById('travFirstName').value.trim(),
          lastName: document.getElementById('travLastName').value.trim(),
          documentNumber: document.getElementById('travPassport').value.trim(),
          idType: document.getElementById('travDocType').value,
          nationality: document.getElementById('travNationality').value.trim(),
          dob: document.getElementById('travDob').value,
        });
        addTravelerForm.reset();
        loadTravelers();
        showAlert(profileFeedback, 'Traveler saved.', false);
      } catch (err) {
        showAlert(profileFeedback, err.message || 'Failed to save traveler.', true);
      }
    });
  }

  const profileLogoutBtn = document.getElementById('profileLogoutBtn');
  if (profileLogoutBtn) {
    profileLogoutBtn.addEventListener('click', async function () {
      try { await window.FlyApi.post('/api/auth/logout', {}); } catch (_) {}
      window.FlyApi.clearSession();
      window.location.href = '/';
    });
  }

  if (initialMode === 'profile') {
    guestBox.classList.add('is-hidden');
    profileBox.classList.remove('is-hidden');
    loadProfileView();
  } else {
    switchTab(initialMode === 'register' ? 'register' : 'login');
  }
})();
