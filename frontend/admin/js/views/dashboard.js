/* ==========================================================================
   Admin — Dashboard
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;

  A.views.dashboard = async function (view) {
    const state = { range: Number(localStorage.getItem('saffron_dash_range')) || 30, stats: null };
    let destroyed = false;

    const greeting = () => {
      const h = new Date().getHours();
      if (h < 12) return 'Good morning';
      if (h < 17) return 'Good afternoon';
      return 'Good evening';
    };

    const kpi = (label, value, icon, meta, cls = '') => `
      <div class="kpi">
        <div class="kpi-top"><span class="kpi-icon ${cls}"><i data-lucide="${icon}"></i></span></div>
        <span class="kpi-label">${label}</span>
        <span class="kpi-value">${value}</span>
        <div class="kpi-meta">${meta || ''}</div>
      </div>`;

    const recentOrderRow = (o) => `
      <tr>
        <td><button class="mono strong" data-order="${o.id}" style="border:0;background:none;padding:0;font-size:10.5px">${A.esc(o.order_number)}</button></td>
        <td><div class="cell-main"><span class="avatar" style="width:26px;height:26px;font-size:8.5px;background:linear-gradient(140deg,${A.avatarColor(o.customer_name)},#a9832e)">${A.esc(A.initials(o.customer_name || 'G'))}</span><div><strong>${A.esc(o.customer_name || 'Walk-in')}</strong><span>${A.esc(A.typeLabel(o.type))}</span></div></div></td>
        <td class="num strong">${A.money(o.total)}</td>
        <td>${A.orderBadge(o.status)}</td>
        <td class="muted small nowrap">${A.timeAgo(o.created_at)}</td>
      </tr>`;

    function paint() {
      const s = state.stats;
      const k = s.kpis;
      const today = new Date();
      view.innerHTML = `
        <div class="greet">
          <div>
            <span class="eyebrow">${A.esc(A.roleLabel(A.staff.role))} workspace</span>
            <h2>${greeting()}, <em>${A.esc((A.staff.name || '').split(' ')[0])}</em>.</h2>
            <p>${today.toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · Here is how Saffron House is performing.</p>
          </div>
          <div class="greet-actions">
            <div class="range-tabs" id="dashRange">
              ${[[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '12 months']].map(([d, l]) => `<button data-range="${d}" class="${state.range === d ? 'active' : ''}">${l}</button>`).join('')}
            </div>
            ${A.can('pos') ? `<a href="#/pos" class="btn btn-gold"><i data-lucide="plus"></i> New sale</a>` : ''}
            <button class="btn btn-outline" id="dashRefresh"><i data-lucide="refresh-cw"></i></button>
          </div>
        </div>

        <div class="kpi-grid">
          ${kpi('Today’s revenue', A.money(k.todayRevenue), 'banknote', `<span class="trend ${s.kpis.todayOrders ? 'up' : 'down'}">${k.todayOrders} order${k.todayOrders === 1 ? '' : 's'}</span> <span>today</span>`, 'green')}
          ${kpi('Revenue · last ' + state.range + ' days', A.money(k.rangeSales), 'trending-up', `${A.trend(k.growth.sales)} <span>vs previous period</span>`)}
          ${kpi('Active orders', A.num(k.activeOrders), 'receipt-text', `<span class="trend up">${s.statusCounts.pending || 0} pending</span> <span>${s.statusCounts.preparing || 0} preparing</span>`, 'purple')}
          ${kpi('Average order value', A.money(k.avgOrderValue), 'circle-dollar-sign', `${A.trend(k.growth.avg)} <span>vs previous</span>`, 'blue')}
        </div>

        <div class="kpi-grid" style="margin-top:12px">
          ${kpi('Customers', A.num(k.totalCustomers), 'users', `<span>${s.topCustomers.length ? A.esc(s.topCustomers[0].name) + ' leads loyalty' : 'Building the base'}</span>`, 'blue')}
          ${kpi('Low stock', A.num(k.lowStockCount), 'package-search', `<span>${k.lowStockCount ? 'Needs restocking this week' : 'All ingredients healthy'}</span>`, k.lowStockCount ? 'red' : 'green')}
          ${kpi('Inventory value', A.money(k.inventoryValue), 'boxes', `<span>At current purchase cost</span>`, 'purple')}
          ${kpi('Pending reservations', A.num(k.pendingReservations), 'calendar-clock', `<span>${k.unreadMessages} unread message${k.unreadMessages === 1 ? '' : 's'}</span>`, '')}
        </div>

        <div class="dash-grid" style="margin-top:12px">
          <div class="card">
            <div class="card-head">
              <div><h3><i data-lucide="chart-area"></i> Revenue pulse</h3><p>Completed sales across the selected period.</p></div>
              <div class="chart-legend"><span class="legend-item"><i style="background:#c19a3e"></i> Revenue</span><span class="legend-item"><i style="background:#3d629c"></i> Orders</span></div>
            </div>
            <div class="card-body"><div class="chart-box lg"><canvas id="revenueChart"></canvas></div></div>
          </div>
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="credit-card"></i> Payment mix</h3><p>How guests settled their bills.</p></div></div>
            <div class="card-body">
              <div class="chart-box sm"><canvas id="paymentChart"></canvas></div>
              <div class="mini-list" style="margin-top:8px">
                ${s.paymentMix.length ? s.paymentMix.map((p) => `<div class="mini-row"><span class="mr-left"><i style="width:7px;height:7px;border-radius:2px;background:${({ cash: '#2f7a52', card: '#3d629c', demo: '#c19a3e' }[p.payment_method] || '#7d776b')};display:inline-block"></i><strong>${A.capitalize(p.payment_method)}</strong><span>· ${p.count} txns</span></span><b>${A.money(p.total)}</b></div>`).join('') : '<div class="muted small">No payments in this period.</div>'}
              </div>
            </div>
          </div>
        </div>

        <div class="dash-grid three" style="margin-top:12px">
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="flame"></i> Best sellers</h3><p>Top plates by volume, selected period.</p></div><a href="#/reports" style="font-size:10px;color:var(--gold-dark);font-weight:600">Full report →</a></div>
            <div class="card-body">
              <div class="best-list">
                ${s.bestSellers.length ? s.bestSellers.map((b, i) => `<div class="best-item">
                  <span class="muted mono" style="width:16px">${String(i + 1).padStart(2, '0')}</span>
                  <img src="${A.img(b.image)}" alt="${A.esc(b.name)}" loading="lazy">
                  <div class="bi-copy"><strong>${A.esc(b.name)}</strong><span>${A.esc(b.category || 'Uncategorised')} · ${b.qty} sold</span></div>
                  <div class="bi-num"><b>${A.money(b.revenue)}</b><span>revenue</span></div>
                </div>`).join('') : '<div class="muted small">No completed sales yet.</div>'}
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="pie-chart"></i> Category sales</h3><p>Revenue contribution by menu section.</p></div></div>
            <div class="card-body"><div class="chart-box sm"><canvas id="categoryChart"></canvas></div></div>
          </div>

          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="crown"></i> Top guests</h3><p>Highest spend since opening.</p></div><a href="#/customers" style="font-size:10px;color:var(--gold-dark);font-weight:600">CRM →</a></div>
            <div class="card-body">
              <div class="mini-list">
                ${s.topCustomers.length ? s.topCustomers.map((c) => `<div class="mini-row"><a class="mr-left" href="#/customers" style="color:inherit"><span class="avatar" style="width:25px;height:25px;font-size:8.5px;background:linear-gradient(140deg,${A.avatarColor(c.name)},#a9832e)">${A.esc(A.initials(c.name))}</span><span><strong>${A.esc(c.name)}</strong><span>${c.orders} visits · ${A.esc(c.phone || '—')}</span></span></a><b>${A.money(c.spent)}</b></div>`).join('') : '<div class="muted small">No customer history yet.</div>'}
              </div>
            </div>
          </div>
        </div>

        <div class="dash-grid" style="margin-top:12px">
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="receipt-text"></i> Recent orders</h3><p>Latest activity across all channels.</p></div><a href="#/orders" style="font-size:10px;color:var(--gold-dark);font-weight:600">Order book →</a></div>
            <div class="table-wrap">
              <table class="data" style="min-width:520px">
                <thead><tr><th>Order</th><th>Guest</th><th class="num">Total</th><th>Status</th><th>Placed</th></tr></thead>
                <tbody>${s.recentOrders.length ? s.recentOrders.map(recentOrderRow).join('') : `<tr><td colspan="5">${A.empty('No orders yet', 'The order book is waiting for its first guest.', 'receipt-text')}</td></tr>`}</tbody>
              </table>
            </div>
            <div class="card-foot"><span>${s.recentOrders.length} most recent</span><a href="#/orders" style="color:var(--gold-dark);font-weight:600">Open order book →</a></div>
          </div>

          <div style="display:flex;flex-direction:column;gap:12px">
            <div class="card">
              <div class="card-head"><div><h3><i data-lucide="triangle-alert"></i> Low stock watch</h3><p>Ingredients at or below par level.</p></div><a href="#/inventory" style="font-size:10px;color:var(--gold-dark);font-weight:600">Inventory →</a></div>
              <div class="card-body">
                ${s.lowStock.length ? `<div class="notice-list">${s.lowStock.slice(0, 4).map((i) => `<a class="notice danger" href="#/inventory"><i data-lucide="package-search"></i><div style="flex:1"><strong>${A.esc(i.name)}</strong><span>${A.num(i.stock_qty, 2)} ${A.esc(i.unit)} left · par ${A.num(i.min_stock, 2)}</span></div><b style="font-size:10px;color:var(--red)">low</b></a>`).join('')}</div>` : `<div class="dot-badge" style="padding:8px 0"><i style="background:var(--green)"></i> All ingredients are above par level.</div>`}
              </div>
            </div>

            <div class="card">
              <div class="card-head"><div><h3><i data-lucide="armchair"></i> Dining room</h3><p>Live table state.</p></div><a href="#/tables" style="font-size:10px;color:var(--gold-dark);font-weight:600">Floor →</a></div>
              <div class="card-body">
                <div class="status-summary">
                  <div class="status-summary-item"><span><i style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--green);margin-right:4px"></i> Available</span><b>${s.tableStats.available || 0}</b></div>
                  <div class="status-summary-item"><span><i style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--red);margin-right:4px"></i> Occupied</span><b>${s.tableStats.occupied || 0}</b></div>
                  <div class="status-summary-item"><span><i style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--amber);margin-right:4px"></i> Reserved</span><b>${s.tableStats.reserved || 0}</b></div>
                  <div class="status-summary-item"><span><i style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--blue);margin-right:4px"></i> Cleaning</span><b>${s.tableStats.cleaning || 0}</b></div>
                </div>
                <div class="quick-actions" style="margin-top:12px;grid-template-columns:repeat(2,1fr)">
                  ${A.can('pos') ? `<a class="quick-action" href="#/pos"><i data-lucide="scan-barcode"></i> Take an order</a>` : ''}
                  ${A.can('reservations') ? `<a class="quick-action" href="#/reservations"><i data-lucide="calendar-plus"></i> New booking</a>` : ''}
                  ${A.can('inventory') ? `<a class="quick-action" href="#/inventory"><i data-lucide="arrow-down-to-line"></i> Receive stock</a>` : ''}
                  ${A.can('reports') ? `<a class="quick-action" href="#/reports"><i data-lucide="file-bar-chart"></i> Run report</a>` : ''}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="dash-grid equal" style="margin-top:12px">
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="calendar-days"></i> Sales by weekday</h3><p>Completed revenue distribution for the selected range.</p></div></div>
            <div class="card-body"><div class="chart-box sm"><canvas id="weekdayChart"></canvas></div></div>
          </div>
          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="wallet-cards"></i> Recent transactions</h3><p>Latest invoices raised at the pass and till.</p></div><a href="#/billing" style="font-size:10px;color:var(--gold-dark);font-weight:600">Billing →</a></div>
            <div class="card-body">
              <div class="mini-list">
                ${s.recentTransactions.length ? s.recentTransactions.map((t) => `<div class="mini-row"><span class="mr-left"><span class="dot-badge" style="color:${t.status === 'paid' ? 'var(--green)' : t.status === 'unpaid' ? 'var(--amber)' : 'var(--red)'}"><i></i>${A.esc(t.invoice_number)}</span><span>· ${A.esc(t.customer_name || 'Walk-in')}</span></span><span style="text-align:right"><b style="display:block">${A.money(t.total)}</b><span style="font-size:8.5px;color:var(--muted)">${A.payBadge(t.status)}</span></span></div>`).join('') : '<div class="muted small">No invoices yet.</div>'}
              </div>
            </div>
          </div>
        </div>
      `;
      A.icons();
      drawCharts();

      A.qsa('[data-range]', view).forEach((b) => b.addEventListener('click', () => {
        state.range = Number(b.dataset.range);
        localStorage.setItem('saffron_dash_range', state.range);
        load();
      }));
      A.qs('#dashRefresh', view).addEventListener('click', (e) => {
        A.busyEvent(e, true, '');
        load().finally(() => A.busyEvent(e, false));
      });
      A.qsa('[data-order]', view).forEach((b) => b.addEventListener('click', () => {
        if (A.openOrder) A.openOrder(Number(b.dataset.order), { onChange: () => load() });
      }));
    }

    function drawCharts() {
      const s = state.stats;
      if (!window.Chart) return;
      const labels = s.daily.map((d) => {
        const dt = A.parse(d.date);
        return dt ? dt.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' }) : d.date;
      });
      const revCanvas = A.qs('#revenueChart', view);
      if (revCanvas) {
        A.chart(revCanvas, {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: 'Revenue', data: s.daily.map((d) => d.sales), borderColor: '#c19a3e',
                backgroundColor: (ctx) => A.gradient(ctx.chart.ctx, ctx.chart.chartArea), fill: true,
                tension: .38, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#9b7524', yAxisID: 'y'
              },
              {
                label: 'Orders', data: s.daily.map((d) => d.orders), borderColor: '#3d629c',
                backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [4, 3], tension: .35,
                pointRadius: 0, pointHoverRadius: 3, yAxisID: 'y1'
              }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.dataset.yAxisID === 'y1' ? ` ${c.parsed.y} orders` : ` ${A.money(c.parsed.y)}` } } },
            scales: {
              x: { grid: { display: false }, ticks: { maxTicksLimit: state.range > 60 ? 8 : 12, maxRotation: 0 } },
              y: { beginAtZero: true, grid: { color: '#f1ede4' }, ticks: { callback: (v) => A.money(v).replace(/\s/g, ' '), maxTicksLimit: 5 }, border: { display: false } },
              y1: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { maxTicksLimit: 5, precision: 0 }, border: { display: false } }
            }
          }
        });
      }

      const payCanvas = A.qs('#paymentChart', view);
      if (payCanvas) {
        const colors = { cash: '#2f7a52', card: '#3d629c', demo: '#c19a3e' };
        A.chart(payCanvas, {
          type: 'doughnut',
          data: {
            labels: s.paymentMix.map((p) => A.capitalize(p.payment_method)),
            datasets: [{ data: s.paymentMix.map((p) => p.total), backgroundColor: s.paymentMix.map((p) => colors[p.payment_method] || '#7d776b'), borderWidth: 2, borderColor: '#fffdf8', hoverOffset: 5 }]
          },
          options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${A.money(c.parsed)}` } } } }
        });
      }

      const catCanvas = A.qs('#categoryChart', view);
      if (catCanvas) {
        A.chart(catCanvas, {
          type: 'bar',
          data: {
            labels: s.categorySales.map((c) => c.category),
            datasets: [{ data: s.categorySales.map((c) => c.revenue), backgroundColor: ['#c19a3e', '#3d629c', '#2f7a52', '#72539b', '#b06c15', '#267085', '#a33b63', '#b23a33'], borderRadius: 4, barThickness: 12 }]
          },
          options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${A.money(c.parsed.x)}` } } },
            scales: { x: { beginAtZero: true, grid: { color: '#f1ede4' }, ticks: { callback: (v) => A.money(v), maxTicksLimit: 4 }, border: { display: false } }, y: { grid: { display: false } } }
          }
        });
      }

      const weekCanvas = A.qs('#weekdayChart', view);
      if (weekCanvas) {
        A.chart(weekCanvas, {
          type: 'bar',
          data: {
            labels: s.weekly.map((w) => w.label),
            datasets: [{ data: s.weekly.map((w) => w.sales), backgroundColor: s.weekly.map((w, i) => i === 5 || i === 6 ? '#c19a3e' : '#e4d5ae'), hoverBackgroundColor: '#9b7524', borderRadius: 4, maxBarThickness: 28 }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${A.money(c.parsed.y)} · ${s.weekly[c.dataIndex].orders} orders` } } },
            scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#f1ede4' }, ticks: { callback: (v) => A.money(v), maxTicksLimit: 4 }, border: { display: false } } }
          }
        });
      }
    }

    async function load() {
      if (destroyed) return;
      view.innerHTML = `<div class="view-loading"><span class="spinner"></span><p>Reading the room…</p></div>`;
      A.destroyCharts();
      try {
        state.stats = await A.api(`/stats?range=${state.range}`);
        if (destroyed) return;
        paint();
      } catch (err) {
        if (destroyed) return;
        view.innerHTML = `<div class="card card-pad" style="max-width:560px;margin:9vh auto;text-align:center">
          <div class="confirm-icon" style="margin:0 auto 16px"><i data-lucide="alert-triangle"></i></div>
          <h2 style="font-family:var(--font-display);font-size:28px;font-weight:500">Dashboard unavailable</h2>
          <p style="color:var(--muted);font-size:12px;margin-top:6px">${A.esc(err.message)}</p>
          <button class="btn btn-gold" style="margin-top:16px" onclick="location.reload()"><i data-lucide="refresh-cw"></i> Try again</button>
        </div>`;
        A.icons();
      }
    }

    await load();
    return () => { destroyed = true; };
  };
})();
