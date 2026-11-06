/* ==========================================================================
   Saffron House — Admin application shell, authentication and router
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;

  const ROUTES = {
    dashboard: { title: 'Dashboard', kicker: 'Overview', permission: 'dashboard' },
    pos: { title: 'Point of Sale', kicker: 'Service floor', permission: 'pos' },
    orders: { title: 'Orders', kicker: 'Service floor', permission: 'orders' },
    kitchen: { title: 'Kitchen Display', kicker: 'Service floor', permission: 'kitchen' },
    billing: { title: 'Billing & Invoices', kicker: 'Service floor', permission: 'billing' },
    tables: { title: 'Table Management', kicker: 'Service floor', permission: 'tables' },
    reservations: { title: 'Reservations', kicker: 'Service floor', permission: 'reservations' },
    menu: { title: 'Menu Manager', kicker: 'Catalog', permission: 'menu' },
    recipes: { title: 'Recipes & Food Costing', kicker: 'Catalog', permission: 'recipes' },
    inventory: { title: 'Inventory', kicker: 'Operations', permission: 'inventory' },
    suppliers: { title: 'Suppliers & Purchasing', kicker: 'Operations', permission: 'suppliers' },
    expenses: { title: 'Expenses', kicker: 'Operations', permission: 'expenses' },
    customers: { title: 'Customers', kicker: 'People', permission: 'customers' },
    staff: { title: 'Staff & Roles', kicker: 'People', permission: 'staff' },
    reports: { title: 'Reports & Analytics', kicker: 'Insight', permission: 'reports' },
    settings: { title: 'Settings', kicker: 'System', permission: 'settings' }
  };
  A.ROUTES = ROUTES;

  const loginScreen = A.qs('#loginScreen');
  const app = A.qs('#app');
  const loginForm = A.qs('#loginForm');
  const loginError = A.qs('#loginError');
  const loginSubmit = A.qs('#loginSubmit');
  let routeToken = 0;
  let clockTimer = null;
  let badgeTimer = null;
  let booted = false;

  function showLogin() {
    loginScreen.classList.remove('hidden');
    app.classList.add('hidden');
    document.body.classList.remove('modal-open');
    A.qsa('#modalRoot .modal-backdrop').forEach((el) => el.remove());
    if (clockTimer) clearInterval(clockTimer);
    const saved = localStorage.getItem('saffron_admin_email');
    if (saved) A.qs('#loginEmail').value = saved;
    setTimeout(() => A.qs('#loginEmail').focus({ preventScroll: true }), 120);
    A.icons();
  }

  function showApp() {
    loginScreen.classList.add('hidden');
    app.classList.remove('hidden');
    const name = A.staff?.name || 'Staff';
    const role = A.roleLabel(A.staff?.role);
    const initials = A.initials(name);
    ['sidebarAvatar', 'topbarAvatar'].forEach((id) => {
      const el = A.qs('#' + id);
      if (el) { el.textContent = initials; el.style.background = `linear-gradient(140deg, ${A.avatarColor(name)}, #a9832e)`; }
    });
    ['sidebarName', 'topbarName', 'dropName'].forEach((id) => { const el = A.qs('#' + id); if (el) el.textContent = name; });
    ['sidebarRole', 'topbarRole'].forEach((id) => { const el = A.qs('#' + id); if (el) el.textContent = role; });
    const email = A.qs('#dropEmail'); if (email) email.textContent = A.staff?.email || '';
    A.qs('#footerYear').textContent = new Date().getFullYear();
    filterNav();
    A.icons();
    if (!clockTimer) clockTimer = A.startClock();
    startBadgeRefresh();
  }

  function filterNav() {
    A.qsa('.nav-link').forEach((link) => {
      const route = link.dataset.route;
      const cfg = ROUTES[route];
      const allowed = cfg && A.can(cfg.permission);
      link.style.display = allowed ? '' : 'none';
      link.parentElement.style.display = [...link.parentElement.children].some((c) => c.classList.contains('nav-link') && c.style.display !== 'none') ? '' : 'none';
    });
  }

  // ── Login ──
  A.qsa('.demo-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      A.qs('#loginEmail').value = chip.dataset.email;
      A.qs('#loginPassword').value = chip.dataset.pass;
      loginError.textContent = '';
      A.qs('#loginPassword').focus();
    });
  });
  const toggle = A.qs('#togglePassword');
  if (toggle) toggle.addEventListener('click', () => {
    const input = A.qs('#loginPassword');
    input.type = input.type === 'password' ? 'text' : 'password';
    toggle.innerHTML = `<i data-lucide="${input.type === 'password' ? 'eye' : 'eye-off'}"></i>`;
    A.icons();
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    const email = A.qs('#loginEmail').value.trim();
    const password = A.qs('#loginPassword').value;
    if (!email || !password) { loginError.textContent = 'Enter your email and password.'; return; }
    A.busy(loginSubmit, true, 'Signing in…');
    try {
      await A.raw('/api/auth/staff/login', { method: 'POST', body: { email, password } });
      if (A.qs('#rememberEmail').checked) localStorage.setItem('saffron_admin_email', email);
      else localStorage.removeItem('saffron_admin_email');
      const params = new URLSearchParams(location.search);
      const next = params.get('next');
      await boot();
      if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/admin')) {
        location.href = next;
        return;
      }
      if (!location.hash || location.hash === '#') location.hash = '#/dashboard';
      A.toast(`Signed in as ${A.staff.name}`, 'success', 'Welcome back');
    } catch (err) {
      loginError.textContent = err.message || 'Could not sign in.';
    } finally {
      A.busy(loginSubmit, false);
    }
  });

  // ── Logout ──
  async function logout() {
    try { await A.raw('/api/auth/staff/logout', { method: 'POST' }); } catch (_) {}
    A.staff = null;
    if (badgeTimer) { clearInterval(badgeTimer); badgeTimer = null; }
    showLogin();
    A.toast('You have been signed out.', 'info');
  }
  ['sidebarLogout', 'userLogout'].forEach((id) => {
    const el = A.qs('#' + id);
    if (el) el.addEventListener('click', logout);
  });

  // ── Sidebar / dropdown / mobile ──
  const setSidebar = (open) => app.classList.toggle('sidebar-open', open);
  A.qs('#menuBtn').addEventListener('click', () => setSidebar(true));
  A.qs('#sidebarClose').addEventListener('click', () => setSidebar(false));
  A.qs('#sidebarScrim').addEventListener('click', () => setSidebar(false));
  A.qsa('.nav-link').forEach((link) => link.addEventListener('click', () => setSidebar(false)));

  const userChip = A.qs('#userChip');
  const userDropdown = A.qs('#userDropdown');
  userChip.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = userDropdown.classList.toggle('open');
    userChip.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!userDropdown.contains(e.target) && !userChip.contains(e.target)) {
      userDropdown.classList.remove('open');
      userChip.setAttribute('aria-expanded', 'false');
    }
  });
  A.qsa('[data-route-link]', userDropdown).forEach((a) => a.addEventListener('click', () => userDropdown.classList.remove('open')));

  A.qs('#topbarBell').addEventListener('click', showNotifications);

  // ── Notifications ──
  let lastStats = null;
  async function refreshBadges() {
    if (!A.staff) return;
    try {
      const stats = await A.api('/stats?range=7');
      lastStats = stats;
      const k = stats.kpis;
      const setBadge = (id, value, show) => {
        const el = A.qs('#' + id);
        if (!el) return;
        el.textContent = value;
        el.hidden = !show;
      };
      setBadge('navOrdersBadge', k.activeOrders, k.activeOrders > 0);
      setBadge('navKitchenBadge', stats.statusCounts?.preparing || 0, (stats.statusCounts?.preparing || 0) > 0);
      setBadge('navStockBadge', k.lowStockCount, k.lowStockCount > 0);
      setBadge('navResBadge', k.pendingReservations || 0, (k.pendingReservations || 0) > 0);
      setBadge('navMsgBadge', k.unreadMessages || 0, (k.unreadMessages || 0) > 0);
      const bell = A.qs('#bellDot');
      if (bell) bell.hidden = !(k.lowStockCount || k.unreadMessages || k.pendingReservations);
      setBadge('navOrdersBadge', k.activeOrders, k.activeOrders > 0);
    } catch (_) { /* silent */ }
  }
  function startBadgeRefresh() {
    refreshBadges();
    if (badgeTimer) clearInterval(badgeTimer);
    badgeTimer = setInterval(refreshBadges, 60000);
  }

  async function showNotifications() {
    const m = A.modal({
      title: 'Service notices',
      subtitle: 'Things that may need your attention right now.',
      size: 'sm',
      body: `<div class="view-loading" style="min-height:120px"><span class="spinner"></span></div>`,
      footer: `<a class="btn btn-soft left" href="#/settings" data-goto="settings"><i data-lucide="inbox"></i> Open messages</a><button class="btn btn-gold" data-close>Done</button>`,
      onMount: (modal) => {
        A.qs('[data-close]', modal.footer).addEventListener('click', modal.close);
        A.qs('[data-goto]', modal.footer).addEventListener('click', modal.close);
      }
    });
    try {
      const stats = lastStats || await A.api('/stats?range=7');
      const k = stats.kpis;
      const items = [];
      if (k.lowStockCount) items.push({ icon: 'package-search', cls: 'danger', title: `${k.lowStockCount} ingredient${k.lowStockCount > 1 ? 's' : ''} low in stock`, sub: 'Review purchase orders before service.', route: 'inventory' });
      if (k.pendingReservations) items.push({ icon: 'calendar-clock', cls: '', title: `${k.pendingReservations} reservation${k.pendingReservations > 1 ? 's' : ''} awaiting confirmation`, sub: 'Confirm the book before tonight’s service.', route: 'reservations' });
      if (k.unreadMessages) items.push({ icon: 'mail', cls: '', title: `${k.unreadMessages} unread guest message${k.unreadMessages > 1 ? 's' : ''}`, sub: 'Reply from Settings → Messages.', route: 'settings' });
      if (k.activeOrders) items.push({ icon: 'receipt-text', cls: '', title: `${k.activeOrders} active order${k.activeOrders > 1 ? 's' : ''} in service`, sub: 'Track preparation and delivery.', route: 'orders' });
      m.body.innerHTML = items.length
        ? `<div class="notice-list">${items.map((it) => `<a class="notice ${it.cls}" href="#/${it.route}" data-notice-route="${it.route}"><i data-lucide="${it.icon}"></i><div><strong>${A.esc(it.title)}</strong><span>${A.esc(it.sub)}</span></div></a>`).join('')}</div>`
        : `<div class="table-empty" style="padding:26px 10px"><i data-lucide="check-circle-2"></i><strong>All clear</strong><span>No outstanding alerts at the moment.</span></div>`;
      A.icons();
      A.qsa('[data-notice-route]', m.body).forEach((a) => a.addEventListener('click', m.close));
    } catch (err) {
      m.body.innerHTML = `<div class="modal-note danger">${A.esc(err.message)}</div>`;
    }
  }

  // ── Router ──
  function currentRoute() {
    const raw = (location.hash || '#/dashboard').replace(/^#\/?/, '');
    return (raw.split('?')[0] || 'dashboard').replace(/\/+$/, '') || 'dashboard';
  }

  function setActiveNav(route) {
    A.qsa('.nav-link').forEach((l) => l.classList.toggle('active', l.dataset.route === route));
  }

  function renderNoAccess(route) {
    const cfg = ROUTES[route];
    A.qs('#view').innerHTML = `
      <div class="card card-pad" style="max-width:560px;margin:8vh auto;text-align:center">
        <div class="confirm-icon warn" style="margin:0 auto 16px"><i data-lucide="shield-alert"></i></div>
        <h2 style="font-family:var(--font-display);font-size:30px;font-weight:500">Access restricted</h2>
        <p style="color:var(--muted);font-size:12px;margin-top:7px;line-height:1.6">Your role (${A.esc(A.roleLabel(A.staff?.role))}) does not have access to ${A.esc(cfg?.title || 'this module')}. Ask an administrator if you need this permission.</p>
        <a href="#/dashboard" class="btn btn-gold" style="margin-top:18px"><i data-lucide="layout-dashboard"></i> Back to dashboard</a>
      </div>`;
    A.icons();
  }

  async function route() {
    if (!A.staff) return;
    const name = currentRoute();
    const cfg = ROUTES[name];
    const token = ++routeToken;
    A.qs('#userDropdown').classList.remove('open');
    setSidebar(false);

    // Clean up previous view (timers, polls, charts)
    try { if (typeof A.cleanup === 'function') A.cleanup(); } catch (_) {}
    A.cleanup = null;
    A.destroyCharts();
    A.qsa('#modalRoot .modal-backdrop').forEach((el) => el.remove());
    document.body.classList.remove('modal-open');

    setActiveNav(name);
    if (!cfg) {
      A.qs('#view').innerHTML = `<div class="table-empty" style="padding-top:15vh"><i data-lucide="compass"></i><strong>Page not found</strong><span>The section “${A.esc(name)}” does not exist.</span><a class="btn btn-gold" href="#/dashboard" style="margin-top:16px">Go to dashboard</a></div>`;
      A.icons();
      return;
    }
    A.qs('#topbarKicker').textContent = cfg.kicker;
    A.qs('#topbarTitle').textContent = cfg.title;
    document.title = `${cfg.title} · Saffron House Admin`;
    A.route = name;

    if (!A.can(cfg.permission)) {
      renderNoAccess(name);
      return;
    }
    const view = A.qs('#view');
    view.innerHTML = `<div class="view-loading"><span class="spinner"></span><p>Loading ${A.esc(cfg.title.toLowerCase())}…</p></div>`;
    view.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'instant' });

    const fn = A.views[name];
    if (typeof fn !== 'function') {
      view.innerHTML = `<div class="table-empty" style="padding-top:14vh"><i data-lucide="construction"></i><strong>This module is not wired up</strong><span>The ${A.esc(cfg.title)} view is unavailable.</span></div>`;
      A.icons();
      return;
    }
    try {
      const cleanup = await fn(view, { token, isCurrent: () => token === routeToken });
      if (token !== routeToken) { try { if (typeof cleanup === 'function') cleanup(); } catch (_) {} return; }
      if (typeof cleanup === 'function') A.cleanup = cleanup;
      A.icons();
    } catch (err) {
      if (token !== routeToken) return;
      if (err?.status === 401) return A.onUnauthorized();
      view.innerHTML = `<div class="card card-pad" style="max-width:560px;margin:8vh auto;text-align:center">
        <div class="confirm-icon" style="margin:0 auto 16px"><i data-lucide="alert-triangle"></i></div>
        <h2 style="font-family:var(--font-display);font-size:28px;font-weight:500">Could not load this page</h2>
        <p style="color:var(--muted);font-size:12px;margin-top:6px">${A.esc(err.message || 'Unexpected error')}</p>
        <button class="btn btn-gold" style="margin-top:16px" onclick="location.reload()"><i data-lucide="refresh-cw"></i> Try again</button>
      </div>`;
      A.icons();
    }
  }
  window.addEventListener('hashchange', route);

  A.onUnauthorized = () => {
    A.staff = null;
    A.toast('Your session has ended. Please sign in again.', 'error', 'Signed out');
    showLogin();
  };

  // ── Keyboard: Ctrl/Cmd+K command palette ──
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && A.staff) {
      e.preventDefault();
      openPalette();
    }
    if (e.key.toLowerCase() === 'p' && A.staff && !e.ctrlKey && !e.metaKey && !/input|textarea|select/i.test(document.activeElement?.tagName || '') && A.can('pos') && !A.qs('.modal-backdrop')) {
      location.hash = '#/pos';
    }
  });
  function openPalette() {
    const routes = Object.entries(ROUTES).filter(([, cfg]) => A.can(cfg.permission));
    const m = A.modal({
      title: 'Quick navigation', size: 'sm', body: `<div class="search-box" style="max-width:none;margin-bottom:10px"><i data-lucide="search"></i><input type="search" id="paletteSearch" placeholder="Find a section…" autocomplete="off"></div><div class="mini-list" id="paletteList"></div>`
    });
    const list = A.qs('#paletteList', m.body);
    const render = (q = '') => {
      const filtered = routes.filter(([, cfg]) => cfg.title.toLowerCase().includes(q.toLowerCase()) || cfg.kicker.toLowerCase().includes(q.toLowerCase()));
      list.innerHTML = filtered.length ? filtered.map(([key, cfg]) => `<a class="mini-row" href="#/${key}" data-palette-route="${key}" style="text-decoration:none"><span class="mr-left"><i data-lucide="corner-down-right" style="width:13px;height:13px;color:var(--gold-dark)"></i><span><strong>${A.esc(cfg.title)}</strong><span> · ${A.esc(cfg.kicker)}</span></span></span><b style="color:var(--muted-2)">↵</b></a>`).join('') : `<div class="table-empty" style="padding:20px">No matching section.</div>`;
      A.icons();
      A.qsa('[data-palette-route]', list).forEach((a) => a.addEventListener('click', m.close));
    };
    render();
    const search = A.qs('#paletteSearch', m.body);
    search.addEventListener('input', () => render(search.value));
    search.focus();
  }

  // ── Boot ──
  async function boot() {
    const me = await A.raw('/api/auth/staff/me');
    A.staff = me.staff;
    try {
      const site = await A.raw('/api/site');
      A.siteSettings = site.settings;
      A.settings = { ...(A.settings || {}), ...site.settings };
    } catch (_) {}
    showApp();
    booted = true;
    if (!location.hash || location.hash === '#') location.hash = '#/dashboard';
    else await route();
  }

  (async function init() {
    A.icons();
    try {
      await boot();
    } catch (err) {
      showLogin();
      if (err.status && err.status !== 401) A.toast(err.message, 'error');
    }
    // Re-check session when tab regains focus after a long pause
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible' || !booted || !A.staff) return;
      try { await A.raw('/api/auth/staff/me'); } catch (err) { if (err.status === 401) A.onUnauthorized(); }
    });
  })();
})();
