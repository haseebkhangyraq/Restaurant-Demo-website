/* ==========================================================================
   Admin — Reservations
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;

  A.views.reservations = async function (view) {
    const state = { data: null, tables: [], status: 'all', date: '', search: '', destroyed: false };

    view.innerHTML = `<div class="view-loading"><span class="spinner"></span><p>Checking the reservation book…</p></div>`;

    async function load() {
      try {
        const qs = new URLSearchParams();
        if (state.status !== 'all') qs.set('status', state.status);
        if (state.date) qs.set('date', state.date);
        if (state.search) qs.set('search', state.search);
        const [data, tableData] = await Promise.all([A.api(`/reservations?${qs.toString()}`), A.api('/tables')]);
        if (state.destroyed) return;
        state.data = data;
        state.tables = tableData.tables || [];
        paint();
      } catch (err) {
        if (state.destroyed) return;
        view.innerHTML = `<div class="card card-pad" style="max-width:560px;margin:9vh auto;text-align:center"><div class="confirm-icon"><i data-lucide="alert-triangle"></i></div><h2 style="font-family:var(--font-display);font-size:28px">Reservations unavailable</h2><p class="muted small">${A.esc(err.message)}</p></div>`;
        A.icons();
      }
    }

    function paint() {
      const d = state.data;
      const c = d.counts || {};
      const today = A.today();
      const todays = d.reservations.filter((r) => r.date === today && ['pending', 'confirmed', 'seated'].includes(r.status));
      const upcoming = d.reservations.filter((r) => r.date >= today && ['pending', 'confirmed'].includes(r.status));
      view.innerHTML = `
        <div class="view-head">
          <div class="view-head-copy"><h2>Reservations</h2><p>Bookings from the website and phone, with table assignment and live seating status.</p></div>
          <div class="view-head-actions">
            <button class="btn btn-outline" id="resRefresh"><i data-lucide="refresh-cw"></i> Refresh</button>
            <button class="btn btn-gold" id="resAdd"><i data-lucide="calendar-plus"></i> New reservation</button>
          </div>
        </div>

        <div class="kpi-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:16px">
          <div class="kpi"><span class="kpi-label">Today’s bookings</span><span class="kpi-value">${todays.length}</span><div class="kpi-meta"><span>${todays.reduce((s, r) => s + Number(r.guests), 0)} covers expected</span></div></div>
          <div class="kpi"><span class="kpi-label">Pending</span><span class="kpi-value" style="color:var(--amber)">${c.pending || 0}</span><div class="kpi-meta"><span>Awaiting confirmation</span></div></div>
          <div class="kpi"><span class="kpi-label">Confirmed</span><span class="kpi-value" style="color:var(--green)">${c.confirmed || 0}</span><div class="kpi-meta"><span>Table held</span></div></div>
          <div class="kpi"><span class="kpi-label">Seated</span><span class="kpi-value">${c.seated || 0}</span><div class="kpi-meta"><span>Currently dining</span></div></div>
          <div class="kpi"><span class="kpi-label">Upcoming</span><span class="kpi-value">${upcoming.length}</span><div class="kpi-meta"><span>${c.completed || 0} completed all time</span></div></div>
        </div>

        <div class="filter-bar">
          <div class="search-box"><i data-lucide="search"></i><input type="search" id="resSearch" placeholder="Search guest, phone or code…" value="${A.esc(state.search)}"></div>
          <div class="seg-tabs" id="resTabs">
            ${[['all', 'All'], ['pending', 'Pending'], ['confirmed', 'Confirmed'], ['seated', 'Seated'], ['completed', 'Completed'], ['cancelled', 'Cancelled']].map(([v, l]) => `<button data-status="${v}" class="${state.status === v ? 'active' : ''}">${l}</button>`).join('')}
          </div>
          <input type="date" id="resDate" value="${state.date}" title="Show one date">
          <button class="btn btn-soft btn-sm" id="resClear"><i data-lucide="filter-x"></i> Clear</button>
          <span class="spacer"></span><span class="muted small">${d.reservations.length} bookings</span>
        </div>

        <div class="table-card">
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Code</th><th>Guest</th><th>Date &amp; time</th><th class="num">Guests</th><th>Table</th><th>Status</th><th>Notes</th><th class="actions">Actions</th></tr></thead>
            <tbody>${d.reservations.length ? d.reservations.map((r) => `<tr>
              <td class="mono strong" style="font-size:9.5px">${A.esc(r.reservation_code)}</td>
              <td><div class="cell-main"><span class="avatar" style="width:28px;height:28px;font-size:8.5px;background:linear-gradient(140deg,${A.avatarColor(r.customer_name)},#a9832e)">${A.esc(A.initials(r.customer_name))}</span><div><strong>${A.esc(r.customer_name)}</strong><span>${A.esc(r.phone || r.email || '—')}</span></div></div></td>
              <td><span class="small strong">${A.date(r.date)}</span><div class="muted" style="font-size:8.8px">${A.esc(r.time)}</div></td>
              <td class="num">${r.guests}</td>
              <td class="small">${A.esc(r.table_number || 'Unassigned')}</td>
              <td>${A.badge(r.status)}</td>
              <td class="muted small" style="max-width:150px" title="${A.esc(r.notes || '')}">${A.esc(r.notes || '—')}</td>
              <td class="actions"><div class="row-actions">
                <select class="input" data-res-status="${r.id}" style="min-height:26px;padding:2px 20px 2px 6px;font-size:9px;width:auto">
                  ${['pending', 'confirmed', 'seated', 'completed', 'cancelled'].map((s) => `<option value="${s}" ${r.status === s ? 'selected' : ''}>${A.statusLabel(s)}</option>`).join('')}
                </select>
                <button class="btn btn-xs btn-danger-soft btn-icon" data-del-res="${r.id}" title="Delete"><i data-lucide="trash-2"></i></button>
              </div></td>
            </tr>`).join('') : `<tr><td colspan="8">${A.empty('No reservations match', 'Try another date or create a booking.', 'calendar-check')}</td></tr>`}</tbody>
          </table></div>
          <div class="table-foot"><span>Website bookings appear here instantly</span><span class="muted">Guest count includes children</span></div>
        </div>`;
      A.icons();
      bind();
    }

    function bind() {
      A.qs('#resSearch').addEventListener('input', A.debounce((e) => { state.search = e.target.value.trim(); load(); }, 280));
      A.qs('#resTabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-status]');
        if (!b) return;
        state.status = b.dataset.status; load();
      });
      A.qs('#resDate').addEventListener('change', (e) => { state.date = e.target.value; load(); });
      A.qs('#resClear').addEventListener('click', () => { state.status = 'all'; state.date = ''; state.search = ''; load(); });
      A.qs('#resRefresh').addEventListener('click', (e) => { A.busyEvent(e, true, ''); load().finally(() => A.busyEvent(e, false)); });
      A.qs('#resAdd').addEventListener('click', () => reservationForm());
      A.qsa('[data-res-status]', view).forEach((sel) => sel.addEventListener('change', async () => {
        try {
          await A.api(`/reservations/${sel.dataset.resStatus}/status`, { method: 'PATCH', body: { status: sel.value } });
          A.toast(`Reservation marked ${sel.value}.`, 'success');
          await load();
        } catch (err) { A.notifyError(err); await load(); }
      }));
      A.qsa('[data-del-res]', view).forEach((b) => b.addEventListener('click', () => {
        const r = state.data.reservations.find((x) => x.id === Number(b.dataset.delRes));
        A.deleteConfirm(r.reservation_code, async () => {
          await A.api(`/reservations/${r.id}`, { method: 'DELETE' });
          A.toast('Reservation deleted.', 'success'); await load();
        }, { title: 'Delete this reservation?', message: `${r.customer_name} · ${A.date(r.date)} at ${r.time}` });
      }));
    }

    function reservationForm() {
      const m = A.modal({
        title: 'New reservation', subtitle: 'Reserve a table for a guest.',
        size: 'sm',
        body: `<form id="resForm"><div class="form-grid">
          <label class="field full"><span>Guest name *</span><input name="customer_name" required placeholder="Full name"></label>
          <label class="field"><span>Phone</span><input name="phone" placeholder="03xx…"></label>
          <label class="field"><span>Email</span><input name="email" type="email" placeholder="guest@email.com"></label>
          <label class="field"><span>Date *</span><input name="date" type="date" min="${A.today()}" value="${A.today()}" required></label>
          <label class="field"><span>Time *</span><input name="time" type="time" value="19:30" required></label>
          <label class="field"><span>Guests *</span><input name="guests" type="number" min="1" max="40" value="2" required></label>
          <label class="field"><span>Table</span><select name="table_id">${A.options(state.tables, '', 'id', 'number', 'No table yet')}</select></label>
          <label class="field full"><span>Status</span><select name="status">${['pending', 'confirmed', 'seated'].map((s) => `<option value="${s}">${A.statusLabel(s)}</option>`).join('')}</select></label>
          <label class="field full"><span>Notes</span><textarea name="notes" style="min-height:55px" placeholder="Allergies, occasion, seating preference…"></textarea></label>
        </div></form>`,
        footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-gold" data-save><i data-lucide="calendar-check"></i> Create reservation</button>`,
        onMount: (modal) => {
          A.qs('[data-cancel]', modal.footer).addEventListener('click', modal.close);
          A.qs('[data-save]', modal.footer).addEventListener('click', async (e) => {
            const form = A.qs('#resForm', modal.body);
            if (!form.reportValidity()) return;
            const fd = A.formData(form);
            A.busyEvent(e, true, 'Saving…');
            try {
              await A.api('/reservations', { method: 'POST', body: fd });
              A.toast('Reservation created.', 'success'); modal.close(); await load();
            } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
          });
        }
      });
    }

    await load();
    return () => { state.destroyed = true; };
  };
})();
