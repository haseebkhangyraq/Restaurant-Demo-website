/* ==========================================================================
   Saffron House — menu browsing, search & filtering
   ========================================================================== */
(function () {
  'use strict';
  const SH = window.SH;
  const params = new URLSearchParams(window.location.search);

  const state = {
    products: [],
    categories: [],
    category: params.get('category') || 'all',
    search: params.get('q') || '',
    veg: params.get('veg') === '1',
    sort: params.get('sort') || 'recommended'
  };

  const grid = document.getElementById('menuGrid');
  const empty = document.getElementById('menuEmpty');
  const countEl = document.getElementById('menuCount');
  const chips = document.getElementById('categoryChips');
  const search = document.getElementById('menuSearch');
  const sort = document.getElementById('menuSort');
  const veg = document.getElementById('vegToggle');

  const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

  function syncURL() {
    const p = new URLSearchParams();
    if (state.category !== 'all') p.set('category', state.category);
    if (state.search) p.set('q', state.search);
    if (state.veg) p.set('veg', '1');
    if (state.sort !== 'recommended') p.set('sort', state.sort);
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }

  function filtered() {
    const q = state.search.trim().toLowerCase();
    let list = state.products.filter((p) => {
      if (state.veg && !p.is_veg) return false;
      if (state.category !== 'all' && p.category_slug !== state.category) return false;
      if (q) {
        const hay = `${p.name} ${p.description || ''} ${p.long_description || ''} ${p.category_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    switch (state.sort) {
      case 'price-asc': list = list.slice().sort((a, b) => a.price - b.price); break;
      case 'price-desc': list = list.slice().sort((a, b) => b.price - a.price); break;
      case 'name': list = list.slice().sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'rating': list = list.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0)); break;
      default: list = list.slice().sort((a, b) =>
        (Number(b.is_featured) - Number(a.is_featured)) ||
        (Number(b.is_popular) - Number(a.is_popular)) ||
        a.name.localeCompare(b.name));
    }
    return list;
  }

  function render() {
    const list = filtered();
    countEl.textContent = `${list.length} dish${list.length === 1 ? '' : 'es'}`;
    empty.style.display = list.length ? 'none' : 'block';
    grid.style.display = list.length ? 'grid' : 'none';
    grid.innerHTML = list.map((p) => SH.productCardHTML(p)).join('');
    list.forEach((p) => {
      const card = grid.querySelector(`[data-product-id="${p.id}"]`);
      if (card) SH.bindProductCard(card, p);
    });
    SH.icons();
    syncURL();
  }

  function renderChips() {
    const all = `<button class="chip ${state.category === 'all' ? 'active' : ''}" data-category="all">All dishes</button>`;
    const cats = state.categories.map((c) =>
      `<button class="chip ${state.category === c.slug ? 'active' : ''}" data-category="${SH.esc(c.slug)}">${SH.esc(c.name)}</button>`
    ).join('');
    chips.innerHTML = all + cats;
    chips.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
      state.category = b.dataset.category;
      renderChips();
      render();
    }));
  }

  function setVegUI() {
    veg.classList.toggle('active', state.veg);
    veg.setAttribute('aria-pressed', String(state.veg));
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const site = await SH.loadSite();
    state.products = site.products || [];
    state.categories = site.categories || [];
    if (state.category !== 'all' && !state.categories.some((c) => c.slug === state.category)) state.category = 'all';
    search.value = state.search;
    sort.value = state.sort;
    setVegUI();
    renderChips();
    render();

    search.addEventListener('input', SH.debounce(() => { state.search = search.value; render(); }, 180));
    sort.addEventListener('change', () => { state.sort = sort.value; render(); });
    veg.addEventListener('click', () => { state.veg = !state.veg; setVegUI(); render(); });
    document.getElementById('clearFilters').addEventListener('click', () => {
      state.search = ''; state.veg = false; state.category = 'all'; state.sort = 'recommended';
      search.value = ''; sort.value = 'recommended'; setVegUI(); renderChips(); render();
    });

    // Deep link: /menu.html?product=slug opens that dish
    const slug = params.get('product');
    if (slug) {
      const product = state.products.find((p) => p.slug === slug);
      if (product) setTimeout(() => SH.openProduct(product), 260);
    }
  });
})();
