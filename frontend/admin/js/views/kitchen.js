/* ==========================================================================
   Admin — Kitchen Display (KDS)
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;

  A.views.kitchen = async function (view) {
    let timer = null;
    let ticker = null;
    let destroyed = false;
    let orders = [];
    let counts = { pending: 0, preparing: 0, ready: 0 };
    let lastSync = null;

    view.innerHTML = `
      <div class="view-head">
        <div class="view-head-copy">
          <h2>Kitchen pass</h2>
          <p>Every ticket from the floor, live. Start, finish and hand over dishes without leaving the pass.</p>
        </div>
        <div class="view-head-actions">
          <span class="kds-live"><i></i> Live · <span id="kdsSync">connecting</span></span>
          <button class="btn btn-outline" id="kdsRefresh"><i data-lucide="refresh-cw"></i> Refresh</button>
          <a href="/kitchen" target="_blank" rel="noopener" class="btn btn-gold"><i data-lucide="maximize-2"></i> Full-screen KDS</a>
        </div>
      </div>

      <div class="kds-bar">
        <div class="table-legend">
          <span><i style="background:var(--amber)"></i> Awaiting start</span>
          <span><i style="background:var(--purple)"></i> In the pass</span>
          <span><i style="background:var(--green)"></i> Ready to serve</span>
        </div>
        <span class="muted small" id="kdsSummary">Loading tickets…</span>
      </div>

      <div class="kds-columns" id="kdsColumns">
        <div class="kds-col pending"><div class="kds-col-head"><h3><i></i> Awaiting</h3><b>0</b></div><div class="kds-empty">Loading…</div></div>
        <div class="kds-col preparing"><div class="kds-col-head"><h3><i></i> Preparing</h3><b>0</b></div><div class="kds-empty">Loading…</div></div>
        <div class="kds-col ready"><div class="kds-col-head"><h3><i></i> Ready</h3><b>0</b></div><div class="kds-empty">Loading…</div></div>
      </div>`;
    A.icons();

    const elapsed = (o) => {
      const d = A.parse(o.created_at);
      return d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000)) : (o.minutes_elapsed || 0);
    };
    const timeClass = (mins) => mins >= 20 ? 'late' : mins >= 10 ? 'warn' : '';

    function ticketHTML(o) {
      const mins = elapsed(o);
      return `<div class="kds-ticket ${o.status === 'preparing' ? 'preparing' : o.status === 'ready' ? 'ready' : 'pending'}" data-order="${o.id}">
        <div class="kds-ticket-head">
          <div><strong>${A.esc(o.order_number)}</strong><span>${o.type === 'dine-in' ? `Table ${A.esc(o.table_number || '—')}` : A.esc(A.typeLabel(o.type))} · ${A.esc(o.customer_name || 'Walk-in Guest')}</span></div>
          <span class="kds-time ${timeClass(mins)}" data-elapsed="${o.id}">${mins} min</span>
        </div>
        <div class="kds-items">
          ${(o.items || []).map((it) => `<div class="kds-item"><b>×${it.qty}</b><span>${A.esc(it.name)}${it.addons?.names?.length ? `<span class="kds-addons">+ ${it.addons.names.map(A.esc).join(', ')}</span>` : ''}${it.notes ? `<span class="kds-note">“${A.esc(it.notes)}”</span>` : ''}</span></div>`).join('')}
        </div>
        ${o.notes ? `<div class="kds-note" style="margin-top:5px">Order note: ${A.esc(o.notes)}</div>` : ''}
        <div class="kds-ticket-foot">
          ${o.status === 'ready'
            ? `<button class="btn btn-green btn-sm" data-advance="${o.id}" data-status="completed"><i data-lucide="check"></i> Handed over</button>`
            : `<button class="btn btn-gold btn-sm" data-advance="${o.id}" data-status="${o.status === 'preparing' ? 'ready' : 'preparing'}"><i data-lucide="${o.status === 'preparing' ? 'bell-ring' : 'flame'}"></i> ${o.status === 'preparing' ? 'Mark ready' : 'Start cooking'}</button>`}
        </div>
      </div>`;
    }

    function paint() {
      const cols = A.qs('#kdsColumns');
      if (!cols) return;
      const groups = {
        pending: orders.filter((o) => ['pending', 'confirmed'].includes(o.status)),
        preparing: orders.filter((o) => o.status === 'preparing'),
        ready: orders.filter((o) => o.status === 'ready')
      };
      cols.innerHTML = `
        <div class="kds-col pending">
          <div class="kds-col-head"><h3><i></i> Awaiting</h3><b>${groups.pending.length}</b></div>
          ${groups.pending.length ? groups.pending.map(ticketHTML).join('') : '<div class="kds-empty">No tickets waiting — the pass is clear.</div>'}
        </div>
        <div class="kds-col preparing">
          <div class="kds-col-head"><h3><i></i> Preparing</h3><b>${groups.preparing.length}</b></div>
          ${groups.preparing.length ? groups.preparing.map(ticketHTML).join('') : '<div class="kds-empty">Nothing on the range right now.</div>'}
        </div>
        <div class="kds-col ready">
          <div class="kds-col-head"><h3><i></i> Ready</h3><b>${groups.ready.length}</b></div>
          ${groups.ready.length ? groups.ready.map(ticketHTML).join('') : '<div class="kds-empty">No dishes waiting for pickup.</div>'}
        </div>`;
      A.qs('#kdsSummary').textContent = `${orders.length} live ticket${orders.length === 1 ? '' : 's'} · ${groups.pending.length} awaiting · ${groups.preparing.length} cooking · ${groups.ready.length} ready`;
      A.icons();
      A.qsa('[data-advance]').forEach((b) => b.addEventListener('click', async () => {
        A.busy(b, true, '');
        try {
          await A.api(`/orders/${b.dataset.advance}/status`, { method: 'PATCH', body: { status: b.dataset.status } });
          A.toast(`Ticket moved to ${A.statusLabel(b.dataset.status).toLowerCase()}.`, 'success');
          await load(true);
        } catch (err) { A.notifyError(err); A.busy(b, false); }
      }));
    }

    function tickTimers() {
      A.qsa('[data-elapsed]', view).forEach((el) => {
        const o = orders.find((x) => String(x.id) === el.dataset.elapsed);
        if (!o) return;
        const mins = elapsed(o);
        el.textContent = `${mins} min`;
        el.className = `kds-time ${timeClass(mins)}`;
      });
    }

    async function load(silent = false) {
      if (destroyed) return;
      try {
        const data = await A.api('/kitchen/orders');
        if (destroyed) return;
        orders = data.orders || [];
        counts = data.counts || counts;
        lastSync = new Date();
        A.qs('#kdsSync').textContent = `synced ${lastSync.toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
        paint();
      } catch (err) {
        if (destroyed) return;
        if (err.status === 401) return A.onUnauthorized();
        if (!silent) {
          A.qs('#kdsColumns').innerHTML = `<div class="card card-pad" style="grid-column:1/-1">${A.empty('Kitchen queue unavailable', err.message, 'alert-triangle')}</div>`;
          A.qs('#kdsSync').textContent = 'offline';
        }
      }
    }

    A.qs('#kdsRefresh').addEventListener('click', (e) => {
      A.busyEvent(e, true, '');
      load().finally(() => A.busyEvent(e, false));
    });

    await load();
    timer = setInterval(() => load(true), 15000);
    ticker = setInterval(tickTimers, 30000);
    return () => { destroyed = true; clearInterval(timer); clearInterval(ticker); };
  };
})();
