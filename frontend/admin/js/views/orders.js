/* ==========================================================================
   Admin — Orders & shared order detail drawer
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;

  const STATUS_FLOW = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed'];
  const STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'];
  const STATUS_ICONS = {
    pending: 'clock-3', confirmed: 'check-check', preparing: 'flame', ready: 'bell-ring',
    out_for_delivery: 'bike', completed: 'circle-check', cancelled: 'circle-x'
  };
  A.ORDER_STATUSES = STATUSES;

  A.nextStatus = (order) => {
    if (!order || ['completed', 'cancelled'].includes(order.status)) return null;
    if (order.status === 'ready') return order.type === 'delivery' ? 'out_for_delivery' : 'completed';
    if (order.status === 'out_for_delivery') return 'completed';
    const idx = STATUS_FLOW.indexOf(order.status);
    return STATUS_FLOW[idx + 1] || null;
  };
  A.statusActionLabel = (status) => ({
    confirmed: 'Confirm order', preparing: 'Start preparing', ready: 'Mark ready',
    out_for_delivery: 'Send for delivery', completed: 'Complete order', cancelled: 'Cancel order'
  }[status] || A.statusLabel(status));

  function typeIcon(type) {
    return type === 'dine-in' ? 'armchair' : type === 'delivery' ? 'bike' : 'shopping-bag';
  }
  const typeLabel = (t) => ({ 'dine-in': 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery' }[t] || A.capitalize(t));

  A.orderTypeIcon = typeIcon;
  A.typeLabel = typeLabel;

  async function patchStatus(id, status, force = false) {
    return A.api(`/orders/${id}/status`, { method: 'PATCH', body: { status, force } });
  }

  /** Runs a status change, handling insufficient inventory with a force confirmation. */
  A.changeOrderStatus = async (id, status, { onForced } = {}) => {
    try {
      const data = await patchStatus(id, status, false);
      if (data.warnings?.length) A.toast(data.warnings.join(' '), 'info', 'Completed with stock warnings');
      else A.toast(`Order moved to ${A.statusLabel(status).toLowerCase()}.`, 'success', 'Status updated');
      return data;
    } catch (err) {
      if (err.data?.code === 'INSUFFICIENT_STOCK') {
        const shortages = err.data.shortages || [];
        const ok = await A.confirm({
          title: 'Not enough stock to complete',
          message: 'Completing this order will consume ingredients below their available quantity. You can force completion — stock will be reduced to zero and a warning recorded.',
          confirmText: 'Force complete',
          danger: true,
          note: `<div class="shortage-list">${shortages.map((s) => `<div class="shortage-item"><span>${A.esc(s.name)}</span><b>${A.num(s.required, 2)} / ${A.num(s.available, 2)} ${A.esc(s.unit)}</b></div>`).join('')}</div>`
        });
        if (!ok) throw Object.assign(new Error('cancelled'), { silent: true });
        const forced = await patchStatus(id, status, true);
        if (forced.warnings?.length) A.toast(forced.warnings.join(' '), 'info', 'Stock adjusted');
        else A.toast('Order completed and stock adjusted.', 'success');
        onForced && onForced(forced);
        return forced;
      }
      throw err;
    }
  };

  // ── Shared order detail ──
  A.openOrder = (orderId, { onChange } = {}) => {
    let data = null;
    let m = null;

    const bodyHTML = () => {
      const o = data.order;
      const inv = o.invoice;
      const next = A.nextStatus(o);
      const timeline = [];
      const ended = o.status === 'cancelled';
      const flow = ended ? ['pending', 'confirmed', 'cancelled'] : STATUS_FLOW;
      let reached = true;
      for (const s of flow) {
        const isCurrent = o.status === s;
        const done = !isCurrent && reached && (flow.indexOf(s) < flow.indexOf(o.status) || (o.status === 'out_for_delivery' && s !== 'completed'));
        if (s === 'cancelled' && ended) { timeline.push({ s, done: false, current: true }); break; }
        timeline.push({ s, done, current: isCurrent });
        if (isCurrent) reached = false;
      }
      const tsFor = {
        pending: o.created_at, confirmed: o.status !== 'pending' ? o.updated_at : null,
        preparing: ['preparing', 'ready', 'out_for_delivery', 'completed'].includes(o.status) ? o.updated_at : null,
        ready: ['ready', 'out_for_delivery', 'completed'].includes(o.status) ? o.updated_at : null,
        out_for_delivery: ['out_for_delivery', 'completed'].includes(o.status) ? o.updated_at : null,
        completed: o.completed_at, cancelled: ended ? o.updated_at : null
      };

      return `
      <div class="order-detail-grid">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:14px">
            <div>
              <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
                <strong class="mono" style="font-size:14px">${A.esc(o.order_number)}</strong>
                ${A.orderBadge(o.status)}
                ${A.payBadge(o.payment_status)}
              </div>
              <div class="muted small" style="margin-top:5px">${A.dateTime(o.created_at)} · ${A.timeAgo(o.created_at)} · ${A.esc(o.source === 'online' ? 'Online order' : 'POS order')}</div>
            </div>
            <div style="text-align:right">
              <div style="font-family:var(--font-head);font-size:23px;font-weight:800;letter-spacing:-.5px">${A.money2(o.total)}</div>
              <div class="muted" style="font-size:9.5px">${o.item_count || o.items?.length || 0} item${(o.items?.length || 0) === 1 ? '' : 's'}</div>
            </div>
          </div>
          <div class="detail-section">
            <h4>Fulfilment</h4>
            <div class="detail-row"><span>Service type</span><b><i data-lucide="${typeIcon(o.type)}" style="width:12px;height:12px;display:inline-block;vertical-align:-2px;margin-right:4px"></i>${A.esc(typeLabel(o.type))}${o.table_number ? ` · Table ${A.esc(o.table_number)}` : ''}</b></div>
            <div class="detail-row"><span>Staff</span><b>${A.esc(o.staff_name || 'Online / self-service')}</b></div>
            ${o.address ? `<div class="detail-row"><span>Delivery address</span><b style="max-width:65%">${A.esc(o.address)}</b></div>` : ''}
          </div>
          <div class="detail-section">
            <h4>Order items</h4>
            <div class="detail-items">
              ${(o.items || []).map((it) => {
                const addonNames = it.addons?.names || [];
                return `<div class="detail-item">
                  <div class="di-name"><strong>${A.esc(it.name)}</strong>${addonNames.length ? `<span>+ ${addonNames.map(A.esc).join(', ')}</span>` : ''}${it.notes ? `<span style="color:var(--amber)">“${A.esc(it.notes)}”</span>` : ''}</div>
                  <div class="di-qty">×${it.qty}</div>
                  <div class="di-total">${A.money2(it.line_total)}</div>
                </div>`;
              }).join('') || '<div class="muted small">No items on this order.</div>'}
            </div>
          </div>
          ${o.notes ? `<div class="order-note"><strong>Order note:</strong> ${A.esc(o.notes)}</div>` : ''}
          <div class="detail-section" style="margin-top:14px;padding-bottom:0">
            <h4>Payment summary</h4>
            <div class="detail-row"><span>Subtotal</span><b>${A.money2(o.subtotal)}</b></div>
            ${Number(o.discount) > 0 ? `<div class="detail-row"><span>Discount${o.coupon_code ? ` · ${A.esc(o.coupon_code)}` : ''}</span><b style="color:var(--green)">− ${A.money2(o.discount)}</b></div>` : ''}
            <div class="detail-row"><span>${A.esc(data.order.settings?.tax_label || 'Tax')}</span><b>${A.money2(o.tax)}</b></div>
            ${Number(o.delivery_fee) > 0 ? `<div class="detail-row"><span>Delivery fee</span><b>${A.money2(o.delivery_fee)}</b></div>` : ''}
            <div class="detail-row total"><span>Total</span><b>${A.money2(o.total)}</b></div>
            ${inv ? `<div class="detail-row" style="margin-top:5px"><span>Invoice</span><b class="mono" style="font-size:9.5px">${A.esc(inv.invoice_number)}</b></div>` : ''}
          </div>
        </div>

        <div>
          <div class="detail-section">
            <h4>Guest</h4>
            <div class="customer-profile" style="margin-bottom:8px">
              <span class="avatar" style="width:38px;height:38px;font-size:12px;background:linear-gradient(140deg,${A.avatarColor(o.customer_name)},#a9832e)">${A.esc(A.initials(o.customer_name || 'Guest'))}</span>
              <div><h4 style="font-size:18px;line-height:1.15">${A.esc(o.customer_name || 'Walk-in Guest')}</h4><span>${A.esc(o.phone || 'No phone provided')}</span></div>
            </div>
            ${o.customer_email ? `<div class="detail-row"><span>Email</span><b style="font-size:10px">${A.esc(o.customer_email)}</b></div>` : ''}
            ${o.customer_record_name && o.customer_record_name !== o.customer_name ? `<div class="detail-row"><span>Customer record</span><b>${A.esc(o.customer_record_name)}</b></div>` : ''}
          </div>

          <div class="detail-section">
            <h4>Progress</h4>
            <div class="timeline">
              ${timeline.map(({ s, done, current }) => `<div class="timeline-item ${done ? 'done' : ''} ${current ? 'current' : ''}">
                <strong>${A.esc(A.statusLabel(s))}</strong>
                <span>${tsFor[s] ? A.dateTime(tsFor[s]) : (done ? 'Completed' : current ? 'Current stage' : 'Pending')}</span>
              </div>`).join('')}
            </div>
            ${next ? `<button class="btn btn-gold btn-block" data-next-status="${next}" style="margin-top:13px"><i data-lucide="arrow-right-circle"></i> ${A.esc(A.statusActionLabel(next))}</button>` : ''}
            ${!['completed', 'cancelled'].includes(o.status) ? `<button class="btn btn-soft btn-block" data-change-status style="margin-top:6px"><i data-lucide="arrow-left-right"></i> Move to another status</button>` : ''}
          </div>

          <div class="detail-section">
            <h4>Payment</h4>
            <div class="detail-row"><span>Status</span><b>${A.payBadge(o.payment_status)}</b></div>
            <div class="detail-row"><span>Method</span><b>${A.esc(A.capitalize(o.payment_method))}</b></div>
            <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">
              <select class="select" data-payment-status style="min-height:32px;font-size:10.5px">
                ${['paid', 'unpaid', 'refunded'].map((s) => `<option value="${s}" ${o.payment_status === s ? 'selected' : ''}>${A.capitalize(s)}</option>`).join('')}
              </select>
              <button class="btn btn-soft btn-sm" data-save-payment>Update payment</button>
            </div>
          </div>

          ${A.can('tables') && o.type === 'dine-in' ? `<div class="detail-section">
            <h4>Table</h4>
            <div style="display:flex;gap:6px">
              <select class="select" data-table-select style="min-height:33px;font-size:10.5px"><option value="">Loading tables…</option></select>
              <button class="btn btn-soft btn-sm" data-save-table>Move</button>
            </div>
          </div>` : ''}

          <div class="detail-section">
            <h4>Internal note</h4>
            <textarea class="textarea" data-order-notes style="min-height:58px;font-size:11px" placeholder="Add a note for the team…">${A.esc(o.notes || '')}</textarea>
            <button class="btn btn-soft btn-sm" data-save-notes style="margin-top:6px;width:100%"><i data-lucide="save"></i> Save note</button>
          </div>
        </div>
      </div>`;
    };

    const footerHTML = () => {
      const o = data.order;
      return `<button class="btn btn-soft left" data-print ${o.invoice ? '' : 'disabled'}><i data-lucide="printer"></i> Print invoice</button>
        ${!['completed', 'cancelled'].includes(o.status) ? `<button class="btn btn-danger-soft" data-cancel-order><i data-lucide="ban"></i> Cancel order</button>` : ''}
        <button class="btn btn-outline" data-close>Close</button>`;
    };

    const render = () => {
      if (!m) return;
      m.body.innerHTML = bodyHTML();
      m.footer.innerHTML = footerHTML();
      A.icons();
      bind();
    };

    const reload = async () => {
      data = await A.api(`/orders/${orderId}`);
      render();
      onChange && onChange(data.order);
    };

    function bind() {
      const o = data.order;
      A.qs('[data-close]', m.footer)?.addEventListener('click', m.close);
      A.qs('[data-print]', m.footer)?.addEventListener('click', () => A.printInvoice(o.invoice?.id || o.id));
      A.qs('[data-cancel-order]', m.footer)?.addEventListener('click', async () => {
        const ok = await A.confirm({
          title: 'Cancel this order?',
          message: `Order <strong>${A.esc(o.order_number)}</strong> will be cancelled.${o.inventory_deducted ? ' Ingredients will be returned to stock.' : ''}${o.payment_status === 'paid' ? ' The payment will be marked as refunded.' : ''}`,
          confirmText: 'Cancel order', danger: true
        });
        if (!ok) return;
        try {
          await A.changeOrderStatus(o.id, 'cancelled');
          m.close();
          onChange && onChange({ ...o, status: 'cancelled' });
        } catch (err) { if (!err.silent) A.notifyError(err); }
      });

      A.qs('[data-next-status]', m.body)?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const next = btn.dataset.nextStatus;
        A.busy(btn, true, 'Updating…');
        try {
          await A.changeOrderStatus(o.id, next);
          await reload();
        } catch (err) { if (!err.silent) A.notifyError(err); A.busy(btn, false); }
      });

      A.qs('[data-change-status]', m.body)?.addEventListener('click', () => {
        const mm = A.modal({
          title: 'Change order status',
          subtitle: `Order ${o.order_number}`,
          size: 'sm',
          body: `<div class="field"><span>New status</span><select class="select" data-status-pick>${STATUSES.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${A.statusLabel(s)}</option>`).join('')}</select></div>
            <div class="modal-note info" style="margin-top:12px"><i data-lucide="info"></i> Completing an order deducts recipe ingredients. Reverting to pending does not undo stock movements.</div>`,
          footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-gold" data-apply>Update status</button>`,
          onMount: (mm) => {
            A.qs('[data-cancel]', mm.footer).addEventListener('click', mm.close);
            A.qs('[data-apply]', mm.footer).addEventListener('click', async (e) => {
              const status = A.qs('[data-status-pick]', mm.body).value;
              if (status === o.status) return mm.close();
              A.busyEvent(e, true, 'Updating…');
              try {
                await A.changeOrderStatus(o.id, status);
                mm.close();
                await reload();
              } catch (err) { if (!err.silent) A.notifyError(err); A.busyEvent(e, false); }
            });
          }
        });
      });

      A.qs('[data-save-payment]', m.body)?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const status = A.qs('[data-payment-status]', m.body).value;
        A.busy(btn, true, 'Saving…');
        try {
          await A.api(`/orders/${o.id}/payment`, { method: 'PATCH', body: { payment_status: status, payment_method: o.payment_method } });
          A.toast('Payment status updated.', 'success');
          await reload();
        } catch (err) { A.notifyError(err); A.busy(btn, false); }
      });

      const tableSelect = A.qs('[data-table-select]', m.body);
      if (tableSelect) {
        A.api('/tables').then((d) => {
          const current = o.table_id;
          tableSelect.innerHTML = `<option value="">Choose a table…</option>` + d.tables.map((t) => `<option value="${t.id}" ${t.id === current ? 'selected' : ''} ${t.status === 'occupied' && t.id !== current ? 'disabled' : ''}>${A.esc(t.number)} · ${t.capacity} seats${t.status === 'occupied' && t.id !== current ? ' (occupied)' : ''}</option>`).join('');
        }).catch(() => {});
        A.qs('[data-save-table]', m.body)?.addEventListener('click', async (e) => {
          if (!tableSelect.value) return A.toast('Choose a table first.', 'error');
          A.busyEvent(e, true, 'Moving…');
          try {
            await A.api(`/orders/${o.id}/table`, { method: 'PATCH', body: { table_id: Number(tableSelect.value) } });
            A.toast('Order moved to the selected table.', 'success');
            await reload();
          } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
        });
      }

      A.qs('[data-save-notes]', m.body)?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        A.busy(btn, true, 'Saving…');
        try {
          await A.api(`/orders/${o.id}/notes`, { method: 'PATCH', body: { notes: A.qs('[data-order-notes]', m.body).value } });
          A.toast('Order note saved.', 'success');
          await reload();
        } catch (err) { A.notifyError(err); A.busy(btn, false); }
      });
    }

    m = A.modal({
      title: 'Order details',
      subtitle: 'Complete timeline, payment and fulfilment controls.',
      size: 'xl',
      body: `<div class="view-loading" style="min-height:180px"><span class="spinner"></span></div>`,
      footer: '',
      onMount: async (modal) => {
        m = modal;
        try { await reload(); } catch (err) { m.body.innerHTML = `<div class="modal-note danger">${A.esc(err.message)}</div>`; }
      }
    });
    return m;
  };

  // ── Orders list view ──
  A.views.orders = async function (view) {
    let state = {
      status: 'all', search: '', type: 'all', payment_status: 'all', source: 'all',
      from: '', to: '', limit: 40, offset: 0, orders: [], total: 0, counts: {}
    };
    let destroyed = false;

    view.innerHTML = `
      <div class="view-head">
        <div class="view-head-copy">
          <h2>Order book</h2>
          <p>Every dine-in, takeaway and delivery order across the restaurant — with kitchen status, payment and fulfilment in one place.</p>
        </div>
        <div class="view-head-actions">
          <button class="btn btn-outline" data-refresh><i data-lucide="refresh-cw"></i> Refresh</button>
          ${A.can('pos') ? `<a href="#/pos" class="btn btn-gold"><i data-lucide="plus"></i> New sale</a>` : ''}
        </div>
      </div>

      <div class="chip-row" id="statusChips" style="margin-bottom:12px"></div>

      <div class="filter-bar">
        <div class="search-box"><i data-lucide="search"></i><input type="search" id="orderSearch" placeholder="Search order #, guest, phone or table…"></div>
        <select id="orderType"><option value="all">All types</option><option value="dine-in">Dine-in</option><option value="takeaway">Takeaway</option><option value="delivery">Delivery</option></select>
        <select id="orderPayment"><option value="all">All payments</option><option value="paid">Paid</option><option value="unpaid">Unpaid</option><option value="refunded">Refunded</option></select>
        <select id="orderSource"><option value="all">All sources</option><option value="pos">POS</option><option value="online">Online</option></select>
        <input type="date" id="orderFrom" title="From date">
        <input type="date" id="orderTo" title="To date">
        <button class="btn btn-soft btn-sm" id="clearFilters"><i data-lucide="filter-x"></i> Clear</button>
        <span class="spacer"></span>
        <span class="muted small" id="orderCountLabel"></span>
      </div>

      <div class="table-card">
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Order</th><th>Guest</th><th>Fulfilment</th><th class="num">Items</th><th class="num">Total</th><th>Payment</th><th>Status</th><th>Placed</th><th class="actions">Actions</th></tr></thead>
            <tbody id="ordersBody"><tr><td colspan="9"><div class="view-loading" style="min-height:180px"><span class="spinner"></span></div></td></tr></tbody>
          </table>
        </div>
        <div class="table-foot">
          <span id="orderFootLabel">Loading…</span>
          <button class="btn btn-soft btn-sm" id="loadMore" hidden>Load more <i data-lucide="chevron-down"></i></button>
        </div>
      </div>`;
    A.icons();

    const body = A.qs('#ordersBody', view);
    const chips = A.qs('#statusChips', view);

    const chipDefs = [
      ['all', 'All'], ['active', 'Active'], ['pending', 'Pending'], ['confirmed', 'Confirmed'],
      ['preparing', 'Preparing'], ['ready', 'Ready'], ['out_for_delivery', 'Out for delivery'],
      ['completed', 'Completed'], ['cancelled', 'Cancelled']
    ];

    function renderChips() {
      chips.innerHTML = chipDefs.map(([key, label]) => {
        const count = key === 'all' ? state.counts.all : key === 'active' ? state.counts.active : state.counts[key];
        return `<button class="chip ${state.status === key ? 'active' : ''}" data-status="${key}">${label}${count !== undefined ? ` <b class="count">${count}</b>` : ''}</button>`;
      }).join('');
      A.qsa('[data-status]', chips).forEach((b) => b.addEventListener('click', () => {
        state.status = b.dataset.status; state.offset = 0; load();
      }));
    }

    function query() {
      const qs = new URLSearchParams();
      if (state.status !== 'all') qs.set('status', state.status);
      if (state.search) qs.set('search', state.search);
      if (state.type !== 'all') qs.set('type', state.type);
      if (state.payment_status !== 'all') qs.set('payment_status', state.payment_status);
      if (state.source !== 'all') qs.set('source', state.source);
      if (state.from) qs.set('from', state.from);
      if (state.to) qs.set('to', state.to);
      qs.set('limit', state.limit);
      qs.set('offset', state.offset);
      return qs.toString();
    }

    function rowHTML(o) {
      const next = A.nextStatus(o);
      return `<tr data-order-row="${o.id}">
        <td><button class="mono strong" data-view-order="${o.id}" style="border:0;background:none;padding:0;color:var(--ink);font-size:10.5px;text-align:left">${A.esc(o.order_number)}</button>
          <div class="muted" style="font-size:8.8px;margin-top:1px">${o.invoice_number ? A.esc(o.invoice_number) : 'No invoice'}</div></td>
        <td><div class="cell-main"><span class="avatar" style="width:27px;height:27px;font-size:9px;background:linear-gradient(140deg,${A.avatarColor(o.customer_name)},#a9832e)">${A.esc(A.initials(o.customer_name || 'G'))}</span><div><strong>${A.esc(o.customer_name || 'Walk-in Guest')}</strong><span>${A.esc(o.phone || '—')}</span></div></div></td>
        <td><span style="display:inline-flex;align-items:center;gap:4px;font-size:10.5px"><i data-lucide="${typeIcon(o.type)}" style="width:12px;height:12px;color:var(--muted)"></i>${A.esc(typeLabel(o.type))}</span>
          ${o.table_number ? `<div class="muted" style="font-size:8.5px;margin-top:1px">Table ${A.esc(o.table_number)}</div>` : ''}</td>
        <td class="num">${o.item_count || 0}</td>
        <td class="num strong">${A.money(o.total)}</td>
        <td>${A.payBadge(o.payment_status)}<div class="muted" style="font-size:8.5px;margin-top:2px">${A.esc(A.capitalize(o.payment_method))}</div></td>
        <td>${A.orderBadge(o.status)}</td>
        <td><span class="small">${A.time(o.created_at)}</span><div class="muted" style="font-size:8.5px">${A.dateShort(o.created_at)}</div></td>
        <td class="actions"><div class="row-actions">
          ${next ? `<button class="btn btn-xs btn-soft" data-quick-status="${o.id}" data-next="${next}" title="${A.esc(A.statusActionLabel(next))}"><i data-lucide="arrow-right"></i></button>` : ''}
          <button class="btn btn-xs btn-outline" data-view-order="${o.id}">View</button>
        </div></td>
      </tr>`;
    }

    function bindRows() {
      A.qsa('[data-view-order]', body).forEach((b) => b.addEventListener('click', () => A.openOrder(Number(b.dataset.viewOrder), { onChange: () => load() })));
      A.qsa('[data-quick-status]', body).forEach((b) => b.addEventListener('click', async () => {
        A.busy(b, true, '');
        try {
          await A.changeOrderStatus(Number(b.dataset.quickStatus), b.dataset.next);
          await load();
        } catch (err) { if (!err.silent) A.notifyError(err); A.busy(b, false); }
      }));
    }

    async function load() {
      if (destroyed) return;
      A.qs('#orderSearch', view).value = state.search;
      A.qs('#orderType', view).value = state.type;
      A.qs('#orderPayment', view).value = state.payment_status;
      A.qs('#orderSource', view).value = state.source;
      A.qs('#orderFrom', view).value = state.from;
      A.qs('#orderTo', view).value = state.to;
      body.innerHTML = `<tr><td colspan="9"><div class="view-loading" style="min-height:160px"><span class="spinner"></span></div></td></tr>`;
      try {
        const data = await A.api(`/orders?${query()}`);
        if (destroyed) return;
        state.orders = data.orders; state.total = data.total; state.counts = data.counts;
        body.innerHTML = data.orders.length ? data.orders.map(rowHTML).join('') : `<tr><td colspan="9">${A.empty('No orders match this view', 'Try clearing the filters or searching a different guest.', 'receipt-text')}</td></tr>`;
        renderChips();
        A.qs('#orderCountLabel', view).textContent = `${data.total} order${data.total === 1 ? '' : 's'}`;
        A.qs('#orderFootLabel', view).textContent = `Showing ${Math.min(state.offset + data.orders.length, data.total)} of ${data.total}`;
        A.qs('#loadMore', view).hidden = state.offset + data.orders.length >= data.total;
        A.icons();
        bindRows();
      } catch (err) {
        if (destroyed) return;
        if (err.status === 401) return A.onUnauthorized();
        body.innerHTML = `<tr><td colspan="9">${A.empty('Could not load orders', err.message, 'alert-triangle')}</td></tr>`;
      }
    }

    // Filters
    A.qs('#orderSearch', view).addEventListener('input', A.debounce((e) => { state.search = e.target.value.trim(); state.offset = 0; load(); }, 300));
    A.qs('#orderType', view).addEventListener('change', (e) => { state.type = e.target.value; state.offset = 0; load(); });
    A.qs('#orderPayment', view).addEventListener('change', (e) => { state.payment_status = e.target.value; state.offset = 0; load(); });
    A.qs('#orderSource', view).addEventListener('change', (e) => { state.source = e.target.value; state.offset = 0; load(); });
    A.qs('#orderFrom', view).addEventListener('change', (e) => { state.from = e.target.value; state.offset = 0; load(); });
    A.qs('#orderTo', view).addEventListener('change', (e) => { state.to = e.target.value; state.offset = 0; load(); });
    A.qs('#clearFilters', view).addEventListener('click', () => {
      state = { ...state, search: '', type: 'all', payment_status: 'all', source: 'all', from: '', to: '', status: 'all', offset: 0 };
      load();
    });
    A.qs('#loadMore', view).addEventListener('click', () => { state.offset += state.limit; load(); });
    A.qs('[data-refresh]', view).addEventListener('click', (e) => { A.busyEvent(e, true, 'Refreshing…'); load().finally(() => A.busyEvent(e, false)); });

    await load();
    return () => { destroyed = true; };
  };
})();
