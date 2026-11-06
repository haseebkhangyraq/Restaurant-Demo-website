/* ==========================================================================
   Admin — Staff & role-based access
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;
  const ROLE_INFO = {
    admin: { icon: 'shield-check', desc: 'Full control of the restaurant, staff, finances and system settings.' },
    manager: { icon: 'briefcase-business', desc: 'Runs day-to-day operations: menu, purchasing, reports and rosters.' },
    cashier: { icon: 'scan-barcode', desc: 'Takes payments, manages the order book, billing, guests and tables.' },
    waiter: { icon: 'utensils', desc: 'Takes orders, manages the floor, tables, guests and reservations.' },
    kitchen: { icon: 'chef-hat', desc: 'Sees the kitchen pass and order tickets — no financial access.' }
  };
  const PERMISSION_LABELS = { dashboard: 'Dashboard', pos: 'POS', orders: 'Orders', kitchen: 'Kitchen', billing: 'Billing', menu: 'Menu', inventory: 'Inventory', recipes: 'Recipes', tables: 'Tables', reservations: 'Bookings', customers: 'Guests', staff: 'Staff', suppliers: 'Purchasing', expenses: 'Expenses', reports: 'Reports', settings: 'Settings' };

  A.views.staff = async function (view) {
    const state = { staff: [], search: '', role: 'all', destroyed: false };

    view.innerHTML = `<div class="view-loading"><span class="spinner"></span><p>Loading the team…</p></div>`;

    async function load() {
      try {
        const data = await A.api('/staff');
        if (state.destroyed) return;
        state.staff = data.staff || [];
        paint();
      } catch (err) {
        if (state.destroyed) return;
        view.innerHTML = `<div class="card card-pad" style="max-width:560px;margin:9vh auto;text-align:center"><div class="confirm-icon"><i data-lucide="alert-triangle"></i></div><h2 style="font-family:var(--font-display);font-size:28px">Team unavailable</h2><p class="muted small">${A.esc(err.message)}</p></div>`;
        A.icons();
      }
    }

    function filtered() {
      const q = state.search.toLowerCase();
      return state.staff.filter((s) => {
        if (state.role !== 'all' && s.role !== state.role) return false;
        if (!q) return true;
        return `${s.name} ${s.email} ${s.phone || ''}`.toLowerCase().includes(q);
      });
    }

    function paint() {
      const payroll = state.staff.filter((s) => s.status === 'active').reduce((sum, s) => sum + Number(s.salary || 0), 0);
      const active = state.staff.filter((s) => s.status === 'active').length;
      const handled = state.staff.reduce((sum, s) => sum + Number(s.orders_handled || 0), 0);
      view.innerHTML = `
        <div class="view-head">
          <div class="view-head-copy"><h2>Staff &amp; roles</h2><p>Accounts, permissions and payroll at a glance. Access is enforced on the server as well as the interface.</p></div>
          <div class="view-head-actions">
            <button class="btn btn-outline" id="staffRefresh"><i data-lucide="refresh-cw"></i> Refresh</button>
            ${A.isAdmin() ? `<button class="btn btn-gold" id="staffAdd"><i data-lucide="user-plus"></i> Add staff member</button>` : `<span class="badge neutral" style="padding:7px 11px"><i data-lucide="eye"></i> View only</span>`}
          </div>
        </div>

        <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
          <div class="kpi"><span class="kpi-label">Team members</span><span class="kpi-value">${state.staff.length}</span><div class="kpi-meta"><span>${active} active accounts</span></div></div>
          <div class="kpi"><span class="kpi-label">Monthly payroll</span><span class="kpi-value">${A.money(payroll)}</span><div class="kpi-meta"><span>Active staff salaries</span></div></div>
          <div class="kpi"><span class="kpi-label">Orders handled</span><span class="kpi-value">${A.num(handled)}</span><div class="kpi-meta"><span>All-time across the team</span></div></div>
          <div class="kpi"><span class="kpi-label">Roles</span><span class="kpi-value">${new Set(state.staff.map((s) => s.role)).size}</span><div class="kpi-meta"><span>Permission profiles in use</span></div></div>
        </div>

        <div class="card" style="margin-bottom:16px">
          <div class="card-head"><div><h3><i data-lucide="key-round"></i> Role permissions</h3><p>What each role can open and change in this console.</p></div></div>
          <div class="card-body"><div class="role-grid">
            ${Object.entries(ROLE_INFO).map(([role, info]) => {
              const perms = A.ROLE_PERMISSIONS[role] || [];
              return `<div class="role-card"><strong><i data-lucide="${info.icon}"></i> ${A.roleLabel(role)}</strong><p>${info.desc}</p><div class="permission-tags">${perms.includes('*') ? '<span>Everything</span>' : perms.map((p) => `<span>${PERMISSION_LABELS[p] || p}</span>`).join('')}</div></div>`;
            }).join('')}
          </div></div>
        </div>

        <div class="filter-bar">
          <div class="search-box"><i data-lucide="search"></i><input type="search" id="staffSearch" placeholder="Search name, email or phone…" value="${A.esc(state.search)}"></div>
          <div class="seg-tabs" id="staffRoles">
            <button data-role="all" class="${state.role === 'all' ? 'active' : ''}">All roles</button>
            ${Object.keys(ROLE_INFO).map((r) => `<button data-role="${r}" class="${state.role === r ? 'active' : ''}">${A.roleLabel(r)}</button>`).join('')}
          </div>
          <span class="spacer"></span><span class="muted small">${filtered().length} people</span>
        </div>

        <div class="table-card">
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Team member</th><th>Role</th><th>Contact</th><th>Joined</th><th class="num">Salary</th><th class="num">Orders</th><th>Status</th><th class="actions">Actions</th></tr></thead>
            <tbody>${rowHTML()}</tbody>
          </table></div>
          <div class="table-foot"><span>Passwords are hashed with bcrypt</span><span class="muted">${A.money(payroll)} monthly payroll</span></div>
        </div>`;
      A.icons();
      bind();
    }

    function rowHTML() {
      const rows = filtered();
      if (!rows.length) return `<tr><td colspan="8">${A.empty('No staff match', 'Try a different role or search.', 'badge-check')}</td></tr>`;
      return rows.map((s) => `<tr>
        <td><div class="cell-main"><span class="avatar" style="width:32px;height:32px;font-size:9.5px;background:linear-gradient(140deg,${A.esc(s.color || '#C9A227')},#7c5f1c)">${A.esc(A.initials(s.name))}</span><div><strong>${A.esc(s.name)}</strong><span>${A.esc(s.email)}${s.id === A.staff?.id ? ' · you' : ''}</span></div></div></td>
        <td><span class="badge neutral"><i data-lucide="${ROLE_INFO[s.role]?.icon || 'user'}"></i> ${A.roleLabel(s.role)}</span></td>
        <td class="small">${A.esc(s.phone || '—')}</td>
        <td class="small">${A.date(s.join_date)}</td>
        <td class="num">${s.salary ? A.money(s.salary) : '—'}</td>
        <td class="num">${A.num(s.orders_handled)}</td>
        <td>${A.badge(s.status)}</td>
        <td class="actions"><div class="row-actions">
          ${A.isAdmin() ? `<button class="btn btn-xs btn-outline" data-edit-staff="${s.id}"><i data-lucide="pencil"></i> Edit</button><button class="btn btn-xs btn-danger-soft btn-icon" data-del-staff="${s.id}" ${s.id === A.staff?.id ? 'disabled' : ''}><i data-lucide="trash-2"></i></button>` : '<span class="muted small">View only</span>'}
        </div></td>
      </tr>`).join('');
    }

    function bind() {
      const search = A.qs('#staffSearch');
      search.addEventListener('input', A.debounce(() => { state.search = search.value.trim(); A.qs('tbody').innerHTML = rowHTML(); A.icons(); bindRows(); }, 200));
      A.qs('#staffRoles').addEventListener('click', (e) => {
        const b = e.target.closest('[data-role]');
        if (!b) return;
        state.role = b.dataset.role;
        A.qsa('#staffRoles button').forEach((x) => x.classList.toggle('active', x === b));
        A.qs('tbody').innerHTML = rowHTML(); A.icons(); bindRows();
      });
      A.qs('#staffAdd')?.addEventListener('click', () => staffForm(null));
      A.qs('#staffRefresh').addEventListener('click', (e) => { A.busyEvent(e, true, ''); load().finally(() => A.busyEvent(e, false)); });
      bindRows();
    }

    function bindRows() {
      A.qsa('[data-edit-staff]', view).forEach((b) => b.addEventListener('click', () => staffForm(state.staff.find((s) => s.id === Number(b.dataset.editStaff)))));
      A.qsa('[data-del-staff]', view).forEach((b) => b.addEventListener('click', () => {
        const s = state.staff.find((x) => x.id === Number(b.dataset.delStaff));
        if (!s || s.id === A.staff?.id) return;
        A.deleteConfirm(s.name, async () => {
          await A.api(`/staff/${s.id}`, { method: 'DELETE' });
          A.toast('Staff account removed.', 'success'); await load();
        }, { title: 'Remove this account?', message: 'They will lose access immediately. Past orders remain attributed to their name.' });
      }));
    }

    function staffForm(member) {
      const isNew = !member;
      const s = member || { name: '', email: '', role: 'waiter', phone: '', salary: '', join_date: A.today(), status: 'active', color: '#C9A227' };
      const m = A.modal({
        title: isNew ? 'Add a staff member' : 'Edit staff member',
        subtitle: isNew ? 'Create a secure account with a role-based permission profile.' : `${s.name} · ${A.roleLabel(s.role)}`,
        size: 'lg',
        body: `<form id="staffForm"><div class="form-grid three">
          <label class="field full"><span>Full name *</span><input name="name" value="${A.esc(s.name)}" required></label>
          <label class="field"><span>Email *</span><input name="email" type="email" value="${A.esc(s.email)}" required></label>
          <label class="field"><span>Phone</span><input name="phone" value="${A.esc(s.phone || '')}"></label>
          <label class="field"><span>Role *</span><select name="role">${Object.keys(ROLE_INFO).map((r) => `<option value="${r}" ${s.role === r ? 'selected' : ''}>${A.roleLabel(r)}</option>`).join('')}</select></label>
          <label class="field"><span>Monthly salary</span><input name="salary" type="number" min="0" step="1000" value="${s.salary || ''}"></label>
          <label class="field"><span>Join date</span><input name="join_date" type="date" value="${s.join_date || A.today()}"></label>
          <label class="field"><span>Status</span><select name="status"><option value="active" ${s.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${s.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></label>
          <label class="field"><span>Avatar colour</span><input name="color" type="color" value="${s.color || '#C9A227'}" style="padding:4px 6px;height:38px"></label>
          <label class="field full"><span>${isNew ? 'Password *' : 'New password (leave blank to keep current)'}</span><input name="password" type="password" minlength="6" ${isNew ? 'required' : ''} autocomplete="new-password" placeholder="${isNew ? 'At least 6 characters' : 'Unchanged'}"></label>
        </div>
        <div class="modal-note"><i data-lucide="shield-check"></i><span>Role changes take effect on the next request. ${isNew ? 'The password is hashed before it is stored.' : 'Only administrators can manage staff accounts.'}</span></div>
        </form>`,
        footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-gold" data-save>${isNew ? 'Create account' : 'Save changes'}</button>`,
        onMount: (modal) => {
          A.qs('[data-cancel]', modal.footer).addEventListener('click', modal.close);
          A.qs('[data-save]', modal.footer).addEventListener('click', async (e) => {
            const form = A.qs('#staffForm', modal.body);
            if (!form.reportValidity()) return;
            const fd = A.formData(form);
            if (!fd.password) delete fd.password;
            A.busyEvent(e, true, 'Saving…');
            try {
              await A.api(isNew ? '/staff' : `/staff/${s.id}`, { method: isNew ? 'POST' : 'PUT', body: fd });
              A.toast(isNew ? 'Staff account created.' : 'Staff account updated.', 'success');
              modal.close(); await load();
            } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
          });
        }
      });
    }

    await load();
    return () => { state.destroyed = true; };
  };
})();
