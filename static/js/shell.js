/**
 * FLY AVIATION - SHARED SITE SHELL JAVASCRIPT
 * Handles:
 * 1. Fully accessible mobile navigation drawer (keyboard trap, Escape key, aria-expanded)
 * 2. Theme switching (light / dark) persisted in localStorage
 * 3. Client auth state synchronization for navigation header and drawer
 */

(function() {
  'use strict';

  // -------------------------------------------------------------
  // 1. THEME INITIALIZATION & TOGGLE
  // -------------------------------------------------------------
  function initTheme() {
    const savedTheme = localStorage.getItem('fly_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);

    const themeToggleBtn = document.getElementById('themeToggleBtn');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', nextTheme);
        localStorage.setItem('fly_theme', nextTheme);
      });
    }
  }

  // -------------------------------------------------------------
  // 2. ACCESSIBLE MOBILE NAVIGATION DRAWER
  // -------------------------------------------------------------
  function initMobileDrawer() {
    const toggleBtn = document.getElementById('mobileMenuToggle');
    const drawer = document.getElementById('mobileNavDrawer');
    const overlay = document.getElementById('mobileNavOverlay');
    const closeBtn = document.getElementById('mobileNavClose');

    if (!toggleBtn || !drawer || !overlay) return;

    let previouslyFocusedElement = null;

    function openDrawer() {
      previouslyFocusedElement = document.activeElement;
      drawer.classList.add('is-open');
      overlay.classList.add('is-open');
      toggleBtn.setAttribute('aria-expanded', 'true');
      drawer.setAttribute('aria-hidden', 'false');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';

      // Focus first actionable element inside drawer
      const focusable = drawer.querySelectorAll('button, a, input, [tabindex="0"]');
      if (focusable.length > 0) {
        setTimeout(() => focusable[0].focus(), 50);
      }
    }

    function closeDrawer() {
      drawer.classList.remove('is-open');
      overlay.classList.remove('is-open');
      toggleBtn.setAttribute('aria-expanded', 'false');
      drawer.setAttribute('aria-hidden', 'true');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';

      if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === 'function') {
        previouslyFocusedElement.focus();
      }
    }

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = drawer.classList.contains('is-open');
      if (isOpen) {
        closeDrawer();
      } else {
        openDrawer();
      }
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', closeDrawer);
    }

    overlay.addEventListener('click', closeDrawer);

    // Keyboard Accessibility: Escape key and Focus Trap
    document.addEventListener('keydown', (e) => {
      if (!drawer.classList.contains('is-open')) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        closeDrawer();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = Array.from(drawer.querySelectorAll('button, a, input, [tabindex="0"]'))
          .filter(el => !el.disabled && el.offsetParent !== null);
        
        if (focusable.length === 0) return;

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (e.shiftKey) {
          // Shift + Tab: if on first element, wrap to last
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          // Tab: if on last element, wrap to first
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    });
  }

  // -------------------------------------------------------------
  // 3. AUTH STATE SYNCHRONIZATION
  // -------------------------------------------------------------
  function syncAuthState() {
    const token = localStorage.getItem('fly_token');
    let user = null;
    try {
      user = JSON.parse(localStorage.getItem('fly_user') || 'null');
    } catch (_) {}

    const authArea = document.getElementById('authArea');
    const mobileNavAuth = document.getElementById('mobileNavAuth');

    if (token && user) {
      const displayName = user.displayName || user.username || 'Traveler';
      const userHtml = `
        <div class="user-menu-wrapper" style="position: relative;">
          <button class="user-profile-pill" id="userMenuTrigger" type="button" aria-haspopup="true" aria-expanded="false" onclick="this.nextElementSibling.classList.toggle('show')">
            <span style="font-size: 1.1rem;">👤</span>
            <div class="user-pill-info">
              <span class="user-pill-name">${displayName}</span>
              <span class="user-pill-role">${user.role || 'Passenger'}</span>
            </div>
            <span style="font-size: 0.75rem; margin-left: 4px;">▾</span>
          </button>
          <div class="user-dropdown-menu">
            <a href="/my-bookings" class="dropdown-item">
              <span>🎟️ My Bookings</span>
            </a>
            <a href="/profile" class="dropdown-item">
              <span>👤 Profile & Settings</span>
            </a>
            <div class="dropdown-divider"></div>
            <button type="button" class="dropdown-item danger" onclick="window.flyLogout()">
              <span>🚪 Sign Out</span>
            </button>
          </div>
        </div>
      `;

      if (authArea) authArea.innerHTML = userHtml;

      if (mobileNavAuth) {
        mobileNavAuth.innerHTML = `
          <div style="background: var(--bg-surface-elevated); padding: 12px; border-radius: var(--radius-md); margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <strong style="display: block; font-size: 0.95rem;">${displayName}</strong>
              <span style="font-size: 0.78rem; color: var(--text-muted);">${user.email || user.username}</span>
            </div>
            <button type="button" class="btn-secondary-sm" onclick="window.flyLogout()">Sign Out</button>
          </div>
        `;
      }
    }
  }

  window.flyLogout = function() {
    localStorage.removeItem('fly_token');
    localStorage.removeItem('fly_user');
    window.location.href = '/login';
  };

  // Close open dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.user-menu-wrapper')) {
      const menus = document.querySelectorAll('.user-dropdown-menu.show');
      menus.forEach(m => m.classList.remove('show'));
    }
  });

  // DOMContentLoaded initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initTheme();
      initMobileDrawer();
      syncAuthState();
    });
  } else {
    initTheme();
    initMobileDrawer();
    syncAuthState();
  }
})();
