/* ==========================================================================
   Admin — Reports & analytics
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;
  const TABS = [
    ['sales', 'Sales', 'trending-up'],
    ['products', 'Products', 'flame'],
    ['inventory', 'Inventory', 'boxes'],
    ['purchases', 'Purchasing', 'truck'],
    ['expenses', 'Expenses', 'wallet'],
    ['pnl', 'Profit & loss', 'scale'],
    ['tax', 'Tax', 'landmark'],
    ['employees', 'Team', 'users']
  ];

  A.views.reports = async function (view) {
    const state = { tab: 'sales', preset: 30, from: A.daysAgo(29), to: A.today(), group: 'day', data: null, loading: false, destroyed: false };

    view.innerHTML = `<div class="view-loading"><span class="spinner"></span><p>Crunching the numbers…</p></div>`;

    function endpoint() {
      const map = { sales: 'sales', products: 'products', inventory: 'inventory', purchases: 'purchases', expenses: 'expenses', pnl: 'pnl', tax: 'tax', employees: 'employees' };
      return map[state.tab];
    }

    async function load() {
      if (state.destroyed) return;
      state.loading = true;
      A.destroyCharts();
      try {
        const qs = new URLSearchParams({ from: state.from, to: state.to });
        if (state.tab === 'sales') qs.set('group', state.group);
        const data = await A.api(`/reports/${endpoint()}?${qs.toString()}`);
        if (state.destroyed) return;
        state.data = data;
        state.loading = false;
        paint();
      } catch (err) {
        state.loading = false;
        if (state.destroyed) return;
        A.qs('#reportBody', view).innerHTML = `<div class="card card-pad">${A.empty('This report could not load', err.message, 'alert-triangle')}</div>`;
        A.icons();
      }
    }

    function shell() {
      view.innerHTML = `
        <div class="view-head">
          <div class="view-head-copy"><h2>Reports &amp; analytics</h2><p>Sales, costs and the shape of the business. Pick a period, inspect the detail, export or print it.</p></div>
          <div class="view-head-actions">
            <button class="btn btn-outline" id="reportPrint"><i data-lucide="printer"></i> Print</button>
            <button class="btn btn-gold" id="reportExport"><i data-lucide="download"></i> Export CSV</button>
          </div>
        </div>

        <div class="seg-tabs" id="reportTabs" style="margin-bottom:14px;overflow-x:auto;white-space:nowrap">
          ${TABS.map(([k, l, icon]) => `<button data-tab="${k}" class="${state.tab === k ? 'active' : ''}"><i data-lucide="${icon}" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"></i>${l}</button>`).join('')}
        </div>

        <div class="report-toolbar">
          <div class="report-toolbar-left">
            <div class="seg-tabs" id="rangePresets" style="border:0;background:transparent;padding:0">
              ${[[7, '7D'], [30, '30D'], [90, '90D'], [365, '12M']].map(([d, l]) => `<button data-preset="${d}" class="${state.preset === d ? 'active' : ''}">${l}</button>`).join('')}
            </div>
            <input type="date" id="reportFrom" value="${state.from}" title="From">
            <span class="muted small">to</span>
            <input type="date" id="reportTo" value="${state.to}" title="To">
            ${state.tab === 'sales' ? `<select id="reportGroup" style="min-height:32px;font-size:10.5px"><option value="day" ${state.group === 'day' ? 'selected' : ''}>Daily</option><option value="week" ${state.group === 'week' ? 'selected' : ''}>Weekly</option><option value="month" ${state.group === 'month' ? 'selected' : ''}>Monthly</option></select>` : ''}
          </div>
          <div class="report-toolbar-right">
            <span class="muted small" id="reportRangeLabel">${A.date(state.from)} – ${A.date(state.to)}</span>
            <button class="btn btn-soft btn-sm" id="reportRefresh"><i data-lucide="refresh-cw"></i></button>
          </div>
        </div>

        <div id="reportBody"><div class="view-loading" style="min-height:260px"><span class="spinner"></span></div></div>`;
      A.icons();
      A.qs('#reportTabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]');
        if (!b || b.dataset.tab === state.tab) return;
        state.tab = b.dataset.tab;
        shell(); load();
      });
      A.qs('#rangePresets').addEventListener('click', (e) => {
        const b = e.target.closest('[data-preset]');
        if (!b) return;
        state.preset = Number(b.dataset.preset);
        const r = A.rangeFor(state.preset);
        state.from = r.from; state.to = r.to;
        shell(); load();
      });
      A.qs('#reportFrom').addEventListener('change', (e) => { state.from = e.target.value; state.preset = 0; shell(); load(); });
      A.qs('#reportTo').addEventListener('change', (e) => { state.to = e.target.value; state.preset = 0; shell(); load(); });
      A.qs('#reportGroup')?.addEventListener('change', (e) => { state.group = e.target.value; load(); });
      A.qs('#reportRefresh').addEventListener('click', (e) => { A.busyEvent(e, true, ''); load().finally(() => A.busyEvent(e, false)); });
      A.qs('#reportPrint').addEventListener('click', () => window.print());
      A.qs('#reportExport').addEventListener('click', () => {
        const type = state.tab === 'pnl' ? 'sales' : state.tab === 'employees' ? 'employees' : state.tab;
        A.download(`/api/admin/reports/export?type=${type}&from=${state.from}&to=${state.to}`, `saffron-${type}-${state.from}-to-${state.to}.csv`);
      });
    }

    function paint() {
      A.destroyCharts();
      const body = A.qs('#reportBody', view);
      if (!body) return;
      const fn = {
        sales: paintSales, products: paintProducts, inventory: paintInventory, purchases: paintPurchases,
        expenses: paintExpenses, pnl: paintPnl, tax: paintTax, employees: paintEmployees
      }[state.tab];
      fn(body);
      A.icons();
    }

    const kpis = (items) => `<div class="report-kpis">${items.map(([l, v, s]) => `<div class="report-kpi"><span>${l}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`).join('')}</div>`;

    function salesLabels(d) {
      return d.series.map((p) => {
        if (state.group === 'month') { const dt = A.parse(`${p.period}-01`); return dt ? dt.toLocaleDateString('en-PK', { month: 'short', year: '2-digit' }) : p.period; }
        if (state.group === 'week') return p.period.replace(/^\d{4}-W/, 'W');
        const dt = A.parse(p.period); return dt ? dt.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' }) : p.period;
      });
    }

    function paintSales(body) {
      const d = state.data;
      const s = d.summary;
      body.innerHTML = `
        ${kpis([
          ['Revenue', A.money(s.revenue), `${s.orders} completed orders`],
          ['Average order', A.money(s.avg_order), `${A.num(s.items_sold)} items sold`],
          ['Discounts', A.money(s.discount), 'Given to guests'],
          ['Tax collected', A.money(s.tax), 'Payable to authority']
        ])}
        <div class="report-grid">
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="chart-area"></i> Sales trend</h3><p>Revenue and order volume from ${A.date(d.from)} to ${A.date(d.to)}.</p></div><div class="chart-legend"><span class="legend-item"><i style="background:#c19a3e"></i> Revenue</span><span class="legend-item"><i style="background:#3d629c"></i> Orders</span></div></div>
            <div class="card-body"><div class="chart-box lg"><canvas id="salesChart"></canvas></div></div>
          </div>
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="credit-card"></i> Payment methods</h3><p>How revenue was settled.</p></div></div>
            <div class="card-body"><div class="chart-box sm"><canvas id="salesPayChart"></canvas></div>
              <div class="mini-list" style="margin-top:6px">${d.byPayment.map((p) => `<div class="mini-row"><span class="mr-left"><strong>${A.capitalize(p.payment_method)}</strong><span>· ${p.orders} orders</span></span><b>${A.money(p.revenue)}</b></div>`).join('') || '<div class="muted small">No sales in this period.</div>'}</div>
            </div>
          </div>
        </div>
        <div class="report-grid" style="margin-top:12px">
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="armchair"></i> By service type</h3><p>Where the sales came from.</p></div></div>
            <div class="card-body"><div class="chart-box sm"><canvas id="salesTypeChart"></canvas></div></div>
          </div>
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="landmark"></i> Daily tax</h3><p>Taxable sales and tax per day.</p></div></div>
            <div class="table-wrap"><table class="data" style="min-width:420px"><thead><tr><th>Date</th><th class="num">Total sales</th><th class="num">Tax</th></tr></thead>
              <tbody>${d.dailyTax.length ? d.dailyTax.slice(-10).reverse().map((r) => `<tr><td class="small">${A.date(r.period)}</td><td class="num">${A.money(r.total)}</td><td class="num strong">${A.money2(r.tax)}</td></tr>`).join('') : `<tr><td colspan="3">${A.empty('No sales in this period', 'Choose another date range.', 'receipt-text')}</td></tr>`}</tbody>
            </table></div>
          </div>
        </div>
        <div class="card" style="margin-top:12px">
          <div class="card-head"><div><h3><i data-lucide="table-properties"></i> Period detail</h3><p>Grouped by ${state.group}.</p></div></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>Period</th><th class="num">Orders</th><th class="num">Revenue</th><th class="num">Average order</th></tr></thead>
            <tbody>${d.series.length ? d.series.map((r) => `<tr><td class="strong">${A.esc(r.period)}</td><td class="num">${r.orders}</td><td class="num strong">${A.money(r.revenue)}</td><td class="num">${A.money(r.avg_order)}</td></tr>`).join('') : `<tr><td colspan="4">${A.empty('No completed sales', 'Try a wider date range.', 'trending-up')}</td></tr>`}</tbody>
          </table></div>
        </div>`;
      const labels = salesLabels(d);
      A.chart(A.qs('#salesChart', body), {
        type: 'line',
        data: { labels, datasets: [
          { label: 'Revenue', data: d.series.map((r) => r.revenue), borderColor: '#c19a3e', backgroundColor: (c) => A.gradient(c.chart.ctx, c.chart.chartArea), fill: true, tension: .38, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, yAxisID: 'y' },
          { label: 'Orders', data: d.series.map((r) => r.orders), borderColor: '#3d629c', backgroundColor: 'transparent', borderWidth: 1.4, borderDash: [4, 3], tension: .35, pointRadius: 0, yAxisID: 'y1' }
        ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.dataset.yAxisID === 'y1' ? ` ${c.parsed.y} orders` : ` ${A.money(c.parsed.y)}` } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#f1ede4' }, ticks: { callback: (v) => A.money(v), maxTicksLimit: 5 }, border: { display: false } }, y1: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { precision: 0, maxTicksLimit: 4 }, border: { display: false } } } }
      });
      const payColors = { cash: '#2f7a52', card: '#3d629c', demo: '#c19a3e' };
      A.chart(A.qs('#salesPayChart', body), {
        type: 'doughnut',
        data: { labels: d.byPayment.map((p) => A.capitalize(p.payment_method)), datasets: [{ data: d.byPayment.map((p) => p.revenue), backgroundColor: d.byPayment.map((p) => payColors[p.payment_method] || '#7d776b'), borderWidth: 2, borderColor: '#fffdf8', hoverOffset: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '66%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${A.money(c.parsed)}` } } } }
      });
      A.chart(A.qs('#salesTypeChart', body), {
        type: 'bar',
        data: { labels: d.byType.map((t) => A.typeLabel(t.type)), datasets: [{ data: d.byType.map((t) => t.revenue), backgroundColor: ['#c19a3e', '#3d629c', '#2f7a52'], borderRadius: 5, maxBarThickness: 34 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${A.money(c.parsed.y)} · ${d.byType[c.dataIndex].orders} orders` } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#f1ede4' }, ticks: { callback: (v) => A.money(v), maxTicksLimit: 4 }, border: { display: false } } } }
      });
    }

    function paintProducts(body) {
      const d = state.data;
      const totalQty = d.products.reduce((s, p) => s + p.qty, 0);
      const totalRev = d.products.reduce((s, p) => s + p.revenue, 0);
      const totalProfit = d.products.reduce((s, p) => s + p.profit, 0);
      body.innerHTML = `
        ${kpis([['Revenue', A.money(totalRev), `${A.num(totalQty)} items sold`], ['Gross profit', A.money(totalProfit), 'After recipe cost'], ['Lines sold', A.num(d.products.length), 'Distinct dishes'], ['Top dish', A.esc(d.products[0]?.name || '—'), d.products[0] ? A.money(d.products[0].revenue) : '']])}
        <div class="report-grid">
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="trophy"></i> Product performance</h3><p>Menu items ranked by revenue for this period.</p></div></div>
            <div class="table-wrap"><table class="data"><thead><tr><th>Dish</th><th class="num">Qty</th><th class="num">Revenue</th><th class="num">Food cost</th><th class="num">Profit</th><th>Margin</th></tr></thead>
              <tbody>${d.products.length ? d.products.slice(0, 40).map((p) => `<tr><td><div class="cell-main"><img src="${A.img(p.image)}" alt="" style="width:29px;height:29px;border-radius:6px;object-fit:cover"><div><strong>${A.esc(p.name)}</strong><span>${A.esc(p.category || 'Uncategorised')}</span></div></div></td><td class="num">${p.qty}</td><td class="num strong">${A.money(p.revenue)}</td><td class="num muted">${A.money(p.cogs)}</td><td class="num" style="color:var(--green)">${A.money(p.profit)}</td><td><div style="display:flex;align-items:center;gap:5px"><div class="margin-bar"><i style="width:${A.clamp(p.margin, 0, 100)}%;background:${p.margin >= 60 ? 'var(--green)' : p.margin >= 35 ? 'var(--amber)' : 'var(--red)'}"></i></div><b style="font-size:9.5px">${p.margin}%</b></div></td></tr>`).join('') : `<tr><td colspan="6">${A.empty('No product sales', 'Completed orders in this period will appear here.', 'flame')}</td></tr>`}</tbody>
            </table></div>
          </div>
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="pie-chart"></i> Category mix</h3><p>Revenue by menu section.</p></div></div>
            <div class="card-body"><div class="chart-box lg"><canvas id="prodCatChart"></canvas></div></div>
          </div>
        </div>`;
      const colors = ['#c19a3e', '#3d629c', '#2f7a52', '#72539b', '#b06c15', '#267085', '#a33b63', '#b23a33'];
      A.chart(A.qs('#prodCatChart', body), {
        type: 'bar',
        data: { labels: d.categories.map((c) => c.category), datasets: [{ data: d.categories.map((c) => c.revenue), backgroundColor: d.categories.map((c, i) => colors[i % colors.length]), borderRadius: 5, barThickness: 14 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${A.money(c.parsed.x)} · ${d.categories[c.dataIndex].qty} sold` } } }, scales: { x: { beginAtZero: true, grid: { color: '#f1ede4' }, ticks: { callback: (v) => A.money(v), maxTicksLimit: 4 }, border: { display: false } }, y: { grid: { display: false } } } }
      });
    }

    function paintInventory(body) {
      const d = state.data;
      body.innerHTML = `
        ${kpis([['Stock value', A.money(d.summary.value), `${d.summary.count} ingredient lines`], ['Low stock', A.num(d.summary.low_stock), 'At or below par'], ['Expiring', A.num(d.summary.expiring), 'Within 7 days'], ['Categories', A.num(d.byCategory.length), 'Stock groups']])}
        <div class="report-grid">
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="boxes"></i> Stock on hand</h3><p>Valued at current purchase cost.</p></div><span class="muted small">${A.money(d.summary.value)} total</span></div>
            <div class="table-wrap"><table class="data"><thead><tr><th>Ingredient</th><th class="num">Stock</th><th class="num">Par</th><th class="num">Unit cost</th><th class="num">Value</th><th>Supplier</th></tr></thead>
              <tbody>${d.ingredients.length ? d.ingredients.map((i) => `<tr><td><strong>${A.esc(i.name)}</strong><div class="muted" style="font-size:8.5px">${A.esc(i.category || 'General')}${i.expiry_date ? ` · expires ${A.date(i.expiry_date)}` : ''}</div></td><td class="num"><span class="stock-qty ${i.stock_qty <= i.min_stock ? 'low' : 'ok'}">${A.num(i.stock_qty, 2)} ${A.esc(i.unit)}</span></td><td class="num muted">${A.num(i.min_stock, 2)}</td><td class="num">${A.money2(i.purchase_price)}</td><td class="num strong">${A.money(i.value)}</td><td class="small">${A.esc(i.supplier_name || '—')}</td></tr>`).join('') : `<tr><td colspan="6">${A.empty('No ingredients', 'Add stock lines in Inventory.', 'boxes')}</td></tr>`}</tbody>
            </table></div>
          </div>
          <div>
            <div class="card"><div class="card-head"><div><h3><i data-lucide="pie-chart"></i> Value by category</h3><p>Where stock capital is tied up.</p></div></div><div class="card-body"><div class="chart-box sm"><canvas id="invCatChart"></canvas></div></div></div>
            <div class="card" style="margin-top:12px"><div class="card-head"><div><h3><i data-lucide="arrow-left-right"></i> 30-day movements</h3><p>Stock activity by type.</p></div></div><div class="card-body"><div class="mini-list">${d.movement.length ? d.movement.map((m) => `<div class="mini-row"><span class="mr-left"><span class="tx-type ${A.esc(m.type)}">${A.esc(A.capitalize(m.type))}</span><span>· ${m.count} entries</span></span><b>${A.num(m.qty, 2)}</b></div>`).join('') : '<div class="muted small">No stock movements recorded.</div>'}</div></div></div>
          </div>
        </div>`;
      const colors = ['#c19a3e', '#3d629c', '#2f7a52', '#72539b', '#b06c15', '#267085', '#a33b63'];
      A.chart(A.qs('#invCatChart', body), {
        type: 'doughnut',
        data: { labels: d.byCategory.map((c) => c.category), datasets: [{ data: d.byCategory.map((c) => c.value), backgroundColor: d.byCategory.map((c, i) => colors[i % colors.length]), borderWidth: 2, borderColor: '#fffdf8', hoverOffset: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '64%', plugins: { legend: { position: 'bottom', labels: { font: { size: 8.5 }, padding: 7 } }, tooltip: { callbacks: { label: (c) => ` ${A.money(c.parsed)}` } } } }
      });
    }

    function paintPurchases(body) {
      const d = state.data;
      body.innerHTML = `
        ${kpis([['Purchases', A.money(d.summary.total), `${d.summary.count} purchase orders`], ['Paid', A.money(d.summary.paid), 'Settled with suppliers'], ['Outstanding', A.money(d.summary.due), 'Still owed'], ['Suppliers', A.num(d.bySupplier.length), 'Active in period']])}
        <div class="report-grid">
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="clipboard-list"></i> Purchase orders</h3><p>Orders placed between ${A.date(d.from)} and ${A.date(d.to)}.</p></div></div>
            <div class="table-wrap"><table class="data"><thead><tr><th>PO</th><th>Supplier</th><th>Date</th><th>Status</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Due</th></tr></thead>
              <tbody>${d.purchases.length ? d.purchases.map((p) => `<tr><td class="mono strong" style="font-size:9.5px">${A.esc(p.po_number)}</td><td class="small">${A.esc(p.supplier_name || '—')}</td><td class="small">${A.date(p.order_date)}</td><td>${A.badge(p.status)}</td><td class="num strong">${A.money2(p.total)}</td><td class="num" style="color:var(--green)">${A.money2(p.paid_amount)}</td><td class="num" style="color:${Number(p.total) - Number(p.paid_amount) > 0 ? 'var(--red)' : 'var(--muted)'}">${A.money2(Number(p.total) - Number(p.paid_amount))}</td></tr>`).join('') : `<tr><td colspan="7">${A.empty('No purchase orders', 'Try a different date range.', 'truck')}</td></tr>`}</tbody>
            </table></div>
          </div>
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="building-2"></i> By supplier</h3><p>Spend concentration.</p></div></div>
            <div class="card-body"><div class="chart-box sm"><canvas id="purSupChart"></canvas></div><div class="mini-list" style="margin-top:8px">${d.bySupplier.length ? d.bySupplier.map((s) => `<div class="mini-row"><span class="mr-left"><strong>${A.esc(s.name)}</strong><span>· ${s.count} POs</span></span><b>${A.money(s.total)}</b></div>`).join('') : '<div class="muted small">No supplier activity.</div>'}</div></div>
          </div>
        </div>`;
      const colors = ['#c19a3e', '#3d629c', '#2f7a52', '#72539b', '#b06c15', '#267085', '#a33b63'];
      A.chart(A.qs('#purSupChart', body), {
        type: 'doughnut',
        data: { labels: d.bySupplier.map((s) => s.name), datasets: [{ data: d.bySupplier.map((s) => s.total), backgroundColor: d.bySupplier.map((s, i) => colors[i % colors.length]), borderWidth: 2, borderColor: '#fffdf8', hoverOffset: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '64%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${A.money(c.parsed)}` } } } }
      });
    }

    function paintExpenses(body) {
      const d = state.data;
      body.innerHTML = `
        ${kpis([['Expenses', A.money(d.summary.total), `${d.summary.count} entries`], ['Categories', A.num(d.byCategory.length), 'In this period'], ['Average entry', A.money(d.summary.count ? d.summary.total / d.summary.count : 0), 'Per expense'], ['Biggest', A.esc(d.byCategory[0]?.category || '—'), d.byCategory[0] ? A.money(d.byCategory[0].total) : '']])}
        <div class="report-grid">
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="chart-line"></i> Monthly expenses</h3><p>Spend trend in the selected window.</p></div></div>
            <div class="card-body"><div class="chart-box lg"><canvas id="expMonthChart"></canvas></div></div>
          </div>
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="chart-pie"></i> By category</h3><p>Largest cost centres.</p></div></div>
            <div class="card-body"><div class="chart-box sm"><canvas id="expCatChart"></canvas></div></div>
          </div>
        </div>
        <div class="card" style="margin-top:12px">
          <div class="card-head"><div><h3><i data-lucide="wallet"></i> Expense entries</h3><p>Detailed ledger for the period.</p></div></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Method</th><th>Reference</th><th class="num">Amount</th></tr></thead>
            <tbody>${d.expenses.length ? d.expenses.map((e) => `<tr><td class="small">${A.date(e.date)}</td><td><span class="badge neutral">${A.esc(e.category)}</span></td><td>${A.esc(e.description || '—')}</td><td class="small">${A.esc(A.capitalize(e.payment_method || 'cash'))}</td><td class="mono muted" style="font-size:9px">${A.esc(e.reference || '—')}</td><td class="num strong" style="color:var(--red)">${A.money2(e.amount)}</td></tr>`).join('') : `<tr><td colspan="6">${A.empty('No expenses', 'Record expenses in the Expenses module.', 'wallet')}</td></tr>`}</tbody>
          </table></div>
        </div>`;
      const colors = ['#c19a3e', '#3d629c', '#2f7a52', '#72539b', '#b06c15', '#267085', '#a33b63', '#b23a33'];
      A.chart(A.qs('#expMonthChart', body), {
        type: 'bar',
        data: { labels: d.byMonth.map((m) => m.period), datasets: [{ data: d.byMonth.map((m) => m.total), backgroundColor: '#c19a3e', borderRadius: 5, maxBarThickness: 32 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${A.money(c.parsed.y)}` } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#f1ede4' }, ticks: { callback: (v) => A.money(v), maxTicksLimit: 4 }, border: { display: false } } } }
      });
      A.chart(A.qs('#expCatChart', body), {
        type: 'doughnut',
        data: { labels: d.byCategory.map((c) => c.category), datasets: [{ data: d.byCategory.map((c) => c.total), backgroundColor: d.byCategory.map((c, i) => colors[i % colors.length]), borderWidth: 2, borderColor: '#fffdf8', hoverOffset: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '64%', plugins: { legend: { position: 'bottom', labels: { font: { size: 8.5 }, padding: 7 } }, tooltip: { callbacks: { label: (c) => ` ${A.money(c.parsed)}` } } } }
      });
    }

    function paintPnl(body) {
      const d = state.data;
      const max = Math.max(d.sales.revenue, d.cogs, d.expenses, 1);
      const bar = (label, value, color) => `<div class="pnl-bar"><span>${label}</span><div class="track"><i style="width:${A.clamp((value / max) * 100, 0, 100)}%;background:${color}"></i></div><b>${A.money(value)}</b></div>`;
      body.innerHTML = `
        ${kpis([['Net sales', A.money(d.sales.revenue - d.sales.tax), `${d.sales.orders} completed orders`], ['Gross profit', A.money(d.grossProfit), `${d.grossMargin}% gross margin`], ['Expenses', A.money(d.expenses), 'Operating costs'], ['Net profit', A.money(d.netProfit), `${d.netMargin}% net margin`]])}
        <div class="report-grid">
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="scale"></i> Profit &amp; loss bridge</h3><p>From gross sales to what the restaurant keeps.</p></div></div>
            <div class="card-body">
              <div class="pnl-bars">
                ${bar('Gross sales', d.sales.revenue, '#c19a3e')}
                ${bar('Tax collected', d.sales.tax, '#8a8375')}
                ${bar('Cost of goods', d.cogs, '#b06c15')}
                ${bar('Operating expenses', d.expenses, '#b23a33')}
                ${bar('Net profit', Math.max(0, d.netProfit), d.netProfit >= 0 ? '#2f7a52' : '#b23a33')}
              </div>
              <div class="mini-list" style="margin-top:16px">
                <div class="mini-row"><span>Net sales (ex-tax)</span><b>${A.money2(d.sales.revenue - d.sales.tax)}</b></div>
                <div class="mini-row"><span>Discounts given</span><b>− ${A.money2(d.sales.discounts)}</b></div>
                <div class="mini-row"><span>Delivery fees</span><b>${A.money2(d.sales.delivery)}</b></div>
                <div class="mini-row"><span>Purchases in period</span><b>${A.money2(d.purchaseTotal)}</b></div>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="chart-no-axes-combined"></i> Six-month trend</h3><p>Revenue, cost and profit by month.</p></div></div>
            <div class="card-body"><div class="chart-box lg"><canvas id="pnlChart"></canvas></div></div>
          </div>
        </div>`;
      A.chart(A.qs('#pnlChart', body), {
        type: 'bar',
        data: { labels: d.monthly.map((m) => m.label), datasets: [
          { label: 'Net revenue', data: d.monthly.map((m) => m.revenue), backgroundColor: '#c19a3e', borderRadius: 4, maxBarThickness: 22 },
          { label: 'Food cost', data: d.monthly.map((m) => m.cogs), backgroundColor: '#e4d5ae', borderRadius: 4, maxBarThickness: 22 },
          { label: 'Profit', data: d.monthly.map((m) => m.profit), backgroundColor: '#2f7a52', borderRadius: 4, maxBarThickness: 22 }
        ] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${A.money(c.parsed.y)}` } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#f1ede4' }, ticks: { callback: (v) => A.money(v), maxTicksLimit: 4 }, border: { display: false } } } }
      });
    }

    function paintTax(body) {
      const d = state.data;
      body.innerHTML = `
        ${kpis([['Tax collected', A.money(d.summary.tax), `${d.summary.orders} taxable orders`], ['Taxable sales', A.money(d.summary.taxable), 'Excluding tax'], ['Effective rate', `${d.summary.taxable ? (d.summary.tax / d.summary.taxable * 100).toFixed(1) : 0}%`, 'Tax ÷ taxable sales'], ['Days with sales', A.num(d.rows.length), 'In the selected period']])}
        <div class="report-grid">
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="landmark"></i> Daily tax ledger</h3><p>Taxable amount and tax due per day.</p></div></div>
            <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th class="num">Orders</th><th class="num">Taxable</th><th class="num">Tax</th><th class="num">Total</th></tr></thead>
              <tbody>${d.rows.length ? d.rows.map((r) => `<tr><td class="small">${A.date(r.date)}</td><td class="num">${r.orders}</td><td class="num">${A.money2(r.taxable)}</td><td class="num strong">${A.money2(r.tax)}</td><td class="num">${A.money2(r.total)}</td></tr>`).join('') : `<tr><td colspan="5">${A.empty('No taxable sales', 'Try another date range.', 'landmark')}</td></tr>`}</tbody>
            </table></div>
          </div>
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="credit-card"></i> Tax by payment method</h3><p>Liability split by settlement type.</p></div></div>
            <div class="card-body"><div class="chart-box sm"><canvas id="taxChart"></canvas></div><div class="mini-list" style="margin-top:8px">${d.byMethod.map((m) => `<div class="mini-row"><span class="mr-left"><strong>${A.capitalize(m.payment_method)}</strong><span>· ${m.orders} orders</span></span><b>${A.money2(m.tax)}</b></div>`).join('') || '<div class="muted small">No tax recorded.</div>'}</div></div>
          </div>
        </div>`;
      A.chart(A.qs('#taxChart', body), {
        type: 'bar',
        data: { labels: d.byMethod.map((m) => A.capitalize(m.payment_method)), datasets: [{ data: d.byMethod.map((m) => m.tax), backgroundColor: ['#2f7a52', '#3d629c', '#c19a3e', '#72539b'], borderRadius: 5, maxBarThickness: 34 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${A.money2(c.parsed.y)}` } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#f1ede4' }, ticks: { callback: (v) => A.money(v), maxTicksLimit: 4 }, border: { display: false } } } }
      });
    }

    function paintEmployees(body) {
      const d = state.data;
      const totalSales = d.employees.reduce((s, e) => s + Number(e.sales), 0);
      const totalOrders = d.employees.reduce((s, e) => s + Number(e.orders_handled), 0);
      body.innerHTML = `
        ${kpis([['Team sales', A.money(totalSales), 'Attributed to staff'], ['Orders handled', A.num(totalOrders), 'In this period'], ['Active staff', A.num(d.employees.filter((e) => e.status === 'active').length), 'On the roster'], ['Top performer', A.esc(d.employees[0]?.name || '—'), d.employees[0] ? A.money(d.employees[0].sales) : '']])}
        <div class="card">
          <div class="card-head"><div><h3><i data-lucide="users"></i> Staff performance</h3><p>Orders and sales attributed during this period.</p></div><button class="btn btn-soft btn-sm" id="empExport"><i data-lucide="download"></i> Export</button></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>Team member</th><th>Role</th><th class="num">Orders</th><th class="num">Completed</th><th class="num">Cancelled</th><th class="num">Sales</th><th class="num">Avg order</th></tr></thead>
            <tbody>${d.employees.length ? d.employees.map((e) => `<tr><td><div class="cell-main"><span class="avatar" style="width:29px;height:29px;font-size:9px;background:linear-gradient(140deg,${A.avatarColor(e.name)},#a9832e)">${A.esc(A.initials(e.name))}</span><div><strong>${A.esc(e.name)}</strong><span>joined ${A.date(e.join_date)}</span></div></div></td><td><span class="badge neutral">${A.roleLabel(e.role)}</span></td><td class="num">${A.num(e.orders_handled)}</td><td class="num" style="color:var(--green)">${A.num(e.completed)}</td><td class="num" style="color:${Number(e.cancelled) ? 'var(--red)' : 'var(--muted)'}">${A.num(e.cancelled)}</td><td class="num strong">${A.money(e.sales)}</td><td class="num">${A.money(e.avg_order)}</td></tr>`).join('') : `<tr><td colspan="7">${A.empty('No staff activity', 'Try another date range.', 'users')}</td></tr>`}</tbody>
          </table></div>
        </div>`;
      A.qs('#empExport', body)?.addEventListener('click', () => A.download(`/api/admin/reports/export?type=employees&from=${state.from}&to=${state.to}`, `saffron-employees-${state.from}.csv`));
    }

    shell();
    await load();
    return () => { state.destroyed = true; A.destroyCharts(); };
  };
})();
