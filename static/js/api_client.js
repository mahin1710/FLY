/* ==========================================================================
   FLY — Centralized API Client & Auth Session Store
   ========================================================================== */
(function (global) {
  'use strict';

  const TOKEN_KEY = 'fly_token';
  const USER_KEY = 'fly_user';

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function setSession(token, user) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      if (user) {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        localStorage.setItem('username', user.username || '');
        localStorage.setItem('userId', String(user.id || ''));
        localStorage.setItem('role', user.role || 'PASSENGER');
      }
    } catch (_) {}
    if (typeof global.syncAuthState === 'function') {
      global.syncAuthState();
    }
    global.dispatchEvent(new CustomEvent('fly:auth-changed', { detail: { user } }));
  }

  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem('username');
      localStorage.removeItem('userId');
      localStorage.removeItem('role');
    } catch (_) {}
    if (typeof global.syncAuthState === 'function') {
      global.syncAuthState();
    }
    global.dispatchEvent(new CustomEvent('fly:auth-changed', { detail: { user: null } }));
  }

  async function request(url, options) {
    const opts = Object.assign({ method: 'GET', credentials: 'same-origin' }, options || {});
    const headers = Object.assign({}, opts.headers || {});
    const token = getToken();
    if (token && !headers.Authorization) {
      headers.Authorization = 'Bearer ' + token;
    }
    if (opts.body !== undefined && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    opts.headers = headers;

    const response = await fetch(url, opts);
    const contentType = response.headers.get('content-type') || '';
    let data = null;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = { text: await response.text() };
    }

    if (!response.ok) {
      const err = new Error((data && (data.error || data.message)) || ('Request failed (' + response.status + ')'));
      err.status = response.status;
      err.code = data && data.code;
      err.data = data;
      if (response.status === 401 && url !== '/api/auth/login' && url !== '/api/auth/register') {
        clearSession();
      }
      throw err;
    }
    return data;
  }

  async function refreshUser() {
    if (!getToken()) {
      // Try HttpOnly cookie check silently
      try {
        const me = await request('/api/auth/me');
        if (me && me.user) {
          setSession(getToken(), me.user);
          return me.user;
        }
      } catch (_) {
        return null;
      }
    }
    try {
      const res = await request('/api/auth/me');
      if (res && res.user) {
        setSession(getToken(), res.user);
        return res.user;
      }
    } catch (_) {
      clearSession();
    }
    return null;
  }

  function formatBDT(amount) {
    const val = Number(amount || 0);
    return 'BDT ' + Math.round(val).toLocaleString('en-US');
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function updateRoleNavVisibility() {
    const user = getUser();
    const role = String((user && user.role) || '').toUpperCase();
    const isAdmin = role === 'AIRLINE_ADMIN' || role === 'SYSTEM_ADMIN' || role === 'SUPER_ADMIN';
    document.querySelectorAll('[data-route="admin"], a.mobile-nav-link[href="/admin"]').forEach(function (el) {
      el.style.display = isAdmin ? '' : 'none';
    });
  }

  document.addEventListener('DOMContentLoaded', updateRoleNavVisibility);
  global.addEventListener('fly:auth-changed', updateRoleNavVisibility);

  global.FlyApi = {
    request: request,
    get: function (url) { return request(url, { method: 'GET' }); },
    post: function (url, body) { return request(url, { method: 'POST', body: body }); },
    put: function (url, body) { return request(url, { method: 'PUT', body: body }); },
    del: function (url) { return request(url, { method: 'DELETE' }); },
    getToken: getToken,
    getUser: getUser,
    setSession: setSession,
    clearSession: clearSession,
    refreshUser: refreshUser,
    formatBDT: formatBDT,
    escapeHtml: escapeHtml,
    updateRoleNavVisibility: updateRoleNavVisibility
  };
})(window);
