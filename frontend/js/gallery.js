/* ==========================================================================
   Saffron House — gallery
   ========================================================================== */
(function () {
  'use strict';
  const SH = window.SH;
  let items = [];
  let filter = 'All';

  const grid = document.getElementById('galleryGrid');
  const filterEl = document.getElementById('galleryFilter');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');

  function render() {
    const list = filter === 'All' ? items : items.filter((i) => (i.category || 'Other') === filter);
    if (!list.length) {
      grid.innerHTML = '<p style="color:var(--muted);padding:40px 0">Photographs are being prepared. Please check back soon.</p>';
      return;
    }
    grid.innerHTML = list.map((i) => `
      <a class="gallery-item" href="${SH.esc(i.image)}" data-full="${SH.esc(i.image)}" data-title="${SH.esc(i.title || '')}">
        <img src="${SH.esc(i.image)}" alt="${SH.esc(i.title || 'Saffron House photograph')}" loading="lazy">
        <span class="gallery-cap">${SH.esc(i.title || '')}</span>
      </a>`).join('');
    grid.querySelectorAll('[data-full]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      openLightbox(a.dataset.full, a.dataset.title);
    }));
    SH.icons();
  }

  function renderFilters() {
    const cats = ['All', ...Array.from(new Set(items.map((i) => i.category || 'Other')))];
    filterEl.innerHTML = cats.map((c) => `<button class="chip ${c === filter ? 'active' : ''}" data-filter="${SH.esc(c)}">${SH.esc(c)}</button>`).join('');
    filterEl.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      filter = b.dataset.filter;
      renderFilters();
      render();
    }));
  }

  function openLightbox(src, title) {
    lightboxImg.src = src;
    lightboxImg.alt = title || 'Saffron House photograph';
    lightbox.classList.add('open');
    document.body.classList.add('no-scroll');
  }
  function closeLightbox() {
    lightbox.classList.remove('open');
    document.body.classList.remove('no-scroll');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox || e.target.closest('#lightboxClose')) closeLightbox(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

    const site = await SH.loadSite();
    items = site.gallery || [];
    renderFilters();
    render();
  });
})();
