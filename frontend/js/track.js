/* ==========================================================================
   Saffron House — order tracking
   ========================================================================== */
(function () {
  'use strict';
  const SH = window.SH;
  const form = document.getElementById('trackForm');
  const numInput = document.getElementById('trackNumber');
  const phoneInput = document.getElementById('trackPhone');
  const errEl = document.getElementById('trackError');
  const result = document.getElementById('trackResult');
  let refreshTimer = null;
  let lastQuery = null;

  const STATUS_LABEL = {
    pending: 'Order placed', confirmed: 'Confirmed', preparing: 'In the kitchen', ready: 'Ready',
    out_for_delivery: 'On the way', completed: 'Completed', cancelled: 'Cancelled'
  };
  const PILL_CLASS = {
    pending: 'status-pending', confirmed: 'status-confirmed', preparing: 'status-preparing',
    ready: 'status-ready', out_for_delivery: 'status-out_for_delivery', completed: 'status-completed',
    cancelled: 'status-cancelled'
  };

  function steps(order) {
    if (order.type === 'delivery') {
      return [
        { key: 'pending', label: 'Placed', icon: 'receipt' },
        { key: 'confirmed', label: 'Confirmed', icon: 'check-circle-2' },
        { key: 'preparing', label: 'Cooking', icon: 'flame' },
        { key: 'out_for_delivery', label: 'On the way', icon: 'bike' },
        { key: 'completed', label: 'Delivered', icon: 'home' }
      ];
    }
    return [
      { key: 'pending', label: 'Placed', icon: 'receipt' },
      { key: 'confirmed', label: 'Confirmed', icon: 'check-circle-2' },
      { key: 'preparing', label: 'Cooking', icon: 'flame' },
      { key: 'ready', label: 'Ready', icon: 'bell-ring' },
      { key: 'completed', label: 'Collected', icon: 'shopping-bag' }
    ];
  }

  function currentIndex(order) {
    const st = order.status;
    if (order.type === 'delivery') {
      if (st === 'pending') return 0;
      if (st === 'confirmed') return 1;
      if (st === 'preparing') return 2;
      if (st === 'ready') return 3;
      if (st === 'out_for_delivery') return 3;
      if (st === 'completed') return 4;
    } else {
      if (st === 'pending') return 0;
      if (st === 'confirmed') return 1;
      if (st === 'preparing') return 2;
      if (st === 'ready') return 3;
      if (st === 'completed') return 4;
    }
    return 0;
  }

  function render(order) {
    result.classList.add('show');
    document.getElementById('trackOrderNumber').textContent = order.order_number;
    document.getElementById('trackMeta').textContent =
      `${order.type === 'delivery' ? 'Delivery' : 'Collection'} · ${SH.date(order.created_at)} at ${SH.time(order.created_at)}${order.customer_name ? ` · ${order.customer_name}` : ''}`;
    const pill = document.getElementById('trackStatus');
    pill.className = `status-pill ${PILL_CLASS[order.status] || ''}`;
    pill.textContent = STATUS_LABEL[order.status] || order.status;

    const cancelled = order.status === 'cancelled';
    const timeLine = document.getElementById('trackTimeline');
    timeLine.style.display = cancelled ? 'none' : 'grid';
    const cancelBox = document.getElementById('trackCancelled');
    cancelBox.style.display = cancelled ? 'block' : 'none';
    if (cancelled) {
      cancelBox.innerHTML = `<strong>This order was cancelled.</strong><br>${order.payment_status === 'refunded' ? 'Your demo payment has been refunded.' : 'No payment was taken.'} If this is unexpected, please call us on ${SH.esc(SH.settings?.phone || '+92 42 3577 8899')}.`;
    } else {
      const list = steps(order);
      const idx = currentIndex(order);
      timeLine.innerHTML = list.map((s, i) => {
        let cls = '';
        if (order.status === 'completed') cls = i <= idx ? 'done' : '';
        else if (i < idx) cls = 'done';
        else if (i === idx) cls = 'current';
        return `<div class="tl-step ${cls}">
          <span class="tl-dot"><i data-lucide="${s.icon}"></i></span>
          <span>${s.label}</span>
        </div>`;
      }).join('');
    }

    document.getElementById('trackItems').innerHTML = (order.items || []).map((i) => {
      const extra = i.addons?.names?.length ? `<br><small style="color:var(--muted)">${i.addons.names.map(SH.esc).join(', ')}</small>` : '';
      const note = i.notes ? `<br><small style="color:var(--gold-dark);font-style:italic">${SH.esc(i.notes)}</small>` : '';
      return `<div class="track-item"><span><b style="color:var(--gold-dark);margin-right:6px">${i.qty}×</b>${SH.esc(i.name)}${extra}${note}</span><b>${SH.money2(i.line_total)}</b></div>`;
    }).join('');

    document.getElementById('trackTotals').innerHTML = `
      <div><span>Subtotal</span><span>${SH.money2(order.subtotal)}</span></div>
      ${order.discount ? `<div><span>Discount</span><span>− ${SH.money2(order.discount)}</span></div>` : ''}
      <div><span>Tax</span><span>${SH.money2(order.tax)}</span></div>
      ${order.delivery_fee ? `<div><span>Delivery</span><span>${SH.money2(order.delivery_fee)}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${SH.money2(order.total)}</span></div>`;

    const delTitle = document.getElementById('trackDeliveryTitle');
    const delBody = document.getElementById('trackDeliveryBody');
    delTitle.textContent = order.type === 'delivery' ? 'Delivering to' : 'Collection from';
    if (order.type === 'delivery') {
      delBody.innerHTML = `<p style="font-size:12.5px;color:var(--muted);line-height:1.8">${SH.esc(SH.settings?.address || '42-C, MM Alam Road, Gulberg III, Lahore')}<br><span style="color:var(--ink)">Order notes:</span> ${SH.esc(order.notes || '—')}</p>`;
    } else {
      delBody.innerHTML = `<p style="font-size:12.5px;color:var(--muted);line-height:1.8">${SH.esc(SH.settings?.address || '42-C, MM Alam Road, Gulberg III, Lahore')}<br>${SH.esc(SH.settings?.phone || '+92 42 3577 8899')}<br><span style="color:var(--ink)">Order notes:</span> ${SH.esc(order.notes || '—')}</p>`;
    }

    document.getElementById('trackDeliveryBody').innerHTML += `<p style="font-size:11px;color:var(--muted);margin-top:10px">Payment: ${order.payment_status === 'paid' ? 'Paid' : order.payment_status === 'refunded' ? 'Refunded' : 'Due on collection/delivery'} · ${SH.esc(order.payment_method || 'cash')}</p>`;

    SH.icons();
    scheduleRefresh(order);
  }

  function scheduleRefresh(order) {
    clearTimeout(refreshTimer);
    if (['completed', 'cancelled'].includes(order.status)) return;
    refreshTimer = setTimeout(() => { if (lastQuery) fetchOrder(lastQuery, true); }, 30000);
  }

  async function fetchOrder({ order, phone }, silent = false) {
    lastQuery = { order, phone };
    if (!silent) {
      errEl.classList.remove('show');
      const b = form.querySelector('button[type="submit"]');
      b.disabled = true;
    }
    try {
      const data = await SH.api(`/api/orders/${encodeURIComponent(order)}/track?phone=${encodeURIComponent(phone)}`);
      render(data.order);
      const url = new URL(window.location.href);
      url.searchParams.set('order', order);
      url.searchParams.set('phone', phone);
      history.replaceState(null, '', url);
    } catch (err) {
      if (!silent) {
        errEl.textContent = err.message;
        errEl.classList.add('show');
        result.classList.remove('show');
      }
    } finally {
      const b = form.querySelector('button[type="submit"]');
      b.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const order = numInput.value.trim();
      const phone = phoneInput.value.trim();
      if (!order || !phone) { errEl.textContent = 'Enter both your order number and phone.'; errEl.classList.add('show'); return; }
      fetchOrder({ order, phone });
    });

    document.getElementById('refreshTrack').addEventListener('click', () => {
      if (lastQuery) fetchOrder(lastQuery, true);
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get('order')) {
      numInput.value = params.get('order');
      phoneInput.value = params.get('phone') || '';
      if (phoneInput.value) form.dispatchEvent(new Event('submit'));
    }
  });
})();
