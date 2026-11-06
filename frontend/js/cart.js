/* ==========================================================================
   Saffron House — cart page
   ========================================================================== */
(function () {
  'use strict';
  const SH = window.SH;
  let site = null;

  const itemsEl = document.getElementById('cartItems');
  const totalsEl = document.getElementById('cartTotals');
  const content = document.getElementById('cartContent');
  const emptyEl = document.getElementById('cartEmpty');
  const couponForm = document.getElementById('couponForm');
  const couponInput = document.getElementById('couponInput');
  const couponMsg = document.getElementById('couponMsg');
  const crossGrid = document.getElementById('crossSellGrid');
  const crossWrap = document.getElementById('crossSells');

  function localTotals() {
    const subtotal = SH.cart.subtotal();
    const coupon = SH.cart.coupon();
    const discount = Math.min(Number(coupon?.discount) || 0, subtotal);
    const rate = Number(SH.settings?.tax_rate || 0);
    const tax = Math.round((subtotal - discount) * rate) / 100;
    return { subtotal, discount, tax, total: Math.round((subtotal - discount + tax) * 100) / 100, rate };
  }

  function lineHTML(item) {
    const addons = (item.addonNames || []).length
      ? `<p class="line-addons">${item.addonNames.map((n) => SH.esc(n)).join(' · ')}</p>` : '';
    const note = item.notes ? `<p class="line-note">“${SH.esc(item.notes)}”</p>` : '';
    return `
      <div class="cart-line" data-line="${SH.esc(item.key)}">
        <img class="cart-line-img" src="${SH.esc(item.image || '/assets/images/food-spread.jpg')}" alt="${SH.esc(item.name)}">
        <div>
          <h3>${SH.esc(item.name)}</h3>
          ${addons}${note}
          <div class="line-meta">
            <div class="qty-control">
              <button type="button" data-step="-1" aria-label="Decrease ${SH.esc(item.name)}"><i data-lucide="minus"></i></button>
              <input type="number" min="1" max="99" value="${item.qty}" data-qty-input aria-label="Quantity for ${SH.esc(item.name)}">
              <button type="button" data-step="1" aria-label="Increase ${SH.esc(item.name)}"><i data-lucide="plus"></i></button>
            </div>
            <span class="line-price">${SH.money(item.price)} each</span>
          </div>
        </div>
        <div class="cart-line-right">
          <span class="cart-line-total">${SH.money(item.price * item.qty)}</span>
          <button class="remove-line" data-remove><i data-lucide="x"></i> Remove</button>
        </div>
      </div>`;
  }

  function renderTotals() {
    const t = localTotals();
    const coupon = SH.cart.coupon();
    totalsEl.innerHTML = `
      <div class="summary-line"><span>Subtotal</span><b>${SH.money2(t.subtotal)}</b></div>
      ${t.discount ? `<div class="summary-line" style="color:var(--success)"><span>Discount ${coupon ? `(${SH.esc(coupon.code)})` : ''}</span><b style="color:var(--success)">− ${SH.money2(t.discount)}</b></div>` : ''}
      <div class="summary-line"><span>Tax (${t.rate}%)</span><b>${SH.money2(t.tax)}</b></div>
      <div class="summary-line"><span>Delivery</span><b style="font-weight:400;font-size:11px">At checkout</b></div>
      <div class="summary-line total"><span>Estimated total</span><b>${SH.money2(t.total)}</b></div>`;
    if (coupon) couponInput.value = coupon.code;
  }

  function renderCrossSells() {
    if (!crossGrid) return;
    const inCart = new Set(SH.cart.get().map((i) => i.product_id));
    const picks = (site?.products || []).filter((p) => p.available && !inCart.has(p.id)).slice(0, 3);
    if (!picks.length) { crossWrap.style.display = 'none'; return; }
    crossWrap.style.display = '';
    crossGrid.innerHTML = picks.map((p) => SH.productCardHTML(p)).join('');
    picks.forEach((p) => {
      const card = crossGrid.querySelector(`[data-product-id="${p.id}"]`);
      if (card) SH.bindProductCard(card, p);
    });
    SH.icons();
  }

  async function revalidateCoupon() {
    const coupon = SH.cart.coupon();
    const subtotal = SH.cart.subtotal();
    if (!coupon) { couponMsg.textContent = ''; couponMsg.className = 'coupon-msg'; return; }
    if (subtotal < 1) { SH.cart.setCoupon(null); couponMsg.textContent = ''; return; }
    try {
      const r = await SH.api('/api/coupon/validate', { method: 'POST', body: { code: coupon.code, subtotal } });
      SH.cart.setCoupon({ code: r.code, discount: r.discount });
      couponMsg.textContent = r.message;
      couponMsg.className = 'coupon-msg ok';
    } catch (err) {
      SH.cart.setCoupon(null);
      couponInput.value = '';
      couponMsg.textContent = err.message;
      couponMsg.className = 'coupon-msg err';
    }
    renderTotals();
  }

  function renderAll() {
    const items = SH.cart.get();
    const has = items.length > 0;
    content.style.display = has ? '' : 'none';
    emptyEl.style.display = has ? 'none' : 'block';
    if (has) {
      itemsEl.innerHTML = items.map(lineHTML).join('');
      itemsEl.querySelectorAll('[data-line]').forEach((row) => {
        const key = row.dataset.line;
        row.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
          const current = SH.cart.get().find((i) => i.key === key);
          if (!current) return;
          SH.cart.setQty(key, current.qty + Number(b.dataset.step));
          renderAll();
        }));
        const input = row.querySelector('[data-qty-input]');
        input.addEventListener('change', () => {
          SH.cart.setQty(key, Math.max(0, parseInt(input.value, 10) || 0));
          renderAll();
        });
        row.querySelector('[data-remove]').addEventListener('click', () => {
          SH.cart.remove(key);
          SH.toast('Item removed from your order.', 'info');
          renderAll();
        });
      });
      renderTotals();
    } else {
      totalsEl.innerHTML = '';
    }
    SH.icons();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    site = await SH.loadSite();
    renderAll();
    renderCrossSells();
    if (SH.cart.coupon()) revalidateCoupon();

    couponForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = couponInput.value.trim();
      if (!code) return;
      const btn = couponForm.querySelector('button');
      btn.disabled = true;
      try {
        const r = await SH.api('/api/coupon/validate', { method: 'POST', body: { code, subtotal: SH.cart.subtotal() } });
        SH.cart.setCoupon({ code: r.code, discount: r.discount });
        couponMsg.textContent = r.message;
        couponMsg.className = 'coupon-msg ok';
        renderTotals();
        SH.toast(r.message, 'success', 'Coupon applied');
      } catch (err) {
        SH.cart.setCoupon(null);
        couponMsg.textContent = err.message;
        couponMsg.className = 'coupon-msg err';
        renderTotals();
      } finally { btn.disabled = false; }
    });

    document.getElementById('clearCart').addEventListener('click', () => {
      if (!SH.cart.get().length) return;
      SH.cart.clear();
      couponInput.value = '';
      couponMsg.textContent = '';
      cookieReset();
      renderAll();
      renderCrossSells();
      SH.toast('Your order has been cleared.', 'info');
    });

    document.getElementById('checkoutBtn').addEventListener('click', (e) => {
      if (!SH.cart.get().length) { e.preventDefault(); SH.toast('Add at least one dish first.', 'error'); }
    });

    document.addEventListener('cart:updated', () => { renderTotals(); renderCrossSells(); });
  });

  function cookieReset() { /* placeholder for parity */ }
})();
