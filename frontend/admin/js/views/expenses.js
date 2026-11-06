/* ==========================================================================
   Admin — Expenses
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;

  A.views.expenses = async function (view) {
    const state = { data: null, category: 'all', search: '', from: '', to: '', destroyed: false };

    view.innerHTML = `<div class="view-loading"><span class="spinner"></span><p>Reading the expense book…</p></div>`;

    function query() {
      const qs = new URLSearchParams();
      if (state.category !== 'all') qs.set('category', state.category);
      if (state.search) qs.set('search', state.search);
      if (state.from) qs.set('from', state.from);
      if (state.to) qs.set('to', state.to);
      return qs.toString();
    }

    async function load() {
      try {
        const data = await A.api(`/expenses?${query()}`);
        if (state.destroyed) return;
        state.data = data;
        paint();
      } catch (err) {
        if (state.destroyed) return;
        view.innerHTML = `<div class="card card-pad" style="max-width:560px;margin:9vh auto;text-align:center"><div class="confirm-icon"><i data-lucide="alert-triangle"></i></div><h2 style="font-family:var(--font-display);font-size:28px">Expenses unavailable</h2><p class="muted small">${A.esc(err.message)}</p></div>`;
        A.icons();
      }
    }

    function paint() {
      const d = state.data;
      view.innerHTML = `
        <div class="view-head">
          <div class="view-head-copy"><h2>Expenses</h2><p>Rent, utilities, payroll and every other cost — the other half of the profit story.</p></div>
          <div class="view-head-actions">
            <button class="btn btn-outline" id="expRefresh"><i data-lucide="refresh-cw"></i> Refresh</button>
            <button class="btn btn-gold" id="expAdd"><i data-lucide="plus"></i> Record expense</button>
          </div>
        </div>

        <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
          <div class="kpi"><span class="kpi-label">Total expenses</span><span class="kpi-value">${A.money(d.summary.total)}</span><div class="kpi-meta"><span>${d.summary.count} entries in view</span></div></div>
          <div class="kpi"><span class="kpi-label">Biggest category</span><span class="kpi-value" style="font-size:20px">${A.esc(d.byCategory[0]?.category || '—')}</span><div class="kpi-meta"><span>${d.byCategory[0] ? A.money(d.byCategory[0].total) : 'No expenses yet'}</span></div></div>
          <div class="kpi"><span class="kpi-label">Categories used</span><span class="kpi-value">${d.byCategory.length}</span><div class="kpi-meta"><span>Across the selected period</span></div></div>
          <div class="kpi"><span class="kpi-label">Average entry</span><span class="kpi-value">${A.money(d.summary.count ? d.summary.total / d.summary.count : 0)}</span><div class="kpi-meta"><span>Per recorded expense</span></div></div>
        </div>

        <div class="report-grid" style="margin-bottom:16px">
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="chart-column"></i> By category</h3><p>Where the money is going in this view.</p></div></div>
            <div class="card-body"><div class="expense-cat-grid">${d.byCategory.length ? d.byCategory.map((c) => `<div class="expense-cat"><span>${A.esc(c.category)}</span><b>${A.money(c.total)}</b><small>${c.count} entr${c.count === 1 ? 'y' : 'ies'}</small></div>`).join('') : '<div class="muted small">No expenses recorded.</div>'}</div></div>
          </div>
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="pie-chart"></i> Split</h3><p>Share of spend by category.</p></div></div>
            <div class="card-body"><div class="chart-box sm"><canvas id="expChart"></canvas></div></div>
          </div>
        </div>

        <div class="filter-bar">
          <div class="search-box"><i data-lucide="search"></i><input type="search" id="expSearch" placeholder="Search description or reference…" value="${A.esc(state.search)}"></div>
          <select id="expCat"><option value="all">All categories</option>${d.categories.map((c) => `<option ${state.category === c ? 'selected' : ''}>${A.esc(c)}</option>`).join('')}</select>
          <input type="date" id="expFrom" value="${state.from}" title="From">
          <input type="date" id="expTo" value="${state.to}" title="To">
          <button class="btn btn-soft btn-sm" id="expClear"><i data-lucide="filter-x"></i> Clear</button>
          <span class="spacer"></span><span class="muted small">${d.expenses.length} records</span>
        </div>

        <div class="table-card">
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Method</th><th>Reference</th><th>Recorded by</th><th class="num">Amount</th><th class="actions">Actions</th></tr></thead>
            <tbody>${d.expenses.length ? d.expenses.map((e) => `<tr>
              <td class="small nowrap">${A.date(e.date)}</td>
              <td><span class="badge neutral">${A.esc(e.category)}</span></td>
              <td><strong>${A.esc(e.description || '—')}</strong></td>
              <td class="small">${A.esc(A.capitalize(e.payment_method || 'cash'))}</td>
              <td class="mono muted" style="font-size:9px">${A.esc(e.reference || '—')}</td>
              <td class="small">${A.esc(e.staff_name || '—')}</td>
              <td class="num strong" style="color:var(--red)">${A.money2(e.amount)}</td>
              <td class="actions"><div class="row-actions">
                <button class="btn btn-xs btn-outline" data-edit-exp="${e.id}"><i data-lucide="pencil"></i></button>
                ${A.isManager() ? `<button class="btn btn-xs btn-danger-soft btn-icon" data-del-exp="${e.id}"><i data-lucide="trash-2"></i></button>` : ''}
              </div></td>
            </tr>`).join('') : `<tr><td colspan="8">${A.empty('No expenses match', 'Try a different period or record a new expense.', 'wallet')}</td></tr>`}</tbody>
          </table></div>
          <div class="table-foot"><span>Filtered total ${A.money(d.summary.total)}</span><span class="muted">All amounts in PKR</span></div>
        </div>`;
      A.icons();
      drawChart();
      bind();
    }

    function drawChart() {
      const canvas = A.qs('#expChart', view);
      if (!canvas || !window.Chart) return;
      const cats = state.data.byCategory.slice(0, 8);
      if (!cats.length) { canvas.parentElement.innerHTML = '<div class="muted small" style="padding:30px 0;text-align:center">Nothing to chart yet.</div>'; return; }
      const colors = ['#c19a3e', '#3d629c', '#2f7a52', '#72539b', '#b06c15', '#267085', '#a33b63', '#b23a33'];
      A.chart(canvas, {
        type: 'doughnut',
        data: { labels: cats.map((c) => c.category), datasets: [{ data: cats.map((c) => c.total), backgroundColor: cats.map((c, i) => colors[i % colors.length]), borderWidth: 2, borderColor: '#fffdf8', hoverOffset: 5 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '64%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 7, boxHeight: 7, font: { size: 9 }, padding: 9 } }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${A.money(c.parsed)}` } } } }
      });
    }

    function bind() {
      A.qs('#expSearch').addEventListener('input', A.debounce((e) => { state.search = e.target.value.trim(); load(); }, 280));
      A.qs('#expCat').addEventListener('change', (e) => { state.category = e.target.value; load(); });
      A.qs('#expFrom').addEventListener('change', (e) => { state.from = e.target.value; load(); });
      A.qs('#expTo').addEventListener('change', (e) => { state.to = e.target.value; load(); });
      A.qs('#expClear').addEventListener('click', () => { state.category = 'all'; state.search = ''; state.from = ''; state.to = ''; load(); });
      A.qs('#expAdd').addEventListener('click', () => expenseForm(null));
      A.qs('#expRefresh').addEventListener('click', (e) => { A.busyEvent(e, true, ''); load().finally(() => A.busyEvent(e, false)); });
      A.qsa('[data-edit-exp]', view).forEach((b) => b.addEventListener('click', () => expenseForm(state.data.expenses.find((e) => e.id === Number(b.dataset.editExp)))));
      A.qsa('[data-del-exp]', view).forEach((b) => b.addEventListener('click', () => {
        const e = state.data.expenses.find((x) => x.id === Number(b.dataset.delExp));
        A.deleteConfirm(e.description || e.category, async () => {
          await A.api(`/expenses/${e.id}`, { method: 'DELETE' });
          A.toast('Expense deleted.', 'success'); await load();
        });
      }));
    }

    function expenseForm(expense) {
      const isNew = !expense;
      const e = expense || { category: 'Ingredients', description: '', amount: '', date: A.today(), payment_method: 'cash', reference: '' };
      const m = A.modal({
        title: isNew ? 'Record an expense' : 'Edit expense', size: 'sm',
        body: `<form id="expForm"><div class="form-grid">
          <label class="field"><span>Category *</span><select name="category" required>${state.data.categories.map((c) => `<option ${e.category === c ? 'selected' : ''}>${A.esc(c)}</option>`).join('')}</select></label>
          <label class="field"><span>Date *</span><input name="date" type="date" value="${e.date}" required></label>
          <label class="field full"><span>Description *</span><input name="description" value="${A.esc(e.description || '')}" required placeholder="e.g. Weekly produce purchase"></label>
          <label class="field"><span>Amount *</span><input name="amount" type="number" min="1" step="0.01" value="${e.amount}" required></label>
          <label class="field"><span>Payment method</span><select name="payment_method">${['cash', 'card', 'bank', 'cheque'].map((p) => `<option ${e.payment_method === p ? 'selected' : ''}>${A.capitalize(p)}</option>`).join('')}</select></label>
          <label class="field full"><span>Reference</span><input name="reference" value="${A.esc(e.reference || '')}" placeholder="Invoice or receipt number"></label>
        </div></form>`,
        footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-gold" data-save>${isNew ? 'Record expense' : 'Save changes'}</button>`,
        onMount: (modal) => {
          A.qs('[data-cancel]', modal.footer).addEventListener('click', modal.close);
          A.qs('[data-save]', modal.footer).addEventListener('click', async (ev) => {
            const form = A.qs('#expForm', modal.body);
            if (!form.reportValidity()) return;
            const fd = A.formData(form);
            A.busy(ev.currentTarget, true, 'Saving…');
            try {
              await A.api(isNew ? '/expenses' : `/expenses/${e.id}`, { method: isNew ? 'POST' : 'PUT', body: fd });
              A.toast(isNew ? 'Expense recorded.' : 'Expense updated.', 'success');
              modal.close(); await load();
            } catch (err) { A.notifyError(err); A.busy(ev.currentTarget, false); }
          });
        }
      });
    }

    await load();
    return () => { state.destroyed = true; A.destroyCharts(); };
  };
})();
