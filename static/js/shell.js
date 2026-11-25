/**
 * FLY AVIATION - SHARED SITE SHELL JAVASCRIPT
 * Handles:
 * 1. Immediate theme initialization and left-side toggle with status label
 * 2. Left-side Account & Profile dropdown menu with full keyboard & outside-click accessibility
 * 3. Mobile navigation drawer with focus trap & Escape key support
 * 4. Auth state synchronization across header, account dropdown, and mobile drawer
 * 5. Secure server-side and client-side logout flow
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
    const themeLabel = document.getElementById('themeToggleLabel');

    function updateLabel(theme) {
      if (themeLabel) {
        themeLabel.textContent = theme === 'dark' ? 'Dark' : 'Light';
      }
    }

    updateLabel(savedTheme);

    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', nextTheme);
        localStorage.setItem('fly_theme', nextTheme);
        updateLabel(nextTheme);
      });
    }
  }

  // -------------------------------------------------------------
  // 2. LEFT-SIDE ACCOUNT DROPDOWN MENU
  // -------------------------------------------------------------
  function initHeaderAccountDropdown() {
    const triggerBtn = document.getElementById('accountTriggerBtn');
    const dropdown = document.getElementById('headerAccountDropdown');

    if (!triggerBtn || !dropdown) return;

    function openDropdown() {
      dropdown.classList.add('is-open');
      triggerBtn.setAttribute('aria-expanded', 'true');
    }

    function closeDropdown() {
      dropdown.classList.remove('is-open');
      triggerBtn.setAttribute('aria-expanded', 'false');
    }

    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('is-open');
      if (isOpen) {
        closeDropdown();
      } else {
        openDropdown();
      }
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && !triggerBtn.contains(e.target)) {
        closeDropdown();
      }
    });

    // Keyboard support: Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dropdown.classList.contains('is-open')) {
        closeDropdown();
        triggerBtn.focus();
      }
    });
  }

  // -------------------------------------------------------------
  // 3. ACCESSIBLE MOBILE NAVIGATION DRAWER
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
  // 4. AUTH STATE SYNCHRONIZATION
  // -------------------------------------------------------------
  function syncAuthState() {
    const token = localStorage.getItem('fly_token');
    let user = null;
    try {
      user = JSON.parse(localStorage.getItem('fly_user') || 'null');
    } catch (_) {}

    const accountTriggerLabel = document.getElementById('accountTriggerLabel');
    const dropdownUserName = document.getElementById('dropdownUserName');
    const dropdownUserSub = document.getElementById('dropdownUserSub');
    const dropdownAvatarBadge = document.getElementById('dropdownAvatarBadge');
    const dropdownLoginLink = document.getElementById('dropdownLoginLink');
    const dropdownLogoutBtn = document.getElementById('dropdownLogoutBtn');
    const dropdownAuthDivider = document.getElementById('dropdownAuthDivider');
    const mobileNavAuth = document.getElementById('mobileNavAuth');

    if (token && user) {
      const displayName = user.displayName || user.username || 'Traveler';
      const emailOrRole = user.email || (user.role ? (user.role.charAt(0).toUpperCase() + user.role.slice(1)) : 'Member');
      const initial = displayName.charAt(0).toUpperCase();

      if (accountTriggerLabel) accountTriggerLabel.textContent = displayName.split(' ')[0];
      if (dropdownUserName) dropdownUserName.textContent = displayName;
      if (dropdownUserSub) dropdownUserSub.textContent = emailOrRole;
      if (dropdownAvatarBadge) dropdownAvatarBadge.textContent = initial || '✈️';
      if (dropdownLoginLink) dropdownLoginLink.style.display = 'none';
      if (dropdownLogoutBtn) dropdownLogoutBtn.style.display = 'flex';
      if (dropdownAuthDivider) dropdownAuthDivider.style.display = 'block';

      if (mobileNavAuth) {
        mobileNavAuth.innerHTML = `
          <div style="background: var(--bg-surface-elevated); padding: 12px; border-radius: var(--radius-md); margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <strong style="display: block; font-size: 0.95rem; color: var(--text-main);">${displayName}</strong>
              <span style="font-size: 0.78rem; color: var(--text-muted);">${emailOrRole}</span>
            </div>
            <button type="button" class="btn-secondary-sm" onclick="window.flyLogout()">Sign Out</button>
          </div>
        `;
      }
    } else {
      if (accountTriggerLabel) accountTriggerLabel.textContent = 'Account';
      if (dropdownUserName) dropdownUserName.textContent = 'Guest Traveler';
      if (dropdownUserSub) dropdownUserSub.textContent = 'Not signed in';
      if (dropdownAvatarBadge) dropdownAvatarBadge.textContent = '✈️';
      if (dropdownLoginLink) dropdownLoginLink.style.display = 'flex';
      if (dropdownLogoutBtn) dropdownLogoutBtn.style.display = 'none';
      if (dropdownAuthDivider) dropdownAuthDivider.style.display = 'none';

      if (mobileNavAuth) {
        mobileNavAuth.innerHTML = `
          <div style="margin-bottom: 12px;">
            <a href="/login" class="btn-primary" style="width: 100%; justify-content: center; text-decoration: none;">Sign In / Register</a>
          </div>
        `;
      }
    }
  }

  // -------------------------------------------------------------
  // 5. SECURE LOGOUT HANDLER
  // -------------------------------------------------------------
  window.flyLogout = async function() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin'
      });
    } catch (_) {}

    try {
      localStorage.removeItem('fly_token');
      localStorage.removeItem('fly_user');
      localStorage.removeItem('fly_active_hold');
    } catch (_) {}

    // Redirect to server-side logout which clears session cookies & headers
    window.location.replace('/logout');
  };

  // Close open dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.user-menu-wrapper')) {
      const menus = document.querySelectorAll('.user-dropdown-menu.show');
      menus.forEach(m => m.classList.remove('show'));
    }
  });

  // DOMContentLoaded initialization
  function initShell() {
    initTheme();
    initHeaderAccountDropdown();
    initMobileDrawer();
    syncAuthState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShell);
  } else {
    initShell();
  }
})();
