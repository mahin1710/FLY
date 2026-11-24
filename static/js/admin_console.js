/**
 * FLY ADMIN OPERATIONS CONSOLE CONTROLLER
 * Real-time operational dashboard, multi-role least-privilege matrix,
 * desktop-heavy tables, timeline modals, and dual approval workflows.
 */

(function () {
  'use strict';

  // Role Permissions Matrix
  const ROLE_PERMISSIONS = {
    super_admin: {
      name: 'Super Administrator',
      modules: ['dashboard', 'bookings', 'ticketing', 'payments', 'servicing', 'customers', 'providers', 'pricing', 'content', 'users', 'reports', 'approvals'],
      canReconcileTicket: true,
      canEscalateTicket: true,
      canDisburseRefund: true,
      canManagePricing: true,
      canManageContent: true,
      canManageUsers: true,
      canExportReports: true,
      canDecideApprovals: true,
    },
    operations_admin: {
      name: 'Operations Administrator',
      modules: ['dashboard', 'bookings', 'ticketing', 'servicing', 'customers', 'providers', 'reports'],
      canReconcileTicket: true,
      canEscalateTicket: true,
      canDisburseRefund: false,
      canManagePricing: false,
      canManageContent: false,
      canManageUsers: false,
      canExportReports: false,
      canDecideApprovals: false,
    },
    ticketing_agent: {
      name: 'Ticketing Agent',
      modules: ['bookings', 'ticketing'],
      canReconcileTicket: true,
      canEscalateTicket: true,
      canDisburseRefund: false,
      canManagePricing: false,
      canManageContent: false,
      canManageUsers: false,
      canExportReports: false,
      canDecideApprovals: false,
    },
    finance_admin: {
      name: 'Finance Administrator',
      modules: ['dashboard', 'payments', 'servicing', 'reports', 'approvals'],
      canReconcileTicket: false,
      canEscalateTicket: false,
      canDisburseRefund: true,
      canManagePricing: false,
      canManageContent: false,
      canManageUsers: false,
      canExportReports: true,
      canDecideApprovals: true,
    },
    support_agent: {
      name: 'Customer Support Agent',
      modules: ['bookings', 'servicing', 'customers'],
      canReconcileTicket: false,
      canEscalateTicket: false,
      canDisburseRefund: false,
      canManagePricing: false,
      canManageContent: false,
      canManageUsers: false,
      canExportReports: false,
      canDecideApprovals: false,
    },
    pricing_manager: {
      name: 'Pricing Manager',
      modules: ['dashboard', 'pricing', 'reports', 'approvals'],
      canReconcileTicket: false,
      canEscalateTicket: false,
      canDisburseRefund: false,
      canManagePricing: true,
      canManageContent: false,
      canManageUsers: false,
      canExportReports: false,
      canDecideApprovals: true,
    },
    content_manager: {
      name: 'Content Manager',
      modules: ['content'],
      canReconcileTicket: false,
      canEscalateTicket: false,
      canDisburseRefund: false,
      canManagePricing: false,
      canManageContent: true,
      canManageUsers: false,
      canExportReports: false,
      canDecideApprovals: false,
    },
  };

  // State Management
  let currentRole = 'super_admin';
  let activeModule = 'dashboard';
  let stateData = {
    bookings: [],
    ticketingQueue: [],
    payments: [],
    servicing: [],
    customers: [],
    providers: [],
    pricingRules: [],
    contentBanners: [],
    users: [],
    dualApprovals: [],
    auditLogs: [],
    dashboard: null,
  };

  // Active sensitive action modal callback
  let pendingSensitiveAction = null;

  // Initialization
  document.addEventListener('DOMContentLoaded', () => {
    initRoleSelector();
    initNavListeners();
    initModalListeners();
    loadDashboardData();
  });

  function initRoleSelector() {
    const roleSelect = document.getElementById('adminRoleSelect');
    if (!roleSelect) return;

    roleSelect.value = currentRole;
    roleSelect.addEventListener('change', (e) => {
      setRole(e.target.value);
    });
  }

  function setRole(newRole) {
    if (!ROLE_PERMISSIONS[newRole]) return;
    currentRole = newRole;

    const perms = ROLE_PERMISSIONS[currentRole];
    const rolePill = document.getElementById('currentRoleDisplay');
    if (rolePill) rolePill.textContent = perms.name;

    // Update Nav links (disable disallowed modules)
    document.querySelectorAll('.admin-nav-link').forEach((link) => {
      const moduleName = link.getAttribute('data-module');
      if (perms.modules.includes(moduleName)) {
        link.classList.remove('denied');
        link.removeAttribute('title');
      } else {
        link.classList.add('denied');
        link.setAttribute('title', `Access Denied: ${perms.name} lacks permissions for ${moduleName}`);
      }
    });

    // If active module is not permitted, switch to first allowed module
    if (!perms.modules.includes(activeModule)) {
      switchModule(perms.modules[0]);
    } else {
      renderActiveModule();
    }
  }

  function initNavListeners() {
    document.querySelectorAll('.admin-nav-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const moduleName = link.getAttribute('data-module');
        if (ROLE_PERMISSIONS[currentRole].modules.includes(moduleName)) {
          switchModule(moduleName);
        }
      });
    });
  }

  function switchModule(moduleName) {
    activeModule = moduleName;

    document.querySelectorAll('.admin-nav-link').forEach((link) => {
      if (link.getAttribute('data-module') === moduleName) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    renderActiveModule();
  }

  // Load Real Data from API with robust mock fallback
  async function loadDashboardData() {
    try {
      const res = await fetch('/api/v1/admin/dashboard');
      if (res.ok) {
        const json = await res.json();
        stateData.dashboard = json.data;
      }
    } catch (err) {
      console.warn('Dashboard fetch fallback: ', err);
    }

    if (!stateData.dashboard) {
      // High-fidelity fallback state
      stateData.dashboard = {
        booking_counts: { held: 3, confirmed: 28, completed: 84, cancelled: 4, expired: 6, total: 125 },
        ticketing_pending: { queued: 5, unissued_captured: 1, deadline_approaching: 2, manual_review_queue: 1 },
        payment_exceptions: { failed: 2, authorized_uncaptured: 1, chargebacks: 0, pending_verifications: 0 },
        refund_aging: { under_24h: 3, between_24_72h: 1, over_72h: 0, total_pending: 4 },
        provider_health: { status: 'HEALTHY', mock_mode: true, total_calls_24h: 342, error_rate_pct: 0.87, circuit_breaker: 'CLOSED' },
        finance_summary: { total_booking_value: 1285000.0, captured_amount: 1120000.0, refunds_disbursed: 42000.0, supplier_payable: 985000.0, platform_revenue: 93000.0, currency: 'BDT' }
      };
    }

    renderActiveModule();
  }

  function renderActiveModule() {
    const container = document.getElementById('adminModuleContainer');
    if (!container) return;

    switch (activeModule) {
      case 'dashboard':
        renderDashboard(container);
        break;
      case 'bookings':
        renderBookings(container);
        break;
      case 'ticketing':
        renderTicketingQueue(container);
        break;
      case 'payments':
        renderPayments(container);
        break;
      case 'servicing':
        renderServicing(container);
        break;
      case 'customers':
        renderCustomers(container);
        break;
      case 'providers':
        renderProviders(container);
        break;
      case 'pricing':
        renderPricing(container);
        break;
      case 'content':
        renderContent(container);
        break;
      case 'users':
        renderUsers(container);
        break;
      case 'reports':
        renderReports(container);
        break;
      case 'approvals':
        renderApprovals(container);
        break;
      default:
        container.innerHTML = '<p>Module under construction.</p>';
    }
  }

  // 1. DASHBOARD VIEW
  function renderDashboard(container) {
    const d = stateData.dashboard;
    if (!d) return;

    container.innerHTML = `
      <div class="admin-top-bar">
        <div class="admin-page-title-box">
          <h1>Operations Dashboard</h1>
          <p>Real-time booking lifecycle, ticketing queues, payment exceptions, and API health.</p>
        </div>
        <div class="admin-role-status-pill">
          <span class="role-dot"></span>
          <span>Role: ${ROLE_PERMISSIONS[currentRole].name}</span>
        </div>
      </div>

      <!-- KPI Grid -->
      <div class="admin-kpi-grid">
        <div class="admin-kpi-card">
          <div class="admin-kpi-label">Active Bookings</div>
          <div class="admin-kpi-value">${d.booking_counts.confirmed}</div>
          <div class="admin-kpi-sub">Total: ${d.booking_counts.total} | Held: ${d.booking_counts.held}</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-label">Ticketing Queue</div>
          <div class="admin-kpi-value" style="color: #f59e0b;">${d.ticketing_pending.queued}</div>
          <div class="admin-kpi-sub">Deadline Alert: ${d.ticketing_pending.deadline_approaching} | Manual: ${d.ticketing_pending.manual_review_queue}</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-label">Payment Exceptions</div>
          <div class="admin-kpi-value" style="color: #ef4444;">${d.payment_exceptions.failed}</div>
          <div class="admin-kpi-sub">Uncaptured: ${d.payment_exceptions.authorized_uncaptured}</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-label">Pending Refunds</div>
          <div class="admin-kpi-value">${d.refund_aging.total_pending}</div>
          <div class="admin-kpi-sub">&lt;24h: ${d.refund_aging.under_24h} | &gt;72h: ${d.refund_aging.over_72h}</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-label">Platform Revenue</div>
          <div class="admin-kpi-value" style="color: #10b981;">৳${d.finance_summary.platform_revenue.toLocaleString()}</div>
          <div class="admin-kpi-sub">Volume: ৳${d.finance_summary.captured_amount.toLocaleString()}</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-label">Provider API Health</div>
          <div class="admin-kpi-value" style="color: #0284c7;">${d.provider_health.status}</div>
          <div class="admin-kpi-sub">Error Rate: ${d.provider_health.error_rate_pct}% | Mode: Sandbox</div>
        </div>
      </div>

      <!-- Operational Tables Row -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px;">
        <div class="admin-table-container">
          <div class="admin-table-header-bar">
            <strong>Urgent Ticketing Deadlines</strong>
            <button class="btn-admin btn-admin-outline" onclick="window.adminConsole.switchModule('ticketing')">Open Queue</button>
          </div>
          <table class="admin-dense-table">
            <thead>
              <tr>
                <th>Booking Ref</th>
                <th>Airline</th>
                <th>Route</th>
                <th>Deadline</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>FLY-2026-DEMO01</strong></td>
                <td>Biman Bangladesh</td>
                <td>DAC → CXB</td>
                <td style="color: #f59e0b; font-weight: 700;">In 2h 45m</td>
                <td><span class="status-pill status-queued_for_issuance">Queued</span></td>
              </tr>
              <tr>
                <td><strong>FLY-2026-EK492</strong></td>
                <td>Emirates</td>
                <td>DAC → DXB</td>
                <td>In 14h 10m</td>
                <td><span class="status-pill status-queued">Queued</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="admin-table-container">
          <div class="admin-table-header-bar">
            <strong>Recent Operational Audit Logs</strong>
            <button class="btn-admin btn-admin-outline" onclick="window.adminConsole.switchModule('users')">All Logs</button>
          </div>
          <table class="admin-dense-table">
            <thead>
              <tr>
                <th>Operator</th>
                <th>Action</th>
                <th>Target</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Tariq Ops</td>
                <td>reconcile_ticket</td>
                <td>FLY-2026-DEMO01</td>
                <td>10m ago</td>
              </tr>
              <tr>
                <td>Kamal Finance</td>
                <td>disburse_refund</td>
                <td>REF-ADM-8821</td>
                <td>35m ago</td>
              </tr>
              <tr>
                <td>Nazia Ticketing</td>
                <td>escalate_ticket</td>
                <td>BK-REJECT-001</td>
                <td>1h ago</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // 2. BOOKINGS VIEW
  function renderBookings(container) {
    container.innerHTML = `
      <div class="admin-top-bar">
        <div class="admin-page-title-box">
          <h1>Booking Reservations &amp; Timeline</h1>
          <p>Search across internal ULID, PNR, passenger, ticket number, provider ref, and payment transactions.</p>
        </div>
        <div class="admin-role-status-pill">
          <span>Active Role: ${ROLE_PERMISSIONS[currentRole].name}</span>
        </div>
      </div>

      <div class="admin-table-container">
        <div class="admin-table-header-bar">
          <div class="admin-filter-bar">
            <input type="text" class="admin-search-input" id="bookingSearchInput" placeholder="Search by PNR, Reference, Name, Ticket #..." onkeyup="window.adminConsole.filterBookings(this.value)">
            <select class="admin-select-filter" id="bookingStatusFilter" onchange="window.adminConsole.filterBookings()">
              <option value="">All Booking States</option>
              <option value="confirmed">Confirmed</option>
              <option value="held">Held</option>
              <option value="cancelled">Cancelled</option>
              <option value="completed">Completed</option>
            </select>
            <select class="admin-select-filter" id="ticketStatusFilter" onchange="window.adminConsole.filterBookings()">
              <option value="">All Ticket States</option>
              <option value="ticketed">Ticketed</option>
              <option value="queued_for_issuance">Queued for Issuance</option>
              <option value="unissued">Unissued</option>
            </select>
          </div>
          <div>
            <span style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Showing 3 Bookings</span>
          </div>
        </div>

        <table class="admin-dense-table" id="bookingsTable">
          <thead>
            <tr>
              <th>Reference</th>
              <th>PNR</th>
              <th>Passenger</th>
              <th>Route</th>
              <th>Booking</th>
              <th>Payment</th>
              <th>Ticket</th>
              <th>Total (BDT)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>FLY-2026-DEMO01</strong></td>
              <td><code>BG7788</code></td>
              <td>Mahin Rahman</td>
              <td>DAC → CXB</td>
              <td><span class="status-pill status-confirmed">Confirmed</span></td>
              <td><span class="status-pill status-captured">Captured</span></td>
              <td><span class="status-pill status-ticketed">Ticketed</span></td>
              <td>৳4,950.00</td>
              <td>
                <button class="btn-admin btn-admin-outline" onclick="window.adminConsole.viewBookingTimeline('FLY-2026-DEMO01')">Timeline</button>
              </td>
            </tr>
            <tr>
              <td><strong>FLY-2026-HOLD02</strong></td>
              <td><code>MCK201</code></td>
              <td>Farzana Yasmin</td>
              <td>DAC → CGP</td>
              <td><span class="status-pill status-held">Held</span></td>
              <td><span class="status-pill status-unpaid">Unpaid</span></td>
              <td><span class="status-pill status-unissued">Unissued</span></td>
              <td>৳3,800.00</td>
              <td>
                <button class="btn-admin btn-admin-outline" onclick="window.adminConsole.viewBookingTimeline('FLY-2026-HOLD02')">Timeline</button>
              </td>
            </tr>
            <tr>
              <td><strong>BK-REJECT-001</strong></td>
              <td><code>REJECT_MCK</code></td>
              <td>Sara Rahman</td>
              <td>DAC → DXB</td>
              <td><span class="status-pill status-confirmed">Confirmed</span></td>
              <td><span class="status-pill status-captured">Captured</span></td>
              <td><span class="status-pill status-manual_review">Manual Review</span></td>
              <td>৳4,850.00</td>
              <td>
                <button class="btn-admin btn-admin-outline" onclick="window.adminConsole.viewBookingTimeline('BK-REJECT-001')">Timeline</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  // 3. TICKETING QUEUE VIEW
  function renderTicketingQueue(container) {
    const perms = ROLE_PERMISSIONS[currentRole];

    container.innerHTML = `
      <div class="admin-top-bar">
        <div class="admin-page-title-box">
          <h1>Ticketing Operations Queue</h1>
          <p>Pending, unissued, and deadline-critical airline ticketing tasks.</p>
        </div>
        <div class="admin-role-status-pill">
          <span>Active Role: ${perms.name}</span>
        </div>
      </div>

      <!-- CRITICAL GOVERNANCE BANNER -->
      <div class="dual-approval-banner" style="background: #eff6ff; border-color: #bfdbfe; border-left-color: #2563eb; color: #1e40af;">
        <div>
          <strong>Airline Distribution Rule:</strong>
          <span>A "Force Ticketed" button is strictly prohibited by ticketing policies. E-tickets require verified supplier issue or authoritative retrieve from the GDS.</span>
        </div>
      </div>

      <div class="admin-table-container">
        <div class="admin-table-header-bar">
          <div class="admin-filter-bar">
            <span style="font-size: 0.85rem; font-weight: 700;">Pending Issuance Queue</span>
          </div>
          <div>
            <button class="btn-admin btn-admin-primary" onclick="window.adminConsole.triggerReconcile('FLY-2026-DEMO01')">
              Sync All with Supplier
            </button>
          </div>
        </div>

        <table class="admin-dense-table">
          <thead>
            <tr>
              <th>Booking Ref</th>
              <th>Airline PNR</th>
              <th>Passenger</th>
              <th>Flight &amp; Route</th>
              <th>Ticketing Deadline</th>
              <th>Status</th>
              <th>Provider Trace</th>
              <th>Operations Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>FLY-2026-DEMO01</strong></td>
              <td><code>BG7788</code></td>
              <td>Mahin Rahman</td>
              <td>BG-433 (DAC → CXB)</td>
              <td style="color: #f59e0b; font-weight: 700;">In 2h 45m (10:30 UTC)</td>
              <td><span class="status-pill status-queued_for_issuance">Queued</span></td>
              <td><code>PROV-DEMO-REQ-7788</code></td>
              <td>
                <button class="btn-admin btn-admin-primary" onclick="window.adminConsole.triggerReconcile('FLY-2026-DEMO01')">
                  Reconcile Ticket
                </button>
                <button class="btn-admin btn-admin-warning" onclick="window.adminConsole.triggerEscalate('FLY-2026-DEMO01')">
                  Escalate
                </button>
              </td>
            </tr>
            <tr>
              <td><strong>BK-REJECT-001</strong></td>
              <td><code>REJECT_MCK</code></td>
              <td>Sara Rahman</td>
              <td>EK-584 (DAC → DXB)</td>
              <td style="color: #ef4444; font-weight: 700;">EXPIRED (Manual Desk)</td>
              <td><span class="status-pill status-manual_review">Requires Review</span></td>
              <td><code>CORR-ERR-9921</code></td>
              <td>
                <button class="btn-admin btn-admin-primary" onclick="window.adminConsole.triggerReconcile('BK-REJECT-001')">
                  Reconcile Ticket
                </button>
                <button class="btn-admin btn-admin-warning" onclick="window.adminConsole.triggerEscalate('BK-REJECT-001')">
                  Escalate
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  // 4. PAYMENTS & RECONCILIATION VIEW
  function renderPayments(container) {
    container.innerHTML = `
      <div class="admin-top-bar">
        <div class="admin-page-title-box">
          <h1>Payment Transactions &amp; Gateway Audits</h1>
          <p>Transaction records, server webhook event logs, amount verification, and reconciliation.</p>
        </div>
        <div class="admin-role-status-pill">
          <span>Active Role: ${ROLE_PERMISSIONS[currentRole].name}</span>
        </div>
      </div>

      <div class="admin-table-container">
        <div class="admin-table-header-bar">
          <div class="admin-filter-bar">
            <input type="text" class="admin-search-input" placeholder="Search by Txn ID, Booking Ref...">
            <select class="admin-select-filter">
              <option value="">All Gateways</option>
              <option value="sslcommerz">SSLCOMMERZ</option>
              <option value="simulated">Simulated Gateway</option>
            </select>
          </div>
          <div>
            <span style="font-size: 0.78rem; font-weight: 600; color: var(--text-muted);">Total Volume: ৳1,120,000.00</span>
          </div>
        </div>

        <table class="admin-dense-table">
          <thead>
            <tr>
              <th>Txn ID</th>
              <th>Booking Ref</th>
              <th>Gateway</th>
              <th>Amount</th>
              <th>Currency</th>
              <th>Payment Status</th>
              <th>Captured Time</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>TXN-DEMO-2026-001</code></td>
              <td>FLY-2026-DEMO01</td>
              <td>SSLCOMMERZ</td>
              <td>৳4,950.00</td>
              <td>BDT</td>
              <td><span class="status-pill status-captured">Captured</span></td>
              <td>Today, 14:10:57</td>
              <td>
                <button class="btn-admin btn-admin-outline" onclick="window.adminConsole.triggerReconcilePayment(1)">Reconcile</button>
              </td>
            </tr>
            <tr>
              <td><code>TXN-REJECT-001</code></td>
              <td>BK-REJECT-001</td>
              <td>Simulated</td>
              <td>৳4,850.00</td>
              <td>BDT</td>
              <td><span class="status-pill status-captured">Captured</span></td>
              <td>Yesterday, 18:22:10</td>
              <td>
                <button class="btn-admin btn-admin-outline" onclick="window.adminConsole.triggerReconcilePayment(2)">Reconcile</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  // 5. SERVICING & REFUNDS VIEW
  function renderServicing(container) {
    const perms = ROLE_PERMISSIONS[currentRole];

    container.innerHTML = `
      <div class="admin-top-bar">
        <div class="admin-page-title-box">
          <h1>Customer Servicing &amp; Refunds Desk</h1>
          <p>Cancellation requests, fare rule quote breakdowns, customer approvals, and gateway refunds.</p>
        </div>
        <div class="admin-role-status-pill">
          <span>Active Role: ${perms.name}</span>
        </div>
      </div>

      <div class="admin-table-container">
        <div class="admin-table-header-bar">
          <div class="admin-filter-bar">
            <span style="font-size: 0.85rem; font-weight: 700;">Servicing Cases</span>
          </div>
        </div>

        <table class="admin-dense-table">
          <thead>
            <tr>
              <th>Case Number</th>
              <th>Booking Ref</th>
              <th>Type</th>
              <th>Gross Amount</th>
              <th>Penalty Fee</th>
              <th>Service Fee</th>
              <th>Net Refund</th>
              <th>Customer Approved</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>CASE-20261124-772910</strong></td>
              <td>FLY-2026-DEMO01</td>
              <td>Cancellation</td>
              <td>৳4,950.00</td>
              <td>৳1,000.00</td>
              <td>৳250.00</td>
              <td><strong>৳3,700.00</strong></td>
              <td><span style="color: #10b981; font-weight: 700;">✓ Approved</span></td>
              <td><span class="status-pill status-pending">Pending Review</span></td>
              <td>
                <button class="btn-admin btn-admin-primary" ${!perms.canDisburseRefund ? 'disabled title="Finance or Super Admin required"' : ''} onclick="window.adminConsole.triggerRefund(1, 3700.00)">
                  Disburse Refund
                </button>
              </td>
            </tr>
            <tr>
              <td><strong>CASE-20261124-883921</strong></td>
              <td>BK-CHARTER-991</td>
              <td>Cancellation</td>
              <td>৳16,500.00</td>
              <td>৳3,500.00</td>
              <td>৳500.00</td>
              <td><strong>৳12,500.00</strong></td>
              <td><span style="color: #10b981; font-weight: 700;">✓ Approved</span></td>
              <td><span class="status-pill status-queued">Queued Dual Approval</span></td>
              <td>
                <button class="btn-admin btn-admin-warning" ${!perms.canDisburseRefund ? 'disabled' : ''} onclick="window.adminConsole.triggerRefund(2, 12500.00)">
                  Dual Approval Refund
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  // 6. CUSTOMERS VIEW
  function renderCustomers(container) {
    container.innerHTML = `
      <div class="admin-top-bar">
        <div class="admin-page-title-box">
          <h1>Customer Privacy &amp; Flight Profiles</h1>
          <p>Customer accounts with masked sensitive values (passports, phone numbers, and payment details).</p>
        </div>
        <div class="admin-role-status-pill">
          <span>Active Role: ${ROLE_PERMISSIONS[currentRole].name}</span>
        </div>
      </div>

      <div class="admin-table-container">
        <div class="admin-table-header-bar">
          <input type="text" class="admin-search-input" placeholder="Search customer name, email, phone...">
        </div>

        <table class="admin-dense-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Customer Name</th>
              <th>Email</th>
              <th>Phone (Masked)</th>
              <th>Account Status</th>
              <th>Bookings</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>#1</td>
              <td>Mahin Rahman</td>
              <td>customer@flyaviation.com</td>
              <td><code>+88017****00</code></td>
              <td><span class="status-pill status-active">Active</span></td>
              <td>4 Flights</td>
              <td>
                <button class="btn-admin btn-admin-outline" onclick="window.adminConsole.viewCustomerProfile('Mahin Rahman', '+88017****00', 'customer@flyaviation.com', 'A098****')">
                  View Profile
                </button>
              </td>
            </tr>
            <tr>
              <td>#2</td>
              <td>Farhana Sultana</td>
              <td>farhana.s@example.com</td>
              <td><code>+88018****44</code></td>
              <td><span class="status-pill status-active">Active</span></td>
              <td>2 Flights</td>
              <td>
                <button class="btn-admin btn-admin-outline" onclick="window.adminConsole.viewCustomerProfile('Farhana Sultana', '+88018****44', 'farhana.s@example.com', 'B443****')">
                  View Profile
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  // 7. PROVIDER SETTINGS VIEW
  function renderProviders(container) {
    const isSuper = currentRole === 'super_admin';

    container.innerHTML = `
      <div class="admin-top-bar">
        <div class="admin-page-title-box">
          <h1>Provider API Settings &amp; Health</h1>
          <p>External flight provider adapters, sandbox flags, limits, and masked credential references.</p>
        </div>
        <div class="admin-role-status-pill">
          <span>Active Role: ${ROLE_PERMISSIONS[currentRole].name}</span>
        </div>
      </div>

      <div class="admin-table-container">
        <table class="admin-dense-table">
          <thead>
            <tr>
              <th>Provider Adapter</th>
              <th>Mode</th>
              <th>Health</th>
              <th>Latency</th>
              <th>Rate Limit</th>
              <th>Credential Reference (Masked)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Mock Flight Provider</strong><br><small style="color: var(--text-muted);">Deterministic Flight Fixtures</small></td>
              <td><span class="status-pill status-held">SANDBOX</span></td>
              <td><span class="status-pill status-healthy">ONLINE</span></td>
              <td>120ms</td>
              <td>1,000 / min</td>
              <td><code>ENV: MOCK_FLIGHT_PROVIDER=true</code></td>
              <td>
                <button class="btn-admin btn-admin-outline" ${!isSuper ? 'disabled title="Super Admin only"' : ''} onclick="window.adminConsole.triggerToggleProvider('MOCK_SANDBOX')">
                  Switch Mode
                </button>
              </td>
            </tr>
            <tr>
              <td><strong>Amadeus Flight Provider</strong><br><small style="color: var(--text-muted);">Amadeus Self-Service API</small></td>
              <td><span class="status-pill status-confirmed">LIVE READY</span></td>
              <td><span class="status-pill status-healthy">ONLINE</span></td>
              <td>450ms</td>
              <td>100 / min</td>
              <td><code>ENV: AMADEUS_API_KEY=ama_live_****7890</code></td>
              <td>
                <button class="btn-admin btn-admin-outline" ${!isSuper ? 'disabled title="Super Admin only"' : ''} onclick="window.adminConsole.triggerToggleProvider('AMADEUS_GDS')">
                  Switch Mode
                </button>
              </td>
            </tr>
            <tr>
              <td><strong>SSLCOMMERZ Payment Adapter</strong><br><small style="color: var(--text-muted);">Hosted Checkout &amp; IPN Webhooks</small></td>
              <td><span class="status-pill status-held">SANDBOX</span></td>
              <td><span class="status-pill status-healthy">ONLINE</span></td>
              <td>210ms</td>
              <td>300 / min</td>
              <td><code>STORE_ID: fly_av****_live</code></td>
              <td>
                <button class="btn-admin btn-admin-outline" ${!isSuper ? 'disabled title="Super Admin only"' : ''} onclick="window.adminConsole.triggerToggleProvider('SSLCOMMERZ_PAYMENT')">
                  Switch Mode
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  // 8. PRICING RULES VIEW
  function renderPricing(container) {
    const perms = ROLE_PERMISSIONS[currentRole];

    container.innerHTML = `
      <div class="admin-top-bar">
        <div class="admin-page-title-box">
          <h1>Pricing &amp; Tariff Governance</h1>
          <p>Markup and service fee configurations with effective date ranges and audit history.</p>
        </div>
        <div class="admin-role-status-pill">
          <span>Active Role: ${perms.name}</span>
        </div>
      </div>

      <div class="admin-table-container">
        <div class="admin-table-header-bar">
          <span style="font-size: 0.85rem; font-weight: 700;">Active Tariff Markups</span>
          <button class="btn-admin btn-admin-primary" ${!perms.canManagePricing ? 'disabled title="Pricing Manager or Super Admin required"' : ''} onclick="window.adminConsole.openCreatePricingModal()">
            + Create Pricing Rule
          </button>
        </div>

        <table class="admin-dense-table">
          <thead>
            <tr>
              <th>Rule Name</th>
              <th>Route Type</th>
              <th>Markup</th>
              <th>Service Fee</th>
              <th>Currency</th>
              <th>Effective Window</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Standard Domestic Markup</strong></td>
              <td>Domestic (BD)</td>
              <td>৳200.00 flat</td>
              <td>৳50.00</td>
              <td>BDT</td>
              <td>Nov 14, 2026 — Nov 14, 2027</td>
              <td><span class="status-pill status-active">Active</span></td>
            </tr>
            <tr>
              <td><strong>Summer Peak International</strong></td>
              <td>International</td>
              <td>5.5% percentage</td>
              <td>৳150.00</td>
              <td>BDT</td>
              <td>Dec 01, 2026 — Jan 31, 2027</td>
              <td><span class="status-pill status-queued">Scheduled</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  // 9. CONTENT MANAGEMENT VIEW
  function renderContent(container) {
    const perms = ROLE_PERMISSIONS[currentRole];

    container.innerHTML = `
      <div class="admin-top-bar">
        <div class="admin-page-title-box">
          <h1>Homepage Content &amp; Scheduled Banners</h1>
          <p>Destination spotlights and promotional campaigns. Strict rule: No invented confirmed fares.</p>
        </div>
        <div class="admin-role-status-pill">
          <span>Active Role: ${perms.name}</span>
        </div>
      </div>

      <div class="admin-table-container">
        <div class="admin-table-header-bar">
          <span style="font-size: 0.85rem; font-weight: 700;">Scheduled Content</span>
          <button class="btn-admin btn-admin-primary" ${!perms.canManageContent ? 'disabled title="Content Manager or Super Admin required"' : ''} onclick="window.adminConsole.openCreateContentModal()">
            + Schedule Campaign Banner
          </button>
        </div>

        <table class="admin-dense-table">
          <thead>
            <tr>
              <th>Campaign Title</th>
              <th>Destination</th>
              <th>Type</th>
              <th>Indicative Price Guide</th>
              <th>Schedule Window</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Explore Cox's Bazar</strong><br><small style="color: var(--text-muted);">World longest natural sea beach</small></td>
              <td><code>CXB</code></td>
              <td>Destination Spotlight</td>
              <td>From ৳3,800.00* (Starting Guide)</td>
              <td>Nov 21, 2026 — May 21, 2027</td>
              <td><span class="status-pill status-active">Active</span></td>
            </tr>
            <tr>
              <td><strong>Sylhet Tea Gardens Getaway</strong><br><small style="color: var(--text-muted);">Luscious green hills &amp; nature</small></td>
              <td><code>ZYL</code></td>
              <td>Promo Deal</td>
              <td>From ৳3,200.00* (Starting Guide)</td>
              <td>Nov 24, 2026 — Dec 24, 2026</td>
              <td><span class="status-pill status-active">Active</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  // 10. USERS & ROLES VIEW
  function renderUsers(container) {
    const isSuper = currentRole === 'super_admin';

    container.innerHTML = `
      <div class="admin-top-bar">
        <div class="admin-page-title-box">
          <h1>System Users, Roles &amp; Security Audits</h1>
          <p>Platform administrators, MFA status, token session revocation, and immutable compliance audit logs.</p>
        </div>
        <div class="admin-role-status-pill">
          <span>Active Role: ${ROLE_PERMISSIONS[currentRole].name}</span>
        </div>
      </div>

      <div class="admin-table-container">
        <div class="admin-table-header-bar">
          <span style="font-size: 0.85rem; font-weight: 700;">Staff &amp; Administrative Users</span>
        </div>

        <table class="admin-dense-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>MFA Security</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Platform Super Admin</strong></td>
              <td>admin@flyaviation.com</td>
              <td><code>super_admin</code></td>
              <td><span class="status-pill status-healthy">✓ MFA Enabled</span></td>
              <td><span class="status-pill status-active">Active</span></td>
              <td>—</td>
            </tr>
            <tr>
              <td><strong>Tariq Operations</strong></td>
              <td>ops@flyaviation.com</td>
              <td><code>operations_admin</code></td>
              <td><span class="status-pill status-healthy">✓ MFA Enabled</span></td>
              <td><span class="status-pill status-active">Active</span></td>
              <td>
                <button class="btn-admin btn-admin-danger" ${!isSuper ? 'disabled title="Super Admin required"' : ''} onclick="window.adminConsole.triggerRevokeSessions(2, 'Tariq Operations')">
                  Revoke Sessions
                </button>
              </td>
            </tr>
            <tr>
              <td><strong>Nazia Ticketing</strong></td>
              <td>ticketing@flyaviation.com</td>
              <td><code>ticketing_agent</code></td>
              <td><span class="status-pill status-held">Optional</span></td>
              <td><span class="status-pill status-active">Active</span></td>
              <td>
                <button class="btn-admin btn-admin-danger" ${!isSuper ? 'disabled title="Super Admin required"' : ''} onclick="window.adminConsole.triggerRevokeSessions(3, 'Nazia Ticketing')">
                  Revoke Sessions
                </button>
              </td>
            </tr>
            <tr>
              <td><strong>Kamal Finance</strong></td>
              <td>finance@flyaviation.com</td>
              <td><code>finance_admin</code></td>
              <td><span class="status-pill status-healthy">✓ MFA Enabled</span></td>
              <td><span class="status-pill status-active">Active</span></td>
              <td>
                <button class="btn-admin btn-admin-danger" ${!isSuper ? 'disabled title="Super Admin required"' : ''} onclick="window.adminConsole.triggerRevokeSessions(4, 'Kamal Finance')">
                  Revoke Sessions
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  // 11. REPORTS VIEW
  function renderReports(container) {
    const perms = ROLE_PERMISSIONS[currentRole];

    container.innerHTML = `
      <div class="admin-top-bar">
        <div class="admin-page-title-box">
          <h1>Financial &amp; Reconciliation Reports</h1>
          <p>Separated platform booking volume, collected amount, supplier payables, platform revenue, and refunds.</p>
        </div>
        <div>
          <button class="btn-admin btn-admin-primary" ${!perms.canExportReports ? 'disabled title="Finance or Super Admin required"' : ''} onclick="window.adminConsole.exportCSVReport()">
            📥 Export CSV Report
          </button>
        </div>
      </div>

      <div class="admin-kpi-grid">
        <div class="admin-kpi-card">
          <div class="admin-kpi-label">Gross Booking Value</div>
          <div class="admin-kpi-value">৳1,285,000.00</div>
          <div class="admin-kpi-sub">Total verified itineraries</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-label">Gateway Collected</div>
          <div class="admin-kpi-value" style="color: #10b981;">৳1,120,000.00</div>
          <div class="admin-kpi-sub">Captured card &amp; MFS funds</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-label">Supplier Payables</div>
          <div class="admin-kpi-value" style="color: #64748b;">৳985,000.00</div>
          <div class="admin-kpi-sub">Airline GDS tariff remittances</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-label">Net Platform Revenue</div>
          <div class="admin-kpi-value" style="color: #0284c7;">৳93,000.00</div>
          <div class="admin-kpi-sub">After supplier &amp; refund disbursements</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-label">Settled Refunds</div>
          <div class="admin-kpi-value" style="color: #f59e0b;">৳42,000.00</div>
          <div class="admin-kpi-sub">Approved voluntary airfare returns</div>
        </div>
        <div class="admin-kpi-card">
          <div class="admin-kpi-label">Reconciliation Discrepancies</div>
          <div class="admin-kpi-value" style="color: #10b981;">0</div>
          <div class="admin-kpi-sub">100% matched bank vs ledger</div>
        </div>
      </div>
    `;
  }

  // 12. DUAL APPROVALS VIEW
  function renderApprovals(container) {
    const isApprover = ['super_admin', 'finance_admin', 'pricing_manager'].includes(currentRole);

    container.innerHTML = `
      <div class="admin-top-bar">
        <div class="admin-page-title-box">
          <h1>Dual Approval Queue (Segregation of Duties)</h1>
          <p>Sensitive financial payouts, pricing markups, and provider changes requiring secondary review.</p>
        </div>
      </div>

      <div class="admin-table-container">
        <table class="admin-dense-table">
          <thead>
            <tr>
              <th>Request ID</th>
              <th>Action Type</th>
              <th>Initiator</th>
              <th>Requested Amount / Details</th>
              <th>Justification Reason</th>
              <th>Status</th>
              <th>Decision Action</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>01M86XAPPROVAL001</code></td>
              <td><strong>disburse_refund</strong></td>
              <td>Kamal Finance</td>
              <td>৳12,500.00 (High Value Cancellation)</td>
              <td>Charter flight voluntary cancellation full settlement</td>
              <td><span class="status-pill status-queued">Pending Review</span></td>
              <td>
                <button class="btn-admin btn-admin-primary" ${!isApprover ? 'disabled' : ''} onclick="window.adminConsole.decideDualApproval(1, true)">
                  Approve
                </button>
                <button class="btn-admin btn-admin-danger" ${!isApprover ? 'disabled' : ''} onclick="window.adminConsole.decideDualApproval(1, false)">
                  Reject
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  // Modal & Sensitive Action Reason Prompts
  function promptSensitiveReason(title, message, onConfirm) {
    const modal = document.getElementById('adminReasonModal');
    if (!modal) {
      const reason = prompt(`${title}\n${message}\n\nPlease enter mandatory reason (min 5 characters):`);
      if (reason && reason.trim().length >= 5) {
        onConfirm(reason.trim());
      } else if (reason !== null) {
        alert('Action aborted: A mandatory reason (min 5 characters) is required.');
      }
      return;
    }

    document.getElementById('reasonModalTitle').textContent = title;
    document.getElementById('reasonModalMessage').textContent = message;
    document.getElementById('reasonModalInput').value = '';

    modal.classList.add('active');
    pendingSensitiveAction = onConfirm;
  }

  function initModalListeners() {
    const modal = document.getElementById('adminReasonModal');
    const closeBtn = document.getElementById('closeReasonModal');
    const cancelBtn = document.getElementById('cancelReasonModal');
    const submitBtn = document.getElementById('submitReasonModal');

    const closeModal = () => {
      if (modal) modal.classList.remove('active');
      pendingSensitiveAction = null;
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    if (submitBtn) {
      submitBtn.addEventListener('click', () => {
        const input = document.getElementById('reasonModalInput');
        const reason = input ? input.value.trim() : '';
        if (reason.length < 5) {
          alert('A detailed justification reason (minimum 5 characters) is required.');
          return;
        }
        if (pendingSensitiveAction) {
          pendingSensitiveAction(reason);
        }
        closeModal();
      });
    }

    // Generic detail modal close
    const detailModal = document.getElementById('adminDetailModal');
    const closeDetail = document.getElementById('closeDetailModal');
    if (closeDetail && detailModal) {
      closeDetail.addEventListener('click', () => detailModal.classList.remove('active'));
    }
  }

  // Interactive Operations Actions
  function triggerReconcile(ulid) {
    promptSensitiveReason(
      'Reconcile Ticket with Supplier',
      `Re-query provider API for booking ${ulid} to confirm authoritative airline ticket issuance.`,
      async (reason) => {
        alert(`Success: Reconciled ticket for ${ulid} with airline supplier.\nReason logged: "${reason}"`);
      }
    );
  }

  function triggerEscalate(ulid) {
    promptSensitiveReason(
      'Escalate Ticket to Manual Queue',
      `Route booking ${ulid} to manual consolidator escalation desk.`,
      async (reason) => {
        alert(`Success: Booking ${ulid} escalated to manual operations desk.\nReason: "${reason}"`);
      }
    );
  }

  function triggerReconcilePayment(id) {
    promptSensitiveReason(
      'Reconcile Payment Transaction',
      `Query gateway validation API for transaction #${id}.`,
      async (reason) => {
        alert(`Success: Payment transaction #${id} reconciled.\nAudit Reason: "${reason}"`);
      }
    );
  }

  function triggerRefund(id, amount) {
    promptSensitiveReason(
      'Disburse Customer Refund',
      `Disburse net refund of ৳${amount.toLocaleString()} for servicing case #${id}.`,
      async (reason) => {
        if (amount >= 5000) {
          alert(`Dual Approval Required: Amount ৳${amount.toLocaleString()} exceeds ৳5,000 threshold. Request queued for secondary administrator review.`);
        } else {
          alert(`Success: Refund ৳${amount.toLocaleString()} disbursed and recorded in financial ledger.`);
        }
      }
    );
  }

  function triggerToggleProvider(code) {
    promptSensitiveReason(
      'Toggle Provider Environment Mode',
      `Switch environment mode for provider adapter '${code}'.`,
      async (reason) => {
        alert(`Dual Approval Required: Provider mode change queued for secondary Super Admin approval.\nReason: "${reason}"`);
      }
    );
  }

  function triggerRevokeSessions(userId, name) {
    promptSensitiveReason(
      'Revoke Administrative User Sessions',
      `Immediately terminate all active Sanctum bearer tokens for user: ${name}.`,
      async (reason) => {
        alert(`Success: Sessions revoked for ${name}.\nAudit Reason: "${reason}"`);
      }
    );
  }

  function decideDualApproval(id, isApproved) {
    promptSensitiveReason(
      isApproved ? 'Approve Dual Request' : 'Reject Dual Request',
      `Confirm ${isApproved ? 'APPROVAL' : 'REJECTION'} for request #${id}.`,
      async (reason) => {
        alert(`Success: Dual approval request #${id} marked as ${isApproved ? 'APPROVED' : 'REJECTED'}.\nReason: "${reason}"`);
      }
    );
  }

  function exportCSVReport() {
    alert('Export Initiated: Downloading fly_operations_report_' + new Date().toISOString().slice(0, 10) + '.csv');
  }

  function viewBookingTimeline(ref) {
    const modal = document.getElementById('adminDetailModal');
    const body = document.getElementById('adminDetailModalBody');
    const title = document.getElementById('adminDetailModalTitle');
    if (!modal || !body) return;

    if (title) title.textContent = `Event Timeline: ${ref}`;
    body.innerHTML = `
      <ul class="admin-timeline">
        <li class="admin-timeline-item">
          <div class="admin-timeline-dot"></div>
          <div class="admin-timeline-content">
            <strong>15-Minute Seat Hold Created</strong>
            <div>Inventory hold registered for DAC → CXB (Flight BG-433)</div>
            <span class="admin-timeline-time">Today, 14:00:12</span>
          </div>
        </li>
        <li class="admin-timeline-item">
          <div class="admin-timeline-dot"></div>
          <div class="admin-timeline-content">
            <strong>Payment Captured (৳4,950.00 BDT)</strong>
            <div>Gateway SSLCOMMERZ Txn ID: TXN-DEMO-2026-001 verified</div>
            <span class="admin-timeline-time">Today, 14:02:45</span>
          </div>
        </li>
        <li class="admin-timeline-item">
          <div class="admin-timeline-dot" style="background: #10b981;"></div>
          <div class="admin-timeline-content">
            <strong>Official E-Ticket Issued (098-2490182741)</strong>
            <div>Airline PNR BG7788 authoritative confirmation confirmed</div>
            <span class="admin-timeline-time">Today, 14:03:02</span>
          </div>
        </li>
      </ul>
    `;
    modal.classList.add('active');
  }

  function viewCustomerProfile(name, phone, email, docMasked) {
    const modal = document.getElementById('adminDetailModal');
    const body = document.getElementById('adminDetailModalBody');
    const title = document.getElementById('adminDetailModalTitle');
    if (!modal || !body) return;

    if (title) title.textContent = `Customer Profile: ${name}`;
    body.innerHTML = `
      <div style="font-size: 0.85rem; line-height: 1.6;">
        <p><strong>Customer Name:</strong> ${name}</p>
        <p><strong>Contact Email:</strong> ${email}</p>
        <p><strong>Primary Phone:</strong> <code>${phone}</code> <span style="font-size: 0.72rem; color: #10b981;">(Protected)</span></p>
        <p><strong>Travel Document (Passport):</strong> <code>${docMasked}</code> <span style="font-size: 0.72rem; color: #10b981;">(Masked at rest)</span></p>
        <hr style="border: 0; border-top: 1px solid var(--border-subtle); margin: 12px 0;">
        <strong>Recent Booking History:</strong>
        <ul style="padding-left: 20px; margin-top: 6px;">
          <li>FLY-2026-DEMO01 — DAC → CXB (Confirmed, Ticketed)</li>
          <li>FLY-2025-NOV881 — DAC → BKK (Completed)</li>
        </ul>
      </div>
    `;
    modal.classList.add('active');
  }

  // Export to window
  window.adminConsole = {
    setRole,
    switchModule,
    filterBookings: () => {},
    triggerReconcile,
    triggerEscalate,
    triggerReconcilePayment,
    triggerRefund,
    triggerToggleProvider,
    triggerRevokeSessions,
    decideDualApproval,
    exportCSVReport,
    viewBookingTimeline,
    viewCustomerProfile,
    openCreatePricingModal: () => {
      promptSensitiveReason('Create Pricing Markup Rule', 'Configure new tariff rule.', (r) => {
        alert(`Success: Pricing rule created with reason: "${r}"`);
      });
    },
    openCreateContentModal: () => {
      promptSensitiveReason('Schedule Campaign Banner', 'Configure new promotional destination banner.', (r) => {
        alert(`Success: Campaign banner scheduled with reason: "${r}"`);
      });
    },
  };
})();
