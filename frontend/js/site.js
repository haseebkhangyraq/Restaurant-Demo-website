/* ==========================================================================
   Saffron House — shared customer-site runtime
   ========================================================================== */
(function () {
  'use strict';

  const SH = (window.SH = window.SH || {});
  const CART_KEY = 'saffron_cart_v2';
  const SETTINGS_KEY = 'saffron_settings_v1';
  const COUPON_KEY = 'saffron_coupon_v1';

  // ── Utilities ──
  SH.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  SH.money = (n) => {
    const symbol = SH.settings?.currency_symbol || 'Rs.';
    return `${symbol} ${Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
  };
  SH.money2 = (n) => {
    const symbol = SH.settings?.currency_symbol || 'Rs.';
    return `${symbol} ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  SH.date = (s) => s ? new Date(String(s).replace(' ', 'T')).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  SH.time = (s) => s ? new Date(String(s).replace(' ', 'T')).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' }) : '—';
  SH.icons = () => { if (window.lucide) window.lucide.createIcons(); };
  SH.debounce = (fn, ms = 250) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };
  SH.qs = (s, el = document) => el.querySelector(s);
  SH.qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

  SH.api = async (path, options = {}) => {
    const opts = { credentials: 'same-origin', ...options };
    if (opts.body && !(opts.body instanceof FormData)) {
      opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
      if (typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) data = await res.json().catch(() => null);
    else data = await res.text().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  };

  // ── Toasts ──
  SH.toast = (message, type = 'info', title = '') => {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    const icon = type === 'success' ? 'check-circle-2' : type === 'error' ? 'alert-circle' : 'info';
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i data-lucide="${icon}"></i><div>${title ? `<strong>${SH.esc(title)}</strong>` : ''}<span>${SH.esc(message)}</span></div>`;
    stack.appendChild(el);
    SH.icons();
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(10px)'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 320); }, 4200);
  };

  // ── Settings (cached) ──
  SH.settings = (() => {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (_) { return null; }
  })();
  let sitePromise = null;
  SH.loadSite = () => {
    if (sitePromise) return sitePromise;
    sitePromise = SH.api('/api/site').then((data) => {
      SH.settings = data.settings;
      SH.site = data;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(data.settings));
      return data;
    }).catch(() => ({ settings: SH.settings || {}, categories: [], products: [] }));
    return sitePromise;
  };

  // ── Cart ──
  const readCart = () => {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch (_) { return []; }
  };
  const writeCart = (items) => {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    SH.updateCartUI();
    document.dispatchEvent(new CustomEvent('cart:updated', { detail: { items } }));
  };
  SH.cart = {
    get: readCart,
    count: () => readCart().reduce((s, i) => s + i.qty, 0),
    subtotal: () => readCart().reduce((s, i) => s + i.price * i.qty, 0),
    add(product, qty = 1, addonIds = [], addonNames = [], addonTotal = 0, notes = '') {
      const items = readCart();
      const key = `${product.id}-${[...addonIds].sort((a, b) => a - b).join('.')}-${notes.trim()}`;
      const existing = items.find((i) => i.key === key);
      if (existing) existing.qty = Math.min(99, existing.qty + qty);
      else items.push({
        key,
        product_id: product.id,
        name: product.name,
        image: product.image,
        price: Number(product.price) + Number(addonTotal || 0),
        base_price: Number(product.price),
        qty: Math.max(1, Math.min(99, qty)),
        addonIds: [...addonIds],
        addonNames: [...addonNames],
        addonTotal: Number(addonTotal || 0),
        notes: notes || ''
      });
      writeCart(items);
      SH.toast(`${product.name} added to your order`, 'success', 'Added to cart');
      return items;
    },
    setQty(key, qty) {
      let items = readCart();
      if (qty <= 0) items = items.filter((i) => i.key !== key);
      else items = items.map((i) => i.key === key ? { ...i, qty: Math.min(99, qty) } : i);
      writeCart(items);
    },
    remove(key) { writeCart(readCart().filter((i) => i.key !== key)); },
    clear() { writeCart([]); localStorage.removeItem(COUPON_KEY); },
    coupon: () => { try { return JSON.parse(localStorage.getItem(COUPON_KEY) || 'null'); } catch (_) { return null; } },
    setCoupon(c) { if (c) localStorage.setItem(COUPON_KEY, JSON.stringify(c)); else localStorage.removeItem(COUPON_KEY); SH.updateCartUI(); }
  };
  SH.updateCartUI = () => {
    const count = SH.cart.count();
    SH.qsa('[data-cart-count]').forEach((el) => {
      el.textContent = count;
      el.dataset.count = count;
      el.style.display = count > 0 ? 'grid' : 'none';
    });
    SH.qsa('[data-cart-subtotal]').forEach((el) => { el.textContent = SH.money(SH.cart.subtotal()); });
  };

  // ── Auth (customer) ──
  let mePromise = null;
  SH.customer = null;
  SH.getCustomer = (force = false) => {
    if (mePromise && !force) return mePromise;
    mePromise = SH.api('/api/auth/customer/me').then((d) => {
      SH.customer = d.customer;
      document.dispatchEvent(new CustomEvent('customer:loaded', { detail: d.customer }));
      return d.customer;
    }).catch(() => {
      SH.customer = null;
      return null;
    });
    return mePromise;
  };

  // ── Header / footer ──
  const NAV = [
    { label: 'Home', href: '/index.html' },
    { label: 'Menu', href: '/menu.html' },
    { label: 'Reservations', href: '/reservations.html' },
    { label: 'Gallery', href: '/gallery.html' },
    { label: 'Contact', href: '/contact.html' },
    { label: 'FAQ', href: '/faq.html' }
  ];

  function headerHTML(active) {
    const mode = document.body.dataset.header || 'overlay';
    const cls = mode === 'light' ? 'light-page' : mode === 'solid' ? 'solid' : '';
    return `
    <header class="site-header ${cls}" id="siteHeader">
      <div class="header-inner">
        <a href="/index.html" class="brand" aria-label="Saffron House home">
          <span class="brand-mark">SH</span>
          <span class="brand-text"><span class="brand-name">Saffron House</span><span class="brand-sub">Modern Pakistani Grill</span></span>
        </a>
        <nav class="nav" aria-label="Primary">
          ${NAV.map((n) => `<a class="nav-link ${n.label === active ? 'active' : ''}" href="${n.href}">${n.label}</a>`).join('')}
        </nav>
        <div class="header-actions">
          <a href="/account.html" class="nav-icon-btn" aria-label="My account" title="My account"><i data-lucide="user"></i></a>
          <a href="/cart.html" class="nav-icon-btn" aria-label="View cart" title="View cart">
            <i data-lucide="shopping-bag"></i><span class="cart-badge" data-cart-count>0</span>
          </a>
          <a href="/reservations.html" class="btn btn-gold btn-sm header-cta">Book a table</a>
          <button class="nav-icon-btn menu-toggle" id="menuToggle" aria-label="Open menu" aria-expanded="false"><i data-lucide="menu"></i></button>
        </div>
      </div>
    </header>
    <div class="mobile-nav" id="mobileNav">
      ${NAV.map((n) => `<a href="${n.href}">${n.label}</a>`).join('')}
      <a href="/account.html">My account</a>
      <a href="/cart.html">Cart (${SH.cart.count()})</a>
      <div class="mobile-contact">
        <p style="font-family:var(--font-alt);font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--gold-2);margin-bottom:10px">Reservations</p>
        <a href="tel:${(SH.settings?.phone || '').replace(/\s/g, '')}">${SH.esc(SH.settings?.phone || '+92 42 3577 8899')}</a>
        <p style="margin-top:14px">${SH.esc(SH.settings?.address || '42-C, MM Alam Road, Gulberg III, Lahore')}</p>
      </div>
    </div>`;
  }

  function footerHTML() {
    const s = SH.settings || {};
    return `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <a href="/index.html" class="brand">
              <span class="brand-mark">SH</span>
              <span class="brand-text"><span class="brand-name">Saffron House</span><span class="brand-sub">Modern Pakistani Grill</span></span>
            </a>
            <p>A modern grill and kitchen rooted in the flavours of Pakistan. Live fire, seasonal produce and generous hospitality — since 2018.</p>
            <div class="footer-socials">
              <a href="#" aria-label="Instagram"><i data-lucide="instagram"></i></a>
              <a href="#" aria-label="Facebook"><i data-lucide="facebook"></i></a>
              <a href="#" aria-label="X"><i data-lucide="twitter"></i></a>
              <a href="#" aria-label="YouTube"><i data-lucide="youtube"></i></a>
            </div>
          </div>
          <div class="footer-col">
            <h4>Explore</h4>
            <a href="/menu.html">Our menu</a>
            <a href="/reservations.html">Reservations</a>
            <a href="/gallery.html">Gallery</a>
            <a href="/index.html#story">Our story</a>
            <a href="/faq.html">FAQs</a>
          </div>
          <div class="footer-col">
            <h4>Visit</h4>
            <a href="/contact.html">${SH.esc(s.address || '42-C, MM Alam Road, Gulberg III, Lahore')}</a>
            <a href="tel:${(s.phone || '').replace(/\s/g, '')}">${SH.esc(s.phone || '+92 42 3577 8899')}</a>
            <a href="mailto:${SH.esc(s.email || 'hello@saffronhouse.pk')}">${SH.esc(s.email || 'hello@saffronhouse.pk')}</a>
            <a href="/reservations.html">Mon – Sun · 12pm – late</a>
          </div>
          <div class="footer-col footer-news">
            <h4>The Saffron Letter</h4>
            <p>Seasonal menus, chef's tables and quiet openings — a note from our kitchen, once a month.</p>
            <form class="newsletter" id="newsletterForm">
              <input type="email" placeholder="Your email address" required aria-label="Email address">
              <button type="submit" aria-label="Subscribe"><i data-lucide="arrow-right"></i></button>
            </form>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© <span data-year></span> Saffron House. All rights reserved.</span>
          <span>Lahore, Pakistan · Crafted for the table</span>
          <a href="/admin" target="_blank" rel="noopener">Team login</a>
        </div>
      </div>
    </footer>`;
  }

  SH.renderChrome = (active) => {
    const headerSlot = document.getElementById('site-header');
    const footerSlot = document.getElementById('site-footer');
    if (headerSlot) headerSlot.innerHTML = headerHTML(active);
    if (footerSlot) footerSlot.innerHTML = footerHTML();
    SH.qsa('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
    SH.updateCartUI();
    SH.icons();

    const toggle = document.getElementById('menuToggle');
    const mobile = document.getElementById('mobileNav');
    if (toggle && mobile) {
      toggle.addEventListener('click', () => {
        const open = mobile.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
        toggle.innerHTML = `<i data-lucide="${open ? 'x' : 'menu'}"></i>`;
        document.body.classList.toggle('no-scroll', open);
        SH.icons();
      });
      mobile.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => {
        mobile.classList.remove('open');
        document.body.classList.remove('no-scroll');
      }));
    }

    const header = document.getElementById('siteHeader');
    if (header && !header.classList.contains('solid') && !header.classList.contains('light-page')) {
      const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 50);
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
    }

    const news = document.getElementById('newsletterForm');
    if (news) {
      news.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = news.querySelector('input');
        try {
          const r = await SH.api('/api/newsletter', { method: 'POST', body: { email: input.value } });
          input.value = '';
          SH.toast(r.message, 'success', 'Subscribed');
        } catch (err) { SH.toast(err.message, 'error'); }
      });
    }
  };

  // ── Reveal animations ──
  SH.initReveal = () => {
    if (!('IntersectionObserver' in window)) {
      SH.qsa('[data-reveal]').forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    SH.qsa('[data-reveal]').forEach((el) => io.observe(el));
  };

  // ── Counters ──
  SH.initCounters = () => {
    SH.qsa('[data-count]').forEach((el) => {
      const target = Number(el.dataset.count);
      const suffix = el.dataset.suffix || '';
      const duration = 1400;
      const start = performance.now();
      const tick = (t) => {
        const p = Math.min(1, (t - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased).toLocaleString() + suffix;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  };

  // ── Modal ──
  SH.openModal = (html, cls = '') => {
    SH.closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.id = 'shModal';
    wrap.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(wrap);
    document.body.classList.add('no-scroll');
    requestAnimationFrame(() => wrap.classList.add('open'));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) SH.closeModal(); });
    wrap.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', SH.closeModal));
    const onKey = (e) => { if (e.key === 'Escape') SH.closeModal(); };
    document.addEventListener('keydown', onKey);
    wrap._keyHandler = onKey;
    SH.icons();
    return wrap;
  };
  SH.closeModal = () => {
    const wrap = document.getElementById('shModal');
    if (!wrap) return;
    if (wrap._keyHandler) document.removeEventListener('keydown', wrap._keyHandler);
    wrap.classList.remove('open');
    document.body.classList.remove('no-scroll');
    setTimeout(() => wrap.remove(), 320);
  };

  // ── GSAP flourishes (optional, progressive enhancement) ──
  SH.initMotion = () => {
    if (!window.gsap || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);
    if (window.ScrollTrigger) {
      SH.qsa('.experience img.bg, .page-hero img.bg').forEach((img) => {
        gsap.to(img, { yPercent: 12, ease: 'none', scrollTrigger: { trigger: img.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } });
      });
      SH.qsa('.story-img-main, .reserve-img img').forEach((img) => {
        gsap.fromTo(img, { yPercent: -4 }, { yPercent: 4, ease: 'none', scrollTrigger: { trigger: img, start: 'top bottom', end: 'bottom top', scrub: true } });
      });
    }
  };

  // ── Global boot ──
  document.addEventListener('DOMContentLoaded', async () => {
    const active = document.body.dataset.nav || '';
    SH.renderChrome(active);
    SH.initReveal();
    SH.initCounters();
    SH.initMotion();
    SH.updateCartUI();
    SH.getCustomer().catch(() => {});
    SH.loadSite().then(() => {
      const s = SH.settings || {};
      // Refresh chrome once real settings arrive (address/phone may differ)
      if (document.getElementById('site-header')) SH.renderChrome(active);
      SH.qsa('[data-open-status]').forEach((el) => { el.textContent = 'Open today · 12pm – late'; });
    });
    document.addEventListener('cart:updated', SH.updateCartUI);
  });
})();
