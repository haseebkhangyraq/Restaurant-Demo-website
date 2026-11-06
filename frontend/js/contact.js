/* ==========================================================================
   Saffron House — contact
   ========================================================================== */
(function () {
  'use strict';
  const SH = window.SH;
  const form = document.getElementById('contactForm');
  const wrap = document.getElementById('contactFormWrap');
  const success = document.getElementById('contactSuccess');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('contactError');
    err.classList.remove('show');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const body = Object.fromEntries(new FormData(form).entries());
    if (body.message.trim().length < 10) {
      err.textContent = 'Please tell us a little more (at least 10 characters).'; err.classList.add('show'); return;
    }
    if (!body.email && !body.phone) {
      err.textContent = 'Please provide an email or phone number so we can reply.'; err.classList.add('show'); return;
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sending…';
    try {
      await SH.api('/api/contact', { method: 'POST', body });
      wrap.style.display = 'none';
      success.classList.add('show');
      SH.toast('Thank you — we will be in touch shortly.', 'success', 'Message sent');
      SH.icons();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Send message <i data-lucide="send"></i>';
      SH.icons();
    }
  });

  document.getElementById('newContactMessage').addEventListener('click', () => {
    form.reset();
    wrap.style.display = '';
    success.classList.remove('show');
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
})();
