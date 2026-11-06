/* ==========================================================================
   Admin — Settings, messages, security & backup
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;
  const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];

  A.views.settings = async function (view) {
    const state = { tab: 'general', settings: {}, messages: [], destroyed: false };

    view.innerHTML = `<div class="view-loading"><span class="spinner"></span><p>Loading settings…</p></div>`;

    async function load() {
      try {
        const [s, m] = await Promise.all([A.api('/settings'), A.api('/messages').catch(() => ({ messages: [] }))]);
        if (state.destroyed) return;
        state.settings = s.settings || {};
        state.messages = m.messages || [];
        paint();
      } catch (err) {
        if (state.destroyed) return;
        view.innerHTML = `<div class="card card-pad" style="max-width:560px;margin:9vh auto;text-align:center"><div class="confirm-icon"><i data-lucide="alert-triangle"></i></div><h2 style="font-family:var(--font-display);font-size:28px">Settings unavailable</h2><p class="muted small">${A.esc(err.message)}</p></div>`;
        A.icons();
      }
    }

    function s(key, fallback = '') { return state.settings[key] ?? fallback; }
    function hours() { try { return JSON.parse(s('opening_hours', '{}')) || {}; } catch (_) { return {}; } }
    function socials() { try { return JSON.parse(s('socials', '{}')) || {}; } catch (_) { return {}; } }
    function unread() { return state.messages.filter((m) => m.status === 'new').length; }
    const tabs = () => [['general', 'Restaurant', 'store'], ['service', 'Service & tax', 'receipt'], ['hours', 'Hours & socials', 'clock-3'], ['receipt', 'Receipt', 'printer'], ['messages', `Messages${unread() ? ` (${unread()})` : ''}`, 'mail'], ['security', 'My account', 'shield-check'], ...(A.isAdmin() ? [['backup', 'Backup', 'database-backup']] : [])];

    function paint() {
      view.innerHTML = `
        <div class="view-head">
          <div class="view-head-copy"><h2>Settings</h2><p>Restaurant identity, service rules, receipts and system safety. Changes apply across the website and console.</p></div>
          <div class="view-head-actions"><span class="badge neutral" style="padding:7px 11px"><i data-lucide="shield-check"></i> ${A.isAdmin() ? 'Administrator' : 'Manager access'}</span></div>
        </div>
        <div class="settings-layout">
          <nav class="settings-nav" id="settingsNav">
            ${tabs().map(([k, l, icon]) => `<button data-stab="${k}" class="${state.tab === k ? 'active' : ''}"><i data-lucide="${icon}"></i> ${l}</button>`).join('')}
          </nav>
          <div id="settingsPanel"></div>
        </div>`;
      A.icons();
      A.qs('#settingsNav').addEventListener('click', (e) => {
        const b = e.target.closest('[data-stab]');
        if (!b) return;
        state.tab = b.dataset.stab;
        A.qsa('#settingsNav button').forEach((x) => x.classList.toggle('active', x === b));
        paintPanel();
      });
      paintPanel();
    }

    function paintPanel() {
      const panel = A.qs('#settingsPanel');
      if (!panel) return;
      if (state.tab === 'general') generalPanel(panel);
      if (state.tab === 'service') servicePanel(panel);
      if (state.tab === 'hours') hoursPanel(panel);
      if (state.tab === 'receipt') receiptPanel(panel);
      if (state.tab === 'messages') messagesPanel(panel);
      if (state.tab === 'security') securityPanel(panel);
      if (state.tab === 'backup') backupPanel(panel);
      A.icons();
    }

    function generalPanel(panel) {
      panel.innerHTML = `
        <div class="settings-panel">
          <h3>Restaurant identity</h3>
          <p>The name, contact details and branding shown on the website, invoices and emails.</p>
          <form id="generalForm"><div class="form-grid">
            <label class="field full"><span>Restaurant name *</span><input name="restaurant_name" value="${A.esc(s('restaurant_name'))}" required></label>
            <label class="field full"><span>Tagline</span><input name="tagline" value="${A.esc(s('tagline'))}"></label>
            <label class="field full"><span>Address</span><input name="address" value="${A.esc(s('address'))}"></label>
            <label class="field"><span>Phone</span><input name="phone" value="${A.esc(s('phone'))}"></label>
            <label class="field"><span>Email</span><input name="email" type="email" value="${A.esc(s('email'))}"></label>
            <label class="field"><span>Website</span><input name="website" value="${A.esc(s('website'))}"></label>
            <label class="field"><span>Logo monogram</span><input name="logo" maxlength="4" value="${A.esc(s('logo', 'SH'))}"></label>
            <label class="field"><span>Currency code</span><input name="currency" value="${A.esc(s('currency', 'PKR'))}"></label>
            <label class="field"><span>Currency symbol</span><input name="currency_symbol" value="${A.esc(s('currency_symbol', 'Rs.'))}"></label>
            <label class="field"><span>Order prefix</span><input name="order_prefix" maxlength="6" value="${A.esc(s('order_prefix', 'SH'))}"></label>
          </div>
          <div class="form-actions"><button type="button" class="btn btn-gold" data-save-general><i data-lucide="save"></i> Save restaurant details</button></div>
          </form>
        </div>`;
      A.qs('[data-save-general]', panel).addEventListener('click', (e) => saveSection(A.formData(A.qs('#generalForm', panel)), e.currentTarget));
    }

    function servicePanel(panel) {
      panel.innerHTML = `
        <div class="settings-panel">
          <h3>Service &amp; tax</h3>
          <p>These figures drive checkout totals, delivery charges and the tax lines on every invoice.</p>
          <form id="serviceForm"><div class="form-grid three">
            <label class="field"><span>Tax rate (%)</span><input name="tax_rate" type="number" min="0" max="50" step="0.1" value="${A.esc(s('tax_rate', '5'))}"></label>
            <label class="field"><span>Tax label</span><input name="tax_label" value="${A.esc(s('tax_label', 'GST'))}"></label>
            <label class="field"><span>Service charge (%)</span><input name="service_charge" type="number" min="0" step="0.1" value="${A.esc(s('service_charge', '0'))}"></label>
            <label class="field"><span>Delivery fee</span><input name="delivery_fee" type="number" min="0" step="1" value="${A.esc(s('delivery_fee', '250'))}"></label>
            <label class="field"><span>Minimum order</span><input name="min_order" type="number" min="0" step="1" value="${A.esc(s('min_order', '1000'))}"></label>
            <label class="field"><span>Reservation hold notice</span><input name="reservation_notice" value="${A.esc(s('reservation_notice'))}"></label>
            <label class="switch"><input type="checkbox" name="online_payment_enabled" ${s('online_payment_enabled', '1') === '1' ? 'checked' : ''}><span class="track"></span><span>Enable online payment</span></label>
            <label class="switch"><input type="checkbox" name="maintenance_mode" ${s('maintenance_mode', '0') === '1' ? 'checked' : ''}><span class="track"></span><span>Maintenance mode on website</span></label>
          </div>
          <div class="form-actions"><button type="button" class="btn btn-gold" data-save-service><i data-lucide="save"></i> Save service rules</button></div>
          </form>
        </div>`;
      A.qs('[data-save-service]', panel).addEventListener('click', (e) => {
        const fd = A.formData(A.qs('#serviceForm', panel));
        fd.online_payment_enabled = fd.online_payment_enabled ? '1' : '0';
        fd.maintenance_mode = fd.maintenance_mode ? '1' : '0';
        saveSection(fd, e.currentTarget);
      });
    }

    function hoursPanel(panel) {
      const h = hours();
      const so = socials();
      panel.innerHTML = `
        <div class="settings-panel">
          <h3>Opening hours &amp; socials</h3>
          <p>Shown on the website footer, contact page and homepage. Keep the hours as friendly display strings.</p>
          <form id="hoursForm"><div class="form-grid">
            ${DAYS.map(([k, l]) => `<label class="field"><span>${l}</span><input data-hour="${k}" value="${A.esc(h[k] || '')}" placeholder="12:00 PM – 11:30 PM"></label>`).join('')}
            <label class="field"><span>Instagram URL</span><input data-social="instagram" value="${A.esc(so.instagram || '')}"></label>
            <label class="field"><span>Facebook URL</span><input data-social="facebook" value="${A.esc(so.facebook || '')}"></label>
            <label class="field"><span>Twitter / X URL</span><input data-social="twitter" value="${A.esc(so.twitter || '')}"></label>
            <label class="field"><span>YouTube URL</span><input data-social="youtube" value="${A.esc(so.youtube || '')}"></label>
          </div>
          <div class="form-actions"><button type="button" class="btn btn-gold" data-save-hours><i data-lucide="save"></i> Save hours &amp; socials</button></div>
          </form>
        </div>`;
      A.qs('[data-save-hours]', panel).addEventListener('click', (e) => {
        const hObj = {};
        A.qsa('[data-hour]', panel).forEach((i) => { hObj[i.dataset.hour] = i.value; });
        const sObj = {};
        A.qsa('[data-social]', panel).forEach((i) => { sObj[i.dataset.social] = i.value; });
        saveSection({ opening_hours: JSON.stringify(hObj), socials: JSON.stringify(sObj) }, e.currentTarget);
      });
    }

    function receiptPanel(panel) {
      panel.innerHTML = `
        <div class="settings-panel">
          <h3>Receipt &amp; invoice</h3>
          <p>Printed at the top and bottom of every thermal receipt and A4 invoice.</p>
          <form id="receiptForm"><div class="form-grid">
            <label class="field full"><span>Receipt header</span><textarea name="receipt_header" style="min-height:70px">${A.esc(s('receipt_header'))}</textarea></label>
            <label class="field full"><span>Receipt footer</span><textarea name="receipt_footer" style="min-height:70px">${A.esc(s('receipt_footer'))}</textarea></label>
          </div>
          <div class="muted-box" style="margin-top:13px;font-family:monospace;white-space:pre-line;font-size:10px">${A.esc(s('receipt_header'))}
--------------------------------
SH-260101-0001  ·  Table 04
2 × Charcoal Lamb Chops    Rs. 3,800
--------------------------------
TOTAL                      Rs. 3,990
${A.esc(s('receipt_footer'))}</div>
          <div class="form-actions"><button type="button" class="btn btn-gold" data-save-receipt><i data-lucide="save"></i> Save receipt text</button></div>
          </form>
        </div>`;
      A.qs('[data-save-receipt]', panel).addEventListener('click', (e) => saveSection(A.formData(A.qs('#receiptForm', panel)), e.currentTarget));
    }

    function messagesPanel(panel) {
      const messages = state.messages;
      panel.innerHTML = `
        <div class="settings-panel">
          <h3>Contact messages</h3>
          <p>Enquiries submitted through the website contact form. Mark them read once handled.</p>
          <div style="display:flex;gap:6px;margin-bottom:13px"><span class="badge neutral">${messages.length} total</span><span class="badge" style="background:var(--gold-wash);color:var(--gold-dark)">${unread()} unread</span></div>
          <div class="message-list">${messages.length ? messages.map((m) => `<div class="message-card ${m.status === 'new' ? 'new' : ''}">
            <div class="message-head"><div><strong>${A.esc(m.name)}</strong><span>${A.esc(m.email)}${m.phone ? ` · ${A.esc(m.phone)}` : ''}${m.subject ? ` · ${A.esc(m.subject)}` : ''}</span></div><time>${A.dateTime(m.created_at)}</time></div>
            <div class="message-body">${A.esc(m.message)}</div>
            <div class="message-actions">
              ${m.status === 'new' ? `<button class="btn btn-xs btn-soft" data-msg-read="${m.id}"><i data-lucide="mail-open"></i> Mark read</button>` : `<button class="btn btn-xs btn-outline" data-msg-new="${m.id}"><i data-lucide="mail"></i> Mark unread</button>`}
              <button class="btn btn-xs btn-danger-soft" data-msg-del="${m.id}"><i data-lucide="trash-2"></i> Delete</button>
              <a class="btn btn-xs btn-outline" href="mailto:${A.esc(m.email)}"><i data-lucide="reply"></i> Reply</a>
            </div>
          </div>`).join('') : `<div class="card card-pad">${A.empty('No messages', 'Website enquiries will arrive here.', 'mail')}</div>`}</div>
        </div>`;
      A.qsa('[data-msg-read]', panel).forEach((b) => b.addEventListener('click', () => messageStatus(Number(b.dataset.msgRead), 'read')));
      A.qsa('[data-msg-new]', panel).forEach((b) => b.addEventListener('click', () => messageStatus(Number(b.dataset.msgNew), 'new')));
      A.qsa('[data-msg-del]', panel).forEach((b) => b.addEventListener('click', () => {
        const m = messages.find((x) => x.id === Number(b.dataset.msgDel));
        A.deleteConfirm(m.name, async () => {
          await A.api(`/messages/${m.id}`, { method: 'DELETE' });
          state.messages = state.messages.filter((x) => x.id !== m.id);
          A.toast('Message deleted.', 'success'); paintPanel();
        });
      }));
    }

    async function messageStatus(id, status) {
      try {
        await A.api(`/messages/${id}`, { method: 'PATCH', body: { status } });
        const m = state.messages.find((x) => x.id === id);
        if (m) m.status = status;
        A.toast(status === 'read' ? 'Marked as read.' : 'Marked as unread.', 'success');
        paint();
      } catch (err) { A.notifyError(err); }
    }

    function securityPanel(panel) {
      panel.innerHTML = `
        <div class="settings-panel">
          <h3>My account</h3>
          <p>Signed in as <strong>${A.esc(A.staff?.name || '')}</strong> · ${A.esc(A.staff?.email || '')} · ${A.roleLabel(A.staff?.role)}.</p>
          <div class="kv-list" style="margin-bottom:18px">
            <div><span>Role</span><b>${A.roleLabel(A.staff?.role)}</b></div>
            <div><span>Permissions</span><b>${A.staff?.role === 'admin' ? 'Full access' : (A.ROLE_PERMISSIONS[A.staff?.role] || []).length + ' modules'}</b></div>
            <div><span>Session</span><b>Secure cookie session</b></div>
          </div>
          <h3 style="font-size:13px;margin-bottom:3px">Change password</h3>
          <p style="margin-bottom:13px">Use at least 8 characters. You will stay signed in after changing it.</p>
          <form id="passwordForm"><div class="form-grid" style="max-width:520px">
            <label class="field full"><span>Current password *</span><input name="current_password" type="password" required autocomplete="current-password"></label>
            <label class="field"><span>New password *</span><input name="new_password" type="password" minlength="8" required autocomplete="new-password"></label>
            <label class="field"><span>Confirm new password *</span><input name="confirm_password" type="password" minlength="8" required autocomplete="new-password"></label>
          </div>
          <div class="form-actions"><button type="button" class="btn btn-gold" data-save-pass><i data-lucide="key-round"></i> Update password</button></div>
          </form>
        </div>`;
      A.qs('[data-save-pass]', panel).addEventListener('click', async (e) => {
        const form = A.qs('#passwordForm', panel);
        if (!form.reportValidity()) return;
        const fd = A.formData(form);
        if (fd.new_password !== fd.confirm_password) return A.toast('The new passwords do not match.', 'error');
        A.busyEvent(e, true, 'Updating…');
        try {
          await A.api('/settings/password', { method: 'POST', body: { current_password: fd.current_password, new_password: fd.new_password } });
          A.toast('Password updated.', 'success');
          form.reset();
        } catch (err) { A.notifyError(err); } finally { A.busyEvent(e, false); }
      });
    }

    function backupPanel(panel) {
      panel.innerHTML = `
        <div class="settings-panel">
          <h3>Database backup</h3>
          <p>Download a complete SQLite snapshot or restore a previous backup. Back up before large imports or menu overhauls.</p>
          <div class="form-grid" style="grid-template-columns:1fr 1fr">
            <div class="muted-box">
              <strong style="display:block;margin-bottom:4px">Download backup</strong>
              A consistent snapshot of orders, menu, inventory, staff and settings.
              <div style="margin-top:11px"><button class="btn btn-gold btn-sm" id="backupDownload"><i data-lucide="download"></i> Download database</button></div>
            </div>
            <div class="muted-box">
              <strong style="display:block;margin-bottom:4px">Restore backup</strong>
              Upload a .db file. A safety copy is made automatically. Restart the server afterwards.
              <div style="margin-top:11px"><label class="btn btn-soft btn-sm"><i data-lucide="upload"></i> Choose .db<input type="file" id="backupFile" accept=".db,application/x-sqlite3" hidden></label></div>
            </div>
          </div>
          <div class="modal-note" style="margin-top:14px"><i data-lucide="triangle-alert"></i><span>Restoring replaces the live database. The current database is saved under <code>data/backups</code> before the restore.</span></div>
        </div>`;
      A.qs('#backupDownload', panel).addEventListener('click', (e) => {
        A.busyEvent(e, true, 'Preparing…');
        A.download('/api/admin/backup', `saffron-house-backup-${A.today()}.db`).finally(() => A.busyEvent(e, false));
      });
      A.qs('#backupFile', panel).addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        A.confirm({
          title: 'Restore this backup?', message: `Replace the live database with “${file.name}”? The server must be restarted to load the restored data.`, confirmText: 'Restore database', danger: true, icon: 'database-backup',
          onConfirm: async () => {
            const fd = new FormData(); fd.append('database', file);
            const data = await A.raw('/api/admin/restore', { method: 'POST', body: fd });
            A.toast(data.message || 'Backup restored. Restart the server.', 'success', 'Restore complete');
          }
        });
        e.target.value = '';
      });
    }

    async function saveSection(payload, btn) {
      A.busy(btn, true, 'Saving…');
      try {
        const data = await A.api('/settings', { method: 'PUT', body: payload });
        state.settings = data.settings || state.settings;
        A.siteSettings = state.settings;
        A.toast('Settings saved.', 'success');
        paint();
      } catch (err) { A.notifyError(err); A.busy(btn, false); }
    }

    await load();
    return () => { state.destroyed = true; };
  };
})();
