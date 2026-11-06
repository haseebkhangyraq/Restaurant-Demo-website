/* ==========================================================================
   Admin — Inventory & stock movements
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;
  const UNITS = ['kg', 'g', 'litre', 'ml', 'piece', 'dozen', 'packet', 'box', 'bottle', 'bunch'];
  const MOVEMENTS = [['receive', 'Received'], ['issue', 'Issued to kitchen'], ['wastage', 'Wastage'], ['adjustment', 'Adjustment'], ['return', 'Returned'], ['purchase', 'Purchase received'], ['sale', 'Sold (recipe)'], ['opening', 'Opening stock']];

  A.views.inventory = async function (view) {
    const state = {
      tab: 'ingredients', data: null, movements: [], search: '', filter: 'all', movementType: 'all',
      movementIngredient: '', loadedMovements: false, destroyed: false
    };

    view.innerHTML = `<div class="view-loading"><span class="spinner"></span><p>Counting the store room…</p></div>`;

    async function load() {
      try {
        const data = await A.api('/ingredients');
        if (state.destroyed) return;
        state.data = data;
        if (state.loadedMovements) await loadMovements(true);
        paint();
      } catch (err) {
        if (state.destroyed) return;
        view.innerHTML = `<div class="card card-pad" style="max-width:560px;margin:9vh auto;text-align:center"><div class="confirm-icon"><i data-lucide="alert-triangle"></i></div><h2 style="font-family:var(--font-display);font-size:28px">Inventory unavailable</h2><p class="muted small">${A.esc(err.message)}</p></div>`;
        A.icons();
      }
    }

    async function loadMovements(silent) {
      try {
        const qs = new URLSearchParams();
        if (state.movementType !== 'all') qs.set('type', state.movementType);
        if (state.movementIngredient) qs.set('ingredient_id', state.movementIngredient);
        qs.set('limit', '200');
        const res = await A.api(`/inventory/transactions?${qs.toString()}`);
        if (state.destroyed) return;
        state.movements = res.transactions || [];
        state.loadedMovements = true;
        if (!silent) paint();
      } catch (err) {
        if (!silent) A.notifyError(err);
      }
    }

    function filtered() {
      const q = state.search.toLowerCase();
      return state.data.ingredients.filter((i) => {
        if (state.filter === 'low' && i.stock_status === 'ok') return false;
        if (state.filter === 'out' && i.stock_status !== 'out') return false;
        if (state.filter === 'expiring' && !isExpiring(i)) return false;
        if (!q) return true;
        return `${i.name} ${i.category || ''} ${i.supplier_name || ''}`.toLowerCase().includes(q);
      });
    }

    function isExpiring(i) {
      if (!i.expiry_date) return false;
      const d = A.parse(i.expiry_date);
      if (!d) return false;
      return d.getTime() <= Date.now() + 7 * 86400000;
    }

    function paint() {
      const s = state.data.summary;
      view.innerHTML = `
        <div class="view-head">
          <div class="view-head-copy"><h2>Inventory</h2><p>Ingredients, par levels, expiry watch and a complete stock ledger. Recipe sales deduct automatically.</p></div>
          <div class="view-head-actions">
            <button class="btn btn-outline" id="invRefresh"><i data-lucide="refresh-cw"></i> Refresh</button>
            <button class="btn btn-gold" id="invAdd"><i data-lucide="plus"></i> New ingredient</button>
          </div>
        </div>

        <div class="kpi-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:16px">
          <div class="kpi"><span class="kpi-label">Ingredients</span><span class="kpi-value">${A.num(s.count)}</span><div class="kpi-meta"><span>Tracked lines</span></div></div>
          <div class="kpi"><span class="kpi-label">Stock value</span><span class="kpi-value">${A.money(s.value)}</span><div class="kpi-meta"><span>At purchase cost</span></div></div>
          <div class="kpi"><span class="kpi-label">Low stock</span><span class="kpi-value" style="color:${s.low ? 'var(--red)' : 'var(--green)'}">${A.num(s.low)}</span><div class="kpi-meta"><span>At or below par</span></div></div>
          <div class="kpi"><span class="kpi-label">Out of stock</span><span class="kpi-value" style="color:${s.out ? 'var(--red)' : 'var(--green)'}">${A.num(s.out)}</span><div class="kpi-meta"><span>Needs an order</span></div></div>
          <div class="kpi"><span class="kpi-label">Expiring soon</span><span class="kpi-value">${A.num(s.expiring)}</span><div class="kpi-meta"><span>Within seven days</span></div></div>
        </div>

        <div class="seg-tabs" id="invTabs" style="margin-bottom:14px">
          <button data-tab="ingredients" class="${state.tab === 'ingredients' ? 'active' : ''}"><i data-lucide="boxes" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"></i> Ingredients</button>
          <button data-tab="movements" class="${state.tab === 'movements' ? 'active' : ''}"><i data-lucide="arrow-left-right" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"></i> Stock ledger</button>
        </div>

        <div id="invPanel"></div>`;
      A.icons();
      A.qs('#invTabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]');
        if (!b) return;
        state.tab = b.dataset.tab;
        if (state.tab === 'movements' && !state.loadedMovements) loadMovements().then(paint);
        else paint();
      });
      A.qs('#invRefresh').addEventListener('click', (e) => { A.busyEvent(e, true, ''); load().finally(() => A.busyEvent(e, false)); });
      A.qs('#invAdd').addEventListener('click', () => ingredientForm(null));
      paintPanel();
    }

    function paintPanel() {
      const panel = A.qs('#invPanel');
      if (!panel) return;
      if (state.tab === 'ingredients') paintIngredients(panel);
      else paintMovements(panel);
      A.icons();
    }

    function paintIngredients(panel) {
      panel.innerHTML = `
        <div class="filter-bar">
          <div class="search-box"><i data-lucide="search"></i><input type="search" id="invSearch" placeholder="Search ingredient, category or supplier…" value="${A.esc(state.search)}"></div>
          <div class="seg-tabs" id="invFilter">
            ${[['all', 'All'], ['low', 'Needs restock'], ['out', 'Out of stock'], ['expiring', 'Expiring']].map(([v, l]) => `<button data-filter="${v}" class="${state.filter === v ? 'active' : ''}">${l}</button>`).join('')}
          </div>
          <span class="spacer"></span><span class="muted small">${filtered().length} lines</span>
        </div>
        <div class="table-card">
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Ingredient</th><th>In stock</th><th class="num">Par level</th><th class="num">Unit cost</th><th class="num">Value</th><th>Supplier</th><th>Expiry</th><th class="actions">Actions</th></tr></thead>
            <tbody>${ingredientRows()}</tbody>
          </table></div>
          <div class="table-foot"><span>Stock deducts automatically when kitchen orders are completed</span><a href="#/suppliers" style="color:var(--gold-dark);font-weight:600">Purchase stock →</a></div>
        </div>`;
      const search = A.qs('#invSearch', panel);
      search.addEventListener('input', A.debounce(() => {
        state.search = search.value.trim();
        A.qs('tbody', panel).innerHTML = ingredientRows();
        A.icons(); bindIngredientRows();
      }, 180));
      A.qs('#invFilter', panel).addEventListener('click', (e) => {
        const b = e.target.closest('[data-filter]');
        if (!b) return;
        state.filter = b.dataset.filter;
        A.qsa('#invFilter button', panel).forEach((x) => x.classList.toggle('active', x === b));
        A.qs('tbody', panel).innerHTML = ingredientRows();
        A.icons(); bindIngredientRows();
      });
      bindIngredientRows();
    }

    function ingredientRows() {
      const list = filtered();
      return list.length ? list.map((i) => {
        const pct = i.min_stock > 0 ? A.clamp((i.stock_qty / (i.min_stock * 3)) * 100, 0, 100) : (i.stock_qty > 0 ? 100 : 0);
        const exp = i.expiry_date ? (isExpiring(i) ? `<span style="color:${i.stock_status === 'out' ? 'var(--red)' : 'var(--amber)'}">${A.date(i.expiry_date)}</span>` : `<span class="muted">${A.date(i.expiry_date)}</span>`) : '<span class="muted">—</span>';
        return `<tr>
          <td><div class="cell-main"><span class="avatar" style="width:28px;height:28px;font-size:8px;background:${i.stock_status === 'out' ? '#f8e5e3' : i.stock_status === 'low' ? '#fdf3e3' : '#e8f2eb'};color:${i.stock_status === 'out' ? 'var(--red)' : i.stock_status === 'low' ? 'var(--amber)' : 'var(--green)'}"><i data-lucide="${i.stock_status === 'ok' ? 'package' : 'package-search'}" style="width:13px;height:13px"></i></span><div><strong>${A.esc(i.name)}</strong><span>${A.esc(i.category || 'General')}</span></div></div></td>
          <td><span class="stock-qty ${i.stock_status === 'ok' ? 'ok' : 'low'}">${A.num(i.stock_qty, 2)} ${A.esc(i.unit)}</span><span class="stock-bar ${i.stock_status === 'out' ? 'low' : i.stock_status === 'low' ? 'mid' : ''}"><i style="width:${pct}%"></i></span></td>
          <td class="num muted">${A.num(i.min_stock, 2)} ${A.esc(i.unit)}</td>
          <td class="num">${A.money2(i.purchase_price)}</td>
          <td class="num strong">${A.money(i.stock_value)}</td>
          <td class="small">${A.esc(i.supplier_name || '—')}</td>
          <td class="small">${exp}</td>
          <td class="actions"><div class="row-actions">
            <button class="btn btn-xs btn-outline" data-adjust="${i.id}"><i data-lucide="sliders-horizontal"></i> Stock</button>
            <button class="btn btn-xs btn-soft btn-icon" data-edit-ing="${i.id}" title="Edit"><i data-lucide="pencil"></i></button>
            ${A.isManager() ? `<button class="btn btn-xs btn-danger-soft btn-icon" data-del-ing="${i.id}" title="Delete"><i data-lucide="trash-2"></i></button>` : ''}
          </div></td>
        </tr>`;
      }).join('') : `<tr><td colspan="8">${A.empty('No ingredients match', 'Adjust the filters or add a new ingredient.', 'boxes')}</td></tr>`;
    }

    function bindIngredientRows() {
      A.qsa('[data-adjust]', view).forEach((b) => b.addEventListener('click', () => adjustForm(state.data.ingredients.find((i) => i.id === Number(b.dataset.adjust)))));
      A.qsa('[data-edit-ing]', view).forEach((b) => b.addEventListener('click', () => ingredientForm(state.data.ingredients.find((i) => i.id === Number(b.dataset.editIng)))));
      A.qsa('[data-del-ing]', view).forEach((b) => b.addEventListener('click', () => {
        const i = state.data.ingredients.find((x) => x.id === Number(b.dataset.delIng));
        A.deleteConfirm(i.name, async () => {
          await A.api(`/ingredients/${i.id}`, { method: 'DELETE' });
          A.toast('Ingredient deleted.', 'success'); await load();
        }, { title: 'Delete ingredient?', message: 'Recipes using this ingredient will be updated. This cannot be undone.' });
      }));
    }

    function ingredientForm(ingredient) {
      const isNew = !ingredient;
      const i = ingredient || { name: '', unit: 'kg', stock_qty: 0, min_stock: 1, purchase_price: '', supplier_id: '', expiry_date: '', category: 'General' };
      const categories = [...new Set(['General', 'Meat', 'Seafood', 'Produce', 'Dairy', 'Pantry', 'Spices', 'Beverage', 'Bakery', ...state.data.ingredients.map((x) => x.category || 'General')])];
      const m = A.modal({
        title: isNew ? 'New ingredient' : 'Edit ingredient',
        subtitle: isNew ? 'Add a stock line, par level and supplier price.' : i.name,
        size: 'lg',
        body: `<form id="ingForm"><div class="form-grid three">
          <label class="field full"><span>Ingredient name *</span><input name="name" value="${A.esc(i.name)}" required placeholder="e.g. Chicken thigh, boneless"></label>
          <label class="field"><span>Category</span><input name="category" list="ingCats" value="${A.esc(i.category || 'General')}"><datalist id="ingCats">${categories.map((c) => `<option value="${A.esc(c)}">`).join('')}</datalist></label>
          <label class="field"><span>Unit *</span><select name="unit">${UNITS.map((u) => `<option ${i.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
          <label class="field"><span>Supplier</span><select name="supplier_id">${A.options(state.data.suppliers, i.supplier_id, 'id', 'name', 'No supplier')}</select></label>
          <label class="field"><span>Opening stock</span><input name="stock_qty" type="number" min="0" step="0.001" value="${i.stock_qty || 0}" ${isNew ? '' : 'disabled'}></label>
          <label class="field"><span>Par level (min)</span><input name="min_stock" type="number" min="0" step="0.001" value="${i.min_stock ?? 1}"></label>
          <label class="field"><span>Purchase price / unit *</span><input name="purchase_price" type="number" min="0" step="0.01" value="${i.purchase_price || ''}" required></label>
          <label class="field full"><span>Expiry date</span><input name="expiry_date" type="date" value="${i.expiry_date || ''}"></label>
        </div>
        ${isNew ? '<div class="modal-note"><i data-lucide="info"></i><span>Opening stock creates an inventory ledger entry. Leave at zero if this is a new line.</span></div>' : '<div class="modal-note"><i data-lucide="info"></i><span>To change the quantity in stock, use the Stock button on the ingredient row so the ledger stays accurate.</span></div>'}
        </form>`,
        footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-gold" data-save>${isNew ? 'Create ingredient' : 'Save changes'}</button>`,
        onMount: (modal) => {
          A.qs('[data-cancel]', modal.footer).addEventListener('click', modal.close);
          A.qs('[data-save]', modal.footer).addEventListener('click', async (e) => {
            const form = A.qs('#ingForm', modal.body);
            if (!form.reportValidity()) return;
            const fd = A.formData(form);
            if (!fd.supplier_id) fd.supplier_id = null;
            A.busyEvent(e, true, 'Saving…');
            try {
              await A.api(isNew ? '/ingredients' : `/ingredients/${i.id}`, { method: isNew ? 'POST' : 'PUT', body: fd });
              A.toast(isNew ? 'Ingredient created.' : 'Ingredient updated.', 'success');
              modal.close(); await load();
            } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
          });
        }
      });
    }

    function adjustForm(ing) {
      const m = A.modal({
        title: 'Adjust stock',
        subtitle: `${ing.name} · currently ${A.num(ing.stock_qty, 2)} ${ing.unit}`,
        size: 'sm',
        body: `<form id="adjForm">
          <div class="form-grid">
            <label class="field full"><span>Movement type</span><select name="type">${MOVEMENTS.filter(([v]) => ['receive', 'issue', 'wastage', 'adjustment', 'return'].includes(v)).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
            <label class="field"><span>Quantity *</span><input name="qty" type="number" step="0.001" min="0" required placeholder="0"></label>
            <label class="field"><span>Unit cost</span><input name="unit_cost" type="number" min="0" step="0.01" value="${ing.purchase_price}"></label>
            <label class="field full"><span>Reference</span><input name="reference" placeholder="Invoice, PO or staff initials"></label>
            <label class="field full"><span>Notes</span><textarea name="notes" style="min-height:55px" placeholder="Reason for adjustment…"></textarea></label>
          </div>
          <div class="modal-note" style="margin-top:10px"><i data-lucide="arrow-left-right"></i><span id="adjPreview">New stock after movement will appear here.</span></div>
        </form>`,
        footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-gold" data-save><i data-lucide="check"></i> Post movement</button>`,
        onMount: (modal) => {
          const form = A.qs('#adjForm', modal.body);
          const preview = A.qs('#adjPreview', modal.body);
          const update = () => {
            const type = form.type.value;
            let qty = Number(form.qty.value) || 0;
            let change = 0;
            if (type === 'receive' || type === 'return') change = Math.abs(qty);
            else if (type === 'issue' || type === 'wastage') change = -Math.abs(qty);
            else change = qty;
            preview.textContent = `${A.num(ing.stock_qty, 2)} → ${A.num(Number(ing.stock_qty) + change, 2)} ${ing.unit} (${change >= 0 ? '+' : ''}${A.num(change, 2)})`;
          };
          form.addEventListener('input', update);
          form.addEventListener('change', update);
          A.qs('[data-cancel]', modal.footer).addEventListener('click', modal.close);
          A.qs('[data-save]', modal.footer).addEventListener('click', async (e) => {
            if (!form.reportValidity()) return;
            const fd = A.formData(form);
            A.busyEvent(e, true, 'Posting…');
            try {
              await A.api('/inventory/transactions', { method: 'POST', body: { ...fd, ingredient_id: ing.id } });
              A.toast('Stock movement posted.', 'success');
              modal.close();
              state.loadedMovements = false;
              await load();
              if (state.tab === 'movements') await loadMovements();
            } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
          });
        }
      });
    }

    function paintMovements(panel) {
      panel.innerHTML = `
        <div class="filter-bar">
          <select id="movIng"><option value="">All ingredients</option>${state.data.ingredients.map((i) => `<option value="${i.id}" ${String(state.movementIngredient) === String(i.id) ? 'selected' : ''}>${A.esc(i.name)}</option>`).join('')}</select>
          <select id="movType"><option value="all">All movement types</option>${MOVEMENTS.map(([v, l]) => `<option value="${v}" ${state.movementType === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <button class="btn btn-soft btn-sm" id="movClear"><i data-lucide="filter-x"></i> Clear</button>
          <span class="spacer"></span><span class="muted small">${state.movements.length} entries · latest 200</span>
        </div>
        <div class="table-card">
          <div class="table-wrap"><table class="data">
            <thead><tr><th>When</th><th>Ingredient</th><th>Type</th><th class="num">Change</th><th class="num">Unit cost</th><th>Reference</th><th>Note</th><th>By</th></tr></thead>
            <tbody>${movementRows()}</tbody>
          </table></div>
          <div class="table-foot"><span>Every stock movement is recorded for audit</span><span class="muted">Newest first</span></div>
        </div>`;
      A.qs('#movIng', panel).addEventListener('change', (e) => { state.movementIngredient = e.target.value; loadMovements().then(paint); });
      A.qs('#movType', panel).addEventListener('change', (e) => { state.movementType = e.target.value; loadMovements().then(paint); });
      A.qs('#movClear', panel).addEventListener('click', () => { state.movementIngredient = ''; state.movementType = 'all'; loadMovements().then(paint); });
    }

    function movementRows() {
      if (!state.movements.length) return `<tr><td colspan="8">${A.empty('No stock movements', 'Adjustments, receiving and recipe deductions will appear here.', 'arrow-left-right')}</td></tr>`;
      return state.movements.map((t) => {
        const change = Number(t.qty_change);
        return `<tr>
          <td><span class="small">${A.dateShort(t.created_at)}</span><div class="muted" style="font-size:8.5px">${A.time(t.created_at)}</div></td>
          <td><strong>${A.esc(t.ingredient_name)}</strong><div class="muted" style="font-size:8.5px">${A.esc(t.unit)}</div></td>
          <td><span class="tx-type ${A.esc(t.type)}">${A.esc(A.capitalize(t.type))}</span></td>
          <td class="num"><span class="tx-qty ${change >= 0 ? 'pos' : 'neg'}">${change >= 0 ? '+' : ''}${A.num(change, 2)}</span></td>
          <td class="num">${A.money2(t.unit_cost)}</td>
          <td class="small">${A.esc(t.reference || '—')}</td>
          <td class="muted small">${A.esc(t.notes || '—')}</td>
          <td class="small">${A.esc(t.staff_name || 'System')}</td>
        </tr>`;
      }).join('');
    }

    await load();
    return () => { state.destroyed = true; };
  };
})();
