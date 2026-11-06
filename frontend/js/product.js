/* ==========================================================================
   Saffron House — shared product detail modal
   ========================================================================== */
(function () {
  'use strict';
  const SH = window.SH;
  if (!SH) return;

  const stars = (rating) => {
    const n = Math.round(Number(rating) || 0);
    return Array.from({ length: 5 }, (_, i) => `<i data-lucide="star" style="${i < n ? 'fill:var(--gold);stroke:none' : 'opacity:.25'}"></i>`).join('');
  };

  SH.openProduct = function (product) {
    const addons = Array.isArray(product.addons) ? product.addons : [];
    const groups = product.addon_groups || addons.reduce((acc, a) => {
      (acc[a.group_name || 'Extras'] = acc[a.group_name || 'Extras'] || []).push(a);
      return acc;
    }, {});

    const addonHTML = Object.keys(groups).map((group) => `
      <div class="addon-group">
        <h4>${SH.esc(group)} <span style="font-weight:400;letter-spacing:0;text-transform:none;color:var(--muted-2)">· optional</span></h4>
        ${groups[group].map((a) => `
          <label class="addon-option">
            <span class="ao-left">
              <input type="checkbox" name="addon" value="${a.id}" data-name="${SH.esc(a.name)}" data-price="${Number(a.price)}">
              <span>${SH.esc(a.name)}</span>
            </span>
            <b>+ ${SH.money(a.price)}</b>
          </label>`).join('')}
      </div>`).join('');

    const html = `
      <div class="product-modal-grid">
        <div class="product-modal-img">
          <img src="${SH.esc(product.image || '/assets/images/food-spread.jpg')}" alt="${SH.esc(product.name)}">
          <button class="modal-close" data-close-modal aria-label="Close"><i data-lucide="x"></i></button>
        </div>
        <div class="product-modal-body">
          <span class="dish-cat">${SH.esc(product.category_name || 'Saffron House')}</span>
          <h2>${SH.esc(product.name)}</h2>
          <div class="dish-rating" style="margin-bottom:6px">${stars(product.rating)} <span style="margin-left:4px">${Number(product.rating || 4.5).toFixed(1)} · ${product.is_veg ? 'Vegetarian' : 'Chef’s favourite'}</span></div>
          <p class="desc">${SH.esc(product.long_description || product.description || '')}</p>
          <div class="product-meta-row">
            <span><i data-lucide="clock"></i> ${Number(product.prep_time) || 20} min prep</span>
            ${product.calories ? `<span><i data-lucide="flame"></i> ${product.calories} kcal</span>` : ''}
            <span><i data-lucide="users"></i> Serves 1</span>
          </div>
          ${addonHTML}
          <div class="field" style="margin-top:18px">
            <label for="productNotes">Special instructions (optional)</label>
            <textarea id="productNotes" rows="2" maxlength="300" placeholder="Allergies, spice level, no onions…"></textarea>
          </div>
          <div class="qty-row">
            <div class="qty-control">
              <button type="button" data-qty="-1" aria-label="Decrease quantity"><i data-lucide="minus"></i></button>
              <input id="productQty" type="number" value="1" min="1" max="99" aria-label="Quantity">
              <button type="button" data-qty="1" aria-label="Increase quantity"><i data-lucide="plus"></i></button>
            </div>
            <span class="product-total" id="productTotal">${SH.money(product.price)}</span>
          </div>
          <button class="btn btn-gold btn-block" id="addToCartBtn">Add to order <i data-lucide="shopping-bag"></i></button>
          <p class="ingredient-note"><i data-lucide="info"></i> Cooked to order. Please tell us about any allergies — our kitchen handles nuts, dairy and gluten.</p>
        </div>
      </div>`;

    const wrap = SH.openModal(html);
    const qtyInput = wrap.querySelector('#productQty');
    const totalEl = wrap.querySelector('#productTotal');
    const recalc = () => {
      const qty = Math.max(1, Math.min(99, parseInt(qtyInput.value, 10) || 1));
      qtyInput.value = qty;
      const extras = SH.qsa('input[name="addon"]:checked', wrap).reduce((s, el) => s + Number(el.dataset.price), 0);
      totalEl.textContent = SH.money((Number(product.price) + extras) * qty);
    };

    wrap.querySelectorAll('[data-qty]').forEach((b) => b.addEventListener('click', () => {
      qtyInput.value = Math.max(1, Math.min(99, (parseInt(qtyInput.value, 10) || 1) + Number(b.dataset.qty)));
      recalc();
    }));
    qtyInput.addEventListener('input', recalc);
    wrap.querySelectorAll('input[name="addon"]').forEach((el) => el.addEventListener('change', recalc));

    wrap.querySelector('#addToCartBtn').addEventListener('click', () => {
      const chosen = SH.qsa('input[name="addon"]:checked', wrap);
      const ids = chosen.map((el) => Number(el.value));
      const names = chosen.map((el) => el.dataset.name);
      const addonTotal = chosen.reduce((s, el) => s + Number(el.dataset.price), 0);
      const notes = wrap.querySelector('#productNotes').value.trim();
      SH.cart.add(product, parseInt(qtyInput.value, 10) || 1, ids, names, addonTotal, notes);
      SH.closeModal();
    });

    SH.icons();
    recalc();
  };

  /** Small helper for cards: open the detail modal when a full product is available. */
  SH.bindProductCard = function (card, product) {
    card.querySelectorAll('[data-open-product]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        SH.openProduct(product);
      });
    });
  };

  SH.productCardHTML = function (product, opts = {}) {
    const tags = [];
    if (product.is_featured) tags.push('<span class="tag gold">Signature</span>');
    if (product.is_popular) tags.push('<span class="tag">Popular</span>');
    if (product.is_veg) tags.push('<span class="tag veg">Veg</span>');
    if (!product.available) tags.push('<span class="tag dark">Sold out</span>');
    return `
      <article class="menu-card ${product.available ? '' : 'unavailable'}" data-product-id="${product.id}">
        <div class="dish-media">
          <img src="${SH.esc(product.image || '/assets/images/food-spread.jpg')}" alt="${SH.esc(product.name)}" loading="lazy">
          <div class="dish-tags">${tags.join('')}</div>
          <span class="dish-price">${SH.money(product.price)}</span>
          ${product.available ? '' : '<div class="sold-out">Currently unavailable</div>'}
        </div>
        <div class="dish-body">
          <div class="dish-meta">
            <span class="dish-cat">${SH.esc(product.category_name || '')}</span>
            <span class="dish-rating"><i data-lucide="star"></i> ${Number(product.rating || 4.5).toFixed(1)}</span>
          </div>
          <h3>${SH.esc(product.name)}</h3>
          <p class="dish-desc">${SH.esc(product.description || '')}</p>
          <div class="dish-foot">
            <span class="prep"><i data-lucide="clock"></i> ${Number(product.prep_time) || 20} min ${opts.showCalories && product.calories ? `· ${product.calories} kcal` : ''}</span>
            <button class="add-btn" data-open-product aria-label="Add ${SH.esc(product.name)} to order" ${product.available ? '' : 'disabled'}>
              <i data-lucide="${product.available ? 'plus' : 'x'}"></i>
            </button>
          </div>
        </div>
      </article>`;
  };
})();
