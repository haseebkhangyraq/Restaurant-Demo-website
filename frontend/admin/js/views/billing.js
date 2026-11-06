/* ==========================================================================
   Admin — Billing & invoices
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;

  A.views.billing = async function (view) {
    const state = { status: 'all', search: '', from: '', to: '', invoices: [], summary: {}, destroyed: false };

    view.innerHTML = `
      <div class="view-head">
        <div class="view-head-copy">
          <h2>Billing &amp; invoices</h2>
          <p>Every bill raised at the till, with payment status, guest details and a printable receipt.</p>
        </div>
        <div class="view-head-actions">
          <button class="btn btn-outline" id="billRefresh"><i data-lucide="refresh-cw"></i> Refresh</button>
          ${A.can('pos') ? `<a href="#/pos" class="btn btn-gold"><i data-lucide="plus"></i> New sale</a>` : ''}
        </div>
      </div>

      <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)" id="billKpis">
        ${['Total billed', 'Paid', 'Outstanding', 'Invoices'].map((l) => `<div class="kpi"><span class="kpi-label">${l}</span><span class="kpi-value">—</span></div>`).join('')}
      </div>

      <div class="filter-bar" style="margin-top:16px">
        <div class="search-box"><i data-lucide="search"></i><input type="search" id="billSearch" placeholder="Search invoice, order or guest…"></div>
        <div class="seg-tabs" id="billTabs">
          ${[['all', 'All'], ['paid', 'Paid'], ['unpaid', 'Unpaid'], ['refunded', 'Refunded']].map(([v, l]) => `<button data-status="${v}" class="${v === 'all' ? 'active' : ''}">${l}</button>`).join('')}
        </div>
        <input type="date" id="billFrom" title="From date">
        <input type="date" id="billTo" title="To date">
        <button class="btn btn-soft btn-sm" id="billClear"><i data-lucide="filter-x"></i> Clear</button>
        <span class="spacer"></span>
        <span class="muted small" id="billCount"></span>
      </div>

      <div class="table-card">
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Invoice</th><th>Order</th><th>Guest</th><th>Issued</th><th>Method</th><th>Status</th><th class="num">Total</th><th class="actions">Actions</th></tr></thead>
            <tbody id="billBody"><tr><td colspan="8"><div class="view-loading" style="min-height:180px"><span class="spinner"></span></div></td></tr></tbody>
          </table>
        </div>
        <div class="table-foot"><span id="billFoot">Loading invoices…</span><span class="muted">Receipts can be reprinted at any time</span></div>
      </div>`;
    A.icons();

    const body = A.qs('#billBody', view);

    function query() {
      const qs = new URLSearchParams();
      if (state.status !== 'all') qs.set('status', state.status);
      if (state.search) qs.set('search', state.search);
      if (state.from) qs.set('from', state.from);
      if (state.to) qs.set('to', state.to);
      return qs.toString();
    }

    function paintSummary() {
      const s = state.summary;
      const values = [A.money(s.total || 0), A.money(s.paid || 0), A.money(s.unpaid || 0), A.num(s.count || 0)];
      A.qsa('#billKpis .kpi-value', view).forEach((el, i) => { el.textContent = values[i]; });
    }

    function rowHTML(i) {
      return `<tr>
        <td><button class="mono strong" data-view="${i.id}" style="border:0;background:none;padding:0;font-size:10.5px">${A.esc(i.invoice_number)}</button></td>
        <td class="mono muted" style="font-size:9.8px">${A.esc(i.order_number || '—')}</td>
        <td>${A.esc(i.customer_name || 'Walk-in Guest')}<div class="muted" style="font-size:8.8px">${A.esc(A.typeLabel(i.type || 'takeaway'))}</div></td>
        <td><span class="small">${A.dateShort(i.issued_at)}</span><div class="muted" style="font-size:8.5px">${A.time(i.issued_at)}</div></td>
        <td>${A.esc(A.capitalize(i.payment_method || '—'))}</td>
        <td>${A.payBadge(i.status)}</td>
        <td class="num strong">${A.money2(i.total)}</td>
        <td class="actions"><div class="row-actions">
          <button class="btn btn-xs btn-outline" data-view="${i.id}">View</button>
          <button class="btn btn-xs btn-soft btn-icon" data-print="${i.id}" title="Print"><i data-lucide="printer"></i></button>
        </div></td>
      </tr>`;
    }

    function bind() {
      A.qsa('[data-view]', body).forEach((b) => b.addEventListener('click', () => openInvoice(Number(b.dataset.view))));
      A.qsa('[data-print]', body).forEach((b) => b.addEventListener('click', () => A.printInvoice(Number(b.dataset.print))));
    }

    async function load() {
      body.innerHTML = `<tr><td colspan="8"><div class="view-loading" style="min-height:160px"><span class="spinner"></span></div></td></tr>`;
      try {
        const data = await A.api(`/invoices?${query()}`);
        if (state.destroyed) return;
        state.invoices = data.invoices; state.summary = data.summary;
        paintSummary();
        body.innerHTML = data.invoices.length ? data.invoices.map(rowHTML).join('') : `<tr><td colspan="8">${A.empty('No invoices match this view', 'Try another status or clear the date filters.', 'file-text')}</td></tr>`;
        A.qs('#billCount', view).textContent = `${data.invoices.length} invoice${data.invoices.length === 1 ? '' : 's'}`;
        A.qs('#billFoot', view).textContent = `Showing ${data.invoices.length} invoice${data.invoices.length === 1 ? '' : 's'}`;
        A.icons();
        bind();
      } catch (err) {
        if (state.destroyed) return;
        body.innerHTML = `<tr><td colspan="8">${A.empty('Could not load invoices', err.message, 'alert-triangle')}</td></tr>`;
      }
    }

    async function openInvoice(id) {
      let m = A.modal({
        title: 'Invoice', size: 'lg',
        body: `<div class="view-loading" style="min-height:170px"><span class="spinner"></span></div>`,
        footer: ''
      });
      try {
        const data = await A.api(`/invoices/${id}`);
        const inv = data.invoice;
        const o = data.order;
        const settings = data.settings || {};
        m.body.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:15px;flex-wrap:wrap">
            <div>
              <div style="font-family:var(--font-display);font-size:27px;font-weight:500;line-height:1">Invoice ${A.esc(inv.invoice_number)}</div>
              <div class="muted small" style="margin-top:4px">Issued ${A.dateTime(inv.issued_at)} · ${A.esc(settings.restaurant_name || 'Saffron House')}</div>
            </div>
            <div style="text-align:right">
              <div style="font-family:var(--font-head);font-weight:800;font-size:23px">${A.money2(inv.total)}</div>
              ${A.payBadge(inv.status)}
            </div>
          </div>
          <div class="order-detail-grid">
            <div>
              <div class="detail-section">
                <h4>Bill to</h4>
                <div class="detail-row"><span>Guest</span><b>${A.esc(o?.customer_name || inv.customer_name || 'Walk-in Guest')}</b></div>
                ${o?.phone ? `<div class="detail-row"><span>Phone</span><b>${A.esc(o.phone)}</b></div>` : ''}
                ${o?.order_number ? `<div class="detail-row"><span>Order</span><b class="mono" style="font-size:10px">${A.esc(o.order_number)}</b></div>` : ''}
                <div class="detail-row"><span>Service</span><b>${A.esc(A.typeLabel(o?.type || inv.type || 'takeaway'))}${o?.table_number ? ` · Table ${A.esc(o.table_number)}` : ''}</b></div>
              </div>
              <div class="detail-section">
                <h4>Items</h4>
                <div class="detail-items">
                  ${(o?.items || []).map((it) => `<div class="detail-item"><div class="di-name"><strong>${A.esc(it.name)}</strong>${it.addons?.names?.length ? `<span>+ ${it.addons.names.map(A.esc).join(', ')}</span>` : ''}</div><div class="di-qty">×${it.qty}</div><div class="di-total">${A.money2(it.line_total)}</div></div>`).join('') || '<div class="muted small">No line items available.</div>'}
                </div>
              </div>
              <div class="detail-section">
                <h4>Totals</h4>
                <div class="detail-row"><span>Subtotal</span><b>${A.money2(inv.subtotal)}</b></div>
                ${Number(inv.discount) ? `<div class="detail-row"><span>Discount</span><b style="color:var(--green)">− ${A.money2(inv.discount)}</b></div>` : ''}
                <div class="detail-row"><span>${A.esc(settings.tax_label || 'Tax')}${settings.tax_rate ? ` · ${settings.tax_rate}%` : ''}</span><b>${A.money2(inv.tax)}</b></div>
                ${Number(inv.delivery_fee) ? `<div class="detail-row"><span>Delivery fee</span><b>${A.money2(inv.delivery_fee)}</b></div>` : ''}
                <div class="detail-row total"><span>Total</span><b>${A.money2(inv.total)}</b></div>
              </div>
            </div>
            <div>
              <div class="detail-section">
                <h4>Receipt</h4>
                <div class="muted-box" style="font-size:10.5px;white-space:pre-line;font-family:monospace">${A.esc(settings.receipt_header || 'SAFFRON HOUSE')}
${A.esc(settings.address || '')}
${A.esc(settings.phone || '')}

${A.esc(inv.invoice_number)} · ${A.date(inv.issued_at)}
--------------------------------
${(o?.items || []).map((it) => `${A.esc(it.name)} ×${it.qty}  ${A.money(it.line_total)}`).join('\n')}
--------------------------------
TOTAL ${A.money2(inv.total)}
${A.esc(settings.receipt_footer || 'Thank you for dining with us.')}</div>
              </div>
              <div class="detail-section">
                <h4>Payment</h4>
                <div class="detail-row"><span>Method</span><b>${A.esc(A.capitalize(inv.payment_method || '—'))}</b></div>
                <div class="detail-row"><span>Status</span><b>${A.payBadge(inv.status)}</b></div>
                ${o?.id ? `<div class="order-actions">
                  ${inv.status !== 'paid' ? `<button class="btn btn-green btn-sm" data-mark-paid><i data-lucide="check"></i> Mark paid</button>` : `<button class="btn btn-soft btn-sm" data-mark-unpaid><i data-lucide="rotate-ccw"></i> Mark unpaid</button>`}
                </div>` : ''}
              </div>
            </div>
          </div>`;
        m.footer.innerHTML = `<button class="btn btn-soft left" data-print><i data-lucide="printer"></i> Print invoice</button>
          <button class="btn btn-outline" data-close>Close</button>`;
        A.icons();
        A.qs('[data-close]', m.footer).addEventListener('click', m.close);
        A.qs('[data-print]', m.footer).addEventListener('click', () => A.printInvoice(inv.id));
        A.qs('[data-mark-paid]', m.body)?.addEventListener('click', async (e) => {
          A.busyEvent(e, true, 'Updating…');
          try {
            await A.api(`/orders/${o.id}/payment`, { method: 'PATCH', body: { payment_status: 'paid', payment_method: inv.payment_method } });
            A.toast('Invoice marked as paid.', 'success');
            m.close(); load();
          } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
        });
        A.qs('[data-mark-unpaid]', m.body)?.addEventListener('click', async (e) => {
          A.busyEvent(e, true, 'Updating…');
          try {
            await A.api(`/orders/${o.id}/payment`, { method: 'PATCH', body: { payment_status: 'unpaid', payment_method: inv.payment_method } });
            A.toast('Invoice marked as unpaid.', 'info');
            m.close(); load();
          } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
        });
      } catch (err) {
        m.body.innerHTML = `<div class="modal-note danger">${A.esc(err.message)}</div>`;
      }
    }

    A.qs('#billSearch', view).addEventListener('input', A.debounce((e) => { state.search = e.target.value.trim(); load(); }, 300));
    A.qs('#billTabs', view).addEventListener('click', (e) => {
      const b = e.target.closest('[data-status]');
      if (!b) return;
      state.status = b.dataset.status;
      A.qsa('#billTabs button', view).forEach((x) => x.classList.toggle('active', x === b));
      load();
    });
    A.qs('#billFrom', view).addEventListener('change', (e) => { state.from = e.target.value; load(); });
    A.qs('#billTo', view).addEventListener('change', (e) => { state.to = e.target.value; load(); });
    A.qs('#billClear', view).addEventListener('click', () => {
      state.search = ''; state.from = ''; state.to = ''; state.status = 'all';
      A.qs('#billSearch', view).value = ''; A.qs('#billFrom', view).value = ''; A.qs('#billTo', view).value = '';
      A.qsa('#billTabs button', view).forEach((x) => x.classList.toggle('active', x.dataset.status === 'all'));
      load();
    });
    A.qs('#billRefresh', view).addEventListener('click', (e) => { A.busyEvent(e, true, ''); load().finally(() => A.busyEvent(e, false)); });

    await load();
    return () => { state.destroyed = true; };
  };
})();
