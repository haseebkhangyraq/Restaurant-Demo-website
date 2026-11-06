/* ==========================================================================
   Admin — Visual floor & tables
   ========================================================================== */
(function () {
  'use strict';
  const A = window.A;
  const STATUSES = [['available', 'Available'], ['occupied', 'Occupied'], ['reserved', 'Reserved'], ['cleaning', 'Cleaning']];

  A.views.tables = async function (view) {
    const state = { data: null, area: 'all', destroyed: false };

    view.innerHTML = `<div class="view-loading"><span class="spinner"></span><p>Setting the floor…</p></div>`;

    async function load() {
      try {
        const data = await A.api('/tables');
        if (state.destroyed) return;
        state.data = data;
        paint();
      } catch (err) {
        if (state.destroyed) return;
        view.innerHTML = `<div class="card card-pad" style="max-width:560px;margin:9vh auto;text-align:center"><div class="confirm-icon"><i data-lucide="alert-triangle"></i></div><h2 style="font-family:var(--font-display);font-size:28px">Floor unavailable</h2><p class="muted small">${A.esc(err.message)}</p></div>`;
        A.icons();
      }
    }

    function areas() { return [...new Set(state.data.tables.map((t) => t.area || 'Main Hall'))]; }

    function stats() {
      const s = { available: 0, occupied: 0, reserved: 0, cleaning: 0, seats: 0, guests: 0 };
      state.data.tables.forEach((t) => { s[t.status] = (s[t.status] || 0) + 1; s.seats += Number(t.capacity); });
      return s;
    }

    function paint() {
      const s = stats();
      const currentArea = state.area;
      const visible = state.data.tables.filter((t) => currentArea === 'all' || (t.area || 'Main Hall') === currentArea);
      const grouped = {};
      visible.forEach((t) => { const a = t.area || 'Main Hall'; (grouped[a] = grouped[a] || []).push(t); });
      view.innerHTML = `
        <div class="view-head">
          <div class="view-head-copy"><h2>Dining room</h2><p>A live view of every table. Seat guests, clear covers and keep the floor moving.</p></div>
          <div class="view-head-actions">
            <button class="btn btn-outline" id="tableRefresh"><i data-lucide="refresh-cw"></i> Refresh</button>
            ${A.isManager() ? `<button class="btn btn-gold" id="tableAdd"><i data-lucide="plus"></i> New table</button>` : ''}
            ${A.can('pos') ? `<a class="btn btn-soft" href="#/pos"><i data-lucide="scan-barcode"></i> Open POS</a>` : ''}
          </div>
        </div>

        <div class="table-stats">
          ${[['available', 'Available', 'var(--green)'], ['occupied', 'Occupied', 'var(--red)'], ['reserved', 'Reserved', 'var(--amber)'], ['cleaning', 'Cleaning', 'var(--blue)']].map(([k, l, c]) => `<span class="badge neutral" style="padding:6px 10px;background:var(--paper);border:1px solid var(--line)"><i style="width:7px;height:7px;border-radius:50%;background:${c};display:inline-block;margin-right:5px"></i>${l} <b style="margin-left:4px">${s[k] || 0}</b></span>`).join('')}
          <span class="muted small" style="margin-left:auto">${state.data.tables.length} tables · ${s.seats} covers</span>
        </div>

        <div class="filter-bar">
          <div class="seg-tabs" id="areaTabs">
            <button data-area="all" class="${currentArea === 'all' ? 'active' : ''}">All areas</button>
            ${areas().map((a) => `<button data-area="${A.esc(a)}" class="${currentArea === a ? 'active' : ''}">${A.esc(a)}</button>`).join('')}
          </div>
          <span class="spacer"></span>
          <span class="muted small">${state.data.reservations.length} upcoming reservation${state.data.reservations.length === 1 ? '' : 's'}</span>
        </div>

        <div class="report-grid" style="align-items:start">
          <div>
            ${Object.keys(grouped).length ? Object.entries(grouped).map(([area, tables]) => `
              <div class="table-area">
                <div class="table-area-head"><h3><i data-lucide="layout-grid"></i> ${A.esc(area)}</h3><span>${tables.length} table${tables.length === 1 ? '' : 's'}</span></div>
                <div class="floor-grid">
                  ${tables.map(tableCard).join('')}
                </div>
              </div>`).join('') : `<div class="card card-pad">${A.empty('No tables here', 'Choose another area or add a table.', 'armchair')}</div>`}
          </div>

          <div class="card">
            <div class="card-head"><div><h3><i data-lucide="calendar-clock"></i> Upcoming reservations</h3><p>Next seatings across the restaurant.</p></div><a href="#/reservations" style="font-size:10px;color:var(--gold-dark);font-weight:600">All →</a></div>
            <div class="card-body">
              ${state.data.reservations.length ? `<div class="mini-list">${state.data.reservations.slice(0, 7).map((r) => `<div class="mini-row"><span class="mr-left"><span class="avatar" style="width:27px;height:27px;font-size:8.5px;background:linear-gradient(140deg,${A.avatarColor(r.customer_name)},#a9832e)">${A.esc(A.initials(r.customer_name))}</span><span><strong>${A.esc(r.customer_name)}</strong><span>${A.date(r.date)} · ${A.esc(r.time)} · ${r.guests} guests${r.table_number ? ` · ${A.esc(r.table_number)}` : ''}</span></span></span>${A.badge(r.status)}</div>`).join('')}</div>` : `<div class="muted small">No upcoming reservations. The floor is first-come, first-served.</div>`}
              <div class="quick-actions" style="margin-top:12px;grid-template-columns:1fr 1fr">
                ${A.can('reservations') ? `<a class="quick-action" href="#/reservations"><i data-lucide="calendar-plus"></i> Book a table</a>` : ''}
                ${A.can('orders') ? `<a class="quick-action" href="#/orders"><i data-lucide="receipt-text"></i> Order book</a>` : ''}
              </div>
            </div>
          </div>
        </div>`;
      A.icons();
      bind();
    }

    function tableCard(t) {
      const label = A.statusLabel(t.status);
      return `<div class="floor-table ${A.esc(t.status)}">
        <div class="floor-table-head">
          <div><strong>${A.esc(t.number)}</strong><div class="floor-table-meta"><span><i data-lucide="users"></i> ${t.capacity} seats</span><span><i data-lucide="map-pin"></i> ${A.esc(t.area || 'Main Hall')}</span></div></div>
          ${A.badge(t.status, label)}
        </div>
        ${t.current_order_id ? `<div class="floor-table-order"><strong>${A.esc(t.order_number || 'Active order')}</strong><span>${A.esc(t.customer_name || 'Walk-in Guest')} · ${A.money(t.order_total)}</span></div>` : `<div class="floor-table-order"><strong>${t.status === 'available' ? 'Ready for guests' : t.status === 'reserved' ? 'Held for reservation' : t.status === 'cleaning' ? 'Being reset' : 'No active order'}</strong><span>${t.status === 'available' ? 'Tap to seat a party' : ''}</span></div>`}
        <div class="floor-table-actions">
          ${t.current_order_id ? `<button class="btn btn-xs btn-soft" data-view-order="${t.current_order_id}"><i data-lucide="receipt-text"></i> Order</button>` : ''}
          <select data-status-table="${t.id}" class="input" style="min-height:27px;padding:2px 22px 2px 7px;font-size:9px;flex:1;width:auto">
            ${STATUSES.map(([v, l]) => `<option value="${v}" ${t.status === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          ${A.isManager() ? `<button class="btn btn-xs btn-outline btn-icon" data-edit-table="${t.id}" title="Edit"><i data-lucide="pencil"></i></button>` : ''}
          ${A.isManager() ? `<button class="btn btn-xs btn-danger-soft btn-icon" data-del-table="${t.id}" title="Delete"><i data-lucide="trash-2"></i></button>` : ''}
        </div>
      </div>`;
    }

    function bind() {
      A.qs('#tableRefresh').addEventListener('click', (e) => { A.busyEvent(e, true, ''); load().finally(() => A.busyEvent(e, false)); });
      A.qs('#tableAdd')?.addEventListener('click', () => tableForm(null));
      A.qs('#areaTabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-area]');
        if (!b) return;
        state.area = b.dataset.area;
        paint();
      });
      A.qsa('[data-status-table]').forEach((sel) => sel.addEventListener('change', async () => {
        const id = Number(sel.dataset.statusTable);
        try {
          await A.api(`/tables/${id}/status`, { method: 'PATCH', body: { status: sel.value } });
          A.toast(`Table marked ${sel.value}.`, 'success');
          await load();
        } catch (err) { A.notifyError(err); await load(); }
      }));
      A.qsa('[data-view-order]').forEach((b) => b.addEventListener('click', () => { if (A.openOrder) A.openOrder(Number(b.dataset.viewOrder), { onChange: () => load() }); }));
      A.qsa('[data-edit-table]').forEach((b) => b.addEventListener('click', () => tableForm(state.data.tables.find((t) => t.id === Number(b.dataset.editTable)))));
      A.qsa('[data-del-table]').forEach((b) => b.addEventListener('click', () => {
        const t = state.data.tables.find((x) => x.id === Number(b.dataset.delTable));
        A.deleteConfirm(`Table ${t.number}`, async () => {
          await A.api(`/tables/${t.id}`, { method: 'DELETE' });
          A.toast('Table removed from the floor.', 'success'); await load();
        }, { title: 'Remove this table?', message: 'Tables with an active order cannot be removed.' });
      }));
    }

    function tableForm(table) {
      const isNew = !table;
      const t = table || { number: '', capacity: 4, area: 'Main Hall', x: 60, y: 60 };
      const areasList = [...new Set([...areas(), 'Main Hall', 'Terrace', 'Private Dining', 'Garden'])];
      const m = A.modal({
        title: isNew ? 'New table' : 'Edit table', size: 'sm',
        body: `<form id="tableForm"><div class="form-grid">
          <label class="field"><span>Table number *</span><input name="number" value="${A.esc(t.number)}" required placeholder="e.g. T13"></label>
          <label class="field"><span>Capacity *</span><input name="capacity" type="number" min="1" max="30" value="${t.capacity}" required></label>
          <label class="field full"><span>Area</span><input name="area" list="areaList" value="${A.esc(t.area || 'Main Hall')}"><datalist id="areaList">${areasList.map((a) => `<option value="${A.esc(a)}">`).join('')}</datalist></label>
          <input type="hidden" name="x" value="${t.x || 60}"><input type="hidden" name="y" value="${t.y || 60}">
        </div></form>`,
        footer: `<button class="btn btn-soft" data-cancel>Cancel</button><button class="btn btn-gold" data-save>${isNew ? 'Create table' : 'Save changes'}</button>`,
        onMount: (modal) => {
          A.qs('[data-cancel]', modal.footer).addEventListener('click', modal.close);
          A.qs('[data-save]', modal.footer).addEventListener('click', async (e) => {
            const form = A.qs('#tableForm', modal.body);
            if (!form.reportValidity()) return;
            const fd = A.formData(form);
            A.busyEvent(e, true, 'Saving…');
            try {
              await A.api(isNew ? '/tables' : `/tables/${t.id}`, { method: isNew ? 'POST' : 'PUT', body: fd });
              A.toast('Table saved.', 'success'); modal.close(); await load();
            } catch (err) { A.notifyError(err); A.busyEvent(e, false); }
          });
        }
      });
    }

    await load();
    return () => { state.destroyed = true; };
  };
})();
