/* ==========================================================================
   Saffron House — checkout
   ========================================================================== */
(function () {
  'use strict';
  const SH = window.SH;
  let deliveryFee = 250;
  let taxRate = 5;

  const form = document.getElementById('checkoutForm');
  const layout = document.getElementById('checkoutLayout');
  const empty = document.getElementById('checkoutEmpty');
  const wrap = document.getElementById('checkoutWrap');
  const success = document.getElementById('checkoutSuccess');
  const itemsEl = document.getElementById('checkoutItems');
  const totalsEl = document.getElementById('checkoutTotals');
  const errorEl = document.getElementById('checkoutError');
  const demoForm = document.getElementById('demoCardForm');
  const addressField = document.getElementById('addressField');
  const coAddress = document.getElementById('coAddress');
  const savedSelect = document.getElementById('savedAddress');
  const btn = document.getElementById('placeOrderBtn');

  function type() { return form.querySelector('input[name="type"]:checked').value; }
  function method() { return form.querySelector('input[name="paymentMethod"]:checked').value; }

  function totals() {
    const subtotal = SH.cart.subtotal();
    const coupon = SH.cart.coupon();
    const discount = Math.min(Number(coupon?.discount) || 0, subtotal);
    const tax = Math.round((subtotal - discount) * taxRate) / 100;
    const fee = type() === 'delivery' ? deliveryFee : 0;
    const total = Math.round((subtotal - discount + tax + fee) * 100) / 100;
    return { subtotal, discount, tax, fee, total };
  }

  function render() {
    const items = SH.cart.get();
    if (!items.length) {
      layout.style.display = 'none';
      empty.style.display = 'block';
      SH.icons();
      return;
    }
    layout.style.display = '';
    empty.style.display = 'none';
    itemsEl.innerHTML = items.map((i) => `
      <div class="checkout-item">
        <span><span class="ci-qty">${i.qty}×</span>${SH.esc(i.name)}${(i.addonNames || []).length ? `<br><small style="color:var(--muted)">${i.addonNames.map((n) => SH.esc(n)).join(', ')}</small>` : ''}</span>
        <b>${SH.money(i.price * i.qty)}</b>
      </div>`).join('');

    const t = totals();
    const coupon = SH.cart.coupon();
    totalsEl.innerHTML = `
      <div class="summary-line"><span>Subtotal</span><b>${SH.money2(t.subtotal)}</b></div>
      ${t.discount ? `<div class="summary-line" style="color:var(--success)"><span>Discount ${coupon ? `(${SH.esc(coupon.code)})` : ''}</span><b style="color:var(--success)">− ${SH.money2(t.discount)}</b></div>` : ''}
      <div class="summary-line"><span>Tax (${taxRate}%)</span><b>${SH.money2(t.tax)}</b></div>
      <div class="summary-line"><span>${type() === 'delivery' ? 'Delivery' : 'Collection'}</span><b>${t.fee ? SH.money2(t.fee) : 'Free'}</b></div>
      <div class="summary-line total"><span>Total</span><b>${SH.money2(t.total)}</b></div>`;
    SH.icons();
  }

  function setTypeUI() {
    document.querySelectorAll('[data-type-card]').forEach((card) => {
      card.classList.toggle('selected', card.dataset.typeCard === type());
    });
    addressField.style.display = type() === 'delivery' ? '' : 'none';
    coAddress.required = type() === 'delivery';
    render();
  }

  function setMethodUI() {
    document.querySelectorAll('.payment-card').forEach((card) => {
      card.classList.toggle('selected', card.querySelector('input').checked);
    });
    demoForm.classList.toggle('show', method() === 'demo');
  }

  async function prefill() {
    const customer = await SH.getCustomer();
    if (!customer) return;
    form.querySelector('#coName').value = customer.name || '';
    form.querySelector('#coPhone').value = customer.phone || '';
    if (customer.address) coAddress.value = customer.address;
    try {
      const r = await SH.api('/api/customer/addresses');
      const addresses = r.addresses || [];
      if (addresses.length) {
        savedSelect.style.display = '';
        savedSelect.innerHTML = '<option value="">Choose a saved address…</option>' +
          addresses.map((a) => `<option value="${encodeURIComponent(a.address)}"${a.is_default ? ' selected' : ''}>${SH.esc(a.label)} — ${SH.esc(a.address)}</option>`).join('');
        const def = addresses.find((a) => a.is_default) || addresses[0];
        if (def && !coAddress.value) coAddress.value = def.address;
        savedSelect.addEventListener('change', () => {
          if (savedSelect.value) coAddress.value = decodeURIComponent(savedSelect.value);
        });
      }
    } catch (_) { /* not signed in */ }
  }

  function validateDemoCard() {
    if (method() !== 'demo') return true;
    const num = document.getElementById('cardNumber').value.replace(/\s/g, '');
    const exp = document.getElementById('cardExpiry').value.trim();
    const cvc = document.getElementById('cardCvc').value.trim();
    if (!/^\d{15,16}$/.test(num)) { errorEl.textContent = 'Enter a valid demo card number (16 digits).'; return false; }
    if (!/^\d{2}\/\d{2}$/.test(exp)) { errorEl.textContent = 'Enter the expiry as MM/YY.'; return false; }
    const [mm, yy] = exp.split('/').map(Number);
    const now = new Date();
    if (mm < 1 || mm > 12 || (2000 + yy < now.getFullYear()) || (2000 + yy === now.getFullYear() && mm < now.getMonth() + 1)) {
      errorEl.textContent = 'That card expiry date has passed.'; return false;
    }
    if (!/^\d{3,4}$/.test(cvc)) { errorEl.textContent = 'Enter the 3 or 4 digit CVC.'; return false; }
    return true;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const site = await SH.loadSite();
    deliveryFee = Number(site.settings?.delivery_fee ?? 250);
    taxRate = Number(site.settings?.tax_rate ?? 5);
    render();
    setTypeUI();
    setMethodUI();
    prefill();

    form.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener('change', setTypeUI));
    form.querySelectorAll('input[name="paymentMethod"]').forEach((r) => r.addEventListener('change', setMethodUI));

    // Card input formatting
    const cardNumber = document.getElementById('cardNumber');
    cardNumber.addEventListener('input', () => {
      cardNumber.value = cardNumber.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
    });
    const cardExpiry = document.getElementById('cardExpiry');
    cardExpiry.addEventListener('input', () => {
      let v = cardExpiry.value.replace(/\D/g, '').slice(0, 4);
      if (v.length > 2) v = `${v.slice(0, 2)}/${v.slice(2)}`;
      cardExpiry.value = v;
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.classList.remove('show');
      const items = SH.cart.get();
      if (!items.length) { render(); return; }
      if (!form.checkValidity()) { form.reportValidity(); return; }
      if (!validateDemoCard()) { errorEl.classList.add('show'); return; }
      const data = new FormData(form);
      const name = String(data.get('name') || '').trim();
      const phone = String(data.get('phone') || '').trim();
      if (name.length < 2) { errorEl.textContent = 'Please enter your name.'; errorEl.classList.add('show'); return; }
      if (!/^[0-9+\-\s()]{7,20}$/.test(phone)) { errorEl.textContent = 'Please enter a valid phone number.'; errorEl.classList.add('show'); return; }
      if (type() === 'delivery' && coAddress.value.trim().length < 10) {
        errorEl.textContent = 'Please enter a complete delivery address.'; errorEl.classList.add('show'); return;
      }

      const payload = {
        items: items.map((i) => ({ product_id: i.product_id, qty: i.qty, addonIds: i.addonIds || [], notes: i.notes || '' })),
        type: type(),
        name,
        phone,
        address: type() === 'delivery' ? coAddress.value.trim() : '',
        notes: String(data.get('notes') || '').trim(),
        couponCode: SH.cart.coupon()?.code || null,
        paymentMethod: method()
      };

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Sending to the kitchen…';
      try {
        const r = await SH.api('/api/orders', { method: 'POST', body: payload });
        const order = r.order;
        SH.cart.clear();
        wrap.querySelector('#checkoutLayout').style.display = 'none';
        document.querySelector('.page-title-row').style.display = 'none';
        success.classList.add('show');
        document.getElementById('successNumber').textContent = order.order_number;
        document.getElementById('successText').textContent =
          `Thank you, ${name.split(' ')[0]}. Your ${order.type === 'delivery' ? 'delivery' : 'collection'} order is confirmed — total ${SH.money2(order.total)}${order.payment_status === 'paid' ? ' (demo payment approved)' : ', payable on arrival'}. The kitchen will start shortly.`;
        const track = document.getElementById('trackOrderBtn');
        track.href = `/track.html?order=${encodeURIComponent(order.order_number)}&phone=${encodeURIComponent(phone)}`;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        SH.icons();
      } catch (err) {
        errorEl.textContent = err.message || 'We could not place your order. Please try again.';
        errorEl.classList.add('show');
        if (err.data?.shortages) {
          errorEl.textContent += ' ' + err.data.shortages.map((s) => `${s.name} (${s.available}${s.unit} left)`).join(', ');
        }
        btn.disabled = false;
        btn.innerHTML = 'Place order <i data-lucide="arrow-right"></i>';
        SH.icons();
      }
    });

    document.addEventListener('cart:updated', () => { if (success.classList.contains('show')) return; render(); });
  });
})();
