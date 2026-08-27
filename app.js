'use strict';

/* ============================================================
   Constants
   ============================================================ */
const PALETTE = [
  '#2f6fed', '#1f9d55', '#d97706', '#dc2626', '#7c3aed',
  '#0891b2', '#c2410c', '#4f46e5', '#db2777', '#57606f'
];
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/* ============================================================
   Date helpers (all dates handled as local, no time component)
   ============================================================ */
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function todayISO() { return toISO(new Date()); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function startOfWeek(d) { const r = new Date(d); r.setDate(r.getDate() - r.getDay()); return r; }
function daysInMonth(year, monthIndex) { return new Date(year, monthIndex + 1, 0).getDate(); }
function isSameDate(a, b) { return toISO(a) === toISO(b); }

/* ============================================================
   IndexedDB layer
   ============================================================ */
const DB_NAME = 'DatebookDB';
const DB_VERSION = 1;
let dbInstance = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('categories')) {
        db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('tasks')) {
        const store = db.createObjectStore('tasks', { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_date', 'date');
      }
      if (!db.objectStoreNames.contains('specialDates')) {
        db.createObjectStore('specialDates', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeName, mode) {
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
}
function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const Store = {
  async getAll(name) { return reqToPromise((await tx(name, 'readonly')).getAll()); },
  async get(name, key) { return reqToPromise((await tx(name, 'readonly')).get(key)); },
  async put(name, value) { return reqToPromise((await tx(name, 'readwrite')).put(value)); },
  async delete(name, key) { return reqToPromise((await tx(name, 'readwrite')).delete(key)); },
};

/* ============================================================
   App state
   ============================================================ */
const state = {
  view: 'month',
  anchor: new Date(),      // date currently focused in whichever view
  categories: [],
  tasks: [],
  specialDates: [],
  editingTaskId: null,
  editingSpecialId: null,
  agendaDate: null,
};

async function loadAll() {
  state.categories = await Store.getAll('categories');
  state.tasks = await Store.getAll('tasks');
  state.specialDates = await Store.getAll('specialDates');
}

async function seedDefaultsIfEmpty() {
  const existing = await Store.getAll('categories');
  if (existing.length === 0) {
    const defaults = [
      { name: 'Work', color: PALETTE[0] },
      { name: 'Personal', color: PALETTE[1] },
      { name: 'Bills', color: PALETTE[2] },
      { name: 'Health', color: PALETTE[3] },
    ];
    for (const c of defaults) await Store.put('categories', c);
  }
}

function getCategory(id) {
  return state.categories.find(c => c.id === id);
}
function categoryColor(id) {
  const c = getCategory(id);
  return c ? c.color : PALETTE[9];
}

/* ============================================================
   Special date recurrence matching
   ============================================================ */
function specialDatesOn(date) {
  const matches = [];
  for (const sd of state.specialDates) {
    if (sd.type === 'adhoc') {
      if (sd.date === toISO(date)) matches.push(sd);
    } else if (sd.type === 'annual') {
      const dim = daysInMonth(date.getFullYear(), sd.month);
      const effDay = Math.min(sd.day, dim);
      if (date.getMonth() === sd.month && date.getDate() === effDay) matches.push(sd);
    } else if (sd.type === 'monthly') {
      const dim = daysInMonth(date.getFullYear(), date.getMonth());
      const effDay = Math.min(sd.day, dim);
      if (date.getDate() === effDay) matches.push(sd);
    }
  }
  return matches;
}

function tasksOn(dateISOStr) {
  return state.tasks
    .filter(t => t.date === dateISOStr)
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      if (order[a.priority] !== order[b.priority]) return order[a.priority] - order[b.priority];
      return a.title.localeCompare(b.title);
    });
}

/* ============================================================
   Rendering: title bar
   ============================================================ */
function renderTitle() {
  const el = document.getElementById('view-title');
  if (state.view === 'month') {
    el.textContent = `${MONTH_LABELS[state.anchor.getMonth()]} ${state.anchor.getFullYear()}`;
  } else if (state.view === 'week') {
    const start = startOfWeek(state.anchor);
    const end = addDays(start, 6);
    if (start.getMonth() === end.getMonth()) {
      el.textContent = `${MONTH_LABELS[start.getMonth()].slice(0,3)} ${start.getDate()}–${end.getDate()}`;
    } else {
      el.textContent = `${MONTH_LABELS[start.getMonth()].slice(0,3)} ${start.getDate()} – ${MONTH_LABELS[end.getMonth()].slice(0,3)} ${end.getDate()}`;
    }
  } else {
    el.textContent = `${WEEKDAY_LABELS[state.anchor.getDay()]}, ${MONTH_LABELS[state.anchor.getMonth()].slice(0,3)} ${state.anchor.getDate()}`;
  }
}

/* ============================================================
   Rendering: Month view
   ============================================================ */
function renderMonth() {
  const container = document.getElementById('month-view');
  const year = state.anchor.getFullYear();
  const month = state.anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = startOfWeek(firstOfMonth);
  const todayStr = todayISO();

  let html = '<div class="month-weekdays">' +
    WEEKDAY_LABELS.map(w => `<span>${w}</span>`).join('') +
    '</div><div class="month-grid">';

  for (let i = 0; i < 42; i++) {
    const cellDate = addDays(gridStart, i);
    const iso = toISO(cellDate);
    const outside = cellDate.getMonth() !== month;
    const isToday = iso === todayStr;
    const dayTasks = tasksOn(iso);
    const daySpecials = specialDatesOn(cellDate);

    const items = [
      ...daySpecials.map(s => ({ label: s.label, color: s.categoryId ? categoryColor(s.categoryId) : 'var(--today-ring)', done: false })),
      ...dayTasks.map(t => ({ label: t.title, color: categoryColor(t.categoryId), done: t.status === 'done' })),
    ];
    const MAX_SHOWN = 3;
    const shown = items.slice(0, MAX_SHOWN);
    const itemsHtml = shown.map(it =>
      `<div class="cell-item${it.done ? ' done' : ''}" style="color:${it.color}">
        <span class="cell-dot" style="background:${it.color}"></span>${escapeHTML(it.label)}
      </div>`
    ).join('');
    const more = items.length > MAX_SHOWN ? `<div class="cell-more">+${items.length - MAX_SHOWN} more</div>` : '';

    html += `<div class="month-cell${outside ? ' outside' : ''}${isToday ? ' is-today' : ''}" data-date="${iso}">
      <span class="daynum">${cellDate.getDate()}</span>
      <div class="cell-items">${itemsHtml}${more}</div>
    </div>`;
  }
  html += '</div>';
  container.innerHTML = html;

  container.querySelectorAll('.month-cell').forEach(cell => {
    cell.addEventListener('click', () => openAgenda(cell.dataset.date));
  });
}

/* ============================================================
   Rendering: Week view
   ============================================================ */
function renderWeek() {
  const container = document.getElementById('week-view');
  const start = startOfWeek(state.anchor);
  const todayStr = todayISO();
  let html = '<div class="week-list">';

  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const iso = toISO(d);
    const isToday = iso === todayStr;
    const dayTasks = tasksOn(iso);
    const daySpecials = specialDatesOn(d);

    let itemsHtml = '';
    if (dayTasks.length === 0 && daySpecials.length === 0) {
      itemsHtml = '<div class="week-empty">Nothing scheduled</div>';
    } else {
      itemsHtml = daySpecials.map(s => specialChipHTML(s)).join('') +
                  dayTasks.map(t => taskChipHTML(t)).join('');
    }

    html += `<div class="week-day-row${isToday ? ' is-today' : ''}" data-date="${iso}">
      <div class="week-day-head">
        <span class="wd-label">${WEEKDAY_LABELS[d.getDay()]}</span>
        <span class="wd-num">${MONTH_LABELS[d.getMonth()].slice(0,3)} ${d.getDate()}</span>
      </div>
      <div class="week-items">${itemsHtml}</div>
    </div>`;
  }
  html += '</div>';
  container.innerHTML = html;

  container.querySelectorAll('.task-chip[data-task-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('task-chip-check')) return;
      openTaskModal(Number(el.dataset.taskId));
    });
  });
  container.querySelectorAll('.task-chip-check').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); toggleTaskDone(Number(el.closest('.task-chip').dataset.taskId)); });
  });
  container.querySelectorAll('.task-chip.special').forEach(el => {
    el.addEventListener('click', () => openSpecialModal(Number(el.dataset.specialId)));
  });
  container.querySelectorAll('.week-day-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.task-chip')) return;
      state.anchor = fromISO(row.dataset.date);
      switchView('day');
    });
  });
}

/* ============================================================
   Rendering: Day view
   ============================================================ */
function renderDay() {
  const container = document.getElementById('day-view');
  const iso = toISO(state.anchor);
  const dayTasks = tasksOn(iso);
  const daySpecials = specialDatesOn(state.anchor);

  let html = `<div class="day-header">${dayTasks.length + daySpecials.length} item(s) today</div><div class="day-list">`;

  if (dayTasks.length === 0 && daySpecials.length === 0) {
    html += '<div class="day-empty">Nothing scheduled for this day.<br>Tap + to add a task.</div>';
  } else {
    html += daySpecials.map(s => specialChipHTML(s)).join('');
    html += dayTasks.map(t => taskChipHTML(t)).join('');
  }
  html += '</div>';
  container.innerHTML = html;

  container.querySelectorAll('.task-chip[data-task-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('task-chip-check')) return;
      openTaskModal(Number(el.dataset.taskId));
    });
  });
  container.querySelectorAll('.task-chip-check').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); toggleTaskDone(Number(el.closest('.task-chip').dataset.taskId)); });
  });
  container.querySelectorAll('.task-chip.special').forEach(el => {
    el.addEventListener('click', () => openSpecialModal(Number(el.dataset.specialId)));
  });
}

/* ============================================================
   Shared chip HTML
   ============================================================ */
function taskChipHTML(t) {
  const color = categoryColor(t.categoryId);
  const done = t.status === 'done';
  return `<div class="task-chip pr-${t.priority}${done ? ' done' : ''}" data-task-id="${t.id}">
    <span class="task-chip-check${done ? ' checked' : ''}">${done ? '✓' : ''}</span>
    <span class="task-chip-dot" style="background:${color}"></span>
    <span class="task-chip-title">${escapeHTML(t.title)}</span>
  </div>`;
}
function specialChipHTML(s) {
  const color = s.categoryId ? categoryColor(s.categoryId) : 'var(--today-ring)';
  const icon = s.type === 'annual' ? '🎂' : s.type === 'monthly' ? '💳' : '📌';
  return `<div class="task-chip special" data-special-id="${s.id}">
    <span class="task-chip-icon">${icon}</span>
    <span class="task-chip-dot" style="background:${color}"></span>
    <span class="task-chip-title">${escapeHTML(s.label)}</span>
  </div>`;
}
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ============================================================
   View switching & navigation
   ============================================================ */
function switchView(view) {
  state.view = view;
  document.querySelectorAll('.view-tab').forEach(tab => {
    const active = tab.dataset.view === view;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.getElementById('month-view').hidden = view !== 'month';
  document.getElementById('week-view').hidden = view !== 'week';
  document.getElementById('day-view').hidden = view !== 'day';
  renderCurrentView();
}

function renderCurrentView() {
  renderTitle();
  if (state.view === 'month') renderMonth();
  else if (state.view === 'week') renderWeek();
  else renderDay();
}

function navigate(delta) {
  if (state.view === 'month') {
    state.anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth() + delta, 1);
  } else if (state.view === 'week') {
    state.anchor = addDays(state.anchor, delta * 7);
  } else {
    state.anchor = addDays(state.anchor, delta);
  }
  renderCurrentView();
}

function goToday() {
  state.anchor = new Date();
  renderCurrentView();
}

/* ============================================================
   Task modal
   ============================================================ */
function populateCategorySelect(selectEl, includeNone) {
  selectEl.innerHTML = '';
  if (includeNone) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'None';
    selectEl.appendChild(opt);
  }
  state.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    selectEl.appendChild(opt);
  });
}

function openTaskModal(taskId, presetDate) {
  state.editingTaskId = taskId || null;
  populateCategorySelect(document.getElementById('task-category'), false);

  const titleEl = document.getElementById('task-modal-title');
  const deleteBtn = document.getElementById('task-delete');

  if (taskId) {
    const t = state.tasks.find(x => x.id === taskId);
    titleEl.textContent = 'Edit task';
    document.getElementById('task-title').value = t.title;
    document.getElementById('task-date').value = t.date;
    document.getElementById('task-category').value = t.categoryId;
    document.getElementById('task-priority').value = t.priority;
    document.getElementById('task-notes').value = t.notes || '';
    deleteBtn.hidden = false;
  } else {
    titleEl.textContent = 'New task';
    document.getElementById('task-title').value = '';
    document.getElementById('task-date').value = presetDate || toISO(state.anchor);
    if (state.categories[0]) document.getElementById('task-category').value = state.categories[0].id;
    document.getElementById('task-priority').value = 'medium';
    document.getElementById('task-notes').value = '';
    deleteBtn.hidden = true;
  }
  document.getElementById('task-backdrop').hidden = false;
}
function closeTaskModal() { document.getElementById('task-backdrop').hidden = true; }

async function saveTask() {
  const title = document.getElementById('task-title').value.trim();
  if (!title) { document.getElementById('task-title').focus(); return; }
  const record = {
    title,
    date: document.getElementById('task-date').value || todayISO(),
    categoryId: Number(document.getElementById('task-category').value),
    priority: document.getElementById('task-priority').value,
    notes: document.getElementById('task-notes').value.trim(),
    status: 'pending',
  };
  if (state.editingTaskId) {
    const existing = state.tasks.find(t => t.id === state.editingTaskId);
    record.id = state.editingTaskId;
    record.status = existing.status;
  }
  await Store.put('tasks', record);
  await loadAll();
  closeTaskModal();
  renderCurrentView();
  refreshOverdueBanner();
}
async function deleteTask() {
  if (!state.editingTaskId) return;
  await Store.delete('tasks', state.editingTaskId);
  await loadAll();
  closeTaskModal();
  renderCurrentView();
  refreshOverdueBanner();
}
async function toggleTaskDone(taskId) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t) return;
  t.status = t.status === 'done' ? 'pending' : 'done';
  await Store.put('tasks', t);
  await loadAll();
  renderCurrentView();
  refreshOverdueBanner();
}

/* ============================================================
   Special date modal
   ============================================================ */
function populateMonthDaySelects() {
  const monthSel = document.getElementById('special-month');
  monthSel.innerHTML = MONTH_LABELS.map((m, i) => `<option value="${i}">${m}</option>`).join('');
  const daySel = document.getElementById('special-day');
  daySel.innerHTML = Array.from({ length: 31 }, (_, i) => `<option value="${i+1}">${i+1}</option>`).join('');
  const monthDaySel = document.getElementById('special-monthday');
  monthDaySel.innerHTML = Array.from({ length: 31 }, (_, i) => `<option value="${i+1}">${i+1}</option>`).join('');
}

function updateSpecialTypeFields() {
  const type = document.getElementById('special-type').value;
  document.getElementById('special-adhoc-field').hidden = type !== 'adhoc';
  document.getElementById('special-annual-field').hidden = type !== 'annual';
  document.getElementById('special-monthly-field').hidden = type !== 'monthly';
}

function openSpecialModal(specialId, presetDate) {
  state.editingSpecialId = specialId || null;
  populateMonthDaySelects();
  populateCategorySelect(document.getElementById('special-category'), true);

  const titleEl = document.getElementById('special-modal-title');
  const deleteBtn = document.getElementById('special-delete');

  if (specialId) {
    const s = state.specialDates.find(x => x.id === specialId);
    titleEl.textContent = 'Edit special date';
    document.getElementById('special-label').value = s.label;
    document.getElementById('special-type').value = s.type;
    if (s.type === 'adhoc') document.getElementById('special-date').value = s.date;
    if (s.type === 'annual') { document.getElementById('special-month').value = s.month; document.getElementById('special-day').value = s.day; }
    if (s.type === 'monthly') document.getElementById('special-monthday').value = s.day;
    document.getElementById('special-category').value = s.categoryId || '';
    document.getElementById('special-notes').value = s.notes || '';
    deleteBtn.hidden = false;
  } else {
    titleEl.textContent = 'New special date';
    document.getElementById('special-label').value = '';
    document.getElementById('special-type').value = 'adhoc';
    document.getElementById('special-date').value = presetDate || toISO(state.anchor);
    document.getElementById('special-category').value = '';
    document.getElementById('special-notes').value = '';
    deleteBtn.hidden = true;
  }
  updateSpecialTypeFields();
  document.getElementById('special-backdrop').hidden = false;
}
function closeSpecialModal() { document.getElementById('special-backdrop').hidden = true; }

async function saveSpecial() {
  const label = document.getElementById('special-label').value.trim();
  if (!label) { document.getElementById('special-label').focus(); return; }
  const type = document.getElementById('special-type').value;
  const catVal = document.getElementById('special-category').value;
  const record = {
    label,
    type,
    categoryId: catVal ? Number(catVal) : null,
    notes: document.getElementById('special-notes').value.trim(),
  };
  if (type === 'adhoc') record.date = document.getElementById('special-date').value;
  if (type === 'annual') { record.month = Number(document.getElementById('special-month').value); record.day = Number(document.getElementById('special-day').value); }
  if (type === 'monthly') record.day = Number(document.getElementById('special-monthday').value);

  if (state.editingSpecialId) record.id = state.editingSpecialId;
  await Store.put('specialDates', record);
  await loadAll();
  closeSpecialModal();
  renderCurrentView();
  renderSpecialList();
}
async function deleteSpecial() {
  if (!state.editingSpecialId) return;
  await Store.delete('specialDates', state.editingSpecialId);
  await loadAll();
  closeSpecialModal();
  renderCurrentView();
  renderSpecialList();
}

/* ============================================================
   Agenda popover (tap a day in month/week)
   ============================================================ */
function openAgenda(iso) {
  state.agendaDate = iso;
  const d = fromISO(iso);
  document.getElementById('agenda-title').textContent = `${MONTH_LABELS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  const listEl = document.getElementById('agenda-list');
  const dayTasks = tasksOn(iso);
  const daySpecials = specialDatesOn(d);

  if (dayTasks.length === 0 && daySpecials.length === 0) {
    listEl.innerHTML = '<div class="week-empty">Nothing scheduled</div>';
  } else {
    listEl.innerHTML = daySpecials.map(s => specialChipHTML(s)).join('') + dayTasks.map(t => taskChipHTML(t)).join('');
  }
  listEl.querySelectorAll('.task-chip[data-task-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('task-chip-check')) return;
      closeAgenda();
      openTaskModal(Number(el.dataset.taskId));
    });
  });
  listEl.querySelectorAll('.task-chip-check').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); toggleTaskDone(Number(el.closest('.task-chip').dataset.taskId)).then(() => openAgenda(iso)); });
  });
  listEl.querySelectorAll('.task-chip.special').forEach(el => {
    el.addEventListener('click', () => { closeAgenda(); openSpecialModal(Number(el.dataset.specialId)); });
  });

  document.getElementById('agenda-backdrop').hidden = false;
}
function closeAgenda() { document.getElementById('agenda-backdrop').hidden = true; }

/* ============================================================
   Overdue / postpone flow
   ============================================================ */
function getOverdueTasks() {
  const today = todayISO();
  return state.tasks.filter(t => t.status === 'pending' && t.date < today);
}

function refreshOverdueBanner() {
  const overdue = getOverdueTasks();
  const banner = document.getElementById('overdue-banner');
  if (overdue.length > 0) {
    document.getElementById('overdue-count').textContent = overdue.length;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function overdueRowHTML(t) {
  const d = fromISO(t.date);
  const color = categoryColor(t.categoryId);
  return `<div class="task-chip pr-${t.priority}" data-task-id="${t.id}" style="flex-wrap:wrap;">
    <span class="task-chip-dot" style="background:${color}"></span>
    <span class="task-chip-title">${escapeHTML(t.title)} <span style="color:var(--text-faint);font-weight:400;">(${MONTH_LABELS[d.getMonth()].slice(0,3)} ${d.getDate()})</span></span>
    <div style="display:flex; gap:6px; width:100%; margin-top:6px;">
      <button class="btn-ghost btn-small od-today" data-id="${t.id}" style="background:var(--surface);flex:1;">Move to today</button>
      <input type="date" class="od-pick" data-id="${t.id}" style="background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px;font-size:12px;">
      <button class="btn-ghost btn-small od-done" data-id="${t.id}" style="background:var(--surface);">✓ Done</button>
    </div>
  </div>`;
}

function renderOverdueModal() {
  const overdue = getOverdueTasks();
  const listEl = document.getElementById('overdue-list');
  if (overdue.length === 0) {
    listEl.innerHTML = '<div class="week-empty">All caught up 🎉</div>';
  } else {
    listEl.innerHTML = overdue.map(overdueRowHTML).join('');
  }
  listEl.querySelectorAll('.od-today').forEach(btn => {
    btn.addEventListener('click', () => moveTask(Number(btn.dataset.id), todayISO()));
  });
  listEl.querySelectorAll('.od-pick').forEach(inp => {
    inp.addEventListener('change', () => { if (inp.value) moveTask(Number(inp.dataset.id), inp.value); });
  });
  listEl.querySelectorAll('.od-done').forEach(btn => {
    btn.addEventListener('click', () => markDoneFromOverdue(Number(btn.dataset.id)));
  });
}
async function moveTask(id, newDate) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.date = newDate;
  await Store.put('tasks', t);
  await loadAll();
  renderOverdueModal();
  renderCurrentView();
  refreshOverdueBanner();
}
async function markDoneFromOverdue(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.status = 'done';
  await Store.put('tasks', t);
  await loadAll();
  renderOverdueModal();
  renderCurrentView();
  refreshOverdueBanner();
}
function openOverdueModal() {
  renderOverdueModal();
  document.getElementById('overdue-backdrop').hidden = false;
}
function closeOverdueModal() { document.getElementById('overdue-backdrop').hidden = true; }

async function maybeAutoPromptOverdue() {
  const overdue = getOverdueTasks();
  if (overdue.length === 0) return;
  const setting = await Store.get('settings', 'lastOverduePrompt');
  const today = todayISO();
  if (!setting || setting.value !== today) {
    await Store.put('settings', { key: 'lastOverduePrompt', value: today });
    openOverdueModal();
  }
}

/* ============================================================
   Manage panel: categories & special dates list
   ============================================================ */
let selectedNewCategoryColor = PALETTE[0];

function renderColorSwatches() {
  const wrap = document.getElementById('color-swatches');
  wrap.innerHTML = PALETTE.map(c =>
    `<button type="button" class="swatch-btn${c === selectedNewCategoryColor ? ' selected' : ''}" style="background:${c}" data-color="${c}"></button>`
  ).join('');
  wrap.querySelectorAll('.swatch-btn').forEach(btn => {
    btn.addEventListener('click', () => { selectedNewCategoryColor = btn.dataset.color; renderColorSwatches(); });
  });
}

function renderCategoryList() {
  const listEl = document.getElementById('category-list');
  if (state.categories.length === 0) {
    listEl.innerHTML = '<div class="week-empty">No categories yet</div>';
  } else {
    listEl.innerHTML = state.categories.map(c => `
      <div class="category-row">
        <span class="swatch" style="background:${c.color}"></span>
        <span class="cat-name">${escapeHTML(c.name)}</span>
        <button class="cat-del" data-id="${c.id}">✕</button>
      </div>`).join('');
  }
  listEl.querySelectorAll('.cat-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const inUse = state.tasks.some(t => t.categoryId === Number(btn.dataset.id));
      if (inUse && !confirm('Some tasks use this category. Delete it anyway? (Tasks will keep showing a default color.)')) return;
      await Store.delete('categories', Number(btn.dataset.id));
      await loadAll();
      renderCategoryList();
      renderCurrentView();
    });
  });
}

function renderSpecialList() {
  const listEl = document.getElementById('special-list');
  if (state.specialDates.length === 0) {
    listEl.innerHTML = '<div class="week-empty">No special dates yet</div>';
  } else {
    listEl.innerHTML = state.specialDates.map(s => {
      let sub = '';
      if (s.type === 'adhoc') sub = fromISO(s.date).toDateString();
      else if (s.type === 'annual') sub = `Every ${MONTH_LABELS[s.month]} ${s.day}`;
      else sub = `Every month on day ${s.day}`;
      const icon = s.type === 'annual' ? '🎂' : s.type === 'monthly' ? '💳' : '📌';
      return `<div class="task-chip special" data-special-id="${s.id}">
        <span class="task-chip-icon">${icon}</span>
        <span class="task-chip-title">${escapeHTML(s.label)} <span style="color:var(--text-faint);font-weight:400;">— ${sub}</span></span>
      </div>`;
    }).join('');
  }
  listEl.querySelectorAll('.task-chip.special').forEach(el => {
    el.addEventListener('click', () => { closeManage(); openSpecialModal(Number(el.dataset.specialId)); });
  });
}

function openManage() {
  renderCategoryList();
  renderColorSwatches();
  renderSpecialList();
  document.getElementById('manage-backdrop').hidden = false;
}
function closeManage() { document.getElementById('manage-backdrop').hidden = true; }

/* ============================================================
   Wire up static event listeners
   ============================================================ */
function initEvents() {
  document.getElementById('btn-prev').addEventListener('click', () => navigate(-1));
  document.getElementById('btn-next').addEventListener('click', () => navigate(1));
  document.getElementById('btn-today').addEventListener('click', goToday);
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  document.getElementById('btn-add').addEventListener('click', () => openTaskModal(null, toISO(state.anchor)));
  document.getElementById('task-cancel').addEventListener('click', closeTaskModal);
  document.getElementById('task-save').addEventListener('click', saveTask);
  document.getElementById('task-delete').addEventListener('click', deleteTask);

  document.getElementById('special-cancel').addEventListener('click', closeSpecialModal);
  document.getElementById('special-save').addEventListener('click', saveSpecial);
  document.getElementById('special-delete').addEventListener('click', deleteSpecial);
  document.getElementById('special-type').addEventListener('change', updateSpecialTypeFields);

  document.getElementById('agenda-close').addEventListener('click', closeAgenda);
  document.getElementById('agenda-add').addEventListener('click', () => {
    const iso = state.agendaDate;
    closeAgenda();
    openTaskModal(null, iso);
  });

  document.getElementById('btn-review-overdue').addEventListener('click', openOverdueModal);
  document.getElementById('overdue-done').addEventListener('click', closeOverdueModal);

  document.getElementById('btn-manage').addEventListener('click', openManage);
  document.getElementById('manage-close').addEventListener('click', closeManage);
  document.querySelectorAll('.manage-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.manage-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('manage-categories').hidden = tab.dataset.tab !== 'categories';
      document.getElementById('manage-special').hidden = tab.dataset.tab !== 'special';
    });
  });
  document.getElementById('add-category-btn').addEventListener('click', async () => {
    const name = document.getElementById('new-category-name').value.trim();
    if (!name) return;
    await Store.put('categories', { name, color: selectedNewCategoryColor });
    document.getElementById('new-category-name').value = '';
    await loadAll();
    renderCategoryList();
    renderCurrentView();
  });
  document.getElementById('add-special-btn').addEventListener('click', () => { closeManage(); openSpecialModal(null); });

  // Backdrop click-to-close for all sheets
  document.querySelectorAll('.sheet-backdrop').forEach(bd => {
    bd.addEventListener('click', (e) => { if (e.target === bd) bd.hidden = true; });
  });
}

/* ============================================================
   Boot
   ============================================================ */
async function boot() {
  await openDB();
  await seedDefaultsIfEmpty();
  await loadAll();
  initEvents();
  switchView('month');
  refreshOverdueBanner();
  await maybeAutoPromptOverdue();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', boot);
