/* ==========================================================================
   Saffron House — FAQ accordion
   ========================================================================== */
(function () {
  'use strict';
  const SH = window.SH;
  const list = document.getElementById('faqList');

  document.addEventListener('DOMContentLoaded', async () => {
    const site = await SH.loadSite();
    const faqs = site.faqs || [];
    if (!faqs.length) {
      list.innerHTML = '<p style="color:var(--muted);padding:30px 0">Please call us on +92 42 3577 8899 for any questions.</p>';
      return;
    }
    list.innerHTML = faqs.map((f, i) => `
      <div class="faq-item ${i === 0 ? 'open' : ''}">
        <button class="faq-q" aria-expanded="${i === 0}">${SH.esc(f.question)} <i data-lucide="plus"></i></button>
        <div class="faq-a"><p>${SH.esc(f.answer)}</p></div>
      </div>`).join('');

    list.querySelectorAll('.faq-q').forEach((btn) => btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const wasOpen = item.classList.contains('open');
      list.querySelectorAll('.faq-item').forEach((x) => {
        x.classList.remove('open');
        x.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
      });
      if (!wasOpen) {
        item.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    }));
    SH.icons();
  });
})();
