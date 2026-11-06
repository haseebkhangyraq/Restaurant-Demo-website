/* ==========================================================================
   Saffron House — customer account
   ========================================================================== */
(function () {
  'use strict';
  const SH = window.SH;

  const authSection = document.getElementById('authSection');
  const accountSection = document.getElementById('accountSection');
  let customer = null;
  let orders = [];
  let addresses = [];

  const STATUS_LABEL = {
    pending: 'Placed', confirmed: 'Confirmed', preparing: 'Cooking', ready: 'Ready',
    out_for_delivery: 'On the way', completed: 'Completed', cancelled: 'Cancelled'
  };
  const PILL = {
    pending: 'status-pending', confirmed: 'status-confirmed', preparing: 'status-preparing',
    ready: 'status-ready', out_for_delivery: 'status-out_for_delivery', completed: 'status-completed',
    cancelled: 'status-cancelled'
  };
  const icon = (name) => `<i data-lucide="${name}"></i>`;

  function showAuth() {
    authSection.style.display = '';
    accountSection.style.display = 'none';
    SH.icons();
  }
  function showAccount() {
    authSection.style.display = 'none';
    accountSection.style.display = '';
    SH.icons();
  }

  // ── Auth ──
  function bindAuth() {
    document.querySelectorAll('[data-auth-tab]').forEach((tab) => tab.addEventListener('click', () => {
      document.querySelectorAll('[data-auth-tab]').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.auth-form').forEach((f) => f.classList.toggle('active', f.id === `${tab.dataset.authTab}Form`));
    }));

    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const err = document.getElementById('loginError');
      err.classList.remove('show');
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const b = form.querySelector('button[type="submit"]');
      b.disabled = true; b.innerHTML = '<span class="spinner"></span> Signing in…';
      try {
        const r = await SH.api('/api/auth/customer/login', {
          method: 'POST',
          body: { email: form.email.value, password: form.password.value }
        });
        customer = r.customer;
        SH.toast(`Welcome back, ${customer.name.split(' ')[0]}.`, 'success');
        await loadAccount();
      } catch (ex) {
        err.textContent = ex.message; err.classList.add('show');
      } finally {
        b.disabled = false; b.innerHTML = 'Sign in <i data-lucide="arrow-right"></i>'; SH.icons();
      }
    });

    document.getElementById('registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const err = document.getElementById('registerError');
      err.classList.remove('show');
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const b = form.querySelector('button[type="submit"]');
      b.disabled = true; b.innerHTML = '<span class="spinner"></span> Creating account…';
      try {
        const r = await SH.api('/api/auth/customer/register', {
          method: 'POST',
          body: { name: form.name.value, email: form.email.value, phone: form.phone.value, password: form.password.value }
        });
        customer = r.customer;
        SH.toast('Your Saffron House account is ready.', 'success', 'Welcome');
        await loadAccount();
      } catch (ex) {
        err.textContent = ex.message; err.classList.add('show');
      } finally {
        b.disabled = false; b.innerHTML = 'Create account <i data-lucide="arrow-right"></i>'; SH.icons();
      }
    });

    document.getElementById('signOutBtn').addEventListener('click', async () => {
      await SH.api('/api/auth/customer/logout', { method: 'POST' }).catch(() => {});
      customer = null; orders = []; addresses = [];
      SH.getCustomer(true).catch(() => {});
      showAuth();
      SH.toast('You have been signed out.', 'info');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ── Panels ──
  function bindPanels() {
    document.querySelectorAll('.account-nav [data-panel]').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.account-nav [data-panel]').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('[data-panel-content]').forEach((p) => p.classList.toggle('active', p.dataset.panelContent === b.dataset.panel));
    }));
  }

  // ── Account data ──
  async function loadAccount() {
    customer = customer || await SH.getCustomer(true);
    if (!customer) { showAuth(); return; }
    showAccount();
    document.getElementById('accountAvatar').textContent = (customer.name || 'S').charAt(0).toUpperCase();
    document.getElementById('accountName').textContent = customer.name;
    document.getElementById('accountEmail').textContent = customer.email || customer.phone || '';
    document.getElementById('firstName').textContent = (customer.name || 'friend').split(' ')[0];

    const [ordersRes, addrRes] = await Promise.allSettled([
      SH.api('/api/customer/orders'),
      SH.api('/api/customer/addresses')
    ]);
    orders = ordersRes.status === 'fulfilled' ? (ordersRes.value.orders || []) : [];
    addresses = addrRes.status === 'fulfilled' ? (addrRes.value.addresses || []) : [];
    renderOverview();
    renderOrders();
    renderAddresses();
    fillProfile();
    SH.icons();
  }

  function orderCard(o) {
    return `<div class="order-card">
      <div class="oc-main">
        <strong>${SH.esc(o.order_number)}</strong>
        <span>${SH.date(o.created_at)} · ${o.item_count || 0} item${Number(o.item_count) === 1 ? '' : 's'} · ${SH.esc(o.type)}</span>
        <span style="font-size:10px;color:var(--muted-2)">${o.payment_status === 'paid' ? 'Paid' : o.payment_status === 'refunded' ? 'Refunded' : 'Payment due'} · ${SH.esc(o.payment_method || 'cash')}</span>
      </div>
      <div class="oc-right">
        <span class="status-pill ${PILL[o.status] || ''}">${STATUS_LABEL[o.status] || o.status}</span>
        <span class="oc-total">${SH.money2(o.total)}</span>
        <div class="oc-actions">
          <button class="btn btn-outline btn-xs" data-detail="${o.id}">View</button>
          <button class="btn btn-dark btn-xs" data-reorder="${o.id}">Reorder</button>
          <a class="btn btn-outline btn-xs" href="/track.html?order=${encodeURIComponent(o.order_number)}&phone=${encodeURIComponent(customer?.phone || '')}">Track</a>
        </div>
      </div>
    </div>`;
  }

  function bindOrderActions(container) {
    container.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const r = await SH.api(`/api/customer/orders/${b.dataset.detail}`);
        const o = r.order;
        const items = (o.items || []).map((i) => {
          const addons = i.addons?.names?.length ? `<br><small style="color:var(--muted)">${i.addons.names.map(SH.esc).join(', ')}</small>` : '';
          return `<div class="track-item"><span>${i.qty}× ${SH.esc(i.name)}${addons}</span><b>${SH.money2(i.line_total)}</b></div>`;
        }).join('');
        SH.openModal(`
          <div style="padding:34px">
            <button class="modal-close" data-close-modal aria-label="Close">${icon('x')}</button>
            <span class="eyebrow">Order detail</span>
            <h2 style="font-family:var(--font-display);font-size:34px;margin:10px 0 4px">${SH.esc(o.order_number)}</h2>
            <p style="color:var(--muted);font-size:12px">${SH.date(o.created_at)} at ${SH.time(o.created_at)} · ${SH.esc(o.type)} · <span class="status-pill ${PILL[o.status] || ''}">${STATUS_LABEL[o.status] || o.status}</span></p>
            <div style="margin-top:20px">${items}</div>
            <div class="track-totals">
              <div><span>Subtotal</span><span>${SH.money2(o.subtotal)}</span></div>
              ${o.discount ? `<div><span>Discount</span><span>− ${SH.money2(o.discount)}</span></div>` : ''}
              <div><span>Tax</span><span>${SH.money2(o.tax)}</span></div>
              ${o.delivery_fee ? `<div><span>Delivery</span><span>${SH.money2(o.delivery_fee)}</span></div>` : ''}
              <div class="grand"><span>Total</span><span>${SH.money2(o.total)}</span></div>
            </div>
            <div style="display:flex;gap:10px;margin-top:22px;flex-wrap:wrap">
              <a class="btn btn-outline btn-sm" href="/track.html?order=${encodeURIComponent(o.order_number)}&phone=${encodeURIComponent(customer?.phone || '')}">Track order</a>
              <button class="btn btn-gold btn-sm" data-modal-reorder="${o.id}">Order again</button>
            </div>
          </div>`, 'product-detail-modal');
        const wrap = document.getElementById('shModal');
        const rb = wrap.querySelector('[data-modal-reorder]');
        if (rb) rb.addEventListener('click', () => reorder(o.id));
      } catch (err) { SH.toast(err.message, 'error'); }
    }));
    container.querySelectorAll('[data-reorder]').forEach((b) => b.addEventListener('click', () => reorder(b.dataset.reorder)));
  }

  async function reorder(id) {
    try {
      const r = await SH.api(`/api/customer/orders/${id}/reorder`, { method: 'POST' });
      if (!r.items.length) { SH.toast('These dishes are no longer available.', 'error'); return; }
      let added = 0;
      r.items.forEach((i) => {
        if (!i.available) return;
        SH.cart.add(
          { id: i.product_id, name: i.name, price: i.price, image: i.image },
          i.qty,
          [],
          i.addons?.names || [],
          i.addons?.extra || 0,
          i.notes || ''
        );
        added++;
      });
      if (!added) { SH.toast('These dishes are currently unavailable.', 'error'); return; }
      if (!r.available) SH.toast('Some unavailable items were skipped.', 'info');
      SH.closeModal();
      setTimeout(() => { window.location.href = '/cart.html'; }, 500);
    } catch (err) { SH.toast(err.message, 'error'); }
  }

  function renderOverview() {
    const active = orders.filter((o) => !['completed', 'cancelled'].includes(o.status)).length;
    const spent = orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + Number(o.total), 0);
    document.getElementById('accountStats').innerHTML = `
      <div class="account-stat"><strong>${orders.length}</strong><span>Total orders</span></div>
      <div class="account-stat"><strong>${active}</strong><span>Active now</span></div>
      <div class="account-stat"><strong>${Number(customer?.loyalty_points || 0)}</strong><span>Loyalty points</span></div>`;
    const recent = document.getElementById('recentOrders');
    if (!orders.length) {
      recent.innerHTML = `<div class="menu-empty" style="padding:50px 20px">${icon('receipt')}<h3>No orders yet</h3><p>Your first Saffron House order is waiting to be made.</p><a href="/menu.html" class="btn btn-gold btn-sm" style="margin-top:16px">Browse the menu</a></div>`;
    } else {
      recent.innerHTML = orders.slice(0, 3).map(orderCard).join('');
      bindOrderActions(recent);
    }
    SH.icons();
  }

  function renderOrders() {
    const list = document.getElementById('orderList');
    document.getElementById('ordersCount').textContent = `${orders.length} order${orders.length === 1 ? '' : 's'} · ${SH.money2(orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + Number(o.total), 0))} lifetime`;
    if (!orders.length) {
      list.innerHTML = `<div class="menu-empty">${icon('receipt')}<h3>No orders yet</h3><p>When you order, everything will live here.</p></div>`;
      SH.icons();
      return;
    }
    list.innerHTML = orders.map(orderCard).join('');
    bindOrderActions(list);
    SH.icons();
  }

  // ── Addresses ──
  const addrForm = document.getElementById('addressForm');

  function renderAddresses() {
    const list = document.getElementById('addressList');
    if (!addresses.length) {
      list.innerHTML = '<p style="color:var(--muted);font-size:13px">No saved addresses yet. Add one below for faster checkout.</p>';
      return;
    }
    list.innerHTML = addresses.map((a) => `
      <div class="saved-address ${a.is_default ? 'default' : ''}">
        <div>
          <h4>${SH.esc(a.label)} ${a.is_default ? '<span class="tag gold" style="margin-left:6px">Default</span>' : ''}</h4>
          <p>${SH.esc(a.address)}<br>${SH.esc(a.city || 'Lahore')}${a.phone ? ` · ${SH.esc(a.phone)}` : ''}</p>
        </div>
        <div class="address-actions">
          ${a.is_default ? '' : `<button class="btn btn-outline btn-xs" data-default-address="${a.id}">Set default</button>`}
          <button class="btn btn-ghost btn-xs" data-edit-address="${a.id}" aria-label="Edit address">${icon('pencil')}</button>
          <button class="btn btn-ghost btn-xs" data-delete-address="${a.id}" aria-label="Delete address">${icon('trash-2')}</button>
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-edit-address]').forEach((b) => b.addEventListener('click', () => {
      const a = addresses.find((x) => x.id === Number(b.dataset.editAddress));
      if (!a) return;
      document.getElementById('addressId').value = a.id;
      document.getElementById('addrLabel').value = a.label || '';
      document.getElementById('addrPhone').value = a.phone || '';
      document.getElementById('addrAddress').value = a.address || '';
      document.getElementById('addrCity').value = a.city || 'Lahore';
      document.getElementById('addrDefault').checked = !!a.is_default;
      document.getElementById('addressFormTitle').textContent = 'Edit address';
      document.getElementById('addressSubmit').textContent = 'Update address';
      document.getElementById('addressCancel').style.display = '';
      addrForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    list.querySelectorAll('[data-delete-address]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this saved address?')) return;
      try {
        await SH.api(`/api/customer/addresses/${b.dataset.deleteAddress}`, { method: 'DELETE' });
        addresses = addresses.filter((x) => x.id !== Number(b.dataset.deleteAddress));
        renderAddresses();
        SH.toast('Address removed.', 'success');
      } catch (err) { SH.toast(err.message, 'error'); }
    }));
    list.querySelectorAll('[data-default-address]').forEach((b) => b.addEventListener('click', async () => {
      const a = addresses.find((x) => x.id === Number(b.dataset.defaultAddress));
      try {
        await SH.api(`/api/customer/addresses/${a.id}`, {
          method: 'PUT',
          body: { label: a.label, address: a.address, city: a.city, phone: a.phone, is_default: true }
        });
        addresses = addresses.map((x) => ({ ...x, is_default: x.id === a.id ? 1 : 0 }));
        renderAddresses();
        SH.toast('Default address updated.', 'success');
      } catch (err) { SH.toast(err.message, 'error'); }
    }));
    SH.icons();
  }

  function resetAddressForm() {
    addrForm.reset();
    document.getElementById('addressId').value = '';
    document.getElementById('addrCity').value = 'Lahore';
    document.getElementById('addressFormTitle').textContent = 'Add a new address';
    document.getElementById('addressSubmit').textContent = 'Save address';
    document.getElementById('addressCancel').style.display = 'none';
    document.getElementById('addressError').classList.remove('show');
  }

  addrForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('addressError');
    err.classList.remove('show');
    const id = document.getElementById('addressId').value;
    const body = {
      label: document.getElementById('addrLabel').value.trim() || 'Home',
      phone: document.getElementById('addrPhone').value.trim(),
      address: document.getElementById('addrAddress').value.trim(),
      city: document.getElementById('addrCity').value.trim() || 'Lahore',
      is_default: document.getElementById('addrDefault').checked
    };
    if (body.address.length < 10) { err.textContent = 'Please enter a complete address.'; err.classList.add('show'); return; }
    try {
      const r = await SH.api(id ? `/api/customer/addresses/${id}` : '/api/customer/addresses', {
        method: id ? 'PUT' : 'POST', body
      });
      if (id) addresses = addresses.map((a) => a.id === Number(id) ? r.address : (body.is_default ? { ...a, is_default: 0 } : a));
      else {
        if (body.is_default) addresses = addresses.map((a) => ({ ...a, is_default: 0 }));
        addresses.push(r.address);
      }
      resetAddressForm();
      renderAddresses();
      SH.toast(id ? 'Address updated.' : 'Address saved.', 'success');
    } catch (ex) { err.textContent = ex.message; err.classList.add('show'); }
  });

  document.getElementById('addressCancel').addEventListener('click', resetAddressForm);

  // ── Profile ──
  function fillProfile() {
    document.getElementById('profileName').value = customer.name || '';
    document.getElementById('profilePhone').value = customer.phone || '';
    document.getElementById('profileAddress').value = customer.address || '';
    document.getElementById('profileCity').value = customer.city || 'Lahore';
    document.getElementById('profileEmail').value = customer.email || '';
  }

  document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('profileError');
    const ok = document.getElementById('profileSuccess');
    err.classList.remove('show'); ok.classList.remove('show');
    try {
      const r = await SH.api('/api/auth/customer/profile', {
        method: 'PUT',
        body: {
          name: document.getElementById('profileName').value.trim(),
          phone: document.getElementById('profilePhone').value.trim(),
          address: document.getElementById('profileAddress').value.trim(),
          city: document.getElementById('profileCity').value.trim()
        }
      });
      customer = r.customer;
      document.getElementById('accountName').textContent = customer.name;
      document.getElementById('firstName').textContent = customer.name.split(' ')[0];
      document.getElementById('accountAvatar').textContent = customer.name.charAt(0).toUpperCase();
      ok.classList.add('show');
      SH.toast('Your profile has been updated.', 'success');
    } catch (ex) { err.textContent = ex.message; err.classList.add('show'); }
  });

  // ── Password ──
  document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('passwordError');
    const ok = document.getElementById('passwordSuccess');
    err.classList.remove('show'); ok.classList.remove('show');
    const next = document.getElementById('newPassword').value;
    if (next !== document.getElementById('confirmPassword').value) {
      err.textContent = 'The new passwords do not match.'; err.classList.add('show'); return;
    }
    try {
      await SH.api('/api/auth/customer/password', {
        method: 'PUT',
        body: { current_password: document.getElementById('currentPassword').value, new_password: next }
      });
      e.currentTarget.reset();
      ok.classList.add('show');
      SH.toast('Your password has been changed.', 'success');
    } catch (ex) { err.textContent = ex.message; err.classList.add('show'); }
  });

  document.addEventListener('DOMContentLoaded', async () => {
    bindAuth();
    bindPanels();
    await loadAccount();
  });
})();
