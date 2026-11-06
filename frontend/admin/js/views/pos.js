/* ==========================================================================
   Admin — Point of Sale
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;

  const keyFor = (productId, addons, notes) =>
    `${productId}-${(addons || []).map((a) => a.id).sort((a, b) => a - b).join('.')}-${String(notes || '').trim().toLowerCase()}`;

  A.views.pos = async function (view) {
    let destroyed = false;
    const state = {
      data: null,
      cart: [],
      type: 'dine-in',
      tableId: '',
      customerName: '',
      phone: '',
      address: '',
      notes: '',
      discount: 0,
      coupon: null,
      couponCode: '',
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      cashReceived: '',
      search: '',
      category: 'all'
    };

    view.innerHTML = `<div class="view-loading"><span class="spinner"></span><p>Opening the till…</p></div>`;

    try {
      const [menu, tableData] = await Promise.all([
        A.raw('/api/menu'),
        A.api('/tables').catch(() => ({ tables: [] }))
      ]);
      if (destroyed) return;
      state.data = menu;
      state.tables = tableData.tables || [];
      if (!state.data.products.length) {
        view.innerHTML = `<div class="card card-pad">${A.empty('No products available', 'Add dishes in Menu Manager before opening the till.', 'utensils')}</div>`;
        A.icons();
        return;
      }
      render();
    } catch (err) {
      if (destroyed) return;
      view.innerHTML = `<div class="card card-pad" style="max-width:560px;margin:9vh auto;text-align:center">
        <div class="confirm-icon" style="margin:0 auto 16px"><i data-lucide="alert-triangle"></i></div>
        <h2 style="font-family:var(--font-display);font-size:28px;font-weight:500">Could not open POS</h2>
        <p style="color:var(--muted);font-size:12px;margin-top:6px">${A.esc(err.message)}</p>
      </div>`;
      A.icons();
    }

    function settings() {
      return state.data.settings || A.siteSettings || {};
    }
    function taxRate() { return Number(settings().tax_rate || 0); }
    function deliveryFee() { return Number(settings().delivery_fee || 0); }

    function totals() {
      const subtotal = state.cart.reduce((s, l) => s + (Number(l.price) + (l.addons || []).reduce((x, a) => x + Number(a.price), 0)) * l.qty, 0);
      const coupon = state.coupon ? Number(state.coupon.discount || 0) : 0;
      const manual = Math.max(0, Number(state.discount) || 0);
      const discount = Math.min(subtotal, coupon + manual);
      const tax = ((subtotal - discount) * taxRate()) / 100;
      const delivery = state.type === 'delivery' ? deliveryFee() : 0;
      const total = subtotal - discount + tax + delivery;
      return { subtotal, coupon, manual, discount, tax, delivery, total };
    }

    function filteredProducts() {
      const q = state.search.trim().toLowerCase();
      return state.data.products.filter((p) => {
        if (state.category !== 'all' && p.category_id !== Number(state.category) && p.category_slug !== state.category) return false;
        if (!q) return true;
        return `${p.name} ${p.description || ''} ${p.category_name || ''}`.toLowerCase().includes(q);
      });
    }

    function productGridHTML() {
      const list = filteredProducts();
      return list.map((p) => `<button class="pos-product ${p.available ? '' : 'unavailable'}" data-product="${p.id}" ${p.available ? '' : 'disabled'}>
        <img src="${A.img(p.image)}" alt="${A.esc(p.name)}" loading="lazy">
        ${!p.available ? '<span class="pos-tag">Sold out</span>' : (p.is_popular ? '<span class="pos-tag">Popular</span>' : '')}
        <div class="pos-product-body">
          <strong>${A.esc(p.name)}</strong>
          <div class="pos-product-foot"><b>${A.money(p.price)}</b><span>${A.esc(p.category_name || '')}</span></div>
        </div>
      </button>`).join('') || `<div class="pos-empty"><i data-lucide="search-x" style="width:26px;height:26px;margin:0 auto 8px"></i><strong>No dishes match “${A.esc(state.search)}”</strong><div style="margin-top:4px">Try another search or category.</div></div>`;
    }

    function renderGrid() {
      const grid = A.qs('#posGrid');
      if (!grid) return;
      grid.innerHTML = productGridHTML();
      const count = A.qs('#posResultCount');
      if (count) {
        const n = filteredProducts().length;
        count.textContent = `${n} item${n === 1 ? '' : 's'}`;
      }
      A.qsa('#posCats [data-cat]').forEach((b) => b.classList.toggle('active', b.dataset.cat === String(state.category)));
      A.icons();
    }

    function render() {
      const cats = state.data.categories;
      view.innerHTML = `
        <div class="view-head" style="margin-bottom:16px">
          <div class="view-head-copy">
            <h2>Point of sale</h2>
            <p>Take an order at the counter, assign a table, apply a discount and settle the bill in seconds.</p>
          </div>
          <div class="view-head-actions">
            <span class="badge neutral" style="padding:6px 9px"><i data-lucide="calendar-clock"></i> ${new Date().toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            <button class="btn btn-outline" id="posClearTop"><i data-lucide="trash-2"></i> Clear sale</button>
            <a href="#/orders" class="btn btn-soft"><i data-lucide="receipt-text"></i> Order book</a>
          </div>
        </div>

        <div class="pos-layout">
          <section class="pos-catalog">
            <div class="pos-head">
              <div class="search-box" style="flex:1;max-width:none"><i data-lucide="search"></i><input type="search" id="posSearch" placeholder="Search dishes, drinks, categories…" value="${A.esc(state.search)}"></div>
              <span class="muted small" id="posResultCount">${filteredProducts().length} item${filteredProducts().length === 1 ? '' : 's'}</span>
            </div>
            <div class="pos-cats" id="posCats">
              <button class="pos-cat ${state.category === 'all' ? 'active' : ''}" data-cat="all">All dishes</button>
              ${cats.map((c) => `<button class="pos-cat ${String(state.category) === String(c.id) ? 'active' : ''}" data-cat="${c.id}">${A.esc(c.name)}</button>`).join('')}
            </div>
            <div class="pos-grid" id="posGrid">
              ${productGridHTML()}
            </div>
          </section>

          <aside class="pos-cart" id="posCart">
            <div class="pos-cart-head">
              <h3><i data-lucide="shopping-basket"></i> Current sale</h3>
              <span id="posCartCount">${state.cart.reduce((s, l) => s + l.qty, 0)} item${state.cart.reduce((s, l) => s + l.qty, 0) === 1 ? '' : 's'}</span>
            </div>
            <div class="pos-type" id="posType">
              <button data-type="dine-in" class="${state.type === 'dine-in' ? 'active' : ''}"><i data-lucide="armchair"></i><span>Dine-in</span></button>
              <button data-type="takeaway" class="${state.type === 'takeaway' ? 'active' : ''}"><i data-lucide="shopping-bag"></i><span>Takeaway</span></button>
              <button data-type="delivery" class="${state.type === 'delivery' ? 'active' : ''}"><i data-lucide="bike"></i><span>Delivery</span></button>
            </div>
            <div class="pos-context" id="posContext"></div>
            <div class="pos-lines" id="posLines"></div>
            <div class="pos-payment" id="posPayment">
              ${[['cash', 'banknote', 'Cash'], ['card', 'credit-card', 'Card'], ['demo', 'smartphone', 'Demo pay']].map(([m, icon, label]) => `<button data-pay="${m}" class="${state.paymentMethod === m ? 'active' : ''}"><i data-lucide="${icon}"></i>${label}</button>`).join('')}
            </div>
            <div class="pos-summary" id="posSummary"></div>
            <div class="pos-actions">
              <button class="btn btn-outline btn-icon" id="posClear" title="Clear sale"><i data-lucide="trash-2"></i></button>
              <button class="btn btn-gold btn-lg" id="posCheckout"><i data-lucide="circle-check-big"></i> Charge &amp; complete</button>
            </div>
          </aside>
        </div>`;
      A.icons();
      bind();
      renderCart();
    }

    function renderContext() {
      const el = A.qs('#posContext');
      if (!el) return;
      if (state.type === 'dine-in') {
        const current = state.tables.find((t) => String(t.id) === String(state.tableId));
        el.innerHTML = `
          <label class="field"><span>Table</span>
            <select id="posTable">
              <option value="">Choose a table…</option>
              ${state.tables.map((t) => `<option value="${t.id}" ${String(state.tableId) === String(t.id) ? 'selected' : ''} ${t.status === 'occupied' && t.id !== current?.id ? 'disabled' : ''}>${A.esc(t.number)} · ${t.capacity} seats · ${A.capitalize(t.status)}</option>`).join('')}
            </select>
          </label>
          <div class="form-grid" style="gap:7px">
            <label class="field"><span>Guest name</span><input id="posName" value="${A.esc(state.customerName)}" placeholder="Walk-in Guest"></label>
            <label class="field"><span>Phone</span><input id="posPhone" value="${A.esc(state.phone)}" placeholder="03xx…"></label>
          </div>`;
      } else if (state.type === 'delivery') {
        el.innerHTML = `
          <div class="form-grid" style="gap:7px">
            <label class="field"><span>Guest name</span><input id="posName" value="${A.esc(state.customerName)}" placeholder="Full name"></label>
            <label class="field"><span>Phone</span><input id="posPhone" value="${A.esc(state.phone)}" placeholder="03xx…"></label>
          </div>
          <label class="field"><span>Delivery address</span><textarea id="posAddress" style="min-height:46px">${A.esc(state.address)}</textarea></label>
          <p class="form-hint" style="margin-top:-2px">Delivery fee ${A.money(deliveryFee())} will be added to the bill.</p>`;
      } else {
        el.innerHTML = `
          <div class="form-grid" style="gap:7px">
            <label class="field"><span>Guest name</span><input id="posName" value="${A.esc(state.customerName)}" placeholder="Walk-in Guest"></label>
            <label class="field"><span>Phone</span><input id="posPhone" value="${A.esc(state.phone)}" placeholder="03xx…"></label>
          </div>`;
      }
      A.qs('#posTable')?.addEventListener('change', (e) => { state.tableId = e.target.value; renderCart(); });
      ['posName', 'posPhone', 'posAddress'].forEach((id) => {
        const input = A.qs('#' + id);
        if (!input) return;
        input.addEventListener('input', () => {
          if (id === 'posName') state.customerName = input.value;
          if (id === 'posPhone') state.phone = input.value;
          if (id === 'posAddress') state.address = input.value;
        });
      });
    }

    function renderCart() {
      const lines = A.qs('#posLines');
      const summary = A.qs('#posSummary');
      const count = A.qs('#posCartCount');
      if (!lines) return;
      renderContext();
      count.textContent = `${state.cart.reduce((s, l) => s + l.qty, 0)} item${state.cart.reduce((s, l) => s + l.qty, 0) === 1 ? '' : 's'}`;

      if (!state.cart.length) {
        lines.innerHTML = `<div class="pos-cart-empty"><i data-lucide="shopping-basket"></i><strong>The basket is empty</strong><span>Tap a dish to start this sale.</span></div>`;
      } else {
        lines.innerHTML = state.cart.map((l, idx) => {
          const addonNames = (l.addons || []).map((a) => a.name);
          const unit = Number(l.price) + (l.addons || []).reduce((s, a) => s + Number(a.price), 0);
          return `<div class="pos-line">
            <img src="${A.img(l.image)}" alt="">
            <div class="pos-line-body">
              <strong>${A.esc(l.name)}</strong>
              <span>${addonNames.length ? `+ ${addonNames.map(A.esc).join(', ')}` : A.money(unit) + ' each'}${l.notes ? ` · ${A.esc(l.notes)}` : ''}</span>
              <div class="qty-stepper" style="margin-top:4px"><button data-qty="-1" data-line="${idx}">−</button><span>${l.qty}</span><button data-qty="1" data-line="${idx}">+</button></div>
            </div>
            <div class="pos-line-actions"><b>${A.money(unit * l.qty)}</b><button class="remove-btn" data-remove="${idx}" title="Remove"><i data-lucide="x"></i></button></div>
          </div>`;
        }).join('');
      }

      const t = totals();
      const change = state.paymentMethod === 'cash' && Number(state.cashReceived) > 0 ? Math.max(0, Number(state.cashReceived) - t.total) : 0;
      summary.innerHTML = `
        <div class="pos-row"><span>Subtotal</span><b id="posSubtotal">${A.money2(t.subtotal)}</b></div>
        <div class="pos-row"><span>${A.esc(settings().tax_label || 'Tax')} · ${taxRate()}%</span><b id="posTax">${A.money2(t.tax)}</b></div>
        ${state.type === 'delivery' ? `<div class="pos-row"><span>Delivery</span><b id="posDelivery">${A.money2(t.delivery)}</b></div>` : ''}
        <div class="pos-row"><span>Discount</span><b id="posDiscountAmt">${t.discount ? `− ${A.money2(t.discount)}` : '—'}</b></div>
        <div class="pos-discount">
          <input type="number" min="0" id="posDiscount" placeholder="Manual discount" value="${state.discount || ''}" style="flex:1">
          <input type="text" id="posCoupon" placeholder="Coupon code" value="${A.esc(state.couponCode)}" style="flex:1;text-transform:uppercase">
          <button class="btn btn-soft btn-sm" id="posApplyCoupon">${state.coupon ? 'Applied' : 'Apply'}</button>
        </div>
        ${state.coupon ? `<div class="pos-row" style="color:var(--green)"><span>${A.esc(state.coupon.code)}</span><span>− ${A.money2(state.coupon.discount)} <button type="button" id="posRemoveCoupon" style="border:0;background:none;color:var(--red);font-size:9px;text-decoration:underline">remove</button></span></div>` : ''}
        <div class="pos-row"><span>Payment</span><select id="posPaymentStatus" style="width:auto;min-height:26px;padding:2px 24px 2px 7px;font-size:9.5px"><option value="paid" ${state.paymentStatus === 'paid' ? 'selected' : ''}>Paid now</option><option value="unpaid" ${state.paymentStatus === 'unpaid' ? 'selected' : ''}>Room tab / unpaid</option></select></div>
        ${state.paymentMethod === 'cash' ? `<div class="pos-row" style="align-items:center"><span>Cash received</span><input type="number" min="0" id="posCash" placeholder="${t.total.toFixed(0)}" value="${state.cashReceived}" style="width:100px;min-height:28px;text-align:right;font-size:10.5px"></div>
          <div class="pos-row" style="margin-top:1px"><span>Change due</span><b id="posChange" style="color:var(--green)">${A.money2(change)}</b></div>` : ''}
        <div class="pos-row total"><span>Total</span><b id="posTotal">${A.money2(t.total)}</b></div>`;
      A.icons();
      bindCart();

      A.qs('#posCheckout').disabled = !state.cart.length;
    }

    function refreshTotals() {
      const t = totals();
      const set = (id, value) => { const el = A.qs('#' + id); if (el) el.textContent = value; };
      set('posSubtotal', A.money2(t.subtotal));
      set('posTax', A.money2(t.tax));
      set('posDelivery', A.money2(t.delivery));
      set('posDiscountAmt', t.discount ? `− ${A.money2(t.discount)}` : '—');
      set('posTotal', A.money2(t.total));
      const cash = A.qs('#posCash');
      if (cash) cash.placeholder = t.total.toFixed(0);
      const change = state.paymentMethod === 'cash' && Number(state.cashReceived) > 0 ? Math.max(0, Number(state.cashReceived) - t.total) : 0;
      set('posChange', A.money2(change));
      const btn = A.qs('#posCheckout');
      if (btn) btn.disabled = !state.cart.length;
    }

    function bindCart() {
      A.qsa('[data-qty]').forEach((b) => b.addEventListener('click', () => {
        const idx = Number(b.dataset.line);
        state.cart[idx].qty += Number(b.dataset.qty);
        if (state.cart[idx].qty <= 0) state.cart.splice(idx, 1);
        renderCart();
      }));
      A.qsa('[data-remove]').forEach((b) => b.addEventListener('click', () => {
        state.cart.splice(Number(b.dataset.remove), 1);
        renderCart();
      }));
      const discount = A.qs('#posDiscount');
      if (discount) discount.addEventListener('input', () => { state.discount = Number(discount.value) || 0; refreshTotals(); });
      const cash = A.qs('#posCash');
      if (cash) cash.addEventListener('input', () => { state.cashReceived = cash.value; refreshTotals(); });
      A.qs('#posPaymentStatus')?.addEventListener('change', (e) => { state.paymentStatus = e.target.value; renderCart(); });
      A.qs('#posApplyCoupon')?.addEventListener('click', applyCoupon);
      A.qs('#posCoupon')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } });
      A.qs('#posRemoveCoupon')?.addEventListener('click', () => { state.coupon = null; state.couponCode = ''; renderCart(); });
      A.qs('#posCheckout')?.addEventListener('click', checkout);
    }

    async function applyCoupon() {
      const code = (A.qs('#posCoupon')?.value || '').trim().toUpperCase();
      if (!code) return A.toast('Enter a coupon code first.', 'error');
      const t = totals();
      try {
        const data = await A.raw('/api/coupon/validate', { method: 'POST', body: { code, subtotal: t.subtotal } });
        state.coupon = { code: data.code, discount: data.discount, message: data.message };
        state.couponCode = data.code;
        A.toast(data.message, 'success', 'Coupon applied');
        renderCart();
      } catch (err) { A.notifyError(err); }
    }

    function openProduct(product) {
      const groups = product.addon_groups || {};
      const groupNames = Object.keys(groups);
      const m = A.modal({
        title: A.esc(product.name),
        subtitle: `${A.esc(product.category_name || '')} · ${A.money(product.price)}${product.is_veg ? ' · Vegetarian' : ''}`,
        size: 'sm',
        body: `
          <div style="display:flex;gap:12px;margin-bottom:14px">
            <img src="${A.img(product.image)}" alt="" style="width:92px;height:92px;border-radius:10px;object-fit:cover;flex-shrink:0">
            <div><p class="muted" style="font-size:10.5px;line-height:1.55">${A.esc(product.description || product.long_description || 'Prepared fresh to order.')}</p>${product.recipe?.length ? `<span class="badge neutral" style="margin-top:6px">${product.recipe.length} recipe ingredients</span>` : ''}</div>
          </div>
          ${groupNames.length ? `<h4 class="field-label" style="margin:12px 0 6px">Customise</h4>${groupNames.map((g) => `<div style="margin-bottom:10px"><span class="muted small" style="font-weight:600">${A.esc(g)}</span><div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:4px">${groups[g].map((a) => `<label class="switch" style="border:1px solid var(--line);padding:7px 9px;border-radius:7px;font-size:10.5px;justify-content:space-between"><span>${A.esc(a.name)}<span class="muted" style="font-size:9px"> +${A.money(a.price)}</span></span><input type="checkbox" data-addon="${a.id}" data-addon-name="${A.esc(a.name)}" data-addon-price="${a.price}"><span class="track"></span></label>`).join('')}</div></div>`).join('')}` : ''}
          <div class="form-grid" style="grid-template-columns:100px 1fr;margin-top:12px">
            <label class="field"><span>Quantity</span><div class="qty-stepper" style="height:38px;border-radius:8px"><button type="button" id="pQtyMinus" style="width:31px;height:36px;font-size:16px">−</button><span id="pQty" style="flex:1;font-size:13px">1</span><button type="button" id="pQtyPlus" style="width:31px;height:36px;font-size:16px">+</button></div></label>
            <label class="field"><span>Kitchen note</span><input id="pNotes" placeholder="e.g. no onions, extra spicy"></label>
          </div>`,
        footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-gold" data-add><i data-lucide="plus"></i> Add to sale</button>`,
        onMount: (modal) => {
          let qty = 1;
          const qtyEl = A.qs('#pQty', modal.body);
          A.qs('#pQtyMinus', modal.body).addEventListener('click', () => { qty = Math.max(1, qty - 1); qtyEl.textContent = qty; });
          A.qs('#pQtyPlus', modal.body).addEventListener('click', () => { qty = Math.min(99, qty + 1); qtyEl.textContent = qty; });
          A.qs('[data-cancel]', modal.footer).addEventListener('click', modal.close);
          A.qs('[data-add]', modal.footer).addEventListener('click', () => {
            const addons = A.qsa('[data-addon]:checked', modal.body).map((el) => ({ id: Number(el.dataset.addon), name: el.dataset.addonName, price: Number(el.dataset.addonPrice) }));
            const notes = A.qs('#pNotes', modal.body).value.trim();
            const key = keyFor(product.id, addons, notes);
            const existing = state.cart.find((l) => l.key === key);
            if (existing) existing.qty += qty;
            else state.cart.push({ key, product_id: product.id, name: product.name, price: Number(product.price), image: product.image, qty, addons, notes });
            modal.close();
            renderCart();
          });
        }
      });
    }

    function checkout() {
      if (!state.cart.length) return A.toast('Add at least one dish to the sale.', 'error');
      if (state.type === 'dine-in' && !state.tableId) return A.toast('Choose a table for this dine-in order.', 'error');
      if (state.type === 'delivery' && state.address.trim().length < 10) return A.toast('Enter a complete delivery address.', 'error');
      const t = totals();
      if (state.paymentMethod === 'cash' && state.paymentStatus === 'paid' && Number(state.cashReceived) > 0 && Number(state.cashReceived) < t.total) {
        return A.toast('Cash received is less than the bill total.', 'error');
      }
      const btn = A.qs('#posCheckout');
      doCheckout(false, btn).catch((err) => {
        if (err.status === 409 && err.data?.code === 'INSUFFICIENT_STOCK') {
          const shortages = err.data.shortages || [];
          A.confirm({
            title: 'Not enough stock to complete',
            message: 'Some recipe ingredients are below the required quantity. Force completion to reduce them to zero and finish the sale.',
            confirmText: 'Force & complete',
            danger: true,
            note: `<div class="shortage-list">${shortages.map((s) => `<div class=\"shortage-item\"><span>${A.esc(s.name)}</span><b>${A.num(s.required, 2)} / ${A.num(s.available, 2)} ${A.esc(s.unit)}</b></div>`).join('')}</div>`,
            onConfirm: () => doCheckout(true, btn)
          });
        } else A.notifyError(err);
      });
    }

    async function doCheckout(force, btn) {
      const t = totals();
      A.busy(btn, true, force ? 'Completing…' : 'Charging…');
      try {
        const payload = {
          items: state.cart.map((l) => ({ product_id: l.product_id, qty: l.qty, addonIds: (l.addons || []).map((a) => a.id), notes: l.notes })),
          type: state.type,
          table_id: state.type === 'dine-in' ? Number(state.tableId) : null,
          customer_name: state.customerName.trim(),
          phone: state.phone.trim(),
          address: state.type === 'delivery' ? state.address.trim() : '',
          notes: state.notes,
          coupon_code: state.coupon?.code || null,
          discount: Number(state.discount) || 0,
          delivery_fee: state.type === 'delivery' ? deliveryFee() : 0,
          payment_method: state.paymentMethod,
          payment_status: state.paymentStatus,
          cash_received: Number(state.cashReceived) || 0,
          force: !!force
        };
        const data = await A.api('/pos/checkout', { method: 'POST', body: payload });
        showSuccess(data, t);
        // Reset the till state
        state.cart = [];
        state.coupon = null;
        state.couponCode = '';
        state.discount = 0;
        state.cashReceived = '';
        state.customerName = '';
        state.phone = '';
        state.address = '';
        state.notes = '';
        state.tableId = '';
        renderCart();
        // Refresh table statuses in the background
        A.api('/tables').then((d) => { state.tables = d.tables || []; }).catch(() => {});
      } finally {
        A.busy(btn, false);
      }
    }

    function showSuccess(data, t) {
      const order = data.order;
      const invoice = data.invoice;
      const change = Number(data.change_due) || 0;
      A.modal({
        title: '',
        size: 'sm',
        closable: false,
        body: `<div class="pos-success">
          <div class="success-icon"><i data-lucide="check"></i></div>
          <h3>Sale complete</h3>
          <p>${A.esc(order.order_number)} · ${A.esc(A.typeLabel(order.type))}${order.table_number ? ` · Table ${A.esc(order.table_number)}` : ''}</p>
          <div class="pos-receipt">
            <div><span>Invoice</span><b>${A.esc(invoice?.invoice_number || '—')}</b></div>
            <div><span>Items</span><b>${order.items?.reduce((s, i) => s + i.qty, 0) || 0}</b></div>
            <div><span>Payment</span><b>${A.esc(A.capitalize(order.payment_method))} · ${A.esc(A.capitalize(order.payment_status))}</b></div>
            <div><span>Subtotal</span><b>${A.money2(order.subtotal)}</b></div>
            ${Number(order.discount) ? `<div><span>Discount</span><b>− ${A.money2(order.discount)}</b></div>` : ''}
            <div><span>${A.esc(settings().tax_label || 'Tax')}</span><b>${A.money2(order.tax)}</b></div>
            ${Number(order.delivery_fee) ? `<div><span>Delivery</span><b>${A.money2(order.delivery_fee)}</b></div>` : ''}
            <div class="total"><span>Total</span><b>${A.money2(order.total)}</b></div>
            ${change > 0 ? `<div style="margin-top:5px"><span>Change due</span><b style="color:var(--green)">${A.money2(change)}</b></div>` : ''}
          </div>
          <div class="modal-foot">
            <button class="btn btn-soft" data-print><i data-lucide="printer"></i> Print receipt</button>
            <button class="btn btn-gold" data-new><i data-lucide="plus"></i> New sale</button>
          </div>
        </div>`,
        onMount: (m) => {
          A.qs('[data-new]', m.body).addEventListener('click', m.close);
          A.qs('[data-print]', m.body).addEventListener('click', () => A.printInvoice(invoice?.id));
        }
      });
    }

    function bind() {
      A.qs('#posSearch').addEventListener('input', A.debounce((e) => { state.search = e.target.value; renderGrid(); }, 150));
      A.qs('#posCats').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cat]');
        if (!btn) return;
        state.category = btn.dataset.cat;
        renderGrid();
      });
      A.qs('#posGrid').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-product]');
        if (!btn) return;
        const product = state.data.products.find((p) => p.id === Number(btn.dataset.product));
        if (product) openProduct(product);
      });
      A.qs('#posType').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-type]');
        if (!btn) return;
        state.type = btn.dataset.type;
        if (state.type !== 'dine-in') state.tableId = '';
        A.qsa('#posType button').forEach((b) => b.classList.toggle('active', b.dataset.type === state.type));
        renderCart();
      });
      A.qs('#posPayment').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-pay]');
        if (!btn) return;
        state.paymentMethod = btn.dataset.pay;
        A.qsa('#posPayment button').forEach((b) => b.classList.toggle('active', b.dataset.pay === state.paymentMethod));
        renderCart();
      });
      A.qs('#posClear').addEventListener('click', clearSale);
      A.qs('#posClearTop').addEventListener('click', clearSale);
    }

    async function clearSale() {
      if (!state.cart.length) { A.toast('The sale is already empty.', 'info'); return; }
      const ok = await A.confirm({ title: 'Clear this sale?', message: 'All items and customer details will be removed from the current sale.', confirmText: 'Clear sale', danger: true });
      if (!ok) return;
      state.cart = []; state.coupon = null; state.couponCode = ''; state.discount = 0; state.cashReceived = '';
      state.customerName = ''; state.phone = ''; state.address = ''; state.notes = ''; state.tableId = '';
      renderCart();
    }

    return () => { destroyed = true; };
  };
})();
