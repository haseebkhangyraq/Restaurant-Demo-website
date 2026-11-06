/* ==========================================================================
   Admin — Suppliers & purchasing
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;

  A.views.suppliers = async function (view) {
    const state = {
      tab: 'suppliers', suppliers: [], purchases: [], summary: {}, pSummary: {}, ingredients: [],
      search: '', status: 'all', from: '', to: '', poSearch: '', destroyed: false
    };

    view.innerHTML = `<div class="view-loading"><span class="spinner"></span><p>Opening the purchasing ledger…</p></div>`;

    async function load() {
      try {
        const [sup, ing] = await Promise.all([A.api('/suppliers'), A.api('/ingredients').catch(() => ({ ingredients: [] }))]);
        if (state.destroyed) return;
        state.suppliers = sup.suppliers || [];
        state.summary = sup.summary || {};
        state.ingredients = ing.ingredients || [];
        await loadPurchases(true);
        if (state.destroyed) return;
        paint();
      } catch (err) {
        if (state.destroyed) return;
        view.innerHTML = `<div class="card card-pad" style="max-width:560px;margin:9vh auto;text-align:center"><div class="confirm-icon"><i data-lucide="alert-triangle"></i></div><h2 style="font-family:var(--font-display);font-size:28px">Purchasing unavailable</h2><p class="muted small">${A.esc(err.message)}</p></div>`;
        A.icons();
      }
    }

    async function loadPurchases(silent) {
      const qs = new URLSearchParams();
      if (state.status !== 'all') qs.set('status', state.status);
      if (state.poSearch) qs.set('search', state.poSearch);
      if (state.from) qs.set('from', state.from);
      if (state.to) qs.set('to', state.to);
      const data = await A.api(`/purchases?${qs.toString()}`);
      if (state.destroyed) return;
      state.purchases = data.purchases || [];
      state.pSummary = data.summary || {};
      if (!silent) paintPanel();
    }

    function paint() {
      view.innerHTML = `
        <div class="view-head">
          <div class="view-head-copy"><h2>Suppliers &amp; purchasing</h2><p>Buying relationships, purchase orders and supplier balances — receiving a PO updates inventory and unit costs.</p></div>
          <div class="view-head-actions">
            <button class="btn btn-outline" id="supRefresh"><i data-lucide="refresh-cw"></i> Refresh</button>
            <button class="btn btn-soft" id="newSupplier"><i data-lucide="user-plus"></i> New supplier</button>
            <button class="btn btn-gold" id="newPO"><i data-lucide="plus"></i> New purchase order</button>
          </div>
        </div>

        <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
          <div class="kpi"><span class="kpi-label">Suppliers</span><span class="kpi-value">${A.num(state.summary.count)}</span><div class="kpi-meta"><span>Active relationships</span></div></div>
          <div class="kpi"><span class="kpi-label">Outstanding</span><span class="kpi-value" style="color:var(--amber)">${A.money(state.summary.outstanding)}</span><div class="kpi-meta"><span>Owed to suppliers</span></div></div>
          <div class="kpi"><span class="kpi-label">Purchase orders</span><span class="kpi-value">${A.num(state.pSummary.count)}</span><div class="kpi-meta"><span>${A.money(state.pSummary.total)} total</span></div></div>
          <div class="kpi"><span class="kpi-label">Unpaid balance</span><span class="kpi-value" style="color:${state.pSummary.due ? 'var(--red)' : 'var(--green)'}">${A.money(state.pSummary.due)}</span><div class="kpi-meta"><span>${A.money(state.pSummary.paid)} paid</span></div></div>
        </div>

        <div class="seg-tabs" id="supTabs" style="margin-bottom:14px">
          <button data-tab="suppliers" class="${state.tab === 'suppliers' ? 'active' : ''}"><i data-lucide="truck" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"></i> Suppliers <span style="opacity:.6">(${state.suppliers.length})</span></button>
          <button data-tab="purchases" class="${state.tab === 'purchases' ? 'active' : ''}"><i data-lucide="clipboard-list" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"></i> Purchase orders <span style="opacity:.6">(${state.purchases.length})</span></button>
        </div>
        <div id="supPanel"></div>`;
      A.icons();
      A.qs('#supTabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]');
        if (!b) return;
        state.tab = b.dataset.tab;
        paint();
      });
      A.qs('#newSupplier').addEventListener('click', () => supplierForm(null));
      A.qs('#newPO').addEventListener('click', () => purchaseForm());
      A.qs('#supRefresh').addEventListener('click', (e) => { A.busyEvent(e, true, ''); load().finally(() => A.busyEvent(e, false)); });
      paintPanel();
    }

    function paintPanel() {
      const panel = A.qs('#supPanel');
      if (!panel) return;
      if (state.tab === 'suppliers') paintSuppliers(panel); else paintPurchases(panel);
      A.icons();
    }

    function filteredSuppliers() {
      const q = state.search.toLowerCase();
      if (!q) return state.suppliers;
      return state.suppliers.filter((s) => `${s.name} ${s.contact_person || ''} ${s.phone || ''} ${s.email || ''}`.toLowerCase().includes(q));
    }

    function paintSuppliers(panel) {
      panel.innerHTML = `
        <div class="filter-bar">
          <div class="search-box"><i data-lucide="search"></i><input type="search" id="supSearch" placeholder="Search supplier, contact or phone…" value="${A.esc(state.search)}"></div>
          <span class="spacer"></span><span class="muted small">${filteredSuppliers().length} suppliers</span>
        </div>
        <div class="table-card">
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Supplier</th><th>Contact</th><th class="num">Purchase orders</th><th class="num">Total purchased</th><th class="num">Paid</th><th class="num">Outstanding</th><th class="actions">Actions</th></tr></thead>
            <tbody>${supplierRows()}</tbody>
          </table></div>
          <div class="table-foot"><span>Balances update when purchase orders are received or paid</span><span class="muted">${A.money(state.summary.outstanding)} total owed</span></div>
        </div>`;
      const search = A.qs('#supSearch', panel);
      search.addEventListener('input', A.debounce(() => { state.search = search.value.trim(); A.qs('tbody', panel).innerHTML = supplierRows(); A.icons(); bindSupplierRows(); }, 180));
      bindSupplierRows();
    }

    function supplierRows() {
      const list = filteredSuppliers();
      if (!list.length) return `<tr><td colspan="7">${A.empty('No suppliers match', 'Add a supplier to start purchasing.', 'truck')}</td></tr>`;
      return list.map((s) => `<tr>
        <td><div class="cell-main"><span class="avatar" style="width:30px;height:30px;font-size:9px;background:linear-gradient(140deg,${A.avatarColor(s.name)},#a9832e)">${A.esc(A.initials(s.name))}</span><div><strong>${A.esc(s.name)}</strong><span>${A.esc(s.address || 'No address on file')}</span></div></div></td>
        <td><span class="small">${A.esc(s.contact_person || '—')}</span><div class="muted" style="font-size:8.8px">${A.esc(s.phone || s.email || '')}</div></td>
        <td class="num">${A.num(s.purchase_count)}</td>
        <td class="num">${A.money(s.total_purchased)}</td>
        <td class="num" style="color:var(--green)">${A.money(s.total_paid)}</td>
        <td class="num strong" style="color:${Number(s.outstanding_balance) > 0 ? 'var(--amber)' : 'var(--muted)'}">${A.money(s.outstanding_balance)}</td>
        <td class="actions"><div class="row-actions">
          <button class="btn btn-xs btn-outline" data-edit-sup="${s.id}"><i data-lucide="pencil"></i></button>
          <button class="btn btn-xs btn-soft" data-po-sup="${s.id}">New PO</button>
          <button class="btn btn-xs btn-danger-soft btn-icon" data-del-sup="${s.id}"><i data-lucide="trash-2"></i></button>
        </div></td>
      </tr>`).join('');
    }

    function bindSupplierRows() {
      A.qsa('[data-edit-sup]', view).forEach((b) => b.addEventListener('click', () => supplierForm(state.suppliers.find((s) => s.id === Number(b.dataset.editSup)))));
      A.qsa('[data-po-sup]', view).forEach((b) => b.addEventListener('click', () => purchaseForm(state.suppliers.find((s) => s.id === Number(b.dataset.poSup)))));
      A.qsa('[data-del-sup]', view).forEach((b) => b.addEventListener('click', () => {
        const s = state.suppliers.find((x) => x.id === Number(b.dataset.delSup));
        A.deleteConfirm(s.name, async () => {
          await A.api(`/suppliers/${s.id}`, { method: 'DELETE' });
          A.toast('Supplier deleted.', 'success'); await load();
        }, { title: 'Delete supplier?', message: 'Suppliers with purchase history cannot be deleted.' });
      }));
    }

    function supplierForm(supplier) {
      const isNew = !supplier;
      const s = supplier || { name: '', contact_person: '', phone: '', email: '', address: '', notes: '' };
      const m = A.modal({
        title: isNew ? 'New supplier' : 'Edit supplier', size: 'sm',
        body: `<form id="supForm"><div class="form-grid">
          <label class="field full"><span>Supplier name *</span><input name="name" value="${A.esc(s.name)}" required placeholder="e.g. Punjab Fresh Produce"></label>
          <label class="field"><span>Contact person</span><input name="contact_person" value="${A.esc(s.contact_person || '')}"></label>
          <label class="field"><span>Phone</span><input name="phone" value="${A.esc(s.phone || '')}" placeholder="03xx…"></label>
          <label class="field full"><span>Email</span><input name="email" type="email" value="${A.esc(s.email || '')}"></label>
          <label class="field full"><span>Address</span><textarea name="address" style="min-height:55px">${A.esc(s.address || '')}</textarea></label>
          <label class="field full"><span>Notes</span><textarea name="notes" style="min-height:50px">${A.esc(s.notes || '')}</textarea></label>
        </div></form>`,
        footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-gold" data-save>${isNew ? 'Create supplier' : 'Save'}</button>`,
        onMount: (modal) => {
          A.qs('[data-cancel]', modal.footer).addEventListener('click', modal.close);
          A.qs('[data-save]', modal.footer).addEventListener('click', async (e) => {
            const form = A.qs('#supForm', modal.body);
            if (!form.reportValidity()) return;
            const fd = A.formData(form);
            A.busyEvent(e, true, 'Saving…');
            try {
              await A.api(isNew ? '/suppliers' : `/suppliers/${s.id}`, { method: isNew ? 'POST' : 'PUT', body: fd });
              A.toast('Supplier saved.', 'success'); modal.close(); await load();
            } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
          });
        }
      });
    }

    function paintPurchases(panel) {
      panel.innerHTML = `
        <div class="filter-bar">
          <div class="search-box"><i data-lucide="search"></i><input type="search" id="poSearch" placeholder="Search PO or supplier…" value="${A.esc(state.poSearch)}"></div>
          <div class="seg-tabs" id="poTabs">
            ${[['all', 'All'], ['pending', 'Pending'], ['received', 'Received'], ['cancelled', 'Cancelled']].map(([v, l]) => `<button data-status="${v}" class="${state.status === v ? 'active' : ''}">${l}</button>`).join('')}
          </div>
          <input type="date" id="poFrom" value="${state.from}" title="From date">
          <input type="date" id="poTo" value="${state.to}" title="To date">
          <span class="spacer"></span><span class="muted small">${state.purchases.length} orders</span>
        </div>
        <div class="table-card">
          <div class="table-wrap"><table class="data">
            <thead><tr><th>PO number</th><th>Supplier</th><th>Ordered</th><th class="num">Items</th><th>Status</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Due</th><th class="actions">Actions</th></tr></thead>
            <tbody>${purchaseRows()}</tbody>
          </table></div>
          <div class="table-foot"><span>Receiving a purchase increases ingredient stock and updates cost prices</span><span class="muted">${A.money(state.pSummary.total)} purchased · ${A.money(state.pSummary.due)} due</span></div>
        </div>`;
      A.qs('#poSearch', panel).addEventListener('input', A.debounce((e) => { state.poSearch = e.target.value.trim(); loadPurchases(); }, 260));
      A.qs('#poTabs', panel).addEventListener('click', (e) => {
        const b = e.target.closest('[data-status]');
        if (!b) return;
        state.status = b.dataset.status;
        A.qsa('#poTabs button', panel).forEach((x) => x.classList.toggle('active', x === b));
        loadPurchases();
      });
      A.qs('#poFrom', panel).addEventListener('change', (e) => { state.from = e.target.value; loadPurchases(); });
      A.qs('#poTo', panel).addEventListener('change', (e) => { state.to = e.target.value; loadPurchases(); });
      bindPurchaseRows();
    }

    function purchaseRows() {
      if (!state.purchases.length) return `<tr><td colspan="9">${A.empty('No purchase orders', 'Create a PO to receive stock from a supplier.', 'clipboard-list')}</td></tr>`;
      return state.purchases.map((p) => {
        const due = Number(p.total) - Number(p.paid_amount);
        return `<tr>
          <td><button class="mono strong" data-view-po="${p.id}" style="border:0;background:none;padding:0;font-size:10.5px">${A.esc(p.po_number)}</button></td>
          <td><div class="cell-main"><span class="avatar" style="width:26px;height:26px;font-size:8.5px;background:linear-gradient(140deg,${A.avatarColor(p.supplier_name || 'S')},#a9832e)">${A.esc(A.initials(p.supplier_name || 'S'))}</span><strong>${A.esc(p.supplier_name || '—')}</strong></div></td>
          <td class="small">${A.date(p.order_date)}</td>
          <td class="num">${p.item_count}</td>
          <td>${A.badge(p.status)}</td>
          <td class="num strong">${A.money2(p.total)}</td>
          <td class="num" style="color:var(--green)">${A.money2(p.paid_amount)}</td>
          <td class="num" style="color:${due > 0 ? 'var(--red)' : 'var(--muted)'}">${A.money2(due)}</td>
          <td class="actions"><div class="row-actions">
            <button class="btn btn-xs btn-outline" data-view-po="${p.id}">View</button>
            ${p.status !== 'received' && p.status !== 'cancelled' ? `<button class="btn btn-xs btn-gold" data-receive="${p.id}">Receive</button>` : ''}
            ${due > 0 && p.status !== 'cancelled' ? `<button class="btn btn-xs btn-soft" data-pay="${p.id}">Pay</button>` : ''}
            ${A.isManager() && p.status !== 'received' ? `<button class="btn btn-xs btn-danger-soft btn-icon" data-del-po="${p.id}"><i data-lucide="trash-2"></i></button>` : ''}
          </div></td>
        </tr>`;
      }).join('');
    }

    function bindPurchaseRows() {
      A.qsa('[data-view-po]', view).forEach((b) => b.addEventListener('click', () => viewPurchase(Number(b.dataset.viewPo))));
      A.qsa('[data-receive]', view).forEach((b) => b.addEventListener('click', () => receivePurchase(state.purchases.find((p) => p.id === Number(b.dataset.receive)))));
      A.qsa('[data-pay]', view).forEach((b) => b.addEventListener('click', () => payPurchase(state.purchases.find((p) => p.id === Number(b.dataset.pay)))));
      A.qsa('[data-del-po]', view).forEach((b) => b.addEventListener('click', () => {
        const p = state.purchases.find((x) => x.id === Number(b.dataset.delPo));
        A.deleteConfirm(p.po_number, async () => {
          await A.api(`/purchases/${p.id}`, { method: 'DELETE' });
          A.toast('Purchase order deleted.', 'success'); await load();
        }, { title: 'Delete purchase order?', message: 'Only pending purchase orders can be deleted.' });
      }));
    }

    function purchaseForm(preselectedSupplier) {
      if (!state.ingredients.length) return A.toast('Add ingredients in Inventory before creating a purchase order.', 'error');
      const m = A.modal({
        title: 'New purchase order', subtitle: 'Add lines, then choose whether to receive stock immediately.',
        size: 'lg',
        body: `<form id="poForm">
          <div class="form-grid three">
            <label class="field full"><span>Supplier *</span><select name="supplier_id" required>${A.options(state.suppliers, preselectedSupplier?.id, 'id', 'name', 'Choose supplier…')}</select></label>
            <label class="field"><span>Order date</span><input name="order_date" type="date" value="${A.today()}"></label>
            <label class="field"><span>Tax / other charges</span><input name="tax" id="poTax" type="number" min="0" step="0.01" value="0"></label>
            <label class="switch" style="margin-top:20px"><input type="checkbox" name="receive_now" id="poReceive"><span class="track"></span><span>Receive stock now</span></label>
            <label class="field full"><span>Notes</span><input name="notes" placeholder="Delivery instructions, invoice reference…"></label>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin:8px 0 7px">
            <h4 class="field-label" style="margin:0">Order lines</h4>
            <button class="btn btn-soft btn-xs" id="poAddLine" type="button"><i data-lucide="plus"></i> Add line</button>
          </div>
          <div id="poLines">${poLineHTML(state.ingredients)}${poLineHTML(state.ingredients)}</div>
          <div class="muted-box" style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:12px">
            <div><span style="display:block;font-size:8.5px;text-transform:uppercase;letter-spacing:.7px">Estimated total</span><strong id="poTotal" style="font-family:var(--font-head);font-size:22px;color:var(--ink)">Rs. 0</strong></div>
            <span id="poSub" class="muted" style="font-size:10px">Subtotal Rs. 0 · tax Rs. 0</span>
          </div>
        </form>`,
        footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-gold" data-save><i data-lucide="clipboard-check"></i> Create purchase order</button>`,
        onMount: (modal) => {
          const wrap = A.qs('#poLines', modal.body);
          const recalc = () => {
            let sub = 0;
            A.qsa('.po-row', wrap).forEach((row) => {
              const ingId = Number(A.qs('select', row).value);
              const qty = Number(A.qs('[data-qty]', row).value) || 0;
              const cost = Number(A.qs('[data-cost]', row).value) || 0;
              const ing = state.ingredients.find((i) => i.id === ingId);
              const line = ing ? qty * cost : 0;
              sub += line;
              A.qs('.po-line-cost', row).textContent = ing ? A.money2(line) : '—';
            });
            const tax = Number(A.qs('#poTax', modal.body).value) || 0;
            A.qs('#poTotal', modal.body).textContent = A.money2(sub + tax);
            A.qs('#poSub', modal.body).textContent = `Subtotal ${A.money2(sub)} · tax ${A.money2(tax)}`;
          };
          const syncCost = (row) => {
            const ing = state.ingredients.find((i) => i.id === Number(A.qs('select', row).value));
            if (ing && !A.qs('[data-cost]', row).dataset.touched) A.qs('[data-cost]', row).value = ing.purchase_price;
            recalc();
          };
          A.qsa('.po-row', wrap).forEach(syncCost);
          wrap.addEventListener('input', recalc);
          wrap.addEventListener('change', (e) => { if (e.target.matches('select')) { e.target.closest('.po-row').querySelector('[data-cost]').dataset.touched = ''; syncCost(e.target.closest('.po-row')); } });
          wrap.addEventListener('click', (e) => {
            const rm = e.target.closest('.row-remove');
            if (!rm) return;
            rm.closest('.po-row').remove();
            if (!A.qsa('.po-row', wrap).length) wrap.insertAdjacentHTML('beforeend', poLineHTML(state.ingredients));
            recalc();
          });
          A.qs('#poAddLine', modal.body).addEventListener('click', () => { wrap.insertAdjacentHTML('beforeend', poLineHTML(state.ingredients)); A.icons(); });
          A.qs('[data-cancel]', modal.footer).addEventListener('click', modal.close);
          A.qs('[data-save]', modal.footer).addEventListener('click', async (e) => {
            const supplier_id = Number(A.qs('[name="supplier_id"]', modal.body).value);
            if (!supplier_id) return A.toast('Choose a supplier.', 'error');
            const items = [];
            let invalid = false;
            A.qsa('.po-row', wrap).forEach((row) => {
              const ingredient_id = Number(A.qs('select', row).value);
              const qtyRaw = A.qs('[data-qty]', row).value;
              const costRaw = A.qs('[data-cost]', row).value;
              const qty = Number(qtyRaw);
              const unit_cost = Number(costRaw);
              // Ignore entirely blank lines; only flag lines the user started filling in.
              if (!ingredient_id && qtyRaw === '' && costRaw === '') return;
              if (!ingredient_id || !(qty > 0) || !(unit_cost >= 0)) { invalid = true; return; }
              items.push({ ingredient_id, qty, unit_cost });
            });
            if (invalid) return A.toast('Every filled line needs an ingredient, a positive quantity and a unit cost.', 'error');
            if (!items.length) return A.toast('Add at least one order line.', 'error');
            const payload = {
              supplier_id, items,
              order_date: A.qs('[name="order_date"]', modal.body).value,
              tax: Number(A.qs('#poTax', modal.body).value) || 0,
              notes: A.qs('[name="notes"]', modal.body).value,
              status: A.qs('#poReceive', modal.body).checked ? 'received' : 'pending'
            };
            A.busyEvent(e, true, 'Creating…');
            try {
              await A.api('/purchases', { method: 'POST', body: payload });
              A.toast(payload.status === 'received' ? 'Purchase received · inventory updated.' : 'Purchase order created.', 'success');
              modal.close(); state.tab = 'purchases'; await load();
            } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
          });
          recalc();
        }
      });
    }

    function poLineHTML(ingredients) {
      return `<div class="po-row">
        <select>${A.options(ingredients, '', 'id', 'name', 'Choose ingredient…')}</select>
        <input type="number" min="0.001" step="0.001" data-qty placeholder="Qty">
        <input type="number" min="0" step="0.01" data-cost placeholder="Unit cost">
        <button type="button" class="btn btn-xs btn-danger-soft btn-icon row-remove" title="Remove"><i data-lucide="x"></i></button>
        <span class="po-line-cost mono muted" style="grid-column:1/-1;font-size:9px;margin-top:-5px">—</span>
      </div>`;
    }

    async function viewPurchase(id) {
      const m = A.modal({ title: 'Purchase order', size: 'lg', body: `<div class="view-loading" style="min-height:170px"><span class="spinner"></span></div>`, footer: '' });
      try {
        const { purchase: p } = await A.api(`/purchases/${id}`);
        const due = Number(p.total) - Number(p.paid_amount);
        m.body.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:15px;flex-wrap:wrap">
            <div><div style="font-family:var(--font-display);font-size:26px;font-weight:500">${A.esc(p.po_number)}</div><div class="muted small">${A.esc(p.supplier_name || '—')} · ordered ${A.date(p.order_date)}</div></div>
            <div style="text-align:right"><div style="font-family:var(--font-head);font-weight:800;font-size:22px">${A.money2(p.total)}</div>${A.badge(p.status)}</div>
          </div>
          <div class="order-detail-grid">
            <div>
              <div class="detail-section"><h4>Items</h4><div class="detail-items">${p.items.map((it) => `<div class="detail-item"><div class="di-name"><strong>${A.esc(it.name)}</strong><span>${A.num(it.qty, 2)} ${A.esc(it.unit)} × ${A.money2(it.unit_cost)}</span></div><div class="di-qty"></div><div class="di-total">${A.money2(it.total)}</div></div>`).join('')}</div></div>
              <div class="detail-section"><h4>Totals</h4>
                <div class="detail-row"><span>Subtotal</span><b>${A.money2(p.subtotal)}</b></div>
                <div class="detail-row"><span>Tax / charges</span><b>${A.money2(p.tax)}</b></div>
                <div class="detail-row total"><span>Total</span><b>${A.money2(p.total)}</b></div>
              </div>
            </div>
            <div>
              <div class="detail-section"><h4>Supplier</h4>
                <div class="detail-row"><span>Name</span><b>${A.esc(p.supplier_name || '—')}</b></div>
                <div class="detail-row"><span>Phone</span><b>${A.esc(p.supplier_phone || '—')}</b></div>
                <div class="detail-row"><span>Email</span><b>${A.esc(p.supplier_email || '—')}</b></div>
              </div>
              <div class="detail-section"><h4>Payment</h4>
                <div class="detail-row"><span>Paid</span><b style="color:var(--green)">${A.money2(p.paid_amount)}</b></div>
                <div class="detail-row"><span>Due</span><b style="color:${due > 0 ? 'var(--red)' : 'var(--muted)'}">${A.money2(due)}</b></div>
                ${p.received_date ? `<div class="detail-row"><span>Received</span><b>${A.date(p.received_date)}</b></div>` : ''}
                ${p.notes ? `<div class="detail-row"><span>Notes</span><b>${A.esc(p.notes)}</b></div>` : ''}
              </div>
            </div>
          </div>`;
        m.footer.innerHTML = `<button class="btn btn-soft left" data-print><i data-lucide="printer"></i> Print</button>
          ${p.status !== 'received' && p.status !== 'cancelled' ? `<button class="btn btn-gold" data-recv><i data-lucide="package-check"></i> Receive stock</button>` : ''}
          ${due > 0 ? `<button class="btn btn-green" data-paynow>Record payment</button>` : ''}
          <button class="btn btn-outline" data-close>Close</button>`;
        A.icons();
        A.qs('[data-close]', m.footer).addEventListener('click', m.close);
        A.qs('[data-print]', m.footer).addEventListener('click', () => window.print());
        A.qs('[data-recv]', m.footer)?.addEventListener('click', () => { m.close(); receivePurchase(p); });
        A.qs('[data-paynow]', m.footer)?.addEventListener('click', () => { m.close(); payPurchase(p); });
      } catch (err) {
        m.body.innerHTML = `<div class="modal-note danger">${A.esc(err.message)}</div>`;
      }
    }

    function receivePurchase(p) {
      A.confirm({
        title: 'Receive this purchase?',
        message: `${p.po_number} from ${p.supplier_name || 'supplier'} will add ${p.item_count} ingredient line(s) into stock and update cost prices.`,
        confirmText: 'Receive stock', danger: false, icon: 'package-check',
        onConfirm: async () => {
          await A.api(`/purchases/${p.id}/receive`, { method: 'PATCH' });
          A.toast('Stock received — inventory updated.', 'success');
          await load();
        }
      });
    }

    function payPurchase(p) {
      const due = Number(p.total) - Number(p.paid_amount);
      const m = A.modal({
        title: 'Record supplier payment',
        subtitle: `${p.po_number} · ${p.supplier_name || ''}`,
        size: 'sm',
        body: `<form id="payForm"><div class="form-grid">
          <label class="field full"><span>Amount due</span><input value="${A.money2(due)}" disabled></label>
          <label class="field full"><span>Payment amount *</span><input name="amount" type="number" min="0.01" step="0.01" max="${due}" value="${due}" required></label>
        </div><div class="modal-note" style="margin-top:10px"><i data-lucide="info"></i><span>Outstanding supplier balance will reduce immediately.</span></div></form>`,
        footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-green" data-save><i data-lucide="banknote"></i> Record payment</button>`,
        onMount: (modal) => {
          A.qs('[data-cancel]', modal.footer).addEventListener('click', modal.close);
          A.qs('[data-save]', modal.footer).addEventListener('click', async (e) => {
            const amount = Number(A.qs('[name="amount"]', modal.body).value);
            if (!(amount > 0)) return A.toast('Enter a payment amount.', 'error');
            A.busyEvent(e, true, 'Recording…');
            try {
              await A.api(`/purchases/${p.id}/pay`, { method: 'POST', body: { amount } });
              A.toast('Supplier payment recorded.', 'success'); modal.close(); await load();
            } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
          });
        }
      });
    }

    await load();
    return () => { state.destroyed = true; };
  };
})();
