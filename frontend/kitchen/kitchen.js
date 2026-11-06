/* ==========================================================================
   Saffron House — Standalone Kitchen Display System
   Staff session check, live ticket polling, status moves, filters,
   full-screen mode and a Web Audio new-ticket chime.
   ========================================================================== */
(function () {
  'use strict';

  const POLL_MS = 10000;
  const CLOCK_MS = 1000;
  const TICK_MS = 15000;
  const ALLOWED_ROLES = ['admin', 'manager', 'kitchen'];
  const SOUND_KEY = 'saffron_kds_sound';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = {
    staff: null,
    orders: [],
    filter: 'all',
    previousIds: new Set(),
    firstLoad: true,
    sound: localStorage.getItem(SOUND_KEY) !== 'off',
    audioCtx: null,
    loading: false,
    online: true,
    pollTimer: null,
    clockTimer: null,
    tickTimer: null,
    pendingUpdate: new Set()
  };

  const el = {
    loginScreen: $('#loginScreen'),
    loginForm: $('#loginForm'),
    loginEmail: $('#loginEmail'),
    loginPassword: $('#loginPassword'),
    loginError: $('#loginError'),
    loginSubmit: $('#loginSubmit'),
    togglePassword: $('#togglePassword'),
    fillDemo: $('#fillDemo'),
    kds: $('#kds'),
    clockTime: $('#clockTime'),
    clockDate: $('#clockDate'),
    footClock: $('#footClock'),
    liveDot: $('#liveDot'),
    liveLabel: $('#liveLabel'),
    lastSync: $('#lastSync'),
    soundBtn: $('#soundBtn'),
    refreshBtn: $('#refreshBtn'),
    fullscreenBtn: $('#fullscreenBtn'),
    logoutBtn: $('#logoutBtn'),
    staffInitials: $('#staffInitials'),
    staffName: $('#staffName'),
    staffRole: $('#staffRole'),
    typeFilter: $('#typeFilter'),
    kdsSummary: $('#kdsSummary'),
    offlineBar: $('#offlineBar'),
    offlineText: $('#offlineText'),
    offlineRetry: $('#offlineRetry'),
    board: $('#kdsBoard'),
    colPending: $('#colPending'),
    colPreparing: $('#colPreparing'),
    colReady: $('#colReady'),
    countPending: $('#countPending'),
    countPreparing: $('#countPreparing'),
    countReady: $('#countReady'),
    toastRoot: $('#toastRoot')
  };

  // ── Formatting / escaping ──
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const icon = (name, cls = '') => `<i data-lucide="${name}"${cls ? ` class="${cls}"` : ''}></i>`;

  function typeLabel(type) {
    return ({ 'dine-in': 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery' })[type] || 'Order';
  }

  function parseDate(value) {
    if (!value) return null;
    const d = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function elapsedMinutes(order) {
    const d = parseDate(order.created_at);
    if (!d) return Number(order.minutes_elapsed || 0);
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  }

  function timeClass(mins) {
    return mins >= 20 ? 'late' : mins >= 10 ? 'warn' : '';
  }

  function staffInitials(name) {
    return String(name || 'SH').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
  }

  // ── API ──
  async function api(path, options = {}) {
    const opts = { credentials: 'same-origin', ...options };
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
      opts.body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(`/api${path}`, opts);
    } catch (_) {
      const err = new Error('Could not reach the server. Check the connection and try again.');
      err.status = 0;
      throw err;
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* no JSON body */ }
    if (!res.ok) {
      const err = new Error(data?.error || `Request failed (${res.status}).`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ── Toasts ──
  function toast(message, tone = 'success') {
    const node = document.createElement('div');
    node.className = `toast ${tone}`;
    node.innerHTML = `${icon(tone === 'success' ? 'check-circle-2' : tone === 'error' ? 'alert-circle' : 'info')}<span>${esc(message)}</span>`;
    el.toastRoot.appendChild(node);
    refreshIcons();
    setTimeout(() => {
      node.style.transition = 'opacity .2s, transform .2s';
      node.style.opacity = '0';
      node.style.transform = 'translateY(6px)';
      setTimeout(() => node.remove(), 220);
    }, 3600);
  }

  // ── Sound ──
  function updateSoundButton() {
    el.soundBtn.setAttribute('aria-pressed', String(state.sound));
    el.soundBtn.classList.toggle('muted', !state.sound);
    el.soundBtn.innerHTML = `${icon(state.sound ? 'volume-2' : 'volume-x')}<span class="sr-only">${state.sound ? 'Mute' : 'Unmute'} new-ticket sound</span>`;
    el.soundBtn.title = state.sound ? 'New-ticket sound is on' : 'New-ticket sound is off';
    refreshIcons();
  }

  function audioContext() {
    if (!state.audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      state.audioCtx = new Ctx();
    }
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume().catch(() => {});
    return state.audioCtx;
  }

  function chime() {
    if (!state.sound) return;
    const ctx = audioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [[880, 0], [1174.66, 0.16], [1567.98, 0.32]].forEach(([freq, offset]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.12, now + offset + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.42);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.45);
    });
  }

  // ── Login / session ──
  function showLogin(message = '') {
    stopTimers();
    state.staff = null;
    el.loginError.textContent = message;
    el.kds.classList.add('hidden');
    el.loginScreen.classList.remove('hidden');
    document.title = 'Saffron House — Kitchen Display';
    setTimeout(() => el.loginEmail.focus(), 30);
  }

  function showKds() {
    el.loginScreen.classList.add('hidden');
    el.kds.classList.remove('hidden');
    const initials = staffInitials(state.staff?.name);
    el.staffInitials.textContent = initials;
    el.staffName.textContent = state.staff?.name || 'Kitchen';
    el.staffRole.textContent = state.staff?.role || 'kitchen';
    updateSoundButton();
    startTimers();
  }

  async function checkSession() {
    try {
      const data = await api('/auth/staff/me');
      applySession(data.staff);
      return true;
    } catch (err) {
      if (err.status !== 401) {
        // A server/network problem should not silently drop the user onto login.
        el.loginError.textContent = err.message;
      }
      showLogin();
      return false;
    }
  }

  function applySession(staff) {
    if (!ALLOWED_ROLES.includes(staff.role)) {
      throw Object.assign(new Error('This screen is for kitchen, manager and administrator accounts. Ask your manager for access.'), { code: 'ROLE' });
    }
    state.staff = staff;
    state.previousIds = new Set();
    state.firstLoad = true;
    showKds();
  }

  el.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    el.loginError.textContent = '';
    const email = el.loginEmail.value.trim();
    const password = el.loginPassword.value;
    if (!email || !password) {
      el.loginError.textContent = 'Enter your staff email and password.';
      return;
    }
    const original = el.loginSubmit.innerHTML;
    el.loginSubmit.disabled = true;
    el.loginSubmit.innerHTML = `<span class="spinner"></span><span>Signing in…</span>`;
    audioContext(); // Unlock audio during this user gesture.
    try {
      const data = await api('/auth/staff/login', { method: 'POST', body: { email, password } });
      applySession(data.staff);
      el.loginPassword.value = '';
      await loadOrders();
    } catch (err) {
      if (err.code === 'ROLE') {
        await api('/auth/staff/logout', { method: 'POST' }).catch(() => {});
      }
      el.loginError.textContent = err.message;
      el.loginPassword.focus();
      el.loginPassword.select();
    } finally {
      el.loginSubmit.disabled = false;
      el.loginSubmit.innerHTML = original;
      refreshIcons();
    }
  });

  el.fillDemo.addEventListener('click', () => {
    el.loginEmail.value = 'kitchen@saffronhouse.pk';
    el.loginPassword.value = 'kitchen123';
    el.loginError.textContent = '';
    el.loginPassword.focus();
  });

  el.togglePassword.addEventListener('click', () => {
    const showing = el.loginPassword.type === 'text';
    el.loginPassword.type = showing ? 'password' : 'text';
    el.togglePassword.innerHTML = icon(showing ? 'eye' : 'eye-off');
    el.togglePassword.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    el.loginPassword.focus();
    refreshIcons();
  });

  el.logoutBtn.addEventListener('click', async () => {
    el.logoutBtn.disabled = true;
    try {
      await api('/auth/staff/logout', { method: 'POST' });
    } catch (_) { /* Clear the screen regardless. */ }
    el.logoutBtn.disabled = false;
    showLogin('You have signed out of the kitchen display.');
    refreshIcons();
  });

  // ── Filters ──
  el.typeFilter.addEventListener('click', (event) => {
    const button = event.target.closest('[data-type]');
    if (!button) return;
    state.filter = button.dataset.type;
    $$('[data-type]', el.typeFilter).forEach((b) => {
      const active = b === button;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    paint();
  });

  function filteredOrders() {
    if (state.filter === 'all') return state.orders;
    return state.orders.filter((o) => o.type === state.filter);
  }

  // ── Rendering ──
  function addonNames(item) {
    const addons = item?.addons;
    if (!addons) return [];
    if (Array.isArray(addons.names)) return addons.names;
    if (Array.isArray(addons)) return addons.map((a) => a.name || a).filter(Boolean);
    if (Array.isArray(addons.addons)) return addons.addons.map((a) => a.name || a).filter(Boolean);
    return [];
  }

  function ticketHTML(order, highlight) {
    const mins = elapsedMinutes(order);
    const where = order.type === 'dine-in'
      ? `Table ${esc(order.table_number || '—')}`
      : typeLabel(order.type);
    const items = Array.isArray(order.items) ? order.items : [];
    return `<article class="ticket ${esc(order.status)}${highlight ? ' is-new' : ''}" data-order="${order.id}">
      <header class="ticket-head">
        <div>
          <strong>${esc(order.order_number)}</strong>
          <span>${where} · ${esc(order.customer_name || 'Walk-in guest')}</span>
        </div>
        <span class="ticket-time ${timeClass(mins)}" data-elapsed="${order.id}">${mins} min</span>
      </header>
      <div class="ticket-items">
        ${items.length ? items.map((item) => {
          const addons = addonNames(item);
          return `<div class="ticket-item">
            <b>×${Number(item.qty) || 0}</b>
            <span>${esc(item.name)}${addons.length ? `<span class="ticket-addon">+ ${esc(addons.join(', '))}</span>` : ''}${item.notes ? `<span class="ticket-note">“${esc(item.notes)}”</span>` : ''}</span>
          </div>`;
        }).join('') : '<div class="ticket-item"><span class="muted">No items on this ticket.</span></div>'}
      </div>
      ${order.notes ? `<div class="ticket-order-note">Order note: ${esc(order.notes)}</div>` : ''}
      <footer class="ticket-foot">
        ${advanceButton(order)}
      </footer>
    </article>`;
  }

  function advanceButton(order) {
    const busy = state.pendingUpdate.has(order.id);
    const attrs = busy ? 'disabled' : '';
    if (order.status === 'ready') {
      return `<button class="btn btn-handover btn-sm" data-advance="${order.id}" data-status="completed" ${attrs}>
        ${icon('check')} ${busy ? 'Completing…' : 'Handed over'}
      </button>`;
    }
    if (order.status === 'preparing') {
      return `<button class="btn btn-ready btn-sm" data-advance="${order.id}" data-status="ready" ${attrs}>
        ${icon('bell-ring')} ${busy ? 'Updating…' : 'Mark ready'}
      </button>`;
    }
    return `<button class="btn btn-advance btn-sm" data-advance="${order.id}" data-status="preparing" ${attrs}>
      ${icon('flame')} ${busy ? 'Starting…' : 'Start cooking'}
    </button>`;
  }

  const COLUMNS = [
    { key: 'pending', statuses: ['pending', 'confirmed'], node: () => el.colPending, count: () => el.countPending, empty: 'No tickets waiting — the pass is clear.' },
    { key: 'preparing', statuses: ['preparing'], node: () => el.colPreparing, count: () => el.countPreparing, empty: 'Nothing on the range right now.' },
    { key: 'ready', statuses: ['ready'], node: () => el.colReady, count: () => el.countReady, empty: 'No dishes waiting for pickup.' }
  ];

  function paint() {
    const list = filteredOrders();
    const newIds = new Set();
    if (!state.firstLoad) {
      list.forEach((order) => {
        if (!state.previousIds.has(order.id)) newIds.add(order.id);
      });
    }

    COLUMNS.forEach((column) => {
      const orders = list
        .filter((o) => column.statuses.includes(o.status))
        .sort((a, b) => {
          const at = parseDate(a.created_at)?.getTime() || 0;
          const bt = parseDate(b.created_at)?.getTime() || 0;
          return at - bt;
        });
      column.count().textContent = String(orders.length);
      column.node().innerHTML = orders.length
        ? orders.map((o) => ticketHTML(o, newIds.has(o.id))).join('')
        : `<div class="col-empty">${esc(column.empty)}</div>`;
    });

    const total = list.length;
    const awaiting = list.filter((o) => ['pending', 'confirmed'].includes(o.status)).length;
    const preparing = list.filter((o) => o.status === 'preparing').length;
    const ready = list.filter((o) => o.status === 'ready').length;
    el.kdsSummary.textContent = `${total} live ticket${total === 1 ? '' : 's'} · ${awaiting} awaiting · ${preparing} cooking · ${ready} ready`;
    document.title = total ? `(${total}) Kitchen Pass — Saffron House` : 'Kitchen Pass — Saffron House';

    refreshIcons();

    if (newIds.size) {
      chime();
      const first = list.find((o) => newIds.has(o.id));
      toast(`New ticket ${first?.order_number || ''} ${first?.type === 'dine-in' && first?.table_number ? `· Table ${first.table_number}` : ''}`.trim(), 'info');
    }

    state.previousIds = new Set(list.map((o) => o.id));
    state.firstLoad = false;
  }

  function tickTimes() {
    $$('[data-elapsed]', el.board).forEach((node) => {
      const order = state.orders.find((o) => String(o.id) === String(node.dataset.elapsed));
      if (!order) return;
      const mins = elapsedMinutes(order);
      node.textContent = `${mins} min`;
      node.className = `ticket-time ${timeClass(mins)}`;
    });
  }

  // ── Data / polling ──
  function setConnection(online, message = '') {
    state.online = online;
    const wrap = el.liveDot.closest('.kds-connect');
    wrap.classList.toggle('offline', !online);
    el.liveLabel.textContent = online ? 'Live service' : 'Reconnecting';
    el.offlineBar.classList.toggle('hidden', online);
    if (!online) el.offlineText.textContent = message || 'Connection lost — showing the last known queue. Retrying…';
  }

  function setSyncTime() {
    const now = new Date();
    el.lastSync.textContent = `Synced ${now.toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
  }

  async function loadOrders({ manual = false } = {}) {
    if (!state.staff || state.loading) return;
    state.loading = true;
    if (manual) el.refreshBtn.classList.add('spin');
    try {
      const data = await api('/admin/kitchen/orders');
      state.orders = Array.isArray(data.orders) ? data.orders : [];
      setConnection(true);
      setSyncTime();
      paint();
    } catch (err) {
      if (err.status === 401) {
        showLogin('Your session expired. Sign in again to reopen the pass.');
        toast('Session expired — please sign in again.', 'error');
        return;
      }
      if (err.status === 403) {
        showLogin(err.message || 'Your account does not have kitchen access.');
        return;
      }
      setConnection(false, err.status === 0 ? err.message : 'The kitchen queue could not be refreshed. Retrying…');
      if (manual) toast(err.message, 'error');
    } finally {
      state.loading = false;
      el.refreshBtn.classList.remove('spin');
    }
  }

  async function advanceTicket(button) {
    const id = Number(button.dataset.advance);
    const status = button.dataset.status;
    if (!id || !status || state.pendingUpdate.has(id)) return;
    state.pendingUpdate.add(id);
    button.disabled = true;
    const original = button.innerHTML;
    button.innerHTML = `${icon('loader-circle')} Working…`;
    refreshIcons();
    try {
      await api(`/admin/orders/${id}/status`, { method: 'PATCH', body: { status } });
      const labels = { preparing: 'Cooking started', ready: 'Ticket marked ready', completed: 'Ticket handed over' };
      toast(labels[status] || 'Ticket updated', 'success');
      await loadOrders();
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
      button.innerHTML = original;
      refreshIcons();
    } finally {
      state.pendingUpdate.delete(id);
    }
  }

  el.board.addEventListener('click', (event) => {
    const button = event.target.closest('[data-advance]');
    if (button && !button.disabled) advanceTicket(button);
  });

  el.refreshBtn.addEventListener('click', () => loadOrders({ manual: true }));
  el.offlineRetry.addEventListener('click', () => loadOrders({ manual: true }));

  el.soundBtn.addEventListener('click', () => {
    state.sound = !state.sound;
    localStorage.setItem(SOUND_KEY, state.sound ? 'on' : 'off');
    updateSoundButton();
    if (state.sound) {
      audioContext();
      chime();
      toast('New-ticket sound turned on.', 'success');
    } else {
      toast('New-ticket sound muted.', 'info');
    }
  });

  // ── Clock / timers ──
  function updateClock() {
    const now = new Date();
    el.clockTime.textContent = now.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
    el.clockDate.textContent = now.toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    el.footClock.textContent = now.toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  }

  function startTimers() {
    stopTimers();
    updateClock();
    state.clockTimer = setInterval(updateClock, CLOCK_MS);
    state.pollTimer = setInterval(() => {
      if (!document.hidden) loadOrders();
    }, POLL_MS);
    state.tickTimer = setInterval(tickTimes, TICK_MS);
  }

  function stopTimers() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    if (state.clockTimer) clearInterval(state.clockTimer);
    if (state.tickTimer) clearInterval(state.tickTimer);
    state.pollTimer = state.clockTimer = state.tickTimer = null;
    state.orders = [];
    state.pendingUpdate.clear();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.staff) loadOrders();
  });

  // ── Full screen ──
  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function syncFullscreenButton() {
    const active = !!fullscreenElement();
    el.fullscreenBtn.innerHTML = `${icon(active ? 'minimize' : 'maximize')}<span class="sr-only">${active ? 'Exit full screen' : 'Full screen'}</span>`;
    el.fullscreenBtn.title = active ? 'Exit full screen' : 'Enter full screen';
    refreshIcons();
  }

  el.fullscreenBtn.addEventListener('click', async () => {
    try {
      if (fullscreenElement()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else if (el.kds.requestFullscreen) {
        await el.kds.requestFullscreen();
      } else if (el.kds.webkitRequestFullscreen) {
        el.kds.webkitRequestFullscreen();
      } else {
        toast('Full screen is not supported in this browser.', 'error');
      }
    } catch (_) {
      toast('Full screen was blocked by the browser.', 'error');
    }
    syncFullscreenButton();
  });

  ['fullscreenchange', 'webkitfullscreenchange'].forEach((name) => document.addEventListener(name, syncFullscreenButton));

  // ── Boot ──
  async function boot() {
    refreshIcons();
    updateClock();
    updateSoundButton();
    const signedIn = await checkSession();
    if (signedIn) await loadOrders();
    refreshIcons();
  }

  boot();
})();
