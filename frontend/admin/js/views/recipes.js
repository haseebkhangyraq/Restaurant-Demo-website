/* ==========================================================================
   Admin — Recipes & food costing
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;

  A.views.recipes = async function (view) {
    const state = { data: null, search: '', missingOnly: false, destroyed: false };

    view.innerHTML = `<div class="view-loading"><span class="spinner"></span><p>Costing the menu…</p></div>`;

    async function load() {
      try {
        const data = await A.api('/recipes');
        if (state.destroyed) return;
        state.data = data;
        paint();
      } catch (err) {
        if (state.destroyed) return;
        view.innerHTML = `<div class="card card-pad" style="max-width:560px;margin:9vh auto;text-align:center"><div class="confirm-icon"><i data-lucide="alert-triangle"></i></div><h2 style="font-family:var(--font-display);font-size:28px">Costing unavailable</h2><p class="muted small">${A.esc(err.message)}</p></div>`;
        A.icons();
      }
    }

    function filtered() {
      const q = state.search.toLowerCase();
      return state.data.recipes.filter((r) => {
        if (state.missingOnly && r.ingredients.length) return false;
        if (!q) return true;
        return `${r.name} ${r.category || ''}`.toLowerCase().includes(q);
      });
    }

    function rows() {
      const list = filtered();
      if (!list.length) return `<tr><td colspan="7">${A.empty('No dishes match', 'Adjust the search or add a recipe to an uncosted dish.', 'flask-conical')}</td></tr>`;
      return list.map((r) => `<tr class="recipe-product-row" data-recipe="${r.id}">
        <td><div class="cell-main"><img src="${A.img(r.image)}" alt="" style="width:34px;height:34px;border-radius:7px;object-fit:cover"><div><strong>${A.esc(r.name)}</strong><span>${A.esc(r.category || 'Uncategorised')}</span></div></div></td>
        <td class="num strong">${A.money(r.price)}</td>
        <td class="num">${r.ingredients.length ? A.money(r.cost) : '<span class="muted">—</span>'}</td>
        <td class="num" style="color:${r.profit >= 0 ? 'var(--green)' : 'var(--red)'}">${r.ingredients.length ? A.money(r.profit) : '—'}</td>
        <td style="min-width:100px">${r.ingredients.length ? `<div style="display:flex;align-items:center;gap:7px"><div class="margin-bar" style="flex:1"><i style="width:${A.clamp(r.margin, 0, 100)}%;background:${r.margin >= 60 ? 'var(--green)' : r.margin >= 35 ? 'var(--amber)' : 'var(--red)'}"></i></div><b style="font-size:10px;min-width:36px">${r.margin}%</b></div>` : '<span class="badge inactive">No recipe</span>'}</td>
        <td class="muted small">${r.ingredients.length} ingredient${r.ingredients.length === 1 ? '' : 's'}</td>
        <td class="actions"><button class="btn btn-xs btn-outline" data-edit="${r.id}"><i data-lucide="pencil"></i> Edit recipe</button></td>
      </tr>`).join('');
    }

    function paint() {
      const s = state.data.summary;
      view.innerHTML = `
        <div class="view-head">
          <div class="view-head-copy"><h2>Recipes &amp; costing</h2><p>Every plate costed ingredient by ingredient. Food cost and margin update the moment a supplier price changes.</p></div>
          <div class="view-head-actions">
            <button class="btn btn-outline" id="recipeRefresh"><i data-lucide="refresh-cw"></i> Refresh</button>
            ${A.can('menu') ? `<a class="btn btn-gold" href="#/menu"><i data-lucide="book-open-text"></i> Menu manager</a>` : ''}
          </div>
        </div>

        <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
          <div class="kpi"><span class="kpi-label">Dishes costed</span><span class="kpi-value">${state.data.recipes.length - s.missing}</span><div class="kpi-meta"><span>${s.missing} awaiting a recipe</span></div></div>
          <div class="kpi"><span class="kpi-label">Average food cost</span><span class="kpi-value">${A.money(s.avgCost)}</span><div class="kpi-meta"><span>Per dish across the menu</span></div></div>
          <div class="kpi"><span class="kpi-label">Average margin</span><span class="kpi-value" style="color:${s.avgMargin >= 60 ? 'var(--green)' : 'var(--amber)'}">${s.avgMargin}%</span><div class="kpi-meta"><span>Target 60% or better</span></div></div>
          <div class="kpi"><span class="kpi-label">Ingredients</span><span class="kpi-value">${state.data.ingredients.length}</span><div class="kpi-meta"><span>Available for costing</span></div></div>
        </div>

        <div class="filter-bar">
          <div class="search-box"><i data-lucide="search"></i><input type="search" id="recipeSearch" placeholder="Search dishes…" value="${A.esc(state.search)}"></div>
          <label class="checkbox"><input type="checkbox" id="recipeMissing" ${state.missingOnly ? 'checked' : ''}><span>Only dishes without a recipe</span></label>
          <span class="spacer"></span>
          <span class="muted small">${filtered().length} dish${filtered().length === 1 ? '' : 'es'}</span>
        </div>

        <div class="table-card">
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Dish</th><th class="num">Selling price</th><th class="num">Food cost</th><th class="num">Gross profit</th><th>Margin</th><th>Recipe</th><th class="actions">Actions</th></tr></thead>
              <tbody>${rows()}</tbody>
            </table>
          </div>
          <div class="table-foot"><span>Food cost derived from ingredient purchase prices</span><span class="muted">A healthy grill menu targets 25–40% cost</span></div>
        </div>`;
      A.icons();
      bind();
    }

    function bind() {
      const search = A.qs('#recipeSearch');
      search.addEventListener('input', A.debounce(() => { state.search = search.value.trim(); const tbody = A.qs('tbody'); tbody.innerHTML = rows(); A.icons(); bindRows(); }, 200));
      A.qs('#recipeMissing').addEventListener('change', (e) => { state.missingOnly = e.target.checked; paint(); });
      A.qs('#recipeRefresh').addEventListener('click', (e) => { A.busyEvent(e, true, ''); load().finally(() => A.busyEvent(e, false)); });
      bindRows();
    }

    function bindRows() {
      A.qsa('[data-edit], [data-recipe]').forEach((el) => {
        const id = el.dataset.edit || el.dataset.recipe;
        el.addEventListener('click', (e) => {
          if (e.target.closest('button[data-edit]') || el.classList.contains('recipe-product-row')) {
            e.preventDefault();
            editRecipe(Number(id));
          }
        });
      });
    }

    function editRecipe(id) {
      const r = state.data.recipes.find((x) => x.id === id);
      if (!r) return;
      const ingredients = state.data.ingredients;
      const m = A.modal({
        title: r.name,
        subtitle: `Selling price ${A.money(r.price)} · recipe cost and margin update live`,
        size: 'lg',
        body: `
          <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:14px">
            <div class="expense-cat"><span>Selling price</span><b>${A.money(r.price)}</b><small>On the menu</small></div>
            <div class="expense-cat"><span>Food cost</span><b id="rCost">${A.money(r.cost)}</b><small>Per portion</small></div>
            <div class="expense-cat"><span>Margin</span><b id="rMargin">${r.margin}%</b><small id="rProfit">${A.money(r.profit)} profit</small></div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">
            <h4 class="field-label" style="margin:0">Ingredients <span class="muted" style="font-weight:400">— quantities are per single portion</span></h4>
            <button class="btn btn-soft btn-xs" id="recipeAddRow"><i data-lucide="plus"></i> Add ingredient</button>
          </div>
          <div id="recipeRows">
            ${r.ingredients.length ? r.ingredients.map((it) => recipeRowHTML(it, ingredients)).join('') : recipeRowHTML({}, ingredients)}
          </div>
          <div class="modal-note" style="margin-top:12px"><i data-lucide="info"></i><span>Ingredient costs come from purchase prices in inventory. Updating a supplier price changes every recipe that uses it.</span></div>`,
        footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-gold" data-save><i data-lucide="save"></i> Save recipe</button>`,
        onMount: (modal) => {
          const wrap = A.qs('#recipeRows', modal.body);
          const recalc = () => {
            let cost = 0;
            A.qsa('.recipe-row', wrap).forEach((row) => {
              const select = A.qs('select', row);
              const qty = Number(A.qs('input[type="number"]', row).value) || 0;
              const ing = ingredients.find((i) => i.id === Number(select.value));
              const line = ing ? qty * Number(ing.purchase_price) : 0;
              cost += line;
              A.qs('.line-cost', row).textContent = ing ? A.money2(line) : '—';
            });
            const profit = Number(r.price) - cost;
            const margin = r.price ? Math.round((profit / r.price) * 1000) / 10 : 0;
            A.qs('#rCost', modal.body).textContent = A.money(cost);
            A.qs('#rMargin', modal.body).textContent = `${margin}%`;
            A.qs('#rProfit', modal.body).textContent = `${A.money(profit)} profit`;
          };
          wrap.addEventListener('input', recalc);
          wrap.addEventListener('change', recalc);
          wrap.addEventListener('click', (e) => {
            const rm = e.target.closest('.row-remove');
            if (!rm) return;
            rm.closest('.recipe-row').remove();
            if (!A.qsa('.recipe-row', wrap).length) wrap.insertAdjacentHTML('beforeend', recipeRowHTML({}, ingredients));
            recalc();
          });
          A.qs('#recipeAddRow', modal.body).addEventListener('click', () => { wrap.insertAdjacentHTML('beforeend', recipeRowHTML({}, ingredients)); recalc(); });
          A.qs('[data-cancel]', modal.footer).addEventListener('click', modal.close);
          A.qs('[data-save]', modal.footer).addEventListener('click', async (e) => {
            const items = [];
            let invalid = false;
            A.qsa('.recipe-row', wrap).forEach((row) => {
              const ingredient_id = Number(A.qs('select', row).value);
              const qty = Number(A.qs('input[type="number"]', row).value);
              if (!ingredient_id || !(qty > 0)) { invalid = true; return; }
              items.push({ ingredient_id, qty });
            });
            if (invalid) return A.toast('Choose an ingredient and a positive quantity on every row.', 'error');
            A.busyEvent(e, true, 'Saving…');
            try {
              await A.api(`/recipes/${r.id}`, { method: 'PUT', body: { items } });
              A.toast(`Recipe saved · ${A.money(items.reduce((s, it) => {
                const ing = ingredients.find((i) => i.id === it.ingredient_id);
                return s + (ing ? it.qty * ing.purchase_price : 0);
              }, 0))} cost`, 'success');
              modal.close();
              await load();
            } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
          });
          recalc();
        }
      });
    }

    function recipeRowHTML(it, ingredients) {
      return `<div class="recipe-row">
        <select data-field="ingredient_id">${A.options(ingredients, it.ingredient_id, 'id', 'name', 'Choose ingredient…')}</select>
        <input type="number" min="0" step="0.001" data-field="qty" value="${it.qty || ''}" placeholder="Qty" title="Quantity per portion">
        <span class="line-cost mono" style="font-size:10px;padding-bottom:9px">${it.line_cost !== undefined ? A.money2(it.line_cost) : '—'}</span>
        <button type="button" class="btn btn-xs btn-danger-soft btn-icon row-remove" title="Remove"><i data-lucide="x"></i></button>
      </div>`;
    }

    await load();
    return () => { state.destroyed = true; };
  };
})();
