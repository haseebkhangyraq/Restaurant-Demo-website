/* ==========================================================================
   Saffron House — reservations
   ========================================================================== */
(function () {
  'use strict';
  const SH = window.SH;
  const form = document.getElementById('reservationForm');
  const dateInput = document.getElementById('rvDate');
  const timeInput = document.getElementById('rvTime');
  const guestsInput = document.getElementById('rvGuests');
  const slots = document.getElementById('tableSlots');
  const status = document.getElementById('tableStatus');
  let selectedTable = null;

  function openTime(date) {
    const now = new Date();
    if (date === now.toISOString().slice(0, 10)) {
      now.setMinutes(now.getMinutes() + 30);
      return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
    return '12:00';
  }

  async function loadTables() {
    const date = dateInput.value;
    const time = timeInput.value || '19:00';
    if (!date || !time) return;
    status.textContent = 'Checking availability…';
    slots.innerHTML = '';
    try {
      const r = await SH.api(`/api/tables/availability?date=${encodeURIComponent(date)}&time=${encodeURIComponent(time)}`);
      const guests = parseInt(guestsInput.value, 10) || 2;
      const fitting = (r.tables || []).filter((t) => t.capacity >= guests);
      if (!fitting.length) {
        status.textContent = 'No table fits this party size at this time.';
        slots.innerHTML = '<p style="font-size:11.5px;color:var(--muted);grid-column:1/-1">Try a slightly later time, or call us and we will arrange something.</p>';
        return;
      }
      const openCount = fitting.filter((t) => t.bookable).length;
      status.textContent = `${openCount} of ${fitting.length} tables available`;
      slots.innerHTML = fitting.map((t) => `
        <div class="table-slot ${t.bookable ? '' : 'unavailable'} ${selectedTable === t.id ? 'selected' : ''}" data-table-id="${t.id}" data-capacity="${t.capacity}">
          <strong>Table ${t.number}</strong>
          <span>Seats ${t.capacity}${t.location ? ` · ${SH.esc(t.location)}` : ''}</span>
        </div>`).join('');
      slots.querySelectorAll('.table-slot:not(.unavailable)').forEach((el) => el.addEventListener('click', () => {
        const id = Number(el.dataset.tableId);
        selectedTable = selectedTable === id ? null : id;
        slots.querySelectorAll('.table-slot').forEach((x) => x.classList.toggle('selected', Number(x.dataset.tableId) === selectedTable));
      }));
      SH.icons();
    } catch (err) {
      status.textContent = 'Could not load availability — we will choose for you.';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const today = new Date().toISOString().slice(0, 10);
    dateInput.min = today;
    dateInput.value = today;
    timeInput.value = '19:30';

    dateInput.addEventListener('change', () => {
      selectedTable = null;
      if (dateInput.value === today && timeInput.value < openTime(today)) timeInput.value = '19:30';
      loadTables();
    });
    timeInput.addEventListener('change', () => { selectedTable = null; loadTables(); });
    guestsInput.addEventListener('change', () => { selectedTable = null; loadTables(); });
    loadTables();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('reservationError');
      err.classList.remove('show');
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const date = dateInput.value;
      const time = timeInput.value;
      if (date < today) { err.textContent = 'Please choose today or a future date.'; err.classList.add('show'); return; }
      if (date === today && time < openTime(today)) { err.textContent = 'Please choose a future time for today.'; err.classList.add('show'); return; }

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Sending request…';
      try {
        const data = Object.fromEntries(new FormData(form).entries());
        if (selectedTable) data.table_id = selectedTable;
        const r = await SH.api('/api/reservations', { method: 'POST', body: data });
        form.style.display = 'none';
        const box = document.getElementById('reservationSuccess');
        box.classList.add('show');
        document.getElementById('reservationSuccessText').textContent =
          `Reference ${r.reservation.code} · ${r.reservation.date} at ${r.reservation.time} for ${r.reservation.guests} guest${r.reservation.guests > 1 ? 's' : ''}${r.reservation.table ? ` · Table ${r.reservation.table}` : ''}. ${r.reservation.notice || ''} We will call to confirm.`;
        SH.toast('Our team will confirm your table shortly.', 'success', 'Reservation requested');
        window.scrollTo({ top: form.getBoundingClientRect().top + window.scrollY - 120, behavior: 'smooth' });
        SH.icons();
      } catch (ex) {
        err.textContent = ex.message;
        err.classList.add('show');
      } finally {
        btn.disabled = false;
        btn.innerHTML = 'Request reservation <i data-lucide="arrow-right"></i>';
        SH.icons();
      }
    });

    document.getElementById('anotherReservation').addEventListener('click', () => {
      form.reset();
      form.style.display = '';
      document.getElementById('reservationSuccess').classList.remove('show');
      dateInput.value = today;
      timeInput.value = '19:30';
      guestsInput.value = '2';
      selectedTable = null;
      loadTables();
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
})();
