/* ==========================================================================
   Admin — Menu manager: products, categories, add-ons, coupons
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;
  const TABS = [['products', 'Dishes', 'utensils'], ['categories', 'Categories', 'layout-grid'], ['addons', 'Add-ons', 'plus-circle'], ['coupons', 'Coupons', 'ticket-percent']];

  A.views.menu = async function (view) {
    const state = { tab: 'products', data: null, coupons: [], search: '', category: 'all', availability: 'all', destroyed: false };

    view.innerHTML = `<div class="view-loading"><span class="spinner"></span><p>Setting the menu…</p></div>`;

    async function load() {
      try {
        const [menu, coupons] = await Promise.all([A.api('/menu'), A.api('/coupons').catch(() => ({ coupons: [] }))]);
        if (state.destroyed) return;
        state.data = menu; state.coupons = coupons.coupons || [];
        render();
      } catch (err) {
        if (state.destroyed) return;
        view.innerHTML = `<div class="card card-pad" style="max-width:560px;margin:9vh auto;text-align:center"><div class="confirm-icon"><i data-lucide="alert-triangle"></i></div><h2 style="font-family:var(--font-display);font-size:28px">Menu unavailable</h2><p class="muted small">${A.esc(err.message)}</p></div>`;
        A.icons();
      }
    }

    function render() {
      const d = state.data;
      const s = d.stats;
      const headAction = state.tab === 'products' ? `<button class="btn btn-gold" data-new-product><i data-lucide="plus"></i> New dish</button>`
        : state.tab === 'categories' ? `<button class="btn btn-gold" data-new-category><i data-lucide="plus"></i> New category</button>`
        : state.tab === 'addons' ? `<button class="btn btn-gold" data-new-addon><i data-lucide="plus"></i> New add-on</button>`
        : A.isManager() ? `<button class="btn btn-gold" data-new-coupon><i data-lucide="plus"></i> New coupon</button>` : '';
      view.innerHTML = `
        <div class="view-head">
          <div class="view-head-copy"><h2>Menu manager</h2><p>Dishes, categories, add-ons and promotions — changes go live on the website and POS immediately.</p></div>
          <div class="view-head-actions">${headAction}</div>
        </div>

        <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
          <div class="kpi"><span class="kpi-label">Dishes</span><span class="kpi-value">${s.total}</span><div class="kpi-meta"><span>${s.available} available now</span></div></div>
          <div class="kpi"><span class="kpi-label">Featured</span><span class="kpi-value">${s.featured}</span><div class="kpi-meta"><span>Shown on the homepage</span></div></div>
          <div class="kpi"><span class="kpi-label">Average price</span><span class="kpi-value">${A.money(s.avgPrice)}</span><div class="kpi-meta"><span>Across the full menu</span></div></div>
          <div class="kpi"><span class="kpi-label">Average margin</span><span class="kpi-value">${s.avgMargin}%</span><div class="kpi-meta"><span>Recipe-based food cost</span></div></div>
        </div>

        <div class="seg-tabs" id="menuTabs" style="margin-bottom:14px">
          ${TABS.map(([k, l, icon]) => `<button data-tab="${k}" class="${state.tab === k ? 'active' : ''}"><i data-lucide="${icon}" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"></i>${l}</button>`).join('')}
        </div>

        <div id="menuPanel"></div>`;
      A.icons();
      A.qs('#menuTabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]');
        if (!b) return;
        state.tab = b.dataset.tab;
        render();
      });
      A.qs('[data-new-product]')?.addEventListener('click', () => productForm(null));
      A.qs('[data-new-category]')?.addEventListener('click', () => categoryForm(null));
      A.qs('[data-new-addon]')?.addEventListener('click', () => addonForm(null));
      A.qs('[data-new-coupon]')?.addEventListener('click', () => couponForm(null));
      paintPanel();
    }

    function paintPanel() {
      const panel = A.qs('#menuPanel');
      if (!panel) return;
      if (state.tab === 'products') paintProducts(panel);
      if (state.tab === 'categories') paintCategories(panel);
      if (state.tab === 'addons') paintAddons(panel);
      if (state.tab === 'coupons') paintCoupons(panel);
      A.icons();
    }

    function filteredProducts() {
      const q = state.search.toLowerCase();
      return state.data.products.filter((p) => {
        if (state.category !== 'all' && String(p.category_id) !== String(state.category)) return false;
        if (state.availability === 'available' && !p.available) return false;
        if (state.availability === 'unavailable' && p.available) return false;
        if (!q) return true;
        return `${p.name} ${p.category_name || ''} ${p.description || ''}`.toLowerCase().includes(q);
      });
    }

    function paintProducts(panel) {
      panel.innerHTML = `
        <div class="filter-bar">
          <div class="search-box"><i data-lucide="search"></i><input type="search" id="menuSearch" placeholder="Search dishes…" value="${A.esc(state.search)}"></div>
          <select id="menuCatFilter"><option value="all">All categories</option>${state.data.categories.map((c) => `<option value="${c.id}" ${String(state.category) === String(c.id) ? 'selected' : ''}>${A.esc(c.name)}</option>`).join('')}</select>
          <select id="menuAvailFilter"><option value="all">All availability</option><option value="available" ${state.availability === 'available' ? 'selected' : ''}>Available</option><option value="unavailable" ${state.availability === 'unavailable' ? 'selected' : ''}>Unavailable</option></select>
          <span class="spacer"></span><span class="muted small">${filteredProducts().length} dish${filteredProducts().length === 1 ? '' : 'es'}</span>
        </div>
        <div class="menu-grid" id="productGrid">
          ${filteredProducts().map((p) => `<article class="menu-card ${p.available ? '' : 'menu-unavailable'}">
            <div class="menu-card-img">
              <img src="${A.img(p.image)}" alt="${A.esc(p.name)}" loading="lazy">
              <div class="menu-card-badges">${p.is_featured ? '<span class="badge" style="background:var(--gold);color:#fff">Featured</span>' : ''}${p.is_popular ? '<span class="badge neutral" style="background:rgba(255,255,255,.92)">Popular</span>' : ''}</div>
              <span class="menu-card-veg">${A.vegMark(p.is_veg)}</span>
            </div>
            <div class="menu-card-body">
              <h4>${A.esc(p.name)}</h4>
              <div class="menu-card-meta"><span>${A.esc(p.category_name || 'Uncategorised')}</span><span>${p.recipe_cost ? `cost ${A.money(p.recipe_cost)}` : 'no recipe'}</span></div>
              <div class="menu-card-price"><b>${A.money(p.price)}</b><span>${p.recipe_cost ? `${p.margin}% margin` : 'margin unknown'}</span></div>
              <div class="menu-card-actions">
                <button class="btn btn-xs btn-soft" data-toggle-product="${p.id}"><i data-lucide="${p.available ? 'eye-off' : 'eye'}"></i> ${p.available ? 'Hide' : 'Show'}</button>
                <button class="btn btn-xs btn-outline" data-edit-product="${p.id}"><i data-lucide="pencil"></i> Edit</button>
                <button class="btn btn-xs btn-danger-soft btn-icon" data-delete-product="${p.id}"><i data-lucide="trash-2"></i></button>
              </div>
            </div>
          </article>`).join('') || `<div style="grid-column:1/-1" class="card card-pad">${A.empty('No dishes match', 'Adjust the filters or add a new dish.', 'utensils')}</div>`}
        </div>`;
      const search = A.qs('#menuSearch', panel);
      search.addEventListener('input', A.debounce(() => {
        state.search = search.value.trim();
        const grid = A.qs('#productGrid', panel);
        const items = filteredProducts();
        if (grid) {
          grid.innerHTML = items.map(productCardHTML).join('') || `<div style="grid-column:1/-1" class="card card-pad">${A.empty('No dishes match', 'Adjust the filters or add a new dish.', 'utensils')}</div>`;
          A.icons(); bindProductActions();
        }
      }, 220));
      A.qs('#menuCatFilter', panel).addEventListener('change', (e) => { state.category = e.target.value; paintPanel(); });
      A.qs('#menuAvailFilter', panel).addEventListener('change', (e) => { state.availability = e.target.value; paintPanel(); });
      bindProductActions();
    }

    function productCardHTML(p) {
      return `<article class="menu-card ${p.available ? '' : 'menu-unavailable'}">
        <div class="menu-card-img">
          <img src="${A.img(p.image)}" alt="${A.esc(p.name)}" loading="lazy">
          <div class="menu-card-badges">${p.is_featured ? '<span class="badge" style="background:var(--gold);color:#fff">Featured</span>' : ''}${p.is_popular ? '<span class="badge neutral" style="background:rgba(255,255,255,.92)">Popular</span>' : ''}</div>
          <span class="menu-card-veg">${A.vegMark(p.is_veg)}</span>
        </div>
        <div class="menu-card-body">
          <h4>${A.esc(p.name)}</h4>
          <div class="menu-card-meta"><span>${A.esc(p.category_name || 'Uncategorised')}</span><span>${p.recipe_cost ? `cost ${A.money(p.recipe_cost)}` : 'no recipe'}</span></div>
          <div class="menu-card-price"><b>${A.money(p.price)}</b><span>${p.recipe_cost ? `${p.margin}% margin` : 'margin unknown'}</span></div>
          <div class="menu-card-actions">
            <button class="btn btn-xs btn-soft" data-toggle-product="${p.id}"><i data-lucide="${p.available ? 'eye-off' : 'eye'}"></i> ${p.available ? 'Hide' : 'Show'}</button>
            <button class="btn btn-xs btn-outline" data-edit-product="${p.id}"><i data-lucide="pencil"></i> Edit</button>
            <button class="btn btn-xs btn-danger-soft btn-icon" data-delete-product="${p.id}"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
      </article>`;
    }

    function bindProductActions() {
      A.qsa('[data-edit-product]').forEach((b) => b.addEventListener('click', () => productForm(state.data.products.find((p) => p.id === Number(b.dataset.editProduct)))));
      A.qsa('[data-toggle-product]').forEach((b) => b.addEventListener('click', async () => {
        const p = state.data.products.find((x) => x.id === Number(b.dataset.toggleProduct));
        if (!p) return;
        A.busy(b, true, '');
        try {
          const body = { ...p, available: !p.available, addon_ids: (p.addons || []).map((a) => a.id) };
          await A.api(`/products/${p.id}`, { method: 'PUT', body });
          A.toast(`${p.name} is now ${!p.available ? 'available' : 'hidden'}.`, 'success');
          await load();
        } catch (err) { A.notifyError(err); A.busy(b, false); }
      }));
      A.qsa('[data-delete-product]').forEach((b) => b.addEventListener('click', () => {
        const p = state.data.products.find((x) => x.id === Number(b.dataset.deleteProduct));
        if (!p) return;
        A.deleteConfirm(p.name, async () => {
          await A.api(`/products/${p.id}`, { method: 'DELETE' });
          A.toast('Dish removed from the menu.', 'success');
          await load();
        }, { title: 'Remove this dish?', message: 'It will disappear from the website and POS. Existing orders keep their history.' });
      }));
    }

    function productForm(product) {
      const isNew = !product;
      const p = product || { name: '', category_id: '', description: '', long_description: '', price: '', image: '', is_veg: 0, is_featured: 0, is_popular: 0, is_recommended: 0, available: 1, prep_time: 15, calories: '', rating: 4.5, addons: [] };
      const selectedAddons = new Set((p.addons || []).map((a) => a.id));
      const m = A.modal({
        title: isNew ? 'Add a new dish' : 'Edit dish',
        subtitle: isNew ? 'Create a menu item with price, image and modifiers.' : p.name,
        size: 'lg',
        body: `<form id="productForm" novalidate>
          <div class="form-section">
            <div class="form-grid">
              <label class="field full"><span>Dish name *</span><input name="name" value="${A.esc(p.name)}" required placeholder="e.g. Charcoal Lamb Chops"></label>
              <label class="field"><span>Category *</span><select name="category_id" required>${A.options(state.data.categories, p.category_id, 'id', 'name', 'Choose a category')}</select></label>
              <label class="field"><span>Selling price *</span><input name="price" type="number" min="0" step="1" value="${A.esc(p.price)}" required></label>
              <label class="field full"><span>Short description</span><input name="description" value="${A.esc(p.description)}" maxlength="300" placeholder="One line shown on the menu card"></label>
              <label class="field full"><span>Full description</span><textarea name="long_description" maxlength="2000" placeholder="Story, ingredients, provenance…">${A.esc(p.long_description || '')}</textarea></label>
            </div>
          </div>
          <div class="form-section">
            <h4><i data-lucide="image"></i> Photography</h4>
            <div class="file-drop">
              <img id="productImagePreview" src="${A.img(p.image)}" alt="">
              <div><strong>Menu photo</strong><span>JPG, PNG or WEBP · up to 6 MB · landscape works best</span></div>
              <label class="btn btn-soft btn-sm" style="margin-left:auto"><i data-lucide="upload"></i> Upload<input type="file" id="productImageFile" accept="image/*"></label>
            </div>
            <label class="field" style="margin-top:9px"><span>Or image URL</span><input name="image" id="productImageUrl" value="${A.esc(p.image || '')}" placeholder="/assets/images/dish.jpg"></label>
          </div>
          <div class="form-section">
            <h4><i data-lucide="sliders-horizontal"></i> Details</h4>
            <div class="form-grid three">
              <label class="field"><span>Prep time (min)</span><input name="prep_time" type="number" min="1" value="${p.prep_time || 15}"></label>
              <label class="field"><span>Calories</span><input name="calories" type="number" min="0" value="${p.calories || ''}"></label>
              <label class="field"><span>Rating</span><input name="rating" type="number" min="1" max="5" step="0.1" value="${p.rating || 4.5}"></label>
            </div>
            <div class="switch-grid" style="margin-top:13px">
              ${[['is_veg', 'Vegetarian'], ['is_featured', 'Featured on homepage'], ['is_popular', 'Popular badge'], ['is_recommended', 'Chef recommended'], ['available', 'Available to order']].map(([k, l]) => `<label class="switch"><input type="checkbox" name="${k}" ${p[k] ? 'checked' : ''}><span class="track"></span><span>${l}</span></label>`).join('')}
            </div>
          </div>
          <div class="form-section">
            <h4><i data-lucide="plus-circle"></i> Add-ons available with this dish</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;max-height:180px;overflow:auto;padding-right:4px">
              ${state.data.addons.map((a) => `<label class="switch" style="border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-size:10.5px"><input type="checkbox" data-addon-pick value="${a.id}" ${selectedAddons.has(a.id) ? 'checked' : ''}><span class="track"></span><span>${A.esc(a.name)} <span class="muted" style="font-size:9px">+${A.money(a.price)}</span></span></label>`).join('')}
            </div>
          </div>
        </form>`,
        footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-gold" data-save><i data-lucide="save"></i> ${isNew ? 'Create dish' : 'Save changes'}</button>`,
        onMount: (modal) => {
          let imageUrl = p.image || '';
          const fileInput = A.qs('#productImageFile', modal.body);
          fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            try {
              A.toast('Uploading image…', 'info');
              imageUrl = await A.uploadImage(file);
              A.qs('#productImageUrl', modal.body).value = imageUrl;
              A.qs('#productImagePreview', modal.body).src = imageUrl;
              A.toast('Image uploaded.', 'success');
            } catch (err) { A.notifyError(err); }
          });
          A.qs('[data-cancel]', modal.footer).addEventListener('click', modal.close);
          A.qs('[data-save]', modal.footer).addEventListener('click', async (e) => {
            const form = A.qs('#productForm', modal.body);
            if (!form.reportValidity()) return;
            const fd = A.formData(form);
            const payload = {
              ...fd,
              price: Number(fd.price),
              category_id: Number(fd.category_id),
              image: imageUrl || fd.image,
              is_veg: !!fd.is_veg, is_featured: !!fd.is_featured, is_popular: !!fd.is_popular,
              is_recommended: !!fd.is_recommended, available: !!fd.available,
              addon_ids: A.qsa('[data-addon-pick]:checked', modal.body).map((el) => Number(el.value))
            };
            A.busyEvent(e, true, 'Saving…');
            try {
              await A.api(isNew ? '/products' : `/products/${p.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
              A.toast(isNew ? 'Dish added to the menu.' : 'Dish updated.', 'success');
              modal.close();
              await load();
            } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
          });
        }
      });
    }

    function paintCategories(panel) {
      const cats = state.data.categories;
      panel.innerHTML = `<div class="category-grid">${cats.map((c) => {
        const count = state.data.products.filter((p) => p.category_id === c.id).length;
        return `<article class="category-card">
          <div class="category-card-img"><img src="${A.img(c.image)}" alt=""><span class="badge ${c.active ? 'active' : 'inactive'}">${c.active ? 'Active' : 'Hidden'}</span></div>
          <div class="category-card-body">
            <h4>${A.esc(c.name)}</h4>
            <p>${A.esc(c.description || 'No description yet.')}</p>
            <div class="category-card-foot">
              <span>${count} dish${count === 1 ? '' : 'es'} · sort ${c.sort_order}</span>
              <div class="row-actions">
                <button class="btn btn-xs btn-outline" data-edit-cat="${c.id}"><i data-lucide="pencil"></i></button>
                <button class="btn btn-xs btn-danger-soft btn-icon" data-delete-cat="${c.id}"><i data-lucide="trash-2"></i></button>
              </div>
            </div>
          </div>
        </article>`;
      }).join('') || `<div class="card card-pad">${A.empty('No categories', 'Create your first menu section.', 'layout-grid')}</div>`}</div>`;
      A.qsa('[data-edit-cat]', panel).forEach((b) => b.addEventListener('click', () => categoryForm(cats.find((c) => c.id === Number(b.dataset.editCat)))));
      A.qsa('[data-delete-cat]', panel).forEach((b) => b.addEventListener('click', () => {
        const c = cats.find((x) => x.id === Number(b.dataset.deleteCat));
        A.deleteConfirm(c.name, async () => {
          await A.api(`/categories/${c.id}`, { method: 'DELETE' });
          A.toast('Category deleted.', 'success'); await load();
        }, { title: 'Delete this category?', message: 'Categories can only be deleted once they contain no dishes.' });
      }));
    }

    function categoryForm(category) {
      const isNew = !category;
      const c = category || { name: '', description: '', image: '', active: 1, sort_order: state.data.categories.length + 1 };
      const m = A.modal({
        title: isNew ? 'New category' : 'Edit category', size: 'sm',
        body: `<form id="catForm">
          <div class="form-grid">
            <label class="field full"><span>Name *</span><input name="name" value="${A.esc(c.name)}" required placeholder="e.g. Desserts"></label>
            <label class="field full"><span>Description</span><textarea name="description" style="min-height:60px">${A.esc(c.description || '')}</textarea></label>
            <label class="field full"><span>Image URL</span><input name="image" value="${A.esc(c.image || '')}" placeholder="/assets/images/menu.jpg"></label>
            <label class="field"><span>Sort order</span><input name="sort_order" type="number" value="${c.sort_order || 0}"></label>
            <label class="switch" style="align-items:center;margin-top:20px"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}><span class="track"></span><span>Visible on site</span></label>
          </div>
        </form>`,
        footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-gold" data-save>${isNew ? 'Create category' : 'Save'}</button>`,
        onMount: (modal) => {
          A.qs('[data-cancel]', modal.footer).addEventListener('click', modal.close);
          A.qs('[data-save]', modal.footer).addEventListener('click', async (e) => {
            const form = A.qs('#catForm', modal.body);
            if (!form.reportValidity()) return;
            const fd = A.formData(form);
            A.busyEvent(e, true, 'Saving…');
            try {
              await A.api(isNew ? '/categories' : `/categories/${c.id}`, { method: isNew ? 'POST' : 'PUT', body: { ...fd, active: !!fd.active } });
              A.toast('Category saved.', 'success'); modal.close(); await load();
            } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
          });
        }
      });
    }

    function paintAddons(panel) {
      const addons = state.data.addons;
      panel.innerHTML = `<div class="table-card">
        <div class="table-toolbar"><div class="table-toolbar-left"><strong style="font-size:12px">${addons.length} add-ons</strong><span class="muted small">Extras guests can attach to dishes</span></div></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Add-on</th><th>Group</th><th class="num">Price</th><th>Attached to</th><th>Status</th><th class="actions">Actions</th></tr></thead><tbody>
          ${addons.map((a) => {
            const used = state.data.products.filter((p) => (p.addons || []).some((x) => x.id === a.id)).length;
            return `<tr><td class="strong">${A.esc(a.name)}</td><td><span class="badge neutral">${A.esc(a.group_name || 'Extras')}</span></td><td class="num">${A.money(a.price)}</td><td class="muted small">${used} dish${used === 1 ? '' : 'es'}</td><td>${A.badge(a.active ? 'active' : 'inactive')}</td>
              <td class="actions"><div class="row-actions"><button class="btn btn-xs btn-outline" data-edit-addon="${a.id}">Edit</button><button class="btn btn-xs btn-danger-soft btn-icon" data-delete-addon="${a.id}"><i data-lucide="trash-2"></i></button></div></td></tr>`;
          }).join('') || `<tr><td colspan="6">${A.empty('No add-ons', 'Create extras like extra cheese or a side salad.', 'plus-circle')}</td></tr>`}
        </tbody></table></div>
      </div>`;
      A.qsa('[data-edit-addon]', panel).forEach((b) => b.addEventListener('click', () => addonForm(addons.find((a) => a.id === Number(b.dataset.editAddon)))));
      A.qsa('[data-delete-addon]', panel).forEach((b) => b.addEventListener('click', () => {
        const a = addons.find((x) => x.id === Number(b.dataset.deleteAddon));
        A.deleteConfirm(a.name, async () => { await A.api(`/addons/${a.id}`, { method: 'DELETE' }); A.toast('Add-on deleted.', 'success'); await load(); });
      }));
    }

    function addonForm(addon) {
      const isNew = !addon;
      const a = addon || { name: '', price: '', group_name: 'Extras', active: 1 };
      const groups = [...new Set([...state.data.addons.map((x) => x.group_name || 'Extras'), 'Extras', 'Sides', 'Drinks', 'Desserts'])];
      const m = A.modal({
        title: isNew ? 'New add-on' : 'Edit add-on', size: 'sm',
        body: `<form id="addonForm"><div class="form-grid">
          <label class="field full"><span>Name *</span><input name="name" value="${A.esc(a.name)}" required placeholder="e.g. Extra cheese"></label>
          <label class="field"><span>Price *</span><input name="price" type="number" min="0" step="1" value="${A.esc(a.price)}" required></label>
          <label class="field"><span>Group</span><input name="group_name" value="${A.esc(a.group_name || 'Extras')}" list="addonGroups"><datalist id="addonGroups">${groups.map((g) => `<option value="${A.esc(g)}">`).join('')}</datalist></label>
          <label class="switch full" style="margin-top:5px"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}><span class="track"></span><span>Available to order</span></label>
        </div></form>`,
        footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-gold" data-save>${isNew ? 'Create add-on' : 'Save'}</button>`,
        onMount: (modal) => {
          A.qs('[data-cancel]', modal.footer).addEventListener('click', modal.close);
          A.qs('[data-save]', modal.footer).addEventListener('click', async (e) => {
            const form = A.qs('#addonForm', modal.body);
            if (!form.reportValidity()) return;
            const fd = A.formData(form);
            A.busyEvent(e, true, 'Saving…');
            try {
              await A.api(isNew ? '/addons' : `/addons/${a.id}`, { method: isNew ? 'POST' : 'PUT', body: { ...fd, price: Number(fd.price), active: !!fd.active } });
              A.toast('Add-on saved.', 'success'); modal.close(); await load();
            } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
          });
        }
      });
    }

    function paintCoupons(panel) {
      panel.innerHTML = `<div class="table-card">
        <div class="table-toolbar"><div class="table-toolbar-left"><strong style="font-size:12px">${state.coupons.length} coupons</strong><span class="muted small">Promotions used at checkout</span></div></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Code</th><th>Discount</th><th class="num">Min order</th><th class="num">Used</th><th>Expires</th><th>Status</th><th class="actions">Actions</th></tr></thead><tbody>
          ${state.coupons.map((c) => {
            const expired = c.expires_at && c.expires_at < A.today();
            return `<tr><td><span class="mono strong" style="font-size:11px">${A.esc(c.code)}</span></td>
              <td>${c.type === 'percent' ? `${c.value}%` : A.money(c.value)}${c.max_discount ? `<div class="muted" style="font-size:8.5px">max ${A.money(c.max_discount)}</div>` : ''}</td>
              <td class="num">${A.money(c.min_order)}</td><td class="num">${c.used_count}${c.usage_limit ? ` / ${c.usage_limit}` : ''}</td>
              <td class="small">${c.expires_at ? A.date(c.expires_at) : 'No expiry'}</td>
              <td>${expired ? '<span class="badge cancelled">Expired</span>' : A.badge(c.active ? 'active' : 'inactive')}</td>
              <td class="actions"><div class="row-actions">${A.isManager() ? `<button class="btn btn-xs btn-outline" data-edit-coupon="${c.id}">Edit</button><button class="btn btn-xs btn-danger-soft btn-icon" data-delete-coupon="${c.id}"><i data-lucide="trash-2"></i></button>` : '<span class="muted small">View only</span>'}</div></td></tr>`;
          }).join('') || `<tr><td colspan="7">${A.empty('No coupons', 'Create a promotion code for the website and POS.', 'ticket-percent')}</td></tr>`}
        </tbody></table></div>
      </div>`;
      A.qsa('[data-edit-coupon]', panel).forEach((b) => b.addEventListener('click', () => couponForm(state.coupons.find((c) => c.id === Number(b.dataset.editCoupon)))));
      A.qsa('[data-delete-coupon]', panel).forEach((b) => b.addEventListener('click', () => {
        const c = state.coupons.find((x) => x.id === Number(b.dataset.deleteCoupon));
        A.deleteConfirm(c.code, async () => { await A.api(`/coupons/${c.id}`, { method: 'DELETE' }); A.toast('Coupon deleted.', 'success'); await load(); });
      }));
    }

    function couponForm(coupon) {
      const isNew = !coupon;
      const c = coupon || { code: '', type: 'percent', value: '', min_order: 0, max_discount: '', usage_limit: '', expires_at: '', active: 1 };
      const m = A.modal({
        title: isNew ? 'New coupon' : 'Edit coupon', size: 'sm',
        body: `<form id="couponForm"><div class="form-grid">
          <label class="field full"><span>Code *</span><input name="code" value="${A.esc(c.code)}" ${isNew ? '' : 'disabled'} placeholder="SAFFRON10" style="text-transform:uppercase" required></label>
          <label class="field"><span>Type</span><select name="type" ${isNew ? '' : 'disabled'}><option value="percent" ${c.type === 'percent' ? 'selected' : ''}>Percentage</option><option value="fixed" ${c.type === 'fixed' ? 'selected' : ''}>Fixed amount</option></select></label>
          <label class="field"><span>Value *</span><input name="value" type="number" min="0" step="1" value="${A.esc(c.value)}" required></label>
          <label class="field"><span>Minimum order</span><input name="min_order" type="number" min="0" value="${c.min_order || 0}"></label>
          <label class="field"><span>Maximum discount</span><input name="max_discount" type="number" min="0" value="${c.max_discount || ''}" placeholder="No cap"></label>
          <label class="field"><span>Usage limit</span><input name="usage_limit" type="number" min="1" value="${c.usage_limit || ''}" placeholder="Unlimited"></label>
          <label class="field"><span>Expires</span><input name="expires_at" type="date" value="${c.expires_at || ''}"></label>
          <label class="switch full" style="margin-top:5px"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}><span class="track"></span><span>Active</span></label>
        </div></form>`,
        footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-gold" data-save>${isNew ? 'Create coupon' : 'Save'}</button>`,
        onMount: (modal) => {
          A.qs('[data-cancel]', modal.footer).addEventListener('click', modal.close);
          A.qs('[data-save]', modal.footer).addEventListener('click', async (e) => {
            const form = A.qs('#couponForm', modal.body);
            if (!form.reportValidity()) return;
            const fd = A.formData(form);
            A.busyEvent(e, true, 'Saving…');
            try {
              await A.api(isNew ? '/coupons' : `/coupons/${c.id}`, { method: isNew ? 'POST' : 'PUT', body: { ...fd, value: Number(fd.value), min_order: Number(fd.min_order), max_discount: fd.max_discount ? Number(fd.max_discount) : null, usage_limit: fd.usage_limit ? Number(fd.usage_limit) : null, active: !!fd.active } });
              A.toast('Coupon saved.', 'success'); modal.close(); await load();
            } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
          });
        }
      });
    }

    await load();
    return () => { state.destroyed = true; };
  };
})();
