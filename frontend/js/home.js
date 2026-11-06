/* ==========================================================================
   Saffron House — homepage
   ========================================================================== */
(function () {
  'use strict';
  const SH = window.SH;

  const featuredGrid = document.getElementById('featuredGrid');
  const slider = document.getElementById('testimonialSlider');
  const dots = document.getElementById('testimonialDots');

  function renderFeatured(products) {
    if (!featuredGrid) return;
    const picks = products
      .filter((p) => p.available)
      .sort((a, b) => (Number(b.is_featured) - Number(a.is_featured)) || (Number(b.is_popular) - Number(a.is_popular)))
      .slice(0, 6);
    if (!picks.length) {
      featuredGrid.innerHTML = '<p style="color:var(--muted)">Our menu is being updated. Please check back shortly.</p>';
      return;
    }
    featuredGrid.innerHTML = picks.map((p) => SH.productCardHTML(p)).join('');
    picks.forEach((p, i) => {
      const card = featuredGrid.querySelector(`[data-product-id="${p.id}"]`);
      if (card) SH.bindProductCard(card, p);
      if (card) card.setAttribute('data-reveal', ''), card.setAttribute('data-reveal-delay', String(i % 3));
    });
    SH.icons();
    SH.initReveal();
  }

  function renderTestimonials(items) {
    if (!slider || !items.length) return;
    slider.innerHTML = items.map((t, i) => `
      <div class="testi-slide ${i === 0 ? 'active' : ''}" data-slide="${i}">
        <blockquote>“${SH.esc(t.text)}”</blockquote>
        <div class="testi-person">
          <span class="testi-avatar">${SH.esc((t.name || 'G').charAt(0))}</span>
          <div><strong>${SH.esc(t.name)}</strong><span>${SH.esc(t.role || 'Guest')}</span></div>
        </div>
      </div>`).join('');
    if (dots) {
      dots.innerHTML = items.map((_, i) => `<button class="testi-dot ${i === 0 ? 'active' : ''}" data-dot="${i}" aria-label="Testimonial ${i + 1}"></button>`).join('');
    }

    let current = 0;
    let timer;
    const show = (idx) => {
      current = (idx + items.length) % items.length;
      SH.qsa('.testi-slide', slider).forEach((el, i) => el.classList.toggle('active', i === current));
      SH.qsa('.testi-dot', dots).forEach((el, i) => el.classList.toggle('active', i === current));
    };
    const start = () => { clearInterval(timer); timer = setInterval(() => show(current + 1), 6500); };
    if (dots) SH.qsa('[data-dot]', dots).forEach((b) => b.addEventListener('click', () => { show(Number(b.dataset.dot)); start(); }));
    start();
  }

  function bindReservation() {
    const form = document.getElementById('reserveForm');
    if (!form) return;
    const dateInput = form.querySelector('#rDate');
    if (dateInput) dateInput.min = new Date().toISOString().slice(0, 10);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('reserveError');
      const btn = form.querySelector('button[type="submit"]');
      errEl.classList.remove('show');
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const data = Object.fromEntries(new FormData(form).entries());
      btn.disabled = true;
      const label = btn.innerHTML;
      btn.innerHTML = '<span class="spinner"></span> Sending request…';
      try {
        const r = await SH.api('/api/reservations', { method: 'POST', body: data });
        form.style.display = 'none';
        const ok = document.getElementById('reserveSuccess');
        ok.style.display = 'block';
        document.getElementById('reserveSuccessText').textContent =
          `${r.reservation.code} · ${r.reservation.date} at ${r.reservation.time} for ${r.reservation.guests} guest${r.reservation.guests > 1 ? 's' : ''}. ${r.reservation.notice || ''}`;
        SH.toast('Our team will confirm your table shortly.', 'success', 'Reservation requested');
        SH.icons();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.add('show');
      } finally {
        btn.disabled = false;
        btn.innerHTML = label;
        SH.icons();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    // Reveal any static cards that are already marked
    SH.initReveal();
    const site = await SH.loadSite();
    renderFeatured(site.products || []);
    renderTestimonials(site.testimonials || []);
    bindReservation();
    SH.icons();
  });
})();
