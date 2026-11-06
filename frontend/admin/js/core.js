/* ==========================================================================
   Saffron House — Admin core runtime
   Shared API client, formatters, modals, toasts, charts and UI helpers.
   ========================================================================== */
(function () {
  'use strict';

  const A = (window.A = window.A || {});
  A.views = A.views || {};
  A.settings = A.settings || { currency_symbol: 'Rs.', tax_rate: 5, delivery_fee: 250 };
  A.siteSettings = null;
  A.staff = null;
  A.charts = [];
  A.cleanup = null;
  A.route = 'dashboard';

  const ROLE_PERMISSIONS = {
    admin: ['*'],
    manager: ['dashboard', 'pos', 'orders', 'kitchen', 'billing', 'menu', 'inventory', 'recipes', 'tables', 'reservations', 'customers', 'staff', 'suppliers', 'expenses', 'reports', 'settings'],
    cashier: ['dashboard', 'pos', 'orders', 'billing', 'customers', 'reservations', 'tables'],
    waiter: ['dashboard', 'pos', 'orders', 'tables', 'reservations', 'customers'],
    kitchen: ['dashboard', 'orders', 'kitchen']
  };
  A.ROLE_PERMISSIONS = ROLE_PERMISSIONS;
  A.ROLE_LABELS = { admin: 'Administrator', manager: 'Manager', cashier: 'Cashier', waiter: 'Waiter', kitchen: 'Kitchen' };

  // ── Utilities ──
  A.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  A.symbol = () => A.siteSettings?.currency_symbol || A.settings?.currency_symbol || 'Rs.';
  A.money = (n) => `${A.symbol()} ${Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
  A.money2 = (n) => `${A.symbol()} ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  A.num = (n, d = 0) => Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: d });
  A.pct = (n, d = 1) => `${Number(n || 0).toFixed(d)}%`;
  A.pad = (n) => String(n).padStart(2, '0');

  A.parse = (s) => {
    if (!s) return null;
    const d = new Date(String(s).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  A.date = (s) => {
    const d = A.parse(s);
    return d ? d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  };
  A.dateShort = (s) => {
    const d = A.parse(s);
    return d ? d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' }) : '—';
  };
  A.time = (s) => {
    const d = A.parse(s);
    return d ? d.toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' }) : '—';
  };
  A.dateTime = (s) => {
    const d = A.parse(s);
    return d ? `${d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' })}` : '—';
  };
  A.timeAgo = (s) => {
    const d = A.parse(s);
    if (!d) return '—';
    const diff = Math.max(0, Date.now() - d.getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
    return A.date(s);
  };
  A.today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${A.pad(d.getMonth() + 1)}-${A.pad(d.getDate())}`;
  };
  A.daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${A.pad(d.getMonth() + 1)}-${A.pad(d.getDate())}`;
  };
  A.addDays = (iso, n) => {
    const d = A.parse(iso) || new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${A.pad(d.getMonth() + 1)}-${A.pad(d.getDate())}`;
  };
  A.initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  A.capitalize = (s) => String(s || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  A.statusLabel = (s) => ({ 'dine-in': 'Dine-in', 'takeaway': 'Takeaway', 'delivery': 'Delivery', out_for_delivery: 'Out for delivery', pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled', paid: 'Paid', unpaid: 'Unpaid', refunded: 'Refunded' }[s] || A.capitalize(s));
  A.roleLabel = (r) => A.ROLE_LABELS[r] || A.capitalize(r);
  A.avatarColor = (name) => {
    const colors = ['#c19a3e', '#3d629c', '#72539b', '#b23a33', '#2f7a52', '#b06c15', '#267085', '#a33b63'];
    let h = 0;
    for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 9973;
    return colors[h % colors.length];
  };
  A.debounce = (fn, ms = 250) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };
  A.qs = (s, el = document) => el.querySelector(s);
  A.qsa = (s, el = document) => Array.from(el.querySelectorAll(s));
  A.clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  A.safeId = (s) => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '');

  A.can = (permission) => {
    if (!A.staff) return false;
    const perms = ROLE_PERMISSIONS[A.staff.role] || [];
    return perms.includes('*') || perms.includes(permission);
  };
  A.isAdmin = () => A.staff?.role === 'admin';
  A.isManager = () => A.staff?.role === 'manager' || A.isAdmin();

  A.icons = (root) => {
    try { if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 }, nameAttr: 'data-lucide' }); } catch (_) {}
  };

  // ── API ──
  A.raw = async (path, options = {}) => {
    const opts = { credentials: 'same-origin', ...options };
    if (opts.body && !(opts.body instanceof FormData)) {
      opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
      if (typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    const ct = res.headers.get('content-type') || '';
    let data = null;
    if (ct.includes('application/json')) data = await res.json().catch(() => null);
    else data = await res.text().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  };
  A.api = (path, options) => A.raw(path.startsWith('/api') ? path : `/api/admin${path}`, options);

  A.notifyError = (err) => {
    if (err?.status === 401 && typeof A.onUnauthorized === 'function') return A.onUnauthorized();
    A.toast(err?.message || 'Something went wrong. Please try again.', 'error', 'Could not complete');
  };

  // ── Toasts ──
  A.toast = (message, type = 'info', title = '') => {
    const stack = A.qs('#toastStack') || (() => {
      const el = document.createElement('div');
      el.className = 'toast-stack';
      el.id = 'toastStack';
      document.body.appendChild(el);
      return el;
    })();
    const icon = type === 'success' ? 'check-circle-2' : type === 'error' ? 'alert-circle' : 'info';
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i data-lucide="${icon}"></i><div>${title ? `<strong>${A.esc(title)}</strong>` : ''}<span>${A.esc(message)}</span></div>`;
    stack.appendChild(el);
    A.icons();
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 320);
    }, 4200);
  };

  // ── Modals ──
  A.modal = ({ title = '', subtitle = '', body = '', footer = '', size = '', flush = false, onMount, onClose, closable = true }) => {
    const root = A.qs('#modalRoot') || document.body;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${A.esc(title || 'Dialog')}">
        ${title || closable ? `<div class="modal-head">
          <div>${title ? `<h3>${title}</h3>` : ''}${subtitle ? `<p>${subtitle}</p>` : ''}</div>
          ${closable ? `<button class="modal-close" type="button" aria-label="Close dialog"><i data-lucide="x"></i></button>` : ''}
        </div>` : ''}
        <div class="modal-body ${flush ? 'flush' : ''}">${body}</div>
        <div class="modal-foot">${footer}</div>
      </div>`;
    root.appendChild(backdrop);
    document.body.classList.add('modal-open');
    const modal = A.qs('.modal', backdrop);
    const prevFocus = document.activeElement;

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      backdrop.remove();
      if (!A.qs('#modalRoot .modal-backdrop')) document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', onKey);
      try { onClose && onClose(); } catch (_) {}
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && closable) { e.preventDefault(); close(); }
    };
    document.addEventListener('keydown', onKey);
    A.qsa('.modal-close', backdrop).forEach((b) => b.addEventListener('click', close));
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && closable) close(); });

    const api = { el: backdrop, modal, body: A.qs('.modal-body', backdrop), footer: A.qs('.modal-foot', backdrop), close };
    A.icons();
    try { onMount && onMount(api); } catch (err) { console.error(err); }
    requestAnimationFrame(() => {
      const target = A.qs('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button.btn-gold', A.qs('.modal-body', backdrop)) || A.qs('.modal-close', backdrop);
      if (target) target.focus({ preventScroll: true });
    });
    return api;
  };

  A.confirm = ({ title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = true, icon = 'alert-triangle', note = '', onConfirm } = {}) => {
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        m.close();
        resolve(value);
      };
      const m = A.modal({
        title: '', size: 'sm', closable: true,
        body: `<div class="confirm-icon ${danger ? '' : 'warn'}"><i data-lucide="${icon}"></i></div>
          <div class="confirm-body"><strong>${A.esc(title)}</strong><p>${message}</p>${note ? `<div class="modal-note ${danger ? 'danger' : ''}" style="margin-top:12px">${note}</div>` : ''}</div>`,
        footer: `<button class="btn btn-soft" data-cancel>${A.esc(cancelText)}</button><button class="btn ${danger ? 'btn-danger' : 'btn-gold'}" data-ok>${A.esc(confirmText)}</button>`,
        onMount: (m) => {
          A.qs('[data-cancel]', m.footer).addEventListener('click', () => finish(false));
          A.qs('[data-ok]', m.footer).addEventListener('click', async () => {
            if (onConfirm) {
              try { await onConfirm(); } catch (err) { A.notifyError(err); return; }
            }
            finish(true);
          });
        }
      });
      m.footer.querySelector('[data-cancel]').focus();
    });
  };

  A.deleteConfirm = (name, onConfirm, { title = 'Delete this record?', message = 'This action cannot be undone.' } = {}) =>
    A.confirm({
      title,
      message: name ? `<strong>${A.esc(name)}</strong><br>${A.esc(message)}` : message,
      confirmText: 'Delete',
      danger: true,
      onConfirm
    });

  // ── Busy buttons ──
  A.busy = (btn, isBusy, label) => {
    if (!btn) return;
    if (isBusy) {
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner" style="width:13px;height:13px;border-width:1.5px"></span>${label ? `<span>${A.esc(label)}</span>` : ''}`;
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  };
  // Async handlers lose event.currentTarget after the first await. Capture the
  // button on the event object while it is still available so the finally
  // block can always restore the control.
  A.busyEvent = (event, isBusy, label) => {
    if (!event) return;
    if (isBusy) {
      const btn = event.currentTarget || event.target?.closest?.('button') || null;
      event._busyButton = btn;
      A.busy(btn, true, label);
      return;
    }
    const btn = event._busyButton || null;
    event._busyButton = null;
    A.busy(btn, false);
  };

  // ── HTML helpers ──
  A.empty = (title = 'Nothing here yet', sub = '', icon = 'inbox') =>
    `<div class="table-empty"><i data-lucide="${icon}"></i><strong>${A.esc(title)}</strong><span>${A.esc(sub)}</span></div>`;

  A.badge = (status, label) => `<span class="badge ${A.esc(String(status || '').replace(/\s+/g, '_'))}">${A.esc(label || A.statusLabel(status))}</span>`;
  A.orderBadge = (s) => A.badge(s);
  A.payBadge = (s) => A.badge(s);
  A.vegMark = (isVeg) => isVeg ? '<span class="veg-dot" title="Vegetarian"></span>' : '<span class="nonveg-dot" title="Non-vegetarian"></span>';
  A.trend = (value) => {
    const n = Number(value || 0);
    const up = n >= 0;
    return `<span class="trend ${up ? 'up' : 'down'}"><i data-lucide="${up ? 'arrow-up-right' : 'arrow-down-right'}"></i>${up ? '+' : ''}${Number(n).toFixed(1)}%</span>`;
  };
  A.img = (src, fallback = '/assets/images/food-spread.jpg') => A.esc(src || fallback);
  A.options = (items, selected, valueKey = 'id', labelKey = 'name', placeholder = '') => {
    const sel = String(selected ?? '');
    return `${placeholder ? `<option value="">${A.esc(placeholder)}</option>` : ''}${(items || []).map((it) => {
      const v = String(typeof it === 'object' ? it[valueKey] : it);
      const l = typeof it === 'object' ? (it[labelKey] ?? v) : it;
      return `<option value="${A.esc(v)}" ${v === sel ? 'selected' : ''}>${A.esc(l)}</option>`;
    }).join('')}`;
  };

  A.formData = (form) => {
    const fd = new FormData(form);
    const obj = {};
    for (const [k, v] of fd.entries()) { obj[k] = v; }
    A.qsa('input[type="checkbox"]', form).forEach((el) => { if (el.name) obj[el.name] = el.checked; });
    return obj;
  };

  A.fieldError = (form, message) => {
    let el = A.qs('.form-error', form);
    if (!el) {
      el = document.createElement('p');
      el.className = 'form-error';
      form.prepend(el);
    }
    el.textContent = message || '';
    if (message) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  A.submit = async (btn, fn, label = 'Saving…') => {
    A.busy(btn, true, label);
    try { return await fn(); }
    finally { A.busy(btn, false); }
  };

  // ── Chart helpers ──
  const palette = ['#c19a3e', '#3d629c', '#2f7a52', '#b23a33', '#72539b', '#b06c15', '#267085', '#a33b63'];
  A.palette = palette;
  A.chart = (canvas, config) => {
    if (!canvas || !window.Chart) return null;
    const existing = A.charts.find((c) => c.canvas === canvas);
    if (existing) { try { existing.chart.destroy(); } catch (_) {} A.charts = A.charts.filter((c) => c !== existing); }
    const chart = new Chart(canvas, config);
    A.charts.push({ canvas, chart });
    return chart;
  };
  A.destroyCharts = () => {
    A.charts.forEach(({ chart }) => { try { chart.destroy(); } catch (_) {} });
    A.charts = [];
  };
  if (window.Chart) {
    Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";
    Chart.defaults.font.size = 10;
    Chart.defaults.color = '#8a8375';
    Chart.defaults.borderColor = '#ece7dc';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 7;
    Chart.defaults.plugins.legend.labels.boxHeight = 7;
    Chart.defaults.plugins.legend.labels.padding = 14;
    Chart.defaults.plugins.tooltip.backgroundColor = '#201d16';
    Chart.defaults.plugins.tooltip.titleFont = { size: 11, weight: '600' };
    Chart.defaults.plugins.tooltip.bodyFont = { size: 10.5 };
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 7;
    Chart.defaults.plugins.tooltip.displayColors = true;
    Chart.defaults.plugins.tooltip.boxWidth = 7;
    Chart.defaults.plugins.tooltip.boxHeight = 7;
  }
  A.gradient = (ctx, area, color = '193,154,62') => {
    if (!ctx || !area) return `rgba(${color},.16)`;
    const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, `rgba(${color},.26)`);
    g.addColorStop(1, `rgba(${color},0)`);
    return g;
  };

  // ── Printing ──
  A.printInvoice = (id) => {
    if (!id) return A.toast('This order has no invoice yet.', 'error');
    window.open(`/print/invoice/${encodeURIComponent(id)}`, '_blank', 'noopener,width=920,height=780');
  };

  // ── Live clock ──
  A.startClock = () => {
    const el = A.qs('#liveClock span');
    if (!el) return;
    const tick = () => {
      el.textContent = new Date().toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    };
    tick();
    return setInterval(tick, 1000);
  };

  // ── File upload helper ──
  A.uploadImage = async (file) => {
    const fd = new FormData();
    fd.append('image', file);
    const data = await A.raw('/api/admin/upload', { method: 'POST', body: fd });
    return data.url;
  };

  // ── Browser download via fetch (auth-safe) ──
  A.download = async (url, filename) => {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Download failed.');
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || 'download';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    } catch (err) { A.notifyError(err); }
  };

  A.rangeFor = (days) => ({ from: A.daysAgo(Math.max(0, Number(days) - 1)), to: A.today() });

  A.escapeAttr = A.esc;
})();
