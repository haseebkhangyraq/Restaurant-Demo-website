/* ==========================================================================
   Admin — Customers (CRM)
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;

  A.views.customers = async function (view) {
    const state = { data: null, search: '', segment: 'all', sort: 'spend', destroyed: false };

    view.innerHTML = `<div class="view-loading"><span class="spinner"></span><p>Opening the guest book…</p></div>`;

    async function load() {
      try {
        const data = await A.api(`/customers${state.search ? `?search=${encodeURIComponent(state.search)}` : ''}`);
        if (state.destroyed) return;
        state.data = data;
        paint();
      } catch (err) {
        if (state.destroyed) return;
        view.innerHTML = `<div class="card card-pad" style="max-width:560px;margin:9vh auto;text-align:center"><div class="confirm-icon"><i data-lucide="alert-triangle"></i></div><h2 style="font-family:var(--font-display);font-size:28px">Guests unavailable</h2><p class="muted small">${A.esc(err.message)}</p></div>`;
        A.icons();
      }
    }

    function list() {
      let rows = state.data.customers.slice();
      if (state.segment === 'vip') rows = rows.filter((c) => Number(c.total_spent) >= 15000);
      if (state.segment === 'new') rows = rows.filter((c) => c.created_at && c.created_at.slice(0, 10) >= A.daysAgo(30));
      if (state.segment === 'lapsed') rows = rows.filter((c) => !c.last_order || c.last_order.slice(0, 10) < A.daysAgo(45));
      if (state.segment === 'no-orders') rows = rows.filter((c) => !Number(c.total_orders));
      if (state.sort === 'spend') rows.sort((a, b) => Number(b.total_spent) - Number(a.total_spent));
      if (state.sort === 'orders') rows.sort((a, b) => Number(b.total_orders) - Number(a.total_orders));
      if (state.sort === 'recent') rows.sort((a, b) => String(b.last_order || '').localeCompare(String(a.last_order || '')));
      if (state.sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
      return rows;
    }

    function paint() {
      const d = state.data;
      const customers = d.customers;
      const totalSpend = customers.reduce((s, c) => s + Number(c.total_spent), 0);
      const buyers = customers.filter((c) => Number(c.total_orders) > 0).length;
      const top = customers.slice().sort((a, b) => Number(b.total_spent) - Number(a.total_spent))[0];
      view.innerHTML = `
        <div class="view-head">
          <div class="view-head-copy"><h2>Guests &amp; CRM</h2><p>Every guest, their history, favourite orders and lifetime value — all in one place.</p></div>
          <div class="view-head-actions">
            <button class="btn btn-outline" id="custRefresh"><i data-lucide="refresh-cw"></i> Refresh</button>
            <button class="btn btn-gold" id="custAdd"><i data-lucide="user-plus"></i> Add customer</button>
          </div>
        </div>

        <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
          <div class="kpi"><span class="kpi-label">Customers</span><span class="kpi-value">${A.num(d.summary.count)}</span><div class="kpi-meta"><span>${buyers} have ordered</span></div></div>
          <div class="kpi"><span class="kpi-label">Lifetime revenue</span><span class="kpi-value">${A.money(totalSpend)}</span><div class="kpi-meta"><span>From completed orders</span></div></div>
          <div class="kpi"><span class="kpi-label">Loyalty points</span><span class="kpi-value">${A.num(d.summary.points)}</span><div class="kpi-meta"><span>Issued to date</span></div></div>
          <div class="kpi"><span class="kpi-label">Top guest</span><span class="kpi-value" style="font-size:19px">${A.esc(top?.name || '—')}</span><div class="kpi-meta"><span>${top ? A.money(top.total_spent) + ' lifetime' : 'No purchases yet'}</span></div></div>
        </div>

        <div class="filter-bar">
          <div class="search-box"><i data-lucide="search"></i><input type="search" id="custSearch" placeholder="Search name, phone or email…" value="${A.esc(state.search)}"></div>
          <div class="seg-tabs" id="custSegs">
            ${[['all', 'All'], ['vip', 'VIP'], ['new', 'New'], ['lapsed', 'Lapsed'], ['no-orders', 'No orders']].map(([v, l]) => `<button data-seg="${v}" class="${state.segment === v ? 'active' : ''}">${l}</button>`).join('')}
          </div>
          <select id="custSort">
            <option value="spend" ${state.sort === 'spend' ? 'selected' : ''}>Sort: lifetime spend</option>
            <option value="orders" ${state.sort === 'orders' ? 'selected' : ''}>Sort: most orders</option>
            <option value="recent" ${state.sort === 'recent' ? 'selected' : ''}>Sort: most recent</option>
            <option value="name" ${state.sort === 'name' ? 'selected' : ''}>Sort: name A–Z</option>
          </select>
          <span class="spacer"></span><span class="muted small">${list().length} guests</span>
        </div>

        <div class="table-card">
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Guest</th><th>Contact</th><th class="num">Orders</th><th class="num">Lifetime spend</th><th class="num">Avg order</th><th>Last visit</th><th class="num">Points</th><th class="actions">Actions</th></tr></thead>
            <tbody>${rowHTML()}</tbody>
          </table></div>
          <div class="table-foot"><span>Guest records are created automatically at checkout</span><span class="muted">Segments: VIP ≥ ${A.money(15000)} lifetime</span></div>
        </div>`;
      A.icons();
      bind();
    }

    function rowHTML() {
      const rows = list();
      return rows.length ? rows.map((c) => {
        const avg = Number(c.total_orders) ? Number(c.total_spent) / Number(c.total_orders) : 0;
        return `<tr>
          <td><button class="cell-main" data-view-cust="${c.id}" style="border:0;background:none;padding:0;text-align:left;cursor:pointer"><span class="avatar" style="width:32px;height:32px;font-size:9.5px;background:linear-gradient(140deg,${A.avatarColor(c.name)},#a9832e)">${A.esc(A.initials(c.name))}</span><div><strong>${A.esc(c.name)}</strong><span>${A.esc(c.city || 'Lahore')}${Number(c.total_spent) >= 15000 ? ' · VIP' : ''}</span></div></button></td>
          <td><span class="small">${A.esc(c.phone || '—')}</span><div class="muted" style="font-size:8.8px">${A.esc(c.email || '')}</div></td>
          <td class="num">${A.num(c.total_orders)}</td>
          <td class="num strong">${A.money(c.total_spent)}</td>
          <td class="num muted">${A.money(avg)}</td>
          <td class="small">${c.last_order ? A.dateShort(c.last_order) : '<span class="muted">Never</span>'}</td>
          <td class="num"><span class="badge neutral">${A.num(c.loyalty_points)}</span></td>
          <td class="actions"><div class="row-actions">
            <button class="btn btn-xs btn-outline" data-view-cust="${c.id}">View</button>
            <button class="btn btn-xs btn-soft btn-icon" data-edit-cust="${c.id}" title="Edit"><i data-lucide="pencil"></i></button>
            ${A.isManager() ? `<button class="btn btn-xs btn-danger-soft btn-icon" data-del-cust="${c.id}" title="Delete"><i data-lucide="trash-2"></i></button>` : ''}
          </div></td>
        </tr>`;
      }).join('') : `<tr><td colspan="8">${A.empty('No guests match', 'Try a different segment or search term.', 'users')}</td></tr>`;
    }

    function bind() {
      A.qs('#custSearch').addEventListener('input', A.debounce((e) => { state.search = e.target.value.trim(); load(); }, 280));
      A.qs('#custSegs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-seg]');
        if (!b) return;
        state.segment = b.dataset.seg;
        A.qsa('#custSegs button', view).forEach((x) => x.classList.toggle('active', x === b));
        A.qs('tbody', view).innerHTML = rowHTML();
        A.qs('.filter-bar .muted', view).textContent = `${list().length} guests`;
        A.icons(); bindRows();
      });
      A.qs('#custSort').addEventListener('change', (e) => { state.sort = e.target.value; A.qs('tbody', view).innerHTML = rowHTML(); A.icons(); bindRows(); });
      A.qs('#custAdd').addEventListener('click', () => customerForm(null));
      A.qs('#custRefresh').addEventListener('click', (e) => { A.busyEvent(e, true, ''); load().finally(() => A.busyEvent(e, false)); });
      bindRows();
    }

    function bindRows() {
      A.qsa('[data-view-cust]', view).forEach((b) => b.addEventListener('click', () => viewCustomer(Number(b.dataset.viewCust))));
      A.qsa('[data-edit-cust]', view).forEach((b) => b.addEventListener('click', () => customerForm(state.data.customers.find((c) => c.id === Number(b.dataset.editCust)))));
      A.qsa('[data-del-cust]', view).forEach((b) => b.addEventListener('click', () => {
        const c = state.data.customers.find((x) => x.id === Number(b.dataset.delCust));
        A.deleteConfirm(c.name, async () => {
          await A.api(`/customers/${c.id}`, { method: 'DELETE' });
          A.toast('Customer deleted.', 'success'); await load();
        }, { title: 'Delete customer?', message: 'Their order history will also be removed from reporting.' });
      }));
    }

    async function viewCustomer(id) {
      const m = A.modal({ title: 'Guest profile', size: 'lg', body: `<div class="view-loading" style="min-height:220px"><span class="spinner"></span></div>`, footer: '' });
      try {
        const data = await A.api(`/customers/${id}`);
        const c = data.customer, s = data.stats;
        m.body.innerHTML = `
          <div class="customer-profile">
            <span class="avatar" style="background:linear-gradient(140deg,${A.avatarColor(c.name)},#a9832e)">${A.esc(A.initials(c.name))}</span>
            <div style="flex:1"><h4>${A.esc(c.name)}</h4><span>${A.esc(c.phone || 'No phone')} · ${A.esc(c.email || 'No email')} · joined ${A.date(c.created_at)}</span></div>
            <span class="badge neutral" style="font-size:9px">${A.num(c.loyalty_points)} points</span>
          </div>
          <div class="stat-strip">
            <div><span>Orders</span><b>${A.num(s.total_orders)}</b></div>
            <div><span>Lifetime spend</span><b>${A.money(s.total_spent)}</b></div>
            <div><span>Average order</span><b>${A.money(s.avg_order)}</b></div>
          </div>
          <div class="order-detail-grid">
            <div>
              <div class="detail-section"><h4>Profile</h4>
                <div class="detail-row"><span>Phone</span><b>${A.esc(c.phone || '—')}</b></div>
                <div class="detail-row"><span>Email</span><b>${A.esc(c.email || '—')}</b></div>
                <div class="detail-row"><span>City</span><b>${A.esc(c.city || '—')}</b></div>
                <div class="detail-row"><span>Address</span><b>${A.esc(c.address || '—')}</b></div>
                <div class="detail-row"><span>Last visit</span><b>${s.last_order ? A.dateTime(s.last_order) : 'Never'}</b></div>
              </div>
              <div class="detail-section"><h4>Notes</h4><div class="muted-box">${A.esc(c.notes || 'No notes on this guest yet.')}</div></div>
              <div class="detail-section"><h4>Saved addresses</h4>
                ${data.addresses.length ? data.addresses.map((a) => `<div class="detail-row"><span>${A.esc(a.label || 'Address')}</span><b style="max-width:230px">${A.esc([a.address, a.city].filter(Boolean).join(', '))}</b></div>`).join('') : '<div class="muted small">No saved addresses.</div>'}
              </div>
            </div>
            <div>
              <div class="detail-section"><h4>Recent orders</h4>
                <div class="detail-items">
                  ${data.orders.length ? data.orders.slice(0, 8).map((o) => `<div class="detail-item" style="cursor:pointer" data-open-order="${o.id}"><div class="di-name"><strong>${A.esc(o.order_number)}</strong><span>${A.dateShort(o.created_at)} · ${A.esc(A.typeLabel(o.type))}</span></div><div class="di-qty">${A.badge(o.status)}</div><div class="di-total">${A.money(o.total)}</div></div>`).join('') : '<div class="muted small">No orders yet.</div>'}
                </div>
              </div>
              ${A.can('pos') ? `<a class="btn btn-soft btn-block" href="#/pos" data-close><i data-lucide="scan-barcode"></i> Start an order</a>` : ''}
            </div>
          </div>`;
        m.footer.innerHTML = `<button class="btn btn-soft left" data-edit><i data-lucide="pencil"></i> Edit profile</button><button class="btn btn-outline" data-close>Close</button>`;
        A.icons();
        A.qsa('[data-close]', m.el).forEach((el) => el.addEventListener('click', m.close));
        A.qs('[data-edit]', m.footer).addEventListener('click', () => { m.close(); customerForm(c); });
        A.qsa('[data-open-order]', m.body).forEach((b) => b.addEventListener('click', () => { m.close(); if (A.openOrder) A.openOrder(Number(b.dataset.openOrder), { onChange: () => load() }); }));
      } catch (err) {
        m.body.innerHTML = `<div class="modal-note danger">${A.esc(err.message)}</div>`;
      }
    }

    function customerForm(customer) {
      const isNew = !customer;
      const c = customer || { name: '', phone: '', email: '', address: '', city: 'Lahore', notes: '' };
      const m = A.modal({
        title: isNew ? 'Add a customer' : 'Edit customer', size: 'sm',
        body: `<form id="custForm"><div class="form-grid">
          <label class="field full"><span>Full name *</span><input name="name" value="${A.esc(c.name)}" required></label>
          <label class="field"><span>Phone *</span><input name="phone" value="${A.esc(c.phone || '')}" placeholder="03xx…" required></label>
          <label class="field"><span>Email</span><input name="email" type="email" value="${A.esc(c.email || '')}"></label>
          <label class="field full"><span>Address</span><textarea name="address" style="min-height:55px">${A.esc(c.address || '')}</textarea></label>
          <label class="field"><span>City</span><input name="city" value="${A.esc(c.city || 'Lahore')}"></label>
          <label class="field"><span>Notes</span><input name="notes" value="${A.esc(c.notes || '')}" placeholder="Preferences, allergies…"></label>
        </div></form>`,
        footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-gold" data-save>${isNew ? 'Create customer' : 'Save changes'}</button>`,
        onMount: (modal) => {
          A.qs('[data-cancel]', modal.footer).addEventListener('click', modal.close);
          A.qs('[data-save]', modal.footer).addEventListener('click', async (e) => {
            const form = A.qs('#custForm', modal.body);
            if (!form.reportValidity()) return;
            const fd = A.formData(form);
            A.busyEvent(e, true, 'Saving…');
            try {
              await A.api(isNew ? '/customers' : `/customers/${c.id}`, { method: isNew ? 'POST' : 'PUT', body: fd });
              A.toast('Customer saved.', 'success'); modal.close(); await load();
            } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
          });
        }
      });
    }

    await load();
    return () => { state.destroyed = true; };
  };
})();
