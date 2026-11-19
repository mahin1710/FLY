/**
 * FLY FLIGHT BOOKING SYSTEM — WEB APP APPLICATION LOGIC
 * Author: mahin1710
 */

const app = {
  // Application State
  state: {
    user: null,
    theme: 'light',
    currentPage: 'home',
    currentTripType: 'oneway',
    selectedFlight: null,
    selectedSeat: null,
    selectedSeats: [],
    activeBooking: null,
    paymentCountdownInterval: null,
    seatPollInterval: null,
    adminBookingStatusFilter: 'all',
    adminBookingSearchKeyword: '',
    luggageCount: 0,
    luggageWeight: 0,
    calculatedTotal: 0,
    searchParams: {
      page: 1,
      limit: 10,
      depCountry: '',
      arrCountry: '',
      depCity: '',
      arrCity: '',
      depDateAfter: '',
      depDateBefore: '',
      sortBy: 'closestDate',
      search: ''
    },
    airportsCache: [],
    countriesCache: [],
    airlineAirportsCache: []
  },

  // -------------------------------------------------------------
  formatCurrency(val) {
    if (val === null || val === undefined || isNaN(val)) return '৳0';
    return `৳${Math.round(Number(val)).toLocaleString('en-IN')}`;
  },

  calculateDuration(depStr, arrStr) {
    if (!depStr || !arrStr) return 'Direct Flight';
    try {
      const dep = new Date(depStr.replace(' ', 'T'));
      const arr = new Date(arrStr.replace(' ', 'T'));
      const diffMs = arr.getTime() - dep.getTime();
      if (isNaN(diffMs) || diffMs <= 0) return 'Direct Flight';
      const totalMins = Math.floor(diffMs / 60000);
      const hrs = Math.floor(totalMins / 60);
      const mins = totalMins % 60;
      if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
      if (hrs > 0) return `${hrs}h`;
      return `${mins}m`;
    } catch (e) {
      return 'Direct Flight';
    }
  },

  // -------------------------------------------------------------
  // INITIALIZATION
  // -------------------------------------------------------------
  async init() {
    this.clearAuthInputs();
    this.initTheme();
    this.initAuthFromStorage();
    await this.loadCountries();
    await this.loadAirports();
    this.setupAutocomplete();
    this.renderHeaderAuth();
    this.initHashRouting();
    const initialPage = this.getPageFromHash() || 'home';
    this.navigate(initialPage, false);

    // Pre-populate Bangladesh Dhaka as default departure if empty
    const homeOrig = document.getElementById('homeOriginInput');
    if (homeOrig && !homeOrig.value) {
      homeOrig.value = 'Dhaka (DAC)';
      homeOrig.dataset.city = 'Dhaka';
      homeOrig.dataset.code = 'DAC';
      homeOrig.dataset.country = 'Bangladesh';
      homeOrig.dataset.airportId = '185';
      homeOrig.dataset.id = '185';
    }

    // Set date pickers min constraint to today
    const todayStr = new Date().toISOString().split('T')[0];
    ['homeDepDate', 'homeReturnDate', 'filterDateAfter', 'filterDateBefore'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.min = todayStr;
    });

    const homeDepEl = document.getElementById('homeDepDate');
    const homeRetEl = document.getElementById('homeReturnDate');
    if (homeDepEl && homeRetEl) {
      homeDepEl.addEventListener('change', () => {
        if (homeDepEl.value) {
          homeRetEl.min = homeDepEl.value;
          if (homeRetEl.value && homeRetEl.value < homeDepEl.value) {
            homeRetEl.value = homeDepEl.value;
          }
        }
      });
    }

    this.loadFeaturedFlights();
    this.checkActiveTrips();
    this.checkPendingBookingOnLoad();

    // Close user dropdown menu when clicking anywhere outside
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('userDropdownMenu');
      const pill = document.querySelector('.user-profile-pill');
      if (menu && menu.classList.contains('show')) {
        if (!menu.contains(e.target) && (!pill || !pill.contains(e.target))) {
          menu.classList.remove('show');
        }
      }
    });
  },

  // -------------------------------------------------------------
  // THEME MANAGEMENT
  // -------------------------------------------------------------
  initTheme() {
    const saved = localStorage.getItem('fly_theme') || 'light';
    this.setTheme(saved);
  },

  setTheme(theme) {
    this.state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('fly_theme', theme);
  },

  toggleTheme() {
    const nextTheme = this.state.theme === 'dark' ? 'light' : 'dark';
    this.setTheme(nextTheme);
    this.showToast(`Switched to ${nextTheme} theme`, 'info');
  },

  // -------------------------------------------------------------
  // AUTHENTICATION, TOKENS & SESSION MANAGEMENT
  // -------------------------------------------------------------
  initAuthFromStorage() {
    try {
      const savedUser = localStorage.getItem('fly_user') || sessionStorage.getItem('fly_user');
      const savedToken = localStorage.getItem('fly_token') || sessionStorage.getItem('fly_token');
      if (savedUser && savedToken) {
        this.state.user = JSON.parse(savedUser);
        this.state.token = savedToken;

        // Background session verification
        fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${savedToken}` } })
          .then(res => res.json())
          .then(data => {
            if (!data.authenticated) {
              this.setUser(null, null);
              if (['dashboard', 'bookings', 'favorites', 'account'].includes(this.state.currentPage)) {
                this.navigate('auth');
              }
            } else if (data.user) {
              this.setUser(data.user, savedToken, Boolean(localStorage.getItem('fly_token')));
            }
          })
          .catch(() => { });
      } else {
        this.state.user = null;
        this.state.token = null;
      }
    } catch (e) {
      this.state.user = null;
      this.state.token = null;
    }
  },

  setUser(user, token = null, rememberMe = true) {
    this.state.user = user;
    if (token) this.state.token = token;

    if (user && this.state.token) {
      if (rememberMe) {
        localStorage.setItem('fly_user', JSON.stringify(user));
        localStorage.setItem('fly_token', this.state.token);
        sessionStorage.removeItem('fly_user');
        sessionStorage.removeItem('fly_token');
      } else {
        sessionStorage.setItem('fly_user', JSON.stringify(user));
        sessionStorage.setItem('fly_token', this.state.token);
        localStorage.removeItem('fly_user');
        localStorage.removeItem('fly_token');
      }
    } else {
      localStorage.removeItem('fly_user');
      localStorage.removeItem('fly_token');
      sessionStorage.removeItem('fly_user');
      sessionStorage.removeItem('fly_token');
      this.state.token = null;
      this.clearAuthInputs();
    }

    this.renderHeaderAuth();
    this.updateRoleNavigation();
    this.checkActiveTrips();
  },

  getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.state.token) {
      headers['Authorization'] = `Bearer ${this.state.token}`;
      headers['x-session-token'] = this.state.token;
    }
    return headers;
  },

  initHashRouting() {
    window.addEventListener('hashchange', () => {
      const page = this.getPageFromHash();
      if (page && page !== this.state.currentPage) {
        this.navigate(page, false);
      }
    });

    // Guard against back-button browser cache after logout
    window.addEventListener('popstate', () => {
      const page = this.getPageFromHash() || 'home';
      const protectedPages = ['dashboard', 'bookings', 'favorites', 'account'];
      if (protectedPages.includes(page) && !this.state.user) {
        history.replaceState(null, '', '/login');
        window.location.hash = 'login';
        this.navigate('auth', false);
      } else {
        this.navigate(page, false);
      }
    });
  },

  getPageFromHash() {
    const hash = window.location.hash.replace('#', '').replace('/', '').toLowerCase();
    const path = window.location.pathname.replace('/', '').toLowerCase();

    if (hash === 'login' || hash === 'register' || hash === 'auth' || path === 'login') {
      return 'auth';
    }
    if (hash === 'logout' || path === 'logout') {
      return 'logout';
    }
    const validPages = ['home', 'search', 'seatmap', 'bookings', 'favorites', 'dashboard', 'account', 'auth'];
    return validPages.includes(hash) ? hash : null;
  },

  renderHeaderAuth() {
    const authArea = document.getElementById('authArea');
    const u = this.state.user;

    // Synchronize navbar Log In / Log Out button
    const navAuthLabel = document.getElementById('navAuthLabel');
    const navAuthIcon = document.getElementById('navAuthIcon');
    const navAuthBtn = document.getElementById('navAuthBtn');

    if (u) {
      if (navAuthLabel) navAuthLabel.textContent = 'Log Out';
      if (navAuthIcon) navAuthIcon.innerHTML = '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>';
      if (navAuthBtn) {
        navAuthBtn.title = 'Session Details & Log Out';
        navAuthBtn.onclick = () => app.promptLogout();
      }
    } else {
      if (navAuthLabel) navAuthLabel.textContent = 'Sign In';
      if (navAuthIcon) navAuthIcon.innerHTML = '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/>';
      if (navAuthBtn) {
        navAuthBtn.title = 'Sign In or Register';
        navAuthBtn.onclick = () => app.navigate('auth');
      }
    }

    if (!u) {
      authArea.innerHTML = `
        <button class="btn-primary" onclick="app.navigate('auth')" title="Open Dedicated Login Page">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></svg>
          <span>Sign In</span>
        </button>
      `;
      return;
    }

    const roleUpper = (u.role || '').toUpperCase();
    const isAirline = roleUpper === 'AIRLINE_ADMIN' || roleUpper === 'AIRLINE';
    const displayName = u.displayName || (isAirline ? (u.airline?.name || u.username) : ((u.passenger?.firstName ? `${u.passenger.firstName} ${u.passenger.lastName}` : u.username)));
    const roleBadge = isAirline ? 'Airline Admin' : 'Passenger';
    const avatarSrc = isAirline ? `/images/default_logo.png` : (u.id_passenger ? `/api/passengers/${u.id_passenger}/picture` : `/images/ProfilePicture.png`);

    authArea.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <div class="user-menu-wrapper">
          <div class="user-profile-pill" onclick="app.toggleUserMenu(event)" title="Account Menu">
            <img src="${avatarSrc}" class="user-avatar-mini" alt="${displayName}">
            <div class="user-pill-info">
              <span class="user-pill-name">${displayName}</span>
              <span class="user-pill-role">${roleBadge}</span>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; margin-left: 2px;"><path d="m6 9 6 6 6-6"/></svg>
          </div>

          <div class="user-dropdown-menu" id="userDropdownMenu">
            ${isAirline ? `
              <button class="dropdown-item" onclick="app.navigate('dashboard'); app.closeUserMenu();">
                <span>🏢 Airline Dashboard</span>
              </button>
            ` : `
              <button class="dropdown-item" onclick="app.navigate('bookings'); app.closeUserMenu();">
                <span>🎟️ My Booked Trips</span>
              </button>
              <button class="dropdown-item" onclick="app.navigate('favorites'); app.closeUserMenu();">
                <span>❤️ Saved Favorites</span>
              </button>
              <button class="dropdown-item" onclick="app.navigate('account'); app.closeUserMenu();">
                <span>👤 Passport & Profile</span>
              </button>
            `}
            <button class="dropdown-item" onclick="app.navigate('auth'); app.closeUserMenu();">
              <span>🛡️ Session & Security</span>
            </button>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item danger" onclick="app.promptLogout(); app.closeUserMenu();">
              <span>🚪 Log Out</span>
            </button>
          </div>
        </div>

        <button class="btn-header-logout" onclick="app.promptLogout()" title="Log Out of ${displayName}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
          <span>Logout</span>
        </button>
      </div>
    `;
  },

  toggleUserMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('userDropdownMenu');
    if (menu) menu.classList.toggle('show');
  },

  closeUserMenu() {
    const menu = document.getElementById('userDropdownMenu');
    if (menu) menu.classList.remove('show');
  },

  updateRoleNavigation() {
    const u = this.state.user;
    const roleUpper = (u?.role || '').toUpperCase();
    const isAirline = roleUpper === 'AIRLINE_ADMIN' || roleUpper === 'AIRLINE';
    const dashBtn = document.getElementById('navDashboardBtn');
    const bookingsBtn = document.getElementById('navBookingsBtn');
    const favoritesBtn = document.getElementById('navFavoritesBtn');

    if (dashBtn) dashBtn.style.display = isAirline ? 'flex' : 'none';
    if (bookingsBtn) bookingsBtn.style.display = isAirline ? 'none' : 'flex';
    if (favoritesBtn) favoritesBtn.style.display = isAirline ? 'none' : 'flex';

    this.renderHeaderAuth();

    if (isAirline && (this.state.currentPage === 'bookings' || this.state.currentPage === 'favorites')) {
      this.navigate('dashboard');
    }
  },

  // -------------------------------------------------------------
  // SECURE AUTH INPUT STATE SANITIZATION
  // -------------------------------------------------------------
  clearAuthInputs() {
    const ids = [
      'authPageLoginUsername',
      'authPageLoginPassword',
      'authPageRegFirstName',
      'authPageRegLastName',
      'authPageRegEmail',
      'authPageRegUsername',
      'authPageRegPassword',
      'loginUsername',
      'loginPassword',
      'regFirstName',
      'regLastName',
      'regEmail',
      'regUsername',
      'regPassword'
    ];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.value = '';
        el.defaultValue = '';
      }
    });
  },

  openAuthModal(tab = 'login') {
    this.clearAuthInputs();
    this.switchAuthTab(tab);

    // Reset error alerts
    const errAlert = document.getElementById('authErrorAlert');
    if (errAlert) errAlert.style.display = 'none';

    // Show currently signed in status banner if a user session is active
    const statusBanner = document.getElementById('currentAuthStatusBanner');
    const u = this.state.user;
    if (statusBanner) {
      if (u) {
        statusBanner.style.display = 'flex';
        const userDisplay = document.getElementById('statusUsernameDisplay');
        const roleDisplay = document.getElementById('statusRoleDisplay');
        if (userDisplay) userDisplay.textContent = u.username;
        if (roleDisplay) roleDisplay.textContent = u.role === 'airline' ? '(Airline Manager)' : '(Passenger)';
      } else {
        statusBanner.style.display = 'none';
      }
    }

    document.getElementById('modalAuth').style.display = 'flex';
  },

  switchAuthTab(tab) {
    this.clearAuthInputs();
    const isLogin = tab === 'login';
    document.getElementById('tabAuthLogin').classList.toggle('active', isLogin);
    document.getElementById('tabAuthRegister').classList.toggle('active', !isLogin);
    document.getElementById('formLogin').style.display = isLogin ? 'block' : 'none';
    document.getElementById('formRegister').style.display = isLogin ? 'none' : 'block';

    const errAlert = document.getElementById('authErrorAlert');
    if (errAlert) errAlert.style.display = 'none';
  },

  // -------------------------------------------------------------
  // PASSWORD VISIBILITY & DEMO ACCOUNT HELPERS
  // -------------------------------------------------------------
  togglePasswordVisibility(inputId, btnEl) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';

    if (btnEl) {
      btnEl.innerHTML = isPassword
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px;"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px;"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
      btnEl.title = isPassword ? 'Hide Password' : 'Show Password';
    }
  },

  fillDemoAccount(username, password, role = 'passenger') {
    // Fill dedicated login page inputs
    const pageU = document.getElementById('authPageLoginUsername');
    const pageP = document.getElementById('authPageLoginPassword');
    if (pageU) pageU.value = username;
    if (pageP) pageP.value = password;

    // Fill modal inputs
    const modalU = document.getElementById('loginUsername');
    const modalP = document.getElementById('loginPassword');
    if (modalU) modalU.value = username;
    if (modalP) modalP.value = password;

    // Clear error banners
    const errAlert = document.getElementById('authPageErrorAlert');
    if (errAlert) errAlert.style.display = 'none';
    const modalErr = document.getElementById('authErrorAlert');
    if (modalErr) modalErr.style.display = 'none';

    this.showToast(`Selected demo account: ${username} (${role.toUpperCase()}). Review credentials and click Sign In.`, 'info');
  },

  async instantLogin(username, password) {
    this.fillDemoAccount(username, password);
    if (this.state.currentPage === 'auth') {
      await this.submitPageLogin(new Event('submit'));
    } else {
      await this.submitLogin(new Event('submit'));
    }
  },

  openDemoAccountsModal() {
    this.openAuthModal('login');
  },

  // -------------------------------------------------------------
  // DEDICATED LOGOUT SYSTEM (WITH CONFIRMATION & SESSION CLEANUP)
  // -------------------------------------------------------------
  promptLogout() {
    this.closeUserMenu();
    this.closeModal('modalAuth');
    const modal = document.getElementById('modalLogoutConfirm');
    if (modal) {
      modal.style.display = 'flex';
    } else {
      if (confirm('Are you sure you want to log out of your FLY session?')) {
        this.executeLogout();
      }
    }
  },

  async executeLogout() {
    this.closeModal('modalLogoutConfirm');
    this.closeUserMenu();

    try {
      // Invalidate session on server-side
      if (this.state.token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: this.getAuthHeaders()
        });
      }
    } catch (e) {
      console.warn('Server logout notification error:', e.message);
    }

    // Completely clear user authentication state & local/session storage
    this.setUser(null, null);
    this.state.selectedFlight = null;
    this.state.selectedSeat = null;
    this.state.selectedSeats = [];
    this.state.userBookings = [];
    this.state.userCards = [];
    this.state.activeBooking = null;

    // Clear DOM caches & badges
    const badge = document.getElementById('bookingsCountBadge');
    if (badge) {
      badge.textContent = '0';
      badge.style.display = 'none';
    }
    const tripBanner = document.getElementById('activeTripBanner');
    if (tripBanner) tripBanner.style.display = 'none';

    // Strict Privacy: Clear all private DOM containers so no previous account data is visible
    const bookingsList = document.getElementById('bookingsList');
    if (bookingsList) bookingsList.innerHTML = '';
    const pendingHoldsList = document.getElementById('pendingHoldsList');
    if (pendingHoldsList) pendingHoldsList.innerHTML = '';
    const confirmedTicketsList = document.getElementById('confirmedTicketsList');
    if (confirmedTicketsList) confirmedTicketsList.innerHTML = '';
    const favoritesGrid = document.getElementById('favoritesGrid');
    if (favoritesGrid) favoritesGrid.innerHTML = '';
    const adminTable = document.getElementById('adminBookingsTableBody');
    if (adminTable) adminTable.innerHTML = '';
    ['profileFirstName', 'profileLastName', 'profileEmail', 'profileUsername', 'profileCountry', 'profileGender', 'profileBirthDate'].forEach(fid => {
      const fEl = document.getElementById(fid);
      if (fEl) fEl.value = '';
    });

    // Clear and sanitize all login & register input forms
    this.clearAuthInputs();

    sessionStorage.removeItem('fly_active_booking');
    sessionStorage.removeItem('skynet_active_booking');

    // Replace browser history so back button cannot re-enter private page
    history.replaceState(null, '', '/login');
    window.location.hash = 'login';
    this.navigate('auth', false);

    this.showToast('Logged out successfully. Please sign in again to continue.', 'info');
  },

  // Legacy logout alias mapping to promptLogout
  logout() {
    this.promptLogout();
  },

  logoutFromAuthPage() {
    this.promptLogout();
  },

  switchAccountFromAuthPage() {
    this.promptLogout();
  },

  // -------------------------------------------------------------
  // LOGIN SUBMISSION & ROLE-BASED REDIRECTION
  // -------------------------------------------------------------
  async submitLogin(e) {
    if (e && e.preventDefault) e.preventDefault();
    const u = document.getElementById('loginUsername').value.trim();
    const p = document.getElementById('loginPassword').value;
    const rememberMe = document.getElementById('modalRememberMe')?.checked ?? true;

    const errAlert = document.getElementById('authErrorAlert');
    const errText = document.getElementById('authErrorText');
    if (errAlert) errAlert.style.display = 'none';

    if (!u || !p) {
      const msg = 'Please enter both username/email and password.';
      if (errAlert && errText) {
        errText.textContent = msg;
        errAlert.style.display = 'flex';
      }
      this.showToast(msg, 'error');
      return;
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p, rememberMe })
      });
      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data.error || 'Login failed. Please check your credentials.';
        if (errAlert && errText) {
          errText.textContent = errorMsg;
          errAlert.style.display = 'flex';
        }
        this.showToast(errorMsg, 'error');
        return;
      }

      this.setUser(data.user, data.token, rememberMe);
      this.clearAuthInputs();
      this.closeModal('modalAuth');
      this.showToast(`Welcome back, ${data.user.displayName || data.user.username}!`, 'success');

      if (this.state.pendingPayment) {
        this.state.pendingPayment = false;
        this.proceedToPayment();
        return;
      }

      // Role-Based Redirection
      const roleUpper = (data.user.role || '').toUpperCase();
      if (roleUpper === 'AIRLINE_ADMIN' || roleUpper === 'AIRLINE') {
        this.navigate('dashboard');
      } else {
        this.navigate('bookings');
        this.refreshBookingsBadge();
      }
    } catch (err) {
      if (errAlert && errText) {
        errText.textContent = 'Could not connect to FLY server.';
        errAlert.style.display = 'flex';
      }
      this.showToast('Failed to connect to server', 'error');
    }
  },

  async submitPageLogin(e) {
    if (e && e.preventDefault) e.preventDefault();
    const u = document.getElementById('authPageLoginUsername').value.trim();
    const p = document.getElementById('authPageLoginPassword').value;
    const rememberMe = document.getElementById('authPageRememberMe')?.checked ?? true;

    const errAlert = document.getElementById('authPageErrorAlert');
    const errText = document.getElementById('authPageErrorText');
    if (errAlert) errAlert.style.display = 'none';

    if (!u || !p) {
      const msg = 'Please enter both username/email and password.';
      if (errAlert && errText) {
        errText.textContent = msg;
        errAlert.style.display = 'flex';
      }
      this.showToast(msg, 'error');
      return;
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p, rememberMe })
      });
      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data.error || 'Login failed. Please check your credentials.';
        if (errAlert && errText) {
          errText.textContent = errorMsg;
          errAlert.style.display = 'flex';
        }
        this.showToast(errorMsg, 'error');
        return;
      }

      this.setUser(data.user, data.token, rememberMe);
      this.clearAuthInputs();
      this.showToast(`Welcome back, ${data.user.displayName || data.user.username}!`, 'success');

      // Role-Based Redirection
      const roleUpper = (data.user.role || '').toUpperCase();
      if (roleUpper === 'AIRLINE_ADMIN' || roleUpper === 'AIRLINE') {
        this.navigate('dashboard');
      } else {
        this.navigate('bookings');
        this.refreshBookingsBadge();
      }
    } catch (err) {
      if (errAlert && errText) {
        errText.textContent = 'Could not connect to FLY server.';
        errAlert.style.display = 'flex';
      }
      this.showToast('Failed to connect to server', 'error');
    }
  },

  async submitRegister(e) {
    e.preventDefault();
    const payload = {
      firstName: document.getElementById('regFirstName').value.trim(),
      lastName: document.getElementById('regLastName').value.trim(),
      emailAddress: document.getElementById('regEmail').value.trim(),
      username: document.getElementById('regUsername').value.trim(),
      password: document.getElementById('regPassword').value,
      birthDate: document.getElementById('regBirthDate').value,
      gender: document.getElementById('regGender').value,
      country: 'Bangladesh'
    };

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        this.showToast(data.error || 'Registration failed', 'error');
        return;
      }

      this.setUser(data.user, data.token, true);
      this.clearAuthInputs();
      this.closeModal('modalAuth');
      this.showToast('Account created successfully! Welcome aboard.', 'success');

      if (this.state.pendingPayment) {
        this.state.pendingPayment = false;
        this.proceedToPayment();
        return;
      }
      this.navigate('bookings');
    } catch (err) {
      this.showToast('Registration error', 'error');
    }
  },

  async submitPageRegister(e) {
    if (e && e.preventDefault) e.preventDefault();
    const payload = {
      firstName: document.getElementById('authPageRegFirstName').value.trim(),
      lastName: document.getElementById('authPageRegLastName').value.trim(),
      emailAddress: document.getElementById('authPageRegEmail').value.trim(),
      username: document.getElementById('authPageRegUsername').value.trim(),
      password: document.getElementById('authPageRegPassword').value,
      birthDate: document.getElementById('authPageRegBirthDate').value,
      gender: document.getElementById('authPageRegGender').value,
      country: 'Bangladesh'
    };

    const errAlert = document.getElementById('authPageErrorAlert');
    const errText = document.getElementById('authPageErrorText');
    if (errAlert) errAlert.style.display = 'none';

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || 'Registration failed';
        if (errAlert && errText) {
          errText.textContent = msg;
          errAlert.style.display = 'flex';
        }
        this.showToast(msg, 'error');
        return;
      }

      this.setUser(data.user, data.token, true);
      this.clearAuthInputs();
      this.showToast('Account created successfully! Welcome aboard.', 'success');
      this.navigate('bookings');
    } catch (err) {
      if (errAlert && errText) {
        errText.textContent = 'Registration error. Please check server.';
        errAlert.style.display = 'flex';
      }
      this.showToast('Registration error', 'error');
    }
  },

  // -------------------------------------------------------------
  // DEDICATED AUTHENTICATION (LOG IN & LOG OUT) PAGE VIEW
  // -------------------------------------------------------------
  renderAuthPageView() {
    const u = this.state.user;
    const notLoggedInCard = document.getElementById('authPageNotLoggedIn');
    const loggedInCard = document.getElementById('authPageLoggedIn');

    if (!notLoggedInCard || !loggedInCard) return;

    if (u) {
      notLoggedInCard.style.display = 'none';
      loggedInCard.style.display = 'block';

      const roleUpper = (u.role || '').toUpperCase();
      const isAirline = roleUpper === 'AIRLINE_ADMIN' || roleUpper === 'AIRLINE';
      const displayName = u.displayName || (isAirline ? (u.airline?.name || u.username) : ((u.passenger?.firstName ? `${u.passenger.firstName} ${u.passenger.lastName}` : u.username)));
      const roleBadge = isAirline ? 'Airline Admin' : 'Passenger';
      const avatarSrc = isAirline ? `/images/default_logo.png` : (u.id_passenger ? `/api/passengers/${u.id_passenger}/picture` : `/images/ProfilePicture.png`);

      const dispEl = document.getElementById('authPageDisplayName');
      const fullEl = document.getElementById('authPageFullName');
      const userEl = document.getElementById('authPageUsernameVal');
      const emailEl = document.getElementById('authPageEmailVal');
      const countryEl = document.getElementById('authPageCountryVal');
      const roleEl = document.getElementById('authPageRoleBadge');
      const avatarEl = document.getElementById('authPageAvatar');

      if (dispEl) dispEl.textContent = displayName;
      if (fullEl) fullEl.textContent = displayName;
      if (userEl) userEl.textContent = `@${u.username}`;
      if (emailEl) emailEl.textContent = u.emailAddress || 'N/A';
      if (countryEl) countryEl.textContent = u.location || (isAirline ? (u.airline?.name || 'Dhaka, Bangladesh') : (u.passenger?.country || 'Dhaka, Bangladesh'));
      if (roleEl) roleEl.textContent = roleBadge;
      if (avatarEl) avatarEl.src = avatarSrc;

      // Toggle shortcuts based on role
      const dashShortcut = document.getElementById('sessionShortcutDashboard');
      const tripsShortcut = document.getElementById('sessionShortcutTrips');
      const favsShortcut = document.getElementById('sessionShortcutFavorites');

      if (dashShortcut) dashShortcut.style.display = isAirline ? 'flex' : 'none';
      if (tripsShortcut) tripsShortcut.style.display = isAirline ? 'none' : 'flex';
      if (favsShortcut) favsShortcut.style.display = isAirline ? 'none' : 'flex';
    } else {
      loggedInCard.style.display = 'none';
      notLoggedInCard.style.display = 'block';

      this.clearAuthInputs();

      const hash = window.location.hash.toLowerCase();
      this.switchAuthPageView(hash === '#register' ? 'register' : 'login');

      const errAlert = document.getElementById('authPageErrorAlert');
      if (errAlert) errAlert.style.display = 'none';
    }
  },

  switchAuthPageView(tab) {
    this.clearAuthInputs();
    const isLogin = tab === 'login';
    const tabLogin = document.getElementById('authPageTabLogin');
    const tabReg = document.getElementById('authPageTabRegister');
    const formLogin = document.getElementById('authPageLoginForm');
    const formReg = document.getElementById('authPageRegisterForm');
    const errAlert = document.getElementById('authPageErrorAlert');

    if (tabLogin) tabLogin.classList.toggle('active', isLogin);
    if (tabReg) tabReg.classList.toggle('active', !isLogin);
    if (formLogin) formLogin.style.display = isLogin ? 'block' : 'none';
    if (formReg) formReg.style.display = isLogin ? 'none' : 'block';
    if (errAlert) errAlert.style.display = 'none';

    window.location.hash = isLogin ? 'login' : 'register';
  },

  // -------------------------------------------------------------
  // NAVIGATION (SINGLE PAGE APPLICATION WITH RBAC GUARDS)
  // -------------------------------------------------------------
  navigate(page, updateHash = true) {
    if (page !== 'seatMap' && typeof this.stopSeatPolling === 'function') {
      this.stopSeatPolling();
    }

    // Dedicated logout route
    if (page === 'logout') {
      if (this.state.user) {
        this.promptLogout();
        return;
      } else {
        page = 'auth';
      }
    }

    // Dedicated login / auth route
    if (page === 'login' || page === 'register') {
      page = 'auth';
    }

    // RBAC & Authentication Guard for protected private pages
    const protectedPages = ['dashboard', 'bookings', 'favorites', 'account'];
    if (protectedPages.includes(page) && !this.state.user) {
      this.showToast('Please sign in to access your flight bookings and dashboard.', 'info');
      history.replaceState(null, '', '/login');
      window.location.hash = 'login';
      page = 'auth';
    }

    // Role-Based Guard: Passenger cannot access Airline Dashboard
    if (page === 'dashboard' && this.state.user) {
      const roleUpper = (this.state.user.role || '').toUpperCase();
      if (roleUpper !== 'AIRLINE_ADMIN' && roleUpper !== 'AIRLINE') {
        this.showToast('Access restricted: Airline Administrator privileges required.', 'error');
        page = 'bookings';
      }
    }

    // Role-Based Guard: Airline Admins accessing bookings redirected to dashboard
    if (page === 'bookings' && this.state.user) {
      const roleUpper = (this.state.user.role || '').toUpperCase();
      if (roleUpper === 'AIRLINE_ADMIN' || roleUpper === 'AIRLINE') {
        page = 'dashboard';
      }
    }

    this.state.currentPage = page;
    if (updateHash) {
      if (page === 'auth') {
        window.location.hash = 'login';
      } else if (page === 'home') {
        window.location.hash = '';
      } else {
        window.location.hash = page;
      }
    }

    // Toggle view visibility
    const views = ['pageHome', 'pageSearch', 'pageSeatMap', 'pageBookings', 'pageFavorites', 'pageDashboard', 'pageAccount', 'pageAuth'];
    views.forEach(v => {
      const el = document.getElementById(v);
      if (el) el.style.display = 'none';
    });

    const activeViewId = `page${page.charAt(0).toUpperCase() + page.slice(1)}`;
    const targetEl = document.getElementById(activeViewId);
    if (targetEl) targetEl.style.display = 'block';

    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === page);
    });

    // Page-specific trigger
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (page === 'search') {
      this.executeSearchQuery();
    } else if (page === 'bookings') {
      this.loadMyBookings();
    } else if (page === 'favorites') {
      this.loadMyFavorites();
    } else if (page === 'dashboard') {
      this.loadAirlineDashboard();
    } else if (page === 'account') {
      this.loadAccountInfo();
    } else if (page === 'auth') {
      this.renderAuthPageView();
    }
  },

  // -------------------------------------------------------------
  // AUTOCOMPLETE & AIRPORT LOOKUPS
  // -------------------------------------------------------------
  async loadCountries() {
    try {
      const res = await fetch('/api/airports/countries');
      const list = await res.json();
      this.state.countriesCache = list;

      // Populate filter dropdowns
      const depSel = document.getElementById('filterDepCountry');
      const arrSel = document.getElementById('filterArrCountry');
      const profSel = document.getElementById('profCountry');

      const optionsHtml = list.map(c => `<option value="${c}">${c}</option>`).join('');
      if (depSel) depSel.innerHTML = '<option value="">All Countries</option>' + optionsHtml;
      if (arrSel) arrSel.innerHTML = '<option value="">All Countries</option>' + optionsHtml;
      if (profSel) profSel.innerHTML = optionsHtml;
    } catch (e) {
      console.error(e);
    }
  },

  async loadAirports() {
    try {
      const res = await fetch('/api/airports/search?q=');
      this.state.airportsCache = await res.json();
    } catch (e) {
      console.error(e);
    }
  },

  setupAutocomplete() {
    const bindInput = (inputId, dropdownId, onSelect) => {
      const inp = document.getElementById(inputId);
      const drop = document.getElementById(dropdownId);
      if (!inp || !drop) return;

      let timeout = null;
      inp.addEventListener('input', () => {
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
          const val = inp.value.trim();
          if (val.length < 1) {
            drop.classList.remove('show');
            return;
          }

          const res = await fetch(`/api/airports/search?q=${encodeURIComponent(val)}`);
          const airports = await res.json();
          if (airports.length === 0) {
            drop.innerHTML = '<div style="padding: 10px; font-size: 0.8rem; color: var(--text-muted);">No airports found</div>';
            drop.classList.add('show');
            return;
          }

          drop.innerHTML = airports.map(a => `
            <div class="airport-dropdown-item" onclick="app.selectAirport('${inputId}', '${dropdownId}', '${a.city}', '${a.IATA || a.ICAO}', '${a.country}', ${a.id})">
              <div>
                <div class="airport-item-main">${a.city} (${a.IATA || a.ICAO})</div>
                <div class="airport-item-sub">${a.name}, ${a.country}</div>
              </div>
              <span class="airport-item-iata">${a.IATA || a.ICAO}</span>
            </div>
          `).join('');
          drop.classList.add('show');
        }, 200);
      });

      // Close on outside click
      document.addEventListener('click', (e) => {
        if (!inp.contains(e.target) && !drop.contains(e.target)) {
          drop.classList.remove('show');
        }
      });
    };

    bindInput('homeOriginInput', 'homeOriginDropdown');
    bindInput('homeDestInput', 'homeDestDropdown');
  },

  selectAirport(inputId, dropdownId, city, code, country, airportId) {
    const inp = document.getElementById(inputId);
    const drop = document.getElementById(dropdownId);
    if (inp) {
      inp.value = `${city} (${code})`;
      inp.dataset.city = city;
      inp.dataset.code = code;
      inp.dataset.country = country;
      inp.dataset.airportId = airportId || '';
      inp.dataset.id = airportId || '';
    }
    if (drop) drop.classList.remove('show');
  },

  swapHomeAirports() {
    const orig = document.getElementById('homeOriginInput');
    const dest = document.getElementById('homeDestInput');
    if (!orig || !dest) return;

    const tempVal = orig.value;
    const tempCity = orig.dataset.city || '';
    const tempCountry = orig.dataset.country || '';
    const tempCode = orig.dataset.code || '';
    const tempAirportId = orig.dataset.airportId || '';
    const tempId = orig.dataset.id || '';

    orig.value = dest.value;
    orig.dataset.city = dest.dataset.city || '';
    orig.dataset.country = dest.dataset.country || '';
    orig.dataset.code = dest.dataset.code || '';
    orig.dataset.airportId = dest.dataset.airportId || '';
    orig.dataset.id = dest.dataset.id || '';

    dest.value = tempVal;
    dest.dataset.city = tempCity;
    dest.dataset.country = tempCountry;
    dest.dataset.code = tempCode;
    dest.dataset.airportId = tempAirportId;
    dest.dataset.id = tempId;
  },

  setTripType(type) {
    this.state.currentTripType = type;
    document.getElementById('tabOneWay').classList.toggle('active', type === 'oneway');
    document.getElementById('tabRoundTrip').classList.toggle('active', type === 'roundtrip');
    const form = document.querySelector('.search-widget-form');
    if (form) {
      form.classList.toggle('is-roundtrip', type === 'roundtrip');
    }
    const returnField = document.getElementById('returnDateField');
    if (returnField) {
      returnField.style.display = type === 'roundtrip' ? 'flex' : 'none';
    }
  },

  clearHomeSearch() {
    const orig = document.getElementById('homeOriginInput');
    if (orig) {
      orig.value = 'Dhaka (DAC)';
      orig.dataset.city = 'Dhaka';
      orig.dataset.code = 'DAC';
      orig.dataset.country = 'Bangladesh';
      orig.dataset.airportId = '185';
      orig.dataset.id = '185';
    }
    const dest = document.getElementById('homeDestInput');
    if (dest) {
      dest.value = '';
      dest.dataset.city = '';
      dest.dataset.code = '';
      dest.dataset.country = '';
      dest.dataset.airportId = '';
      dest.dataset.id = '';
    }
    const dep = document.getElementById('homeDepDate');
    if (dep) dep.value = '';
    const ret = document.getElementById('homeReturnDate');
    if (ret) ret.value = '';
  },

  extractCityName(inputEl) {
    if (!inputEl) return '';
    const val = (inputEl.value || '').trim();
    if (inputEl.dataset && inputEl.dataset.city && (val.includes(inputEl.dataset.city) || !val)) {
      return inputEl.dataset.city.trim();
    }
    // Clean trailing (IATA) or (ICAO) codes like "Cox's Bazar (CXB)" -> "Cox's Bazar"
    return val.replace(/\s*\([A-Za-z0-9]{2,4}\)$/, '').trim();
  },

  quickFilterSearch(originCity, destCity) {
    const orig = document.getElementById('homeOriginInput');
    const dest = document.getElementById('homeDestInput');
    if (orig) {
      orig.value = originCity;
      orig.dataset.city = originCity;
    }
    if (dest) {
      dest.value = destCity;
      dest.dataset.city = destCity;
    }
    this.executeHomeSearch();
  },

  executeHomeSearch() {
    const orig = document.getElementById('homeOriginInput');
    const dest = document.getElementById('homeDestInput');
    const depDateInput = document.getElementById('homeDepDate');
    const depDate = depDateInput ? depDateInput.value : '';
    const classSel = document.getElementById('homeCabinClass');
    const cabinClass = classSel ? classSel.value : 'all';
    const passSel = document.getElementById('homePassengers');
    const passengers = passSel ? passSel.value : '1';

    const depCity = this.extractCityName(orig);
    const arrCity = this.extractCityName(dest);

    // Validation: prevent identical origin and destination
    if (depCity && arrCity && depCity.toLowerCase() === arrCity.toLowerCase()) {
      this.showToast('Origin and destination cannot be identical. Please select another airport.', 'warning');
      return;
    }

    this.state.searchParams.depCity = depCity;
    this.state.searchParams.arrCity = arrCity;
    this.state.searchParams.depDateAfter = depDate || '';
    this.state.searchParams.cabinClass = cabinClass;
    this.state.searchParams.passengers = passengers;
    this.state.searchParams.page = 1;

    // Sync to search page filter controls
    const filterDateEl = document.getElementById('filterDateAfter');
    if (filterDateEl && depDate) {
      filterDateEl.value = depDate;
    }

    this.navigate('search');
  },

  // -------------------------------------------------------------
  // FEATURED FLIGHTS (HOMEPAGE)
  // -------------------------------------------------------------
  async loadFeaturedFlights() {
    const container = document.getElementById('featuredFlightsGrid');
    if (!container) return;

    container.innerHTML = `
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
    `;

    try {
      const accId = this.state.user ? this.state.user.id : 0;
      const res = await fetch(`/api/flights/featured?accountId=${accId}`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const flights = await res.json();

      if (!flights || flights.length === 0) {
        container.innerHTML = `
          <div style="grid-column: 1/-1; text-align: center; padding: 48px 24px; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);">
            <div style="font-size: 2.2rem; margin-bottom: 10px;">✈️</div>
            <h4 style="font-size: 1.15rem; color: var(--text-main); margin-bottom: 6px; font-family: var(--font-heading);">No Upcoming Flights Available</h4>
            <p style="color: var(--text-secondary); font-size: 0.9rem; max-width: 420px; margin: 0 auto 16px auto;">All current flights are operating or in progress. Check back shortly or browse our flight catalog.</p>
            <button class="btn-primary" onclick="app.navigate('search')">Browse All Flights</button>
          </div>
        `;
        return;
      }

      container.innerHTML = flights.map(f => this.renderFlightCard(f)).join('');
    } catch (e) {
      console.error('Featured flights error:', e);
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 32px 20px; color: #ef4444; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
          Unable to load featured flights. Please refresh the page or check server connection.
        </div>
      `;
    }
  },

  // -------------------------------------------------------------
  // SEARCH PAGE & FILTER LOGIC
  // -------------------------------------------------------------
  async onDepCountryChange() {
    const c = document.getElementById('filterDepCountry').value;
    const citySel = document.getElementById('filterDepCity');
    if (!c) {
      citySel.innerHTML = '<option value="">All Cities</option>';
      this.triggerFilteredSearch();
      return;
    }

    const res = await fetch(`/api/airports/cities?country=${encodeURIComponent(c)}`);
    const cities = await res.json();
    citySel.innerHTML = '<option value="">All Cities</option>' + cities.map(city => `<option value="${city}">${city}</option>`).join('');
    this.triggerFilteredSearch();
  },

  async onArrCountryChange() {
    const c = document.getElementById('filterArrCountry').value;
    const citySel = document.getElementById('filterArrCity');
    if (!c) {
      citySel.innerHTML = '<option value="">All Cities</option>';
      this.triggerFilteredSearch();
      return;
    }

    const res = await fetch(`/api/airports/cities?country=${encodeURIComponent(c)}`);
    const cities = await res.json();
    citySel.innerHTML = '<option value="">All Cities</option>' + cities.map(city => `<option value="${city}">${city}</option>`).join('');
    this.triggerFilteredSearch();
  },

  triggerFilteredSearch() {
    this.state.searchParams.depCountry = document.getElementById('filterDepCountry').value;
    const depCityVal = document.getElementById('filterDepCity').value;
    if (depCityVal || document.getElementById('filterDepCountry').value) {
      this.state.searchParams.depCity = depCityVal;
    }
    this.state.searchParams.arrCountry = document.getElementById('filterArrCountry').value;
    const arrCityVal = document.getElementById('filterArrCity').value;
    if (arrCityVal || document.getElementById('filterArrCountry').value) {
      this.state.searchParams.arrCity = arrCityVal;
    }
    this.state.searchParams.depDateAfter = document.getElementById('filterDateAfter').value;
    this.state.searchParams.depDateBefore = document.getElementById('filterDateBefore').value;
    this.state.searchParams.sortBy = document.getElementById('filterSortBy').value;
    this.state.searchParams.search = document.getElementById('filterKeyword').value.trim();
    this.state.searchParams.page = 1;

    this.executeSearchQuery();
  },

  clearSearchRoute() {
    this.state.searchParams.depCity = '';
    this.state.searchParams.arrCity = '';
    this.state.searchParams.page = 1;
    this.executeSearchQuery();
  },

  resetSearchFilters() {
    document.getElementById('filterDepCountry').value = '';
    document.getElementById('filterDepCity').innerHTML = '<option value="">All Cities</option>';
    document.getElementById('filterArrCountry').value = '';
    document.getElementById('filterArrCity').innerHTML = '<option value="">All Cities</option>';
    document.getElementById('filterDateAfter').value = '';
    document.getElementById('filterDateBefore').value = '';
    document.getElementById('filterSortBy').value = 'closestDate';
    document.getElementById('filterKeyword').value = '';

    this.state.searchParams = {
      page: 1,
      limit: 10,
      depCountry: '',
      arrCountry: '',
      depCity: '',
      arrCity: '',
      depDateAfter: '',
      depDateBefore: '',
      sortBy: 'closestDate',
      search: ''
    };
    this.executeSearchQuery();
  },

  swapSearchAirports() {
    const dc = document.getElementById('filterDepCountry');
    const ac = document.getElementById('filterArrCountry');
    const tempCountry = dc.value;
    dc.value = ac.value;
    ac.value = tempCountry;

    this.onDepCountryChange();
    this.onArrCountryChange();
  },

  async executeSearchQuery() {
    const listContainer = document.getElementById('flightsListContainer');
    const badge = document.getElementById('resultsCountBadge');
    if (!listContainer) return;

    listContainer.innerHTML = `
      <div style="padding: 40px; text-align: center; color: var(--text-muted);">
        <div class="pulsing-dot" style="margin: 0 auto 12px auto;"></div>
        Searching scheduled routes across worldwide network...
      </div>
    `;

    const p = this.state.searchParams;
    const offset = (p.page - 1) * p.limit;
    const accId = this.state.user ? this.state.user.id : 0;

    const query = new URLSearchParams({
      limit: p.limit,
      offset: offset,
      sortBy: p.sortBy,
      accountId: accId
    });

    if (p.depCountry) query.append('depCountry', p.depCountry);
    if (p.arrCountry) query.append('arrCountry', p.arrCountry);
    if (p.depCity) query.append('depCity', p.depCity);
    if (p.arrCity) query.append('arrCity', p.arrCity);
    if (p.depDateAfter) query.append('dateAfter', p.depDateAfter);
    if (p.depDateBefore) query.append('dateBefore', p.depDateBefore);
    if (p.search) query.append('q', p.search);
    if (p.cabinClass && p.cabinClass !== 'all') query.append('cabinClass', p.cabinClass);

    try {
      const res = await fetch(`/api/flights?${query.toString()}`);
      const data = await res.json();

      badge.innerText = `${data.total} Flights Found`;
      const hint = document.getElementById('resultsFilterHint');
      if (hint) {
        if (p.depCity || p.arrCity) {
          hint.innerHTML = `Route: <strong>${p.depCity || 'Any'}</strong> ➔ <strong>${p.arrCity || 'Any'}</strong> <button class="btn-clear-route-pill" onclick="app.clearSearchRoute()" title="Clear route filter">✕ Clear</button>`;
        } else {
          hint.innerText = 'Showing scheduled flights worldwide';
        }
      }

      if (!data.flights || data.flights.length === 0) {
        listContainer.innerHTML = `
          <div class="empty-search-state" style="padding: 56px 24px; text-align: center; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm);">
            <div style="font-size: 2.8rem; margin-bottom: 14px;">🛫</div>
            <h3 style="font-size: 1.4rem; color: var(--text-main); margin-bottom: 8px; font-family: var(--font-heading);">No Flights Found Matching Your Criteria</h3>
            <p style="color: var(--text-secondary); max-width: 460px; margin: 0 auto 20px auto; font-size: 0.94rem; line-height: 1.5;">
              We couldn't find any scheduled flights for this route and date combination. Try selecting a nearby date, checking another departure airport, or clearing your filters.
            </p>
            <button class="btn-primary" onclick="app.resetSearchFilters()">Reset Search Filters</button>
          </div>
        `;
        document.getElementById('searchPagination').innerHTML = '';
        return;
      }

      listContainer.innerHTML = data.flights.map(f => this.renderFlightCard(f)).join('');
      this.renderPagination(data.total, p.limit, p.page);
    } catch (e) {
      console.error(e);
      listContainer.innerHTML = '<div style="color: #ef4444; padding: 24px; text-align: center; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">Failed to load flights. Please verify server status and try again.</div>';
    }
  },

  renderFlightCard(f) {
    const depTime = f.dep_datetime ? f.dep_datetime.substring(11, 16) : '00:00';
    const depDate = f.dep_datetime ? f.dep_datetime.substring(0, 10) : '';
    const arrTime = f.arr_datetime ? f.arr_datetime.substring(11, 16) : '00:00';
    const arrDate = f.arr_datetime ? f.arr_datetime.substring(0, 10) : '';

    const depCode = f.depIATA || f.depICAO || 'DEP';
    const arrCode = f.arrIATA || f.arrICAO || 'ARR';
    const depAirportClean = (f.depAirportName || '').replace(/^\?stanbul/i, 'Istanbul');
    const arrAirportClean = (f.arrAirportName || '').replace(/^\?stanbul/i, 'Istanbul');
    const durationLabel = f.durationFormatted || this.calculateDuration(f.dep_datetime, f.arr_datetime);
    const flightNum = f.flightNumber || `${(f.airlineIATA || 'FL').trim().toUpperCase()}-${100 + (f.id % 900)}`;
    const flightStatus = f.flightStatus || 'ON TIME';
    const availableSeats = typeof f.availableSeats === 'number' ? f.availableSeats : Math.max(0, 120 - (Number(f.bookedCount) || 0));
    const seatsBadgeClass = availableSeats > 25 ? 'seats-plenty' : (availableSeats > 5 ? 'seats-limited' : 'seats-almost-full');

    const favClass = f.isFavorite ? 'active' : '';

    return `
      <div class="flight-card">
        <div class="flight-card-header">
          <div class="airline-badge">
            <img src="/api/airlines/${f.id_airline}/logo" class="airline-logo-img" alt="${f.airlineName}" onerror="this.src='/images/default_logo.png'">
            <div>
              <div class="airline-name">${f.airlineName}</div>
              <div class="flight-id-tag">
                <span class="flight-code">${flightNum}</span>
                <span class="flight-status-pill status-${flightStatus.toLowerCase().replace(/\s+/g, '-')}">● ${flightStatus}</span>
              </div>
            </div>
          </div>
          <div class="header-card-right">
            <span class="seats-available-badge ${seatsBadgeClass}">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/><path d="M3 11v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0Z"/><path d="M5 18v2"/><path d="M19 18v2"/></svg>
              ${availableSeats} Seats Available
            </span>
            <button class="btn-favorite-card ${favClass}" onclick="app.toggleFavorite(${f.id}, this)" title="Save to Favorites">
              <svg viewBox="0 0 24 24" fill="${f.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
            </button>
          </div>
        </div>

        <div class="flight-timeline">
          <div class="timeline-point">
            <div class="point-time">${depTime}</div>
            <div class="point-iata">${depCode}</div>
            <div class="point-city" title="${depAirportClean}">${f.depCity}, ${f.depCountry}</div>
            <div class="point-date">${depDate}</div>
          </div>

          <div class="timeline-path">
            <span class="duration-text">${durationLabel}</span>
            <div class="flight-path-graphic">
              <div class="path-line"></div>
              <span class="path-plane-icon">✈</span>
            </div>
            <span class="nonstop-badge">${f.flightType || 'Direct / Non-stop'}</span>
          </div>

          <div class="timeline-point text-right">
            <div class="point-time">${arrTime}</div>
            <div class="point-iata">${arrCode}</div>
            <div class="point-city" title="${arrAirportClean}">${f.arrCity}, ${f.arrCountry}</div>
            <div class="point-date">${arrDate}</div>
          </div>
        </div>

        <div class="flight-card-footer">
          <div class="card-pricing-classes">
            <div class="price-col">
              <span class="price-class-name">Economy</span>
              <span class="price-amount eco">${this.formatCurrency(f.economy_price)}</span>
            </div>
            <div class="price-col">
              <span class="price-class-name">Business</span>
              <span class="price-amount biz">${this.formatCurrency(f.business_price)}</span>
            </div>
            <div class="price-col">
              <span class="price-class-name">First</span>
              <span class="price-amount first">${this.formatCurrency(f.first_price)}</span>
            </div>
          </div>

          <button class="btn-select-seats" onclick="app.openSeatMap(${f.id})">
            <span>Select Seats</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 15px; height: 15px;"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </button>
        </div>
      </div>
    `;
  },

  renderPagination(total, limit, current) {
    const totalPages = Math.ceil(total / limit);
    const container = document.getElementById('searchPagination');
    if (!container || totalPages <= 1) {
      if (container) container.innerHTML = '';
      return;
    }

    let html = '';
    const start = Math.max(1, current - 2);
    const end = Math.min(totalPages, current + 2);

    for (let i = start; i <= end; i++) {
      html += `
        <button class="page-num-btn ${i === current ? 'active' : ''}" onclick="app.goToPage(${i})">${i}</button>
      `;
    }
    container.innerHTML = html;
  },

  goToPage(pageNum) {
    this.state.searchParams.page = pageNum;
    this.executeSearchQuery();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  async toggleFavorite(flightId, btnEl) {
    if (!this.state.user) {
      this.openAuthModal('login');
      this.showToast('Please sign in to save favorite flights', 'info');
      return;
    }

    const isActive = btnEl.classList.contains('active');
    const accId = this.state.user.id;

    try {
      if (isActive) {
        await fetch(`/api/favorites/${flightId}?accountId=${accId}`, { method: 'DELETE', headers: this.getAuthHeaders() });
        btnEl.classList.remove('active');
        btnEl.querySelector('svg').setAttribute('fill', 'none');
        this.showToast('Removed from favorites', 'info');
      } else {
        await fetch(`/api/favorites/${flightId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: accId })
        });
        btnEl.classList.add('active');
        btnEl.querySelector('svg').setAttribute('fill', 'currentColor');
        this.showToast('Flight saved to favorites!', 'success');
      }
    } catch (e) {
      this.showToast('Error updating favorite', 'error');
    }
  },

  // -------------------------------------------------------------
  // SEAT MAP & CABIN VISUALIZATION (CONFLICT-FREE & MULTI-SEAT)
  // -------------------------------------------------------------
  async openSeatMap(flightId) {
    this.stopSeatPolling();
    this.state.selectedFlight = null;
    this.state.selectedSeat = null;
    this.state.selectedSeats = [];
    this.state.luggageCount = 0;
    this.state.luggageWeight = 0;

    const accId = this.state.user ? this.state.user.id : 0;
    const [fRes, sRes] = await Promise.all([
      fetch(`/api/flights/${flightId}?accountId=${accId}`),
      fetch(`/api/flights/${flightId}/seats?accountId=${accId}`)
    ]);

    const flight = await fRes.json();
    const seatData = await sRes.json();

    this.state.selectedFlight = flight;
    this.navigate('seatMap');

    // Render Flight Header in Seatmap
    const routeHeader = document.getElementById('seatmapRouteHeader');
    if (routeHeader) {
      routeHeader.innerHTML = `
        <span>${flight.depCity} (${flight.depIATA || 'DEP'}) ➔ ${flight.arrCity} (${flight.arrIATA || 'ARR'})</span>
        <span style="font-size: 0.82rem; color: var(--text-secondary); margin-left: 12px;">• Flight #${flight.id} • ${flight.airlineName}</span>
      `;
    }

    // Render Flight Summary
    const summaryFlightInfo = document.getElementById('summaryFlightInfo');
    if (summaryFlightInfo) {
      summaryFlightInfo.innerHTML = `
        <div style="font-weight: 700; font-size: 0.95rem; margin-bottom: 4px;">${flight.depCity} ➔ ${flight.arrCity}</div>
        <div style="font-size: 0.8rem; color: var(--text-secondary);">${flight.depAirportName}</div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 6px;">📅 ${flight.dep_datetime}</div>
      `;
    }

    // Reset Luggage and Weight Labels
    document.getElementById('lblLuggageRate').innerText = `+${this.formatCurrency(flight.luggage_price || 350)} / bag`;
    document.getElementById('lblWeightRate').innerText = `+${this.formatCurrency(flight.weight_price || 120)} / kg`;
    document.getElementById('valLuggageCount').innerText = '0';
    document.getElementById('valLuggageTotal').innerText = this.formatCurrency(0);
    document.getElementById('inputWeightSlider').value = 0;
    document.getElementById('valWeightDisplay').innerText = '0 kg';
    document.getElementById('valWeightTotal').innerText = this.formatCurrency(0);

    this.renderCabinSeats(seatData.seats);
    this.updatePriceCalculations();

    // Start real-time availability polling (every 4 seconds)
    this.state.seatPollInterval = setInterval(() => {
      this.pollSeatAvailability();
    }, 4000);
  },

  stopSeatPolling() {
    if (this.state.seatPollInterval) {
      clearInterval(this.state.seatPollInterval);
      this.state.seatPollInterval = null;
    }
  },

  async pollSeatAvailability(silent = false) {
    if (this.state.currentPage !== 'seatMap' || !this.state.selectedFlight) return;
    try {
      const accId = this.state.user ? this.state.user.id : 0;
      const res = await fetch(`/api/flights/${this.state.selectedFlight.id}/seats?accountId=${accId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.seats) return;

      // Check if any seat currently chosen by user was held by someone else
      const currentSelectedIds = (this.state.selectedSeats || []).map(s => s.id);
      let conflictFound = false;

      currentSelectedIds.forEach(id => {
        const sSeat = data.seats.find(s => s.id === id);
        if (sSeat && sSeat.status !== 'AVAILABLE' && !sSeat.isHeldByMe) {
          conflictFound = true;
          this.state.selectedSeats = this.state.selectedSeats.filter(s => s.id !== id);
        }
      });

      if (conflictFound && !silent) {
        this.showToast('Sorry, one of your selected seats was just reserved by another customer.', 'warning');
      }

      this.renderCabinSeats(data.seats);
      this.updatePriceCalculations();
    } catch (_) { }
  },

  renderCabinSeats(seats) {
    const grid = document.getElementById('cabinSeatsGrid');
    if (!grid) return;

    // Group seats by row
    const rowMap = new Map();
    seats.forEach(s => {
      if (!rowMap.has(s.row)) rowMap.set(s.row, []);
      rowMap.get(s.row).push(s);
    });

    let html = `
      <div class="cabin-row">
        <span class="cabin-row-header">A</span>
        <span class="cabin-row-header">B</span>
        <span class="cabin-row-header">C</span>
        <span class="cabin-row-header"></span>
        <span class="cabin-row-header">D</span>
        <span class="cabin-row-header">E</span>
        <span class="cabin-row-header">F</span>
      </div>
    `;

    for (let r = 1; r <= 20; r++) {
      if (r === 8) {
        html += `<div class="exit-row-banner"><span>◀ EMERGENCY EXIT 1</span><span>EMERGENCY EXIT 1 ▶</span></div>`;
      }
      if (r === 12) {
        html += `<div class="exit-row-banner"><span>◀ EMERGENCY EXIT 2</span><span>EMERGENCY EXIT 2 ▶</span></div>`;
      }

      const rowSeats = rowMap.get(r) || [];
      const getSeat = col => rowSeats.find(s => s.column === col);

      html += `
        <div class="cabin-row">
          ${this.renderSeatButton(getSeat('A'))}
          ${this.renderSeatButton(getSeat('B'))}
          ${this.renderSeatButton(getSeat('C'))}
          <span class="row-num-badge">${r}</span>
          ${this.renderSeatButton(getSeat('D'))}
          ${this.renderSeatButton(getSeat('E'))}
          ${this.renderSeatButton(getSeat('F'))}
        </div>
      `;
    }

    grid.innerHTML = html;
  },

  renderSeatButton(s) {
    if (!s) return `<div style="width: 44px; height: 44px;"></div>`;

    const isSelected = (this.state.selectedSeats || []).some(sel => sel.id === s.id);
    let statusClass = 'available';
    let titleText = `Seat ${s.seatCode} (${s.type.toUpperCase()}) - Available`;
    let disabledAttr = '';

    if (s.status === 'HELD') {
      statusClass = 'held';
      if (s.isHeldByMe) {
        statusClass += ' held-by-me';
        titleText = `Seat ${s.seatCode} (Held by You - ${s.secondsRemaining || 900}s left)`;
      } else {
        disabledAttr = 'disabled';
        titleText = `Seat ${s.seatCode} (Temporarily Held by Another Customer - 15m window)`;
      }
    } else if (s.status === 'BOOKED' || s.isReserved) {
      statusClass = 'booked taken';
      disabledAttr = 'disabled';
      titleText = `Seat ${s.seatCode} (Confirmed Booked)`;
    }

    if (isSelected) {
      statusClass += ' selected';
    }

    return `
      <button class="seat-btn ${s.type} ${statusClass}" 
              data-id="${s.id}" 
              data-col="${s.column}" 
              data-row="${s.row}" 
              data-type="${s.type}"
              data-code="${s.seatCode}"
              ${disabledAttr}
              onclick="app.onSeatClick(this, ${s.id}, '${s.column}', ${s.row}, '${s.type}')"
              title="${titleText}">
        <span class="seat-num">${s.seatCode}</span>
      </button>
    `;
  },

  onSeatClick(btnEl, id, col, row, type) {
    if (btnEl.disabled || btnEl.classList.contains('taken') || (btnEl.classList.contains('held') && !btnEl.classList.contains('held-by-me'))) {
      return;
    }

    if (!this.state.selectedSeats) {
      this.state.selectedSeats = [];
    }

    const index = this.state.selectedSeats.findIndex(s => s.id === id);
    if (index >= 0) {
      this.state.selectedSeats.splice(index, 1);
      btnEl.classList.remove('selected');
    } else {
      this.state.selectedSeats.push({ id, column: col, row, type, code: `${col}${row}` });
      btnEl.classList.add('selected');
    }

    this.state.selectedSeat = this.state.selectedSeats[0] || null;
    this.updatePriceCalculations();
  },

  adjustLuggage(delta) {
    const next = Math.max(0, Math.min(5, this.state.luggageCount + delta));
    this.state.luggageCount = next;
    document.getElementById('valLuggageCount').innerText = next;
    const rate = this.state.selectedFlight ? this.state.selectedFlight.luggage_price : 350;
    const total = next * rate;
    document.getElementById('valLuggageTotal').innerText = this.formatCurrency(total);
    this.updatePriceCalculations();
  },

  onWeightChange(val) {
    const w = Number(val);
    this.state.luggageWeight = w;
    document.getElementById('valWeightDisplay').innerText = `${w} kg`;
    const rate = this.state.selectedFlight ? this.state.selectedFlight.weight_price : 120;
    const total = w * rate;
    document.getElementById('valWeightTotal').innerText = this.formatCurrency(total);
    this.updatePriceCalculations();
  },

  updatePriceCalculations() {
    const f = this.state.selectedFlight;
    const seats = this.state.selectedSeats || [];

    const seatName = document.getElementById('summarySeatName');
    const seatClass = document.getElementById('summarySeatClass');
    const seatPrice = document.getElementById('summarySeatPrice');
    const pillsContainer = document.getElementById('selectedSeatsPills');
    const proceedBtn = document.getElementById('btnProceedPayment');
    const proceedBtnText = document.getElementById('btnProceedPaymentText');

    if (!f || seats.length === 0) {
      if (seatName) seatName.innerText = 'No Seat Selected';
      if (seatClass) seatClass.innerText = 'Click any available seat to select (multi-seat supported)';
      if (seatPrice) seatPrice.innerText = this.formatCurrency(0);
      if (pillsContainer) pillsContainer.innerHTML = '';
      if (proceedBtn) proceedBtn.disabled = true;
      if (proceedBtnText) proceedBtnText.innerText = 'Select At Least 1 Seat';

      document.getElementById('calcBaseFare').innerText = this.formatCurrency(0);
      document.getElementById('calcLuggageFee').innerText = this.formatCurrency(0);
      document.getElementById('calcWeightFee').innerText = this.formatCurrency(0);
      document.getElementById('calcGrandTotal').innerText = this.formatCurrency(0);
      this.state.calculatedTotal = 0;
      return;
    }

    if (proceedBtn) proceedBtn.disabled = false;

    let totalBase = 0;
    seats.forEach(s => {
      if (s.type === 'first') totalBase += f.first_price;
      else if (s.type === 'business') totalBase += f.business_price;
      else totalBase += f.economy_price;
    });

    const seatCodes = seats.map(s => s.code).join(', ');
    if (seatName) seatName.innerText = `${seats.length} Seat${seats.length > 1 ? 's' : ''} Selected (${seatCodes})`;
    if (seatClass) seatClass.innerText = 'Seats locked for 15 minutes once held';
    if (seatPrice) seatPrice.innerText = this.formatCurrency(totalBase);

    if (pillsContainer) {
      pillsContainer.innerHTML = seats.map(s => `
        <span class="selected-seat-pill">
          ${s.code} (${s.type.toUpperCase()})
          <span class="remove-seat" onclick="app.removeSelectedSeat(${s.id})" title="Remove seat">✕</span>
        </span>
      `).join('');
    }

    const luggageFee = this.state.luggageCount * (f.luggage_price || 350);
    const weightFee = this.state.luggageWeight * (f.weight_price || 120);
    const grandTotal = totalBase + luggageFee + weightFee;
    this.state.calculatedTotal = grandTotal;

    document.getElementById('calcBaseFare').innerText = this.formatCurrency(totalBase);
    document.getElementById('calcLuggageFee').innerText = this.formatCurrency(luggageFee);
    document.getElementById('calcWeightFee').innerText = this.formatCurrency(weightFee);
    document.getElementById('calcGrandTotal').innerText = this.formatCurrency(grandTotal);

    if (proceedBtnText) {
      proceedBtnText.innerText = `Reserve ${seats.length} Seat${seats.length > 1 ? 's' : ''} & Pay ${this.formatCurrency(grandTotal)}`;
    }
  },

  removeSelectedSeat(seatId) {
    if (!this.state.selectedSeats) return;
    this.state.selectedSeats = this.state.selectedSeats.filter(s => s.id !== seatId);
    const btn = document.querySelector(`.seat-btn[data-id="${seatId}"]`);
    if (btn) btn.classList.remove('selected');
    this.state.selectedSeat = this.state.selectedSeats[0] || null;
    this.updatePriceCalculations();
  },

  goBackFromSeatMap() {
    this.stopSeatPolling();
    this.navigate('search');
  },

  // -------------------------------------------------------------
  // CONFLICT-FREE TEMPORARY SEAT HOLD & 15-MINUTE PAYMENT WINDOW
  // -------------------------------------------------------------
  async proceedToPayment() {
    if (!this.state.user) {
      this.state.pendingPayment = true;
      this.openAuthModal('login');
      this.showToast('Please sign in to reserve your seats', 'info');
      return;
    }

    const f = this.state.selectedFlight;
    const seats = this.state.selectedSeats || [];
    if (!f || seats.length === 0) {
      this.showToast('Please select at least one seat', 'warning');
      return;
    }

    const proceedBtn = document.getElementById('btnProceedPayment');
    if (proceedBtn) proceedBtn.disabled = true;

    try {
      // 1. Send temporary hold request (with database transaction and partial unique constraint check)
      const holdRes = await fetch('/api/bookings/hold', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          flightId: f.id,
          accountId: this.state.user.id,
          seatIds: seats.map(s => s.id),
          nbrLuggages: this.state.luggageCount,
          weight: this.state.luggageWeight
        })
      });

      const holdData = await holdRes.json();

      if (!holdRes.ok) {
        if (proceedBtn) proceedBtn.disabled = false;
        // Exact requirement error message
        this.showToast(holdData.error || 'Seat reservation conflict occurred.', 'error');
        // Refresh live availability immediately
        this.pollSeatAvailability(true);
        return;
      }

      // 2. Hold was successful! Store active booking & persist to sessionStorage
      this.state.activeBooking = holdData;
      sessionStorage.setItem('fly_active_booking', JSON.stringify({
        bookingReference: holdData.bookingReference,
        flightId: f.id,
        expiresAt: holdData.expiresAt
      }));

      // Update sticky banner
      this.updateStickyHoldBanner(holdData.bookingReference, holdData.expiresAt);

      // 3. Load saved user cards
      const cardsRes = await fetch(`/api/cards?accountId=${this.state.user.id}`, { headers: this.getAuthHeaders() });
      const cards = await cardsRes.json();
      this.state.userCards = cards || [];

      // 4. Render Checkout Recap
      const seatCodes = seats.map(s => s.code).join(', ');
      document.getElementById('checkoutRecapCard').innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div>
            <span style="font-weight: 800; font-size: 1.05rem;">Booking Ref: ${holdData.bookingReference}</span>
            <div style="font-size: 0.8rem; color: var(--text-secondary);">Flight #${f.id} • ${f.airlineName}</div>
          </div>
          <span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4);">
            ⏱️ 15-MIN HOLD
          </span>
        </div>
        <div style="font-size: 0.9rem; margin-bottom: 6px;">
          ${f.depCity} (${f.depIATA}) ➔ ${f.arrCity} (${f.arrIATA})
        </div>
        <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 10px;">
          📅 ${f.dep_datetime} • Seats: <strong>${seatCodes}</strong> (${seats.length} total) • Baggage: ${this.state.luggageCount} bags (${this.state.luggageWeight}kg)
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed var(--border-subtle); padding-top: 8px;">
          <span style="font-weight: 700;">Total Payable Fare:</span>
          <span style="color: var(--accent-primary); font-size: 1.3rem; font-weight: 800;">${this.formatCurrency(holdData.totalAmount)}</span>
        </div>
      `;

      document.getElementById('btnPayText').innerText = `Confirm & Pay ${this.formatCurrency(holdData.totalAmount)}`;

      // Render payment methods
      const cardsListEl = document.getElementById('checkoutCardsList');
      if (cards.length === 0) {
        cardsListEl.innerHTML = `
          <div style="padding: 10px 14px; background: var(--bg-surface-elevated); border-radius: var(--radius-md); font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 8px;">
            No saved cards. You can use 1-click instant verification or add a card below.
          </div>
        `;
      } else {
        cardsListEl.innerHTML = cards.map((c, i) => `
          <div class="selectable-card-item ${i === 0 ? 'selected' : ''}" onclick="app.selectCheckoutCard(this, ${c.id})">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 1.3rem;">💳</span>
              <div>
                <div style="font-weight: 700; font-size: 0.88rem;">•••• •••• •••• ${c.cardNumber.slice(-4)}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${c.cardHolder} • Exp: ${c.expirationDate}</div>
              </div>
            </div>
            <span style="font-size: 0.8rem; color: var(--accent-primary); font-weight: 600;">Use Card</span>
          </div>
        `).join('');
      }

      // Reset expired banner visibility
      document.getElementById('paymentTimerBox').style.display = 'block';
      document.getElementById('paymentExpiredBanner').style.display = 'none';
      document.getElementById('paymentMethodsSection').style.display = 'block';
      document.getElementById('paymentModalFooter').style.display = 'flex';

      // 5. Start live countdown timer synced to server expiresAt
      this.startPaymentCountdown(holdData.expiresAt);

      document.getElementById('modalPayment').style.display = 'flex';
      this.showToast(`Seats reserved exclusively for you for 15 minutes!`, 'success');

    } catch (err) {
      console.error(err);
      this.showToast('Network error during reservation', 'error');
    } finally {
      if (proceedBtn) proceedBtn.disabled = false;
    }
  },

  startPaymentCountdown(expiresAtStr) {
    if (this.state.paymentCountdownInterval) {
      clearInterval(this.state.paymentCountdownInterval);
      this.state.paymentCountdownInterval = null;
    }

    const expiresAt = new Date(expiresAtStr).getTime();
    const totalDurationSeconds = 15 * 60; // 900s

    const tick = () => {
      const now = Date.now();
      const remainingSeconds = Math.max(0, Math.floor((expiresAt - now) / 1000));

      const mins = Math.floor(remainingSeconds / 60);
      const secs = remainingSeconds % 60;
      const formattedTime = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

      const clockEl = document.getElementById('paymentTimerClock');
      if (clockEl) {
        clockEl.innerText = formattedTime;
      }

      const progressEl = document.getElementById('paymentTimerProgress');
      if (progressEl) {
        const pct = Math.max(0, Math.min(100, (remainingSeconds / totalDurationSeconds) * 100));
        progressEl.style.width = `${pct}%`;
      }

      const stickyTime = document.getElementById('activeHoldTimeText');
      if (stickyTime) stickyTime.innerText = formattedTime;

      // When countdown reaches 0: EXPIRED!
      if (remainingSeconds <= 0) {
        clearInterval(this.state.paymentCountdownInterval);
        this.state.paymentCountdownInterval = null;

        document.getElementById('paymentTimerBox').style.display = 'none';
        document.getElementById('paymentExpiredBanner').style.display = 'flex';
        document.getElementById('paymentMethodsSection').style.display = 'none';
        document.getElementById('paymentModalFooter').style.display = 'none';

        sessionStorage.removeItem('fly_active_booking');
        this.hideStickyHoldBanner();

        this.showToast('Your 15-minute reservation window has expired. Seats released.', 'error');
        this.pollSeatAvailability(true);
      }
    };

    tick();
    this.state.paymentCountdownInterval = setInterval(tick, 1000);
  },

  handlePaymentExpiredDismiss() {
    this.closeModal('modalPayment');
    if (this.state.currentPage === 'seatMap') {
      this.pollSeatAvailability(true);
    } else {
      this.navigate('search');
    }
  },

  updateStickyHoldBanner(bookingRef, expiresAtStr) {
    const banner = document.getElementById('activeHoldStickyBanner');
    if (!banner) return;
    const refText = document.getElementById('activeHoldRefText');
    if (refText) refText.innerText = bookingRef;
    banner.style.display = 'flex';
  },

  hideStickyHoldBanner() {
    const banner = document.getElementById('activeHoldStickyBanner');
    if (banner) banner.style.display = 'none';
  },

  resumePendingPayment() {
    const stored = sessionStorage.getItem('fly_active_booking');
    if (!stored) return;
    try {
      const data = JSON.parse(stored);
      fetch(`/api/bookings/${data.bookingReference}`)
        .then(res => res.json())
        .then(booking => {
          if (booking.status === 'PENDING_PAYMENT' && booking.secondsRemaining > 0) {
            this.state.activeBooking = {
              bookingReference: booking.booking_reference,
              flightId: booking.id_flight,
              expiresAt: booking.expires_at,
              totalAmount: booking.total_amount
            };
            this.startPaymentCountdown(booking.expires_at);
            document.getElementById('modalPayment').style.display = 'flex';
          } else {
            sessionStorage.removeItem('fly_active_booking');
            this.hideStickyHoldBanner();
            this.showToast('Reservation expired or already completed.', 'info');
          }
        });
    } catch (_) { }
  },

  async cancelActivePendingBooking() {
    const stored = sessionStorage.getItem('fly_active_booking');
    if (!stored) return;
    try {
      const data = JSON.parse(stored);
      await fetch('/api/bookings/cancel', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ bookingReference: data.bookingReference, accountId: this.state.user ? this.state.user.id : null })
      });
      sessionStorage.removeItem('fly_active_booking');
      this.hideStickyHoldBanner();
      if (this.state.paymentCountdownInterval) {
        clearInterval(this.state.paymentCountdownInterval);
      }
      this.closeModal('modalPayment');
      this.showToast('Held seats successfully released back to availability.', 'info');
      this.pollSeatAvailability(true);
    } catch (e) {
      this.showToast('Error releasing seats', 'error');
    }
  },

  async checkPendingBookingOnLoad() {
    const stored = sessionStorage.getItem('fly_active_booking');
    if (!stored) return;
    try {
      const data = JSON.parse(stored);
      const res = await fetch(`/api/bookings/${data.bookingReference}`, { headers: this.getAuthHeaders() });
      if (!res.ok) {
        sessionStorage.removeItem('fly_active_booking');
        return;
      }
      const booking = await res.json();
      if (booking.status === 'PENDING_PAYMENT' && booking.secondsRemaining > 0) {
        this.updateStickyHoldBanner(booking.booking_reference, booking.expires_at);
        this.startPaymentCountdown(booking.expires_at);
      } else {
        sessionStorage.removeItem('fly_active_booking');
      }
    } catch (_) { }
  },

  selectCheckoutCard(el, cardId) {
    document.querySelectorAll('.selectable-card-item').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
  },

  // -------------------------------------------------------------
  // PAYMENT SUBMISSION & SERVER VERIFICATION
  // -------------------------------------------------------------
  async submitPayment(paymentType = 'standard') {
    if (!this.state.activeBooking) {
      this.showToast('No active reservation hold found', 'error');
      return;
    }

    const bookingRef = this.state.activeBooking.bookingReference;
    const confirmBtn = document.getElementById('btnConfirmPay');
    if (confirmBtn) confirmBtn.disabled = true;

    try {
      const res = await fetch('/api/bookings/confirm', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          bookingReference: bookingRef,
          paymentMethod: paymentType === 'instant_verify' ? 'instant_verification' : 'credit_card',
          transactionRef: `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
        })
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 410) {
          if (this.state.paymentCountdownInterval) clearInterval(this.state.paymentCountdownInterval);
          sessionStorage.removeItem('fly_active_booking');
          this.hideStickyHoldBanner();
          document.getElementById('paymentTimerBox').style.display = 'none';
          document.getElementById('paymentExpiredBanner').style.display = 'flex';
          document.getElementById('paymentMethodsSection').style.display = 'none';
          document.getElementById('paymentModalFooter').style.display = 'none';
          this.showToast(data.error || 'Reservation expired. Seats released.', 'error');
          return;
        }

        this.showToast(data.error || 'Payment verification failed', 'error');
        if (confirmBtn) confirmBtn.disabled = false;
        return;
      }

      if (this.state.paymentCountdownInterval) {
        clearInterval(this.state.paymentCountdownInterval);
        this.state.paymentCountdownInterval = null;
      }
      sessionStorage.removeItem('fly_active_booking');
      this.hideStickyHoldBanner();

      this.closeModal('modalPayment');
      this.showToast('Payment verified! Flight reservation confirmed.', 'success');
      this.refreshBookingsBadge();

      if (data.ticket) {
        this.renderBoardingPass(data.ticket);
      } else {
        this.navigate('bookings');
      }

    } catch (e) {
      console.error(e);
      this.showToast('Payment processing error', 'error');
      if (confirmBtn) confirmBtn.disabled = false;
    }
  },

  // -------------------------------------------------------------
  // BOARDING PASS (DIGITAL E-TICKET)
  // -------------------------------------------------------------
  renderBoardingPass(t) {
    if (!t) return;

    // Ticket Airline & Logos
    document.getElementById('ticketAirlineName').innerText = t.airlineName || 'FLY Airways';
    document.getElementById('ticketAirlineLogo').src = `/api/airlines/${t.airlineId}/logo`;
    document.getElementById('stubAirlineCode').innerText = t.airlineIATA || 'FLY';

    // Route points
    const depAirportClean = (t.depAirportName || '').replace(/^\?stanbul/i, 'Istanbul');
    const arrAirportClean = (t.arrAirportName || '').replace(/^\?stanbul/i, 'Istanbul');

    document.getElementById('ticketDepCity').innerText = (t.depCity || 'ORIGIN').toUpperCase();
    document.getElementById('ticketDepCode').innerText = t.depIATA || t.depICAO || 'DEP';
    document.getElementById('ticketDepAirport').innerText = depAirportClean;

    document.getElementById('ticketArrCity').innerText = (t.arrCity || 'DEST').toUpperCase();
    document.getElementById('ticketArrCode').innerText = t.arrIATA || t.arrICAO || 'ARR';
    document.getElementById('ticketArrAirport').innerText = arrAirportClean;

    // Flight Info & Duration
    document.getElementById('ticketFlightId').innerText = `FLIGHT #${t.flightId}`;
    document.getElementById('stubFlightNo').innerText = `#${t.flightId}`;

    const durEl = document.getElementById('ticketDuration');
    if (durEl) {
      durEl.innerText = `${this.calculateDuration(t.dep_datetime, t.arr_datetime)} • NON-STOP`;
    }
    const gateEl = document.getElementById('ticketGate');
    if (gateEl) {
      gateEl.innerText = `T${(t.flightId % 2) + 1} / Gate G${(t.flightId % 14) + 1}`;
    }

    const fullName = `${t.firstName || ''} ${t.lastName || ''}`.trim() || 'PASSENGER';
    document.getElementById('ticketPassenger').innerText = fullName.toUpperCase();
    document.getElementById('stubPassenger').innerText = fullName.toUpperCase();

    const depDate = t.dep_datetime ? t.dep_datetime.substring(0, 10) : '';
    const depTime = t.dep_datetime ? t.dep_datetime.substring(11, 16) : '';
    document.getElementById('ticketDate').innerText = depDate;
    document.getElementById('ticketDepTime').innerText = depTime;
    document.getElementById('stubDate').innerText = depDate;

    // Seat & Class
    const seatCode = `${t.seatColumn}${t.seatRow}`;
    document.getElementById('ticketSeat').innerText = seatCode;
    document.getElementById('stubSeat').innerText = seatCode;
    document.getElementById('ticketClass').innerText = (t.seatClass || 'Economy').toUpperCase();

    document.getElementById('stubFrom').innerText = t.depIATA || 'DEP';
    document.getElementById('stubTo').innerText = t.arrIATA || 'ARR';

    document.getElementById('ticketBarcodeNumber').innerText = `SK-${t.flightId}-${t.reservationId}-${t.seatId}-2026`;

    document.getElementById('modalBoardingPass').style.display = 'flex';
  },

  async openTicketById(reservationId) {
    try {
      const res = await fetch(`/api/reservations/ticket/${reservationId}`, { headers: this.getAuthHeaders() });
      const ticket = await res.json();
      this.renderBoardingPass(ticket);
    } catch (e) {
      this.showToast('Could not fetch ticket details', 'error');
    }
  },

  // -------------------------------------------------------------
  // MY BOOKINGS & SAVED TRIPS
  // -------------------------------------------------------------
  async loadMyBookings() {
    if (!this.state.user) {
      this.openAuthModal('login');
      return;
    }

    const container = document.getElementById('bookingsListContainer');
    if (!container) return;
    container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">Loading your reserved flights...</div>`;

    try {
      const res = await fetch(`/api/reservations/my?accountId=${this.state.user.id}`, {
        headers: this.getAuthHeaders()
      });
      if (res.status === 401) {
        this.setUser(null, null);
        this.navigate('auth');
        return;
      }
      const bookings = await res.json();
      this.state.userBookings = bookings;
      this.renderBookingsTab();
    } catch (e) {
      container.innerHTML = `<div style="color: #ef4444; padding: 20px;">Failed to load bookings.</div>`;
    }
  },

  switchBookingsTab(tab) {
    document.getElementById('tabUpcoming').classList.toggle('active', tab === 'upcoming');
    document.getElementById('tabPast').classList.toggle('active', tab === 'past');
    this.state.currentBookingsTab = tab;
    this.renderBookingsTab();
  },

  renderBookingsTab() {
    const container = document.getElementById('bookingsListContainer');
    const bookings = this.state.userBookings || [];
    const isUpcoming = (this.state.currentBookingsTab || 'upcoming') === 'upcoming';
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);

    const filtered = bookings.filter(b => {
      return isUpcoming ? (b.dep_datetime >= nowStr) : (b.dep_datetime < nowStr);
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="glassmorphism" style="padding: 48px; text-align: center;">
          <div style="font-size: 2.2rem; margin-bottom: 12px;">🎟️</div>
          <h3>No ${isUpcoming ? 'Upcoming' : 'Past'} Reservations Found</h3>
          <p style="color: var(--text-secondary); margin: 8px 0 20px 0;">
            ${isUpcoming ? 'You currently have no scheduled flights. Ready to explore new destinations?' : 'Your past flight history is empty.'}
          </p>
          ${isUpcoming ? `<button class="btn-primary" onclick="app.navigate('search')">Find & Book Flights</button>` : ''}
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(b => {
      const refOrId = b.bookingReference || b.reservationId;
      const isPending = b.status === 'PENDING_PAYMENT';
      const isConfirmed = b.status === 'CONFIRMED' || !b.status;
      const isExpired = b.status === 'EXPIRED';

      let statusBadge = '';
      if (isConfirmed) statusBadge = `<span class="badge-status-confirmed">✓ Confirmed</span>`;
      else if (isPending) statusBadge = `<span class="badge-status-pending">⏱️ Pending Payment (${Math.max(0, Math.floor((b.secondsRemaining || 900) / 60))}m left)</span>`;
      else if (isExpired) statusBadge = `<span class="badge-status-expired">✕ Expired</span>`;
      else statusBadge = `<span class="badge-status-cancelled">Cancelled</span>`;

      return `
        <div class="flight-card">
          <div class="flight-card-header">
            <div class="airline-badge">
              <img src="/api/airlines/${b.airlineId}/logo" class="airline-logo-img" alt="${b.airlineName}" onerror="this.src='/images/default_logo.png'">
              <div>
                <div class="airline-name">${b.airlineName}</div>
                <div class="flight-id-tag">REF: ${refOrId} • FLIGHT #${b.flightId}</div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              ${statusBadge}
              <span class="badge">${(b.seatClass || 'Economy').toUpperCase()} CLASS</span>
            </div>
          </div>

          <div class="flight-timeline">
            <div class="timeline-point">
              <div class="point-time">${b.dep_datetime.substring(11, 16)}</div>
              <div class="point-iata">${b.depIATA || 'DEP'}</div>
              <div class="point-city">${b.depCity}, ${b.depCountry}</div>
              <div style="font-size: 0.72rem; color: var(--text-muted);">${b.dep_datetime.substring(0, 10)}</div>
            </div>

            <div class="timeline-path">
              <span class="duration-text">${isPending ? 'Held Seat(s)' : 'Reserved Seat(s)'}</span>
              <div style="font-size: 1.25rem; font-weight: 800; color: ${isPending ? '#f59e0b' : '#10b981'};">
                ${b.seatNumbers || `${b.seatColumn || ''}${b.seatRow || ''}` || 'Selected'}
              </div>
              <span style="font-size: 0.75rem; color: var(--text-muted);">${b.nbr_luggages || 0} Bags • ${b.weight || 0}kg</span>
            </div>

            <div class="timeline-point text-right">
              <div class="point-time">${b.arr_datetime.substring(11, 16)}</div>
              <div class="point-iata">${b.arrIATA || 'ARR'}</div>
              <div class="point-city">${b.arrCity}, ${b.arrCountry}</div>
              <div style="font-size: 0.72rem; color: var(--text-muted);">${b.arr_datetime.substring(0, 10)}</div>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-subtle); padding-top: 14px;">
            <div>
              ${!isExpired ? `
                <button class="btn-text-link" style="color: #ef4444;" onclick="app.cancelBooking('${refOrId}')">
                  ${isPending ? 'Release Held Seats' : 'Cancel Booking'}
                </button>
              ` : `<span style="font-size: 0.8rem; color: var(--text-muted);">Hold timed out & released</span>`}
            </div>
            <div style="display: flex; gap: 10px;">
              ${isPending ? `
                <button class="btn-primary" onclick="app.resumePendingPaymentByRef('${refOrId}')">
                  <span>Complete Payment (15m window)</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                </button>
              ` : ''}
              ${isConfirmed ? `
                <button class="btn-primary" onclick="app.openTicketById('${refOrId}')">
                  <span>View Boarding Pass</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  resumePendingPaymentByRef(bookingRef) {
    fetch(`/api/bookings/${bookingRef}`)
      .then(res => res.json())
      .then(booking => {
        if (booking.status === 'PENDING_PAYMENT' && booking.secondsRemaining > 0) {
          this.state.activeBooking = {
            bookingReference: booking.booking_reference,
            flightId: booking.id_flight,
            expiresAt: booking.expires_at,
            totalAmount: booking.total_amount
          };
          this.startPaymentCountdown(booking.expires_at);
          document.getElementById('modalPayment').style.display = 'flex';
        } else {
          this.showToast('Reservation expired or already confirmed.', 'info');
          this.loadMyBookings();
        }
      });
  },

  async cancelBooking(refOrId) {
    if (!confirm('Are you sure you want to cancel this flight reservation? Any held seats will be released immediately.')) return;
    try {
      const accId = this.state.user ? this.state.user.id : 0;
      let res;
      if (String(refOrId).startsWith('BK-')) {
        res = await fetch('/api/bookings/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingReference: refOrId, accountId: accId })
        });
      } else {
        res = await fetch(`/api/reservations/${refOrId}?accountId=${accId}`, { method: 'DELETE', headers: this.getAuthHeaders() });
      }

      const data = await res.json();
      if (!res.ok) {
        this.showToast(data.error || 'Failed to cancel', 'error');
        return;
      }

      this.showToast('Reservation cancelled and seats released successfully', 'info');
      this.loadMyBookings();
      this.refreshBookingsBadge();
    } catch (e) {
      this.showToast('Failed to cancel reservation', 'error');
    }
  },

  async refreshBookingsBadge() {
    if (!this.state.user || this.state.user.role === 'airline') {
      const b = document.getElementById('bookingsCountBadge');
      if (b) b.style.display = 'none';
      return;
    }

    try {
      const res = await fetch(`/api/reservations/my?accountId=${this.state.user.id}`, {
        headers: this.getAuthHeaders()
      });
      if (res.status === 401) {
        this.setUser(null, null);
        this.navigate('auth');
        return;
      }
      const bookings = await res.json();
      const badge = document.getElementById('bookingsCountBadge');
      if (badge) {
        if (bookings.length > 0) {
          badge.innerText = bookings.length;
          badge.style.display = 'inline-flex';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch (e) { }
  },

  async checkActiveTrips() {
    const banner = document.getElementById('activeTripBanner');
    if (!banner) return;
    if (!this.state.user || this.state.user.role === 'airline') {
      banner.style.display = 'none';
      return;
    }

    try {
      const res = await fetch(`/api/reservations/my?accountId=${this.state.user.id}`, {
        headers: this.getAuthHeaders()
      });
      if (res.status === 401) {
        this.setUser(null, null);
        this.navigate('auth');
        return;
      }
      const bookings = await res.json();
      if (!bookings || bookings.length === 0) {
        banner.style.display = 'none';
        return;
      }

      const nextTrip = bookings[0];
      banner.style.display = 'block';
      banner.innerHTML = `
        <div class="active-trip-card">
          <div class="active-trip-left">
            <div class="active-trip-icon">✈️</div>
            <div>
              <span class="active-trip-badge">Upcoming Confirmed Trip</span>
              <div class="active-trip-route">${nextTrip.depCity} (${nextTrip.depIATA}) ➔ ${nextTrip.arrCity} (${nextTrip.arrIATA})</div>
              <div class="active-trip-meta">Flight #${nextTrip.flightId} • ${nextTrip.airlineName} • Seat ${nextTrip.seatColumn}${nextTrip.seatRow} • Departs: ${nextTrip.dep_datetime}</div>
            </div>
          </div>
          <button class="btn-primary" onclick="app.openTicketById(${nextTrip.reservationId})">
            <span>View Boarding Pass</span>
          </button>
        </div>
      `;
    } catch (e) {
      banner.style.display = 'none';
    }
  },

  // -------------------------------------------------------------
  // FAVORITE FLIGHTS VIEW
  // -------------------------------------------------------------
  async loadMyFavorites() {
    if (!this.state.user) {
      this.openAuthModal('login');
      return;
    }

    const container = document.getElementById('favoritesListContainer');
    if (!container) return;
    container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">Loading favorite flights...</div>`;

    try {
      const res = await fetch(`/api/favorites?accountId=${this.state.user.id}`, { headers: this.getAuthHeaders() });
      const flights = await res.json();

      if (!flights || flights.length === 0) {
        container.innerHTML = `
          <div class="glassmorphism" style="padding: 48px; text-align: center;">
            <div style="font-size: 2.2rem; margin-bottom: 12px;">❤️</div>
            <h3>No Favorite Flights Saved Yet</h3>
            <p style="color: var(--text-secondary); margin: 8px 0 20px 0;">
              Click the heart icon on any flight in the search results to bookmark it here for quick access.
            </p>
            <button class="btn-primary" onclick="app.navigate('search')">Browse Flights</button>
          </div>
        `;
        return;
      }

      container.innerHTML = flights.map(f => this.renderFlightCard(f)).join('');
    } catch (e) {
      container.innerHTML = '<div style="color: #ef4444; padding: 20px;">Failed to load favorites.</div>';
    }
  },

  // -------------------------------------------------------------
  // AIRLINE DASHBOARD (AIRLINE ADMIN PORTAL)
  // -------------------------------------------------------------
  async loadAirlineDashboard() {
    const u = this.state.user;
    const roleUpper = (u?.role || '').toUpperCase();
    if (!u || (roleUpper !== 'AIRLINE_ADMIN' && roleUpper !== 'AIRLINE') || !u.id_airline) {
      this.showToast('Please sign in with an Airline Admin account to access this portal', 'info');
      this.navigate('auth');
      return;
    }

    const airlineId = u.id_airline;

    // Header Badge
    document.getElementById('dashboardAirlineLogo').src = `/api/airlines/${airlineId}/logo`;
    document.getElementById('dashboardAirlineName').innerText = u.displayName || u.airline?.name || 'Airline Portal';
    document.getElementById('dashboardAirlineIATA').innerText = `Fleet Code: ${u.airline?.IATA || 'AL'}`;

    try {
      const [statsRes, flightsRes, airportsRes] = await Promise.all([
        fetch(`/api/airline/stats?airlineId=${airlineId}`, { headers: this.getAuthHeaders() }),
        fetch(`/api/airline/flights?airlineId=${airlineId}`, { headers: this.getAuthHeaders() }),
        fetch(`/api/airports/search?q=`)
      ]);

      if (statsRes.status === 401 || flightsRes.status === 401) {
        this.setUser(null, null);
        this.navigate('auth');
        return;
      }

      const stats = await statsRes.json();
      const flights = await flightsRes.json();
      this.state.airlineAirportsCache = await airportsRes.json();

      // Render KPI cards
      document.getElementById('kpiTotalFlights').innerText = stats.totalFlights || (Array.isArray(flights) ? flights.length : 0);
      document.getElementById('kpiTotalBookings').innerText = stats.totalBookings || 0;
      document.getElementById('kpiTotalRevenue').innerText = this.formatCurrency(stats.totalRevenue || 0);
      const occupancy = stats.totalFlights > 0 ? Math.round(((stats.totalBookings || 0) / (stats.totalFlights * 120)) * 100) : 0;
      document.getElementById('kpiOccupancy').innerText = `${occupancy}%`;

      // Render Table
      this.state.airlineFlightsCache = Array.isArray(flights) ? flights : [];
      this.renderAirlineFlightsTable(this.state.airlineFlightsCache);
    } catch (e) {
      console.error(e);
      this.showToast('Failed to load dashboard metrics', 'error');
    }
  },

  renderAirlineFlightsTable(flights) {
    const tbody = document.getElementById('airlineFlightsTableBody');
    if (!tbody) return;

    if (!flights || flights.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 24px;">No flights currently scheduled for this airline.</td></tr>`;
      return;
    }

    tbody.innerHTML = flights.map(f => `
      <tr>
        <td><strong>#${f.id}</strong></td>
        <td>
          <div style="font-weight: 700;">${f.depCity} (${f.depIATA || f.depAirport})</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${f.depAirportName || ''}</div>
        </td>
        <td>
          <div style="font-weight: 700;">${f.arrCity} (${f.arrIATA || f.arrAirport})</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${f.arrAirportName || ''}</div>
        </td>
        <td>${f.dep_datetime}</td>
        <td>${f.arr_datetime}</td>
        <td>${this.formatCurrency(f.economy_price)}</td>
        <td>${this.formatCurrency(f.business_price)}</td>
        <td>${this.formatCurrency(f.first_price)}</td>
        <td>
          <span class="badge">${f.bookedCount || 0} / 120</span>
        </td>
        <td>
          <button class="table-action-btn edit" onclick="app.openEditFlightModal(${f.id})">Edit</button>
          <button class="table-action-btn delete" onclick="app.deleteAirlineFlight(${f.id})">Delete</button>
        </td>
      </tr>
    `).join('');
  },

  filterDashboardTable(keyword) {
    const k = keyword.toLowerCase();
    const flights = this.state.airlineFlightsCache || [];
    const filtered = flights.filter(f => {
      return (f.depCity && f.depCity.toLowerCase().includes(k)) ||
        (f.arrCity && f.arrCity.toLowerCase().includes(k)) ||
        (f.depIATA && f.depIATA.toLowerCase().includes(k)) ||
        (f.arrIATA && f.arrIATA.toLowerCase().includes(k)) ||
        String(f.id).includes(k);
    });
    this.renderAirlineFlightsTable(filtered);
  },

  switchDashTab(tab) {
    document.querySelectorAll('.dash-tab-btn').forEach(b => {
      b.classList.toggle('active', b.id === (tab === 'flights' ? 'btnDashTabFlights' : 'btnDashTabBookings'));
    });
    const flightsP = document.getElementById('dashFlightsPanel');
    const bookingsP = document.getElementById('dashBookingsPanel');
    if (flightsP) flightsP.style.display = tab === 'flights' ? 'block' : 'none';
    if (bookingsP) bookingsP.style.display = tab === 'bookings' ? 'block' : 'none';

    if (tab === 'bookings') {
      this.loadAdminBookings();
    }
  },

  async loadAdminBookings(status = null, search = null) {
    if (status !== null) this.state.adminBookingStatusFilter = status;
    if (search !== null) this.state.adminBookingSearchKeyword = search;

    const currentStatus = this.state.adminBookingStatusFilter || 'all';
    const currentSearch = this.state.adminBookingSearchKeyword || '';

    const tbody = document.getElementById('adminBookingsTableBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 24px; color: var(--text-muted);">Loading bookings and live holds...</td></tr>`;

    try {
      const res = await fetch(`/api/admin/all-bookings?status=${currentStatus}&search=${encodeURIComponent(currentSearch)}`, {
        headers: this.getAuthHeaders()
      });
      if (res.status === 401) {
        this.setUser(null, null);
        this.navigate('auth');
        return;
      }
      if (res.status === 403) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 24px; color: #ef4444;">Access restricted: Airline Administrator privileges required.</td></tr>`;
        return;
      }
      const data = await res.json();

      if (!data || !data.bookings || data.bookings.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 24px; color: var(--text-muted);">No bookings found matching filter.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.bookings.map(b => {
        let statusBadge = '';
        if (b.status === 'CONFIRMED') {
          statusBadge = `<span class="badge-status-confirmed">✓ Confirmed</span>`;
        } else if (b.status === 'PENDING_PAYMENT') {
          const mins = Math.floor(b.secondsRemaining / 60);
          const secs = b.secondsRemaining % 60;
          const timeText = b.secondsRemaining > 0 ? `${mins}:${secs < 10 ? '0' : ''}${secs} left` : 'Expiring';
          statusBadge = `<span class="badge-status-pending">⏱️ Held (${timeText})</span>`;
        } else if (b.status === 'EXPIRED') {
          statusBadge = `<span class="badge-status-expired">✕ Expired</span>`;
        } else {
          statusBadge = `<span class="badge-status-cancelled">Cancelled</span>`;
        }

        const customerName = `${b.firstName || ''} ${b.lastName || ''}`.trim() || b.username;
        const routeText = `${b.depCity} ➔ ${b.arrCity} (#${b.id_flight})`;
        const seatText = b.seatNumbers || '-';
        const createdText = b.created_at ? b.created_at.substring(0, 16).replace('T', ' ') : '-';
        const expiryOrPaid = b.status === 'CONFIRMED'
          ? (b.paid_at ? b.paid_at.substring(0, 16).replace('T', ' ') : 'Paid')
          : (b.expires_at ? b.expires_at.substring(0, 16).replace('T', ' ') : '-');

        let actions = '';
        if (b.status === 'CONFIRMED') {
          actions = `<button class="btn-text-link" onclick="app.openTicketById('${b.booking_reference}')">View Ticket</button>`;
        } else if (b.status === 'PENDING_PAYMENT') {
          actions = `<button class="btn-text-link" style="color: #ef4444;" onclick="app.cancelAdminHold('${b.booking_reference}')">Release Hold</button>`;
        } else {
          actions = `<span style="color: var(--text-muted); font-size: 0.75rem;">Released</span>`;
        }

        return `
          <tr>
            <td style="font-weight: 700; font-family: monospace;">${b.booking_reference}</td>
            <td>
              <div style="font-weight: 600;">${customerName}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${b.emailAddress || ''}</div>
            </td>
            <td>${routeText}</td>
            <td style="font-weight: 700; color: var(--accent-primary);">${seatText}</td>
            <td style="font-weight: 700;">${this.formatCurrency(b.total_amount)}</td>
            <td>${statusBadge}</td>
            <td style="font-size: 0.75rem; color: var(--text-secondary);">${createdText}</td>
            <td style="font-size: 0.75rem; color: var(--text-secondary);">${expiryOrPaid}</td>
            <td>${actions}</td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #ef4444; padding: 20px;">Failed to load bookings.</td></tr>`;
    }
  },

  filterAdminBookingStatus(status) {
    document.querySelectorAll('.status-filter-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.status === status);
    });
    this.loadAdminBookings(status, null);
  },

  filterAdminBookings(val) {
    clearTimeout(this.adminSearchTimeout);
    this.adminSearchTimeout = setTimeout(() => {
      this.loadAdminBookings(null, val);
    }, 300);
  },

  async cancelAdminHold(bookingRef) {
    if (!confirm(`Are you sure you want to release the held seats for booking ${bookingRef}?`)) return;
    try {
      const res = await fetch('/api/bookings/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingReference: bookingRef })
      });
      const data = await res.json();
      if (!res.ok) {
        this.showToast(data.error || 'Failed to release hold', 'error');
        return;
      }
      this.showToast('Hold cancelled and seats released.', 'info');
      this.loadAdminBookings();
    } catch (e) {
      this.showToast('Error releasing hold', 'error');
    }
  },

  async openNewFlightModal() {
    document.getElementById('adminFlightModalTitle').innerText = 'Add Scheduled Flight';
    document.getElementById('adminFlightId').value = '';
    document.getElementById('btnAdminFlightSubmit').innerText = 'Add Flight Schedule';

    await this.populateAirportSelects();
    document.getElementById('modalFlightAdmin').style.display = 'flex';
  },

  async openEditFlightModal(flightId) {
    const f = (this.state.airlineFlightsCache || []).find(item => item.id === flightId);
    if (!f) return;

    document.getElementById('adminFlightModalTitle').innerText = `Edit Flight #${f.id}`;
    document.getElementById('adminFlightId').value = f.id;
    document.getElementById('btnAdminFlightSubmit').innerText = 'Save Changes';

    await this.populateAirportSelects(f.dep_airport, f.arr_airport);
    document.getElementById('adminDepTime').value = f.dep_datetime ? f.dep_datetime.replace(' ', 'T') : '';
    document.getElementById('adminArrTime').value = f.arr_datetime ? f.arr_datetime.replace(' ', 'T') : '';
    document.getElementById('adminEcoPrice').value = Math.round(f.economy_price);
    document.getElementById('adminBizPrice').value = Math.round(f.business_price);
    document.getElementById('adminFirstPrice').value = Math.round(f.first_price);
    document.getElementById('adminLuggagePrice').value = Math.round(f.luggage_price || 30);
    document.getElementById('adminWeightPrice').value = Math.round(f.weight_price || 10);

    document.getElementById('modalFlightAdmin').style.display = 'flex';
  },

  async populateAirportSelects(selectedDep, selectedArr) {
    const depSel = document.getElementById('adminDepAirport');
    const arrSel = document.getElementById('adminArrAirport');

    if (!this.state.allAirportsLoaded) {
      try {
        const res = await fetch('/api/airports/all');
        const allAirports = await res.json();
        if (allAirports && allAirports.length > 0) {
          this.state.airportsCache = allAirports;
          this.state.allAirportsLoaded = true;
        }
      } catch (e) { }
    }

    const airports = this.state.airportsCache || [];

    const options = airports.map(a => `<option value="${a.id}">${a.city} (${a.IATA || a.ICAO}) - ${a.name}</option>`).join('');
    depSel.innerHTML = options;
    arrSel.innerHTML = options;

    if (selectedDep) depSel.value = selectedDep;
    if (selectedArr) arrSel.value = selectedArr;
  },

  async submitAdminFlight(e) {
    e.preventDefault();
    const flightId = document.getElementById('adminFlightId').value;
    const isEdit = Boolean(flightId);
    const u = this.state.user;
    if (!u || !u.id_airline) return;

    const payload = {
      airlineId: u.id_airline,
      depAirport: document.getElementById('adminDepAirport').value,
      arrAirport: document.getElementById('adminArrAirport').value,
      depDatetime: document.getElementById('adminDepTime').value,
      arrDatetime: document.getElementById('adminArrTime').value,
      economyPrice: document.getElementById('adminEcoPrice').value,
      businessPrice: document.getElementById('adminBizPrice').value,
      firstPrice: document.getElementById('adminFirstPrice').value,
      luggagePrice: document.getElementById('adminLuggagePrice').value,
      weightPrice: document.getElementById('adminWeightPrice').value
    };

    try {
      const url = isEdit ? `/api/airline/flights/${flightId}` : `/api/airline/flights`;
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        this.showToast(data.error || 'Failed to save flight', 'error');
        return;
      }

      this.closeModal('modalFlightAdmin');
      this.showToast(isEdit ? 'Flight schedule updated' : 'New flight successfully scheduled!', 'success');
      this.loadAirlineDashboard();
    } catch (err) {
      this.showToast('Server error while saving flight', 'error');
    }
  },

  async deleteAirlineFlight(flightId) {
    if (!confirm(`Are you sure you want to cancel and remove Flight #${flightId}? All linked reservations will be deleted.`)) return;

    try {
      const res = await fetch(`/api/airline/flights/${flightId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        this.showToast(data.error || 'Failed to delete', 'error');
        return;
      }

      this.showToast('Flight removed successfully', 'info');
      this.loadAirlineDashboard();
    } catch (e) {
      this.showToast('Error removing flight', 'error');
    }
  },

  // -------------------------------------------------------------
  // ACCOUNT & PROFILE SETTINGS
  // -------------------------------------------------------------
  async loadAccountInfo() {
    if (!this.state.user) {
      this.openAuthModal('login');
      return;
    }

    try {
      const res = await fetch(`/api/profile?accountId=${this.state.user.id}`, { headers: this.getAuthHeaders() });
      const data = await res.json();

      document.getElementById('accountProfileName').innerText = `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.username;
      document.getElementById('accountProfileEmail').innerText = data.emailAddress || '';

      document.getElementById('profFirstName').value = data.firstName || '';
      document.getElementById('profLastName').value = data.lastName || '';
      document.getElementById('profEmail').value = data.emailAddress || '';
      document.getElementById('profBirthDate').value = data.birthDate || '';
      document.getElementById('profGender').value = data.gender || 'M';
      if (data.country) document.getElementById('profCountry').value = data.country;

      this.loadSavedCards();
    } catch (e) {
      console.error(e);
    }
  },

  switchAccountTab(tab) {
    document.querySelectorAll('.account-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.getElementById('tabContentInfo').style.display = tab === 'info' ? 'block' : 'none';
    document.getElementById('tabContentCards').style.display = tab === 'cards' ? 'block' : 'none';
    document.getElementById('tabContentSecurity').style.display = tab === 'security' ? 'block' : 'none';
  },

  async savePersonalInfo(e) {
    e.preventDefault();
    if (!this.state.user) return;

    const payload = {
      accountId: this.state.user.id,
      firstName: document.getElementById('profFirstName').value.trim(),
      lastName: document.getElementById('profLastName').value.trim(),
      email: document.getElementById('profEmail').value.trim(),
      birthDate: document.getElementById('profBirthDate').value,
      gender: document.getElementById('profGender').value,
      country: document.getElementById('profCountry').value
    };

    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        this.showToast(data.error || 'Failed to update profile', 'error');
        return;
      }

      this.showToast('Profile information saved successfully', 'success');
      if (data.user) {
        this.setUser(data.user);
      }
      this.loadAccountInfo();
    } catch (err) {
      this.showToast('Server update error', 'error');
    }
  },

  async changePassword(e) {
    e.preventDefault();
    const oldP = document.getElementById('secCurrentPassword').value;
    const newP = document.getElementById('secNewPassword').value;
    const confP = document.getElementById('secConfirmPassword').value;

    if (newP !== confP) {
      this.showToast('New passwords do not match', 'error');
      return;
    }

    try {
      const res = await fetch('/api/profile/password', {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ accountId: this.state.user.id, oldPassword: oldP, newPassword: newP })
      });
      const data = await res.json();
      if (!res.ok) {
        this.showToast(data.error || 'Password update failed', 'error');
        return;
      }

      this.showToast('Password changed successfully!', 'success');
      document.getElementById('secCurrentPassword').value = '';
      document.getElementById('secNewPassword').value = '';
      document.getElementById('secConfirmPassword').value = '';
    } catch (err) {
      this.showToast('Error changing password', 'error');
    }
  },

  // -------------------------------------------------------------
  // CREDIT CARDS
  // -------------------------------------------------------------
  async loadSavedCards() {
    if (!this.state.user) return;
    const grid = document.getElementById('savedCardsGrid');
    if (!grid) return;

    try {
      const res = await fetch(`/api/cards?accountId=${this.state.user.id}`, { headers: this.getAuthHeaders() });
      const cards = await res.json();

      if (!cards || cards.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1/-1; padding: 24px; color: var(--text-muted);">No credit cards saved yet.</div>`;
        return;
      }

      grid.innerHTML = cards.map(c => `
        <div class="credit-card-ui">
          <button class="btn-delete-card" onclick="app.deleteCard(${c.id})" title="Delete Card">&times;</button>
          <div class="credit-card-top">
            <div class="card-chip"></div>
            <span class="card-brand-label">FLY PAY</span>
          </div>
          <div class="card-num-display">•••• •••• •••• ${c.cardNumber.slice(-4)}</div>
          <div class="credit-card-bottom">
            <span class="card-holder-name">${c.cardHolder}</span>
            <span class="card-expiry-val">${c.expirationDate}</span>
          </div>
        </div>
      `).join('');
    } catch (e) {
      console.error(e);
    }
  },

  openAddCardModal() {
    if (!this.state.user) {
      this.openAuthModal('login');
      return;
    }
    document.getElementById('modalAddCard').style.display = 'flex';
  },

  formatCardInput(inp) {
    let v = inp.value.replace(/\D/g, '').substring(0, 16);
    let formatted = v.match(/.{1,4}/g)?.join(' ') || v;
    inp.value = formatted;
    document.getElementById('cardNumPreview').innerText = formatted || '•••• •••• •••• ••••';
  },

  formatExpiryPreview(val) {
    document.getElementById('cardExpiryPreview').innerText = val ? val.substring(2, 7) : 'MM/YY';
  },

  async submitAddCard(e) {
    e.preventDefault();
    if (!this.state.user) return;

    const payload = {
      accountId: this.state.user.id,
      cardHolder: document.getElementById('newCardHolder').value.trim(),
      cardNumber: document.getElementById('newCardNumber').value.replace(/\s+/g, ''),
      expirationDate: document.getElementById('newCardExpiry').value,
      CVV: document.getElementById('newCardCVV').value.trim()
    };

    try {
      const res = await fetch('/api/cards', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        this.showToast(data.error || 'Failed to save card', 'error');
        return;
      }

      this.closeModal('modalAddCard');
      this.showToast('Credit card saved successfully!', 'success');
      this.loadSavedCards();

      // If in payment checkout, refresh checkout cards list
      if (document.getElementById('modalPayment').style.display === 'flex') {
        this.proceedToPayment();
      }
    } catch (err) {
      this.showToast('Card submission error', 'error');
    }
  },

  async deleteCard(cardId) {
    if (!confirm('Are you sure you want to remove this card?')) return;
    try {
      await fetch(`/api/cards/${cardId}?accountId=${this.state.user.id}`, { method: 'DELETE', headers: this.getAuthHeaders() });
      this.showToast('Card removed', 'info');
      this.loadSavedCards();
    } catch (e) {
      this.showToast('Failed to delete card', 'error');
    }
  },

  // -------------------------------------------------------------
  // MODAL UTILITIES
  // -------------------------------------------------------------
  closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'none';
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    toast.innerHTML = `<span style="font-size: 1.1rem;">${icon}</span><span>${message}</span>`;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
};

// Start application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
