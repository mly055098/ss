'use strict';
/* منصة مشرفي حركة الباصات: الواجهة. كل النصوص تُدرج بـ textContent لمنع حقن الأكواد. */

const $ = (s, el = document) => el.querySelector(s);
let me = null;
let alertCount = 0;

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined)).toString();
const fmt = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en'));
const num = (n) => h('span', { class: 'num' }, fmt(n));

/* ------------------------------------------------------------------ التواريخ */
/* التاريخ يُكتب بثلاث قوائم (يوم / شهر / سنة) وليس بحقل تاريخ المتصفح، فلا يتلخبط مع اتجاه الكتابة أو تقويم الجهاز. */
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}
const dt = (d) => h('span', { class: 'date' }, d ? fmtDate(d) : '—');

function dateField({ value = '', required = false, yearsBack = 2, yearsAhead = 10 } = {}) {
  const thisYear = Number(((me && me.today) || new Date().toISOString()).slice(0, 4));
  const blank = (t) => h('option', { value: '' }, t);
  const day = h('select', { 'aria-label': 'اليوم' }, blank('اليوم'));
  const mon = h('select', { 'aria-label': 'الشهر' }, blank('الشهر'), MONTHS.map((n, i) => h('option', { value: String(i + 1) }, n)));
  const yr = h('select', { 'aria-label': 'السنة' }, blank('السنة'));
  const wrap = h('div', { class: 'datepick', role: 'group' }, day, mon, yr);
  const years = new Set();
  for (let y = thisYear - yearsBack; y <= thisYear + yearsAhead; y++) years.add(y);

  const fillYears = (extra) => {
    const all = new Set(years);
    if (extra) all.add(extra);
    const cur = yr.value;
    yr.replaceChildren(blank('السنة'), ...[...all].sort((a, b) => a - b).map((y) => h('option', { value: String(y) }, String(y))));
    yr.value = cur;
  };
  const fillDays = () => {
    const max = mon.value ? new Date(Date.UTC(Number(yr.value) || 2024, Number(mon.value), 0)).getUTCDate() : 31;
    const cur = Number(day.value);
    day.replaceChildren(blank('اليوم'), ...Array.from({ length: max }, (_, i) => h('option', { value: String(i + 1) }, String(i + 1))));
    day.value = cur && cur <= max ? String(cur) : '';
  };
  const set = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
    if (!m) { yr.value = ''; mon.value = ''; fillDays(); day.value = ''; return; }
    fillYears(Number(m[1]));
    yr.value = m[1];
    mon.value = String(Number(m[2]));
    fillDays();
    day.value = String(Number(m[3]));
  };
  yr.addEventListener('change', fillDays);
  mon.addEventListener('change', fillDays);
  if (required) for (const s of [day, mon, yr]) s.required = true;
  Object.defineProperty(wrap, 'value', {
    get: () => (yr.value && mon.value && day.value ? `${yr.value}-${mon.value.padStart(2, '0')}-${day.value.padStart(2, '0')}` : ''),
    set,
  });
  wrap.isPartial = () => { const n = [yr, mon, day].filter((s) => s.value).length; return n > 0 && n < 3; };
  wrap.focus = () => day.focus();
  fillYears();
  fillDays();
  set(value);
  return wrap;
}

async function api(method, url, body) {
  const opt = { method, credentials: 'same-origin' };
  if (method !== 'GET') { opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body || {}); }
  const r = await fetch(url, opt);
  let data = {};
  try { data = await r.json(); } catch { /* not json */ }
  if (r.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error('انتهت الجلسة. سجّل الدخول مرة أخرى.'); }
  if (!r.ok) throw new Error(data.error || 'حصل خطأ غير متوقع');
  return data;
}

let toastTimer;
function toast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), isError ? 5000 : 2500);
}
const isAdmin = () => me && me.role === 'admin';
const daysLeft = (d) => Math.round((Date.parse(d) - Date.parse(me.today)) / 864e5);
const monthStart = () => me.today.slice(0, 8) + '01';

/* ------------------------------------------------------------- login/logout */
function showLogin() {
  me = null;
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#loginForm').password.value = '';
  $('#loginForm').username.focus();
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, err = $('#loginError');
  err.textContent = '';
  try {
    await api('POST', '/api/login', { username: f.username.value, password: f.password.value });
    await boot();
  } catch (ex) { err.textContent = ex.message; }
});
$('#btnLogout').addEventListener('click', async () => { try { await api('POST', '/api/logout'); } catch { /* ignore */ } showLogin(); });
$('#btnPassword').addEventListener('click', () => openForm({
  title: 'تغيير كلمة السر',
  fields: [
    { name: 'current', label: 'كلمة السر الحالية', type: 'password', required: true, wide: true },
    { name: 'next', label: 'كلمة السر الجديدة', type: 'password', required: true, wide: true, hint: '8 أحرف على الأقل' },
  ],
  onSubmit: async (v) => { await api('POST', '/api/me/password', v); toast('تم تغيير كلمة السر'); },
}));

/* ---------------------------------------------------------------- dialogs */
function openForm({ title, fields, values = {}, submitLabel = 'حفظ', onSubmit }) {
  const dlg = h('dialog', { class: 'modal' });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const inputs = {}, labels = {}, infos = {};
  const grid = h('div', { class: 'fgrid' });
  for (const f of fields) {
    let input;
    const id = 'f_' + f.name;
    /* الحقول المشروطة (showIf) لا نضع عليها required الأصلي لأنها قد تكون مخفية، ونتحقق منها يدوياً عند الحفظ */
    const nativeReq = !!f.required && !f.showIf;
    if (f.type === 'select') {
      input = h('select', { id }, (f.options || []).map((o) => h('option', { value: o.value }, o.label)));
      input.value = values[f.name] === null || values[f.name] === undefined ? (f.options[0] ? f.options[0].value : '') : String(values[f.name]);
    } else if (f.type === 'textarea') {
      input = h('textarea', { id, rows: 3 });
      input.value = values[f.name] ?? '';
    } else if (f.type === 'date') {
      input = dateField({ value: values[f.name] || '', required: nativeReq, yearsBack: f.past ? 3 : 2, yearsAhead: f.past ? 1 : 10 });
    } else {
      input = h('input', { id, type: f.type || 'text', inputmode: f.type === 'number' ? 'numeric' : null, autocomplete: f.type === 'password' ? 'new-password' : 'off' });
      input.value = values[f.name] ?? '';
      if (f.dir) input.setAttribute('dir', f.dir);
    }
    if (f.type !== 'date' && nativeReq) input.required = true;
    if (f.readonly) input.disabled = true;
    inputs[f.name] = input;
    if (f.info) infos[f.name] = h('small', { class: 'info', 'aria-live': 'polite' });
    labels[f.name] = h('label', { class: 'field' + (f.wide ? ' wide' : '') + (f.type === 'date' ? ' datefield' : ''), for: f.type === 'date' ? null : id },
      h('span', {}, f.label + (f.required ? ' *' : '')), input, f.hint ? h('small', {}, f.hint) : null, infos[f.name]);
    grid.append(labels[f.name]);
  }
  const refresh = () => {
    for (const f of fields) {
      if (f.showIf) labels[f.name].hidden = !f.showIf((k) => inputs[k].value);
      if (f.info) infos[f.name].textContent = f.info((k) => inputs[k].value);
    }
  };
  grid.addEventListener('change', refresh);
  refresh();
  const submit = h('button', { class: 'btn primary', type: 'submit' }, submitLabel);
  const form = h('form', { method: 'dialog' },
    h('header', {}, h('h2', {}, title)), grid, err,
    h('footer', {}, submit, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'إلغاء')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const out = {};
    for (const f of fields) {
      if (f.readonly || (f.showIf && labels[f.name].hidden)) continue;
      const el = inputs[f.name];
      if (f.type === 'date' && el.isPartial()) { err.textContent = `أكمل تاريخ "${f.label}" (اليوم والشهر والسنة) أو اتركه فارغاً`; el.focus(); return; }
      if (f.required && String(el.value).trim() === '') { err.textContent = `حقل "${f.label}" مطلوب`; el.focus(); return; }
      out[f.name] = el.value;
    }
    submit.disabled = true;
    try { await onSubmit(out); dlg.close(); }
    catch (ex) { err.textContent = ex.message; }
    finally { submit.disabled = false; }
  });
  dlg.append(form);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  const first = grid.querySelector('input:not([disabled]),select,textarea');
  if (first) first.focus();
}

/* -------------------------------------------------------------- table bits */
function table(cols, rows, emptyText, foot) {
  if (!rows.length) return h('div', { class: 'tablewrap' }, h('p', { class: 'empty' }, emptyText || 'لا توجد بيانات.'));
  return h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, cols.map((c) => h('td', { class: c.cls || '' }, c.render ? c.render(r) : (r[c.key] ?? '—')))))),
    foot ? h('tfoot', {}, foot) : null));
}
/* خانة توقيع: العنوان والاسم وخط التوقيع */
const sig = (title, name) => h('div', { class: 'sig' }, h('div', { class: 'sig-title' }, title), h('div', { class: 'sig-name' }, name || ' '), h('div', { class: 'sig-line' }, 'التوقيع'));
/* توقيعات التقارير: مشرف الفرع يميناً (أول عنصر في الاتجاه من اليمين) ومسؤول الخدمات اللوجستية يساراً */
const signatures = (sg = {}, cls = 'rp-foot') => h('footer', { class: cls },
  sig(sg.branch ? `مشرف الفرع — ${sg.branch}` : 'مشرف الفرع', sg.branch_supervisor), sig('مسؤول الخدمات اللوجستية', sg.logistics_officer));
function expiry(date) {
  if (!date) return h('span', { class: 'muted' }, '—');
  const d = daysLeft(date);
  if (d < 0) return h('span', {}, dt(date), ' ', h('span', { class: 'badge overdue' }, 'منتهية'));
  if (d <= 7) return h('span', {}, dt(date), ' ', h('span', { class: 'badge urgent' }, `بعد ${d} يوم`));
  if (d <= 30) return h('span', {}, dt(date), ' ', h('span', { class: 'badge soon' }, `بعد ${d} يوم`));
  return dt(date);
}
const STATUS = { active: 'يعمل', maintenance: 'في الصيانة', stopped: 'متوقف' };
const KIND = { maintenance: 'صيانة', oil: 'تغيير زيت', fuel: 'وقود' };
const opts = (obj) => Object.entries(obj).map(([value, label]) => ({ value, label }));
function field(label, ...ctrl) {
  const isDate = ctrl[0] && ctrl[0].classList && ctrl[0].classList.contains('datepick');
  return h('label', { class: 'field' + (isDate ? ' datefield' : '') }, h('span', {}, label), ...ctrl);
}
function selectEl(name, options, value = '') {
  const s = h('select', { name }, options.map((o) => h('option', { value: o.value }, o.label)));
  s.value = value;
  return s;
}
function pageHead(title, sub, ...actions) {
  return h('div', { class: 'pagehead' }, h('div', {}, h('h1', {}, title), sub ? h('p', { class: 'muted', style: 'margin:.2rem 0 0' }, sub) : null), h('div', { class: 'actions' }, actions));
}

/* ---------------------------------------------------------------- lookups */
async function lookups() {
  const [b, d, u, br] = await Promise.all([
    api('GET', '/api/buses'), api('GET', '/api/drivers'), api('GET', '/api/users'),
    isAdmin() ? api('GET', '/api/branches') : Promise.resolve({ rows: [] }),
  ]);
  return {
    buses: b.rows, drivers: d.rows, branches: br.rows,
    supervisors: u.users.filter((x) => (x.active !== 0 && x.role !== 'admin') || x.id === me.id),
  };
}
const busDesc = (x) => [x.make, x.model].filter(Boolean).join(' ');
const busOpts = (L, blank) => [...(blank ? [{ value: '', label: blank }] : []), ...L.buses.map((x) => ({
  value: x.id, label: x.plate + (busDesc(x) ? ` (${busDesc(x)})` : '') + (isAdmin() && x.supervisor_name ? ` — ${x.supervisor_name}` : ''),
}))];
const driverOpts = (L, blank) => [...(blank ? [{ value: '', label: blank }] : []), ...L.drivers.filter((x) => x.active).map((x) => ({ value: x.id, label: x.name }))];
const supOpts = (L, blank) => [...(blank ? [{ value: '', label: blank }] : []), ...L.supervisors.map((x) => ({ value: x.id, label: x.name + (x.branch_name ? ` — ${x.branch_name}` : '') }))];
const branchOpts = (L, blank) => [...(blank ? [{ value: '', label: blank }] : []), ...L.branches.map((x) => ({ value: x.id, label: x.name }))];
const branchFilter = (L) => (isAdmin() && L.branches.length ? [{ name: 'branch_id', label: 'الفرع', type: 'select', options: branchOpts(L, 'كل الفروع') }] : []);
const adminCols = () => (isAdmin() ? [{ label: 'الفرع', key: 'branch_name' }, { label: 'المشرف', key: 'supervisor_name' }] : []);

/* ---------------------------------------------------------- attachments UI */
async function openFiles(kind, id, title) {
  const dlg = h('dialog', { class: 'modal' });
  const list = h('ul', { class: 'filelist' });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const picker = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf', id: 'filepick' });
  async function load() {
    const { rows } = await api('GET', `/api/attachments?${qs({ owner_kind: kind, owner_id: id })}`);
    list.replaceChildren(...(rows.length ? rows.map((f) => h('li', {},
      h('a', { href: `/api/attachments/${f.id}/file`, target: '_blank', rel: 'noopener' }, f.filename),
      h('button', { class: 'btn small danger', type: 'button', onclick: async () => {
        if (!confirm('حذف هذا الملف؟')) return;
        try { await api('DELETE', `/api/attachments/${f.id}`); await load(); } catch (ex) { err.textContent = ex.message; }
      } }, 'حذف'))) : [h('li', { class: 'muted' }, 'لا توجد ملفات مرفوعة بعد. ارفع صورة الاستمارة أو ملف PDF.')]));
  }
  picker.addEventListener('change', async () => {
    const file = picker.files[0];
    if (!file) return;
    err.textContent = '';
    if (file.size > 5 * 1024 * 1024) { err.textContent = 'حجم الملف أكبر من 5 ميجا'; picker.value = ''; return; }
    let data;
    try { data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); }); }
    catch { err.textContent = 'تعذّرت قراءة الملف'; picker.value = ''; return; }
    try { await api('POST', '/api/attachments', { owner_kind: kind, owner_id: id, filename: file.name, mime: file.type, data }); toast('تم رفع الملف'); await load(); }
    catch (ex) { err.textContent = ex.message; }
    picker.value = '';
  });
  dlg.append(h('div', { class: 'modal-body' },
    h('header', {}, h('h2', {}, title)),
    field('رفع ملف جديد', picker, h('small', {}, 'صورة (JPG أو PNG) أو PDF، حتى 5 ميجا')),
    err, list,
    h('footer', {}, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'إغلاق'))));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  await load();
}

/* ----------------------------------------------------------- generic CRUD */
function crudPage(cfg) {
  return async function render(view) {
    const L = await lookups();
    const state = cfg.defaults ? cfg.defaults() : {};
    const out = h('div', {});
    const filterBox = h('form', { class: 'filters', onsubmit: (e) => { e.preventDefault(); load(); } });
    const result = h('div', {});
    const fdefs = cfg.filters(L);
    const ctrls = {};
    for (const f of fdefs) {
      let el;
      if (f.type === 'select') el = selectEl(f.name, f.options, state[f.name] || '');
      else if (f.type === 'date') el = dateField({ value: state[f.name] || '', yearsBack: 3, yearsAhead: 1 });
      else el = h('input', { name: f.name, type: f.type || 'text', value: state[f.name] || '', placeholder: f.placeholder || null });
      ctrls[f.name] = el;
      filterBox.append(field(f.label, el));
    }
    filterBox.append(h('button', { class: 'btn', type: 'submit' }, 'عرض'));
    const params = () => Object.fromEntries(fdefs.map((f) => [f.name, ctrls[f.name].value]));

    async function openEdit(row) {
      const L2 = await lookups();
      openForm({
        title: row ? `تعديل ${cfg.noun}` : cfg.addLabel,
        fields: cfg.fields(L2, row),
        values: row || cfg.newValues?.() || {},
        onSubmit: async (v) => {
          const body = cfg.prepare ? cfg.prepare(v) : v;
          if (row) await api('PUT', `/api/${cfg.entity}/${row.id}`, body);
          else await api('POST', `/api/${cfg.entity}`, body);
          toast('تم الحفظ');
          await refreshAlerts();
          load();
        },
      });
    }
    async function load() {
      result.replaceChildren(h('p', { class: 'muted' }, 'جارٍ التحميل…'));
      try {
        const { rows } = await api('GET', `/api/${cfg.entity}?${qs(params())}`);
        const cols = cfg.columns(rows).concat([{ label: '', cls: 'acts', render: (r) => [
          h('button', { class: 'btn small', type: 'button', onclick: () => openEdit(r) }, 'تعديل'),
          cfg.extra ? cfg.extra(r) : null,
          cfg.files ? h('button', { class: 'btn small', type: 'button', onclick: () => openFiles(cfg.files, r.id, `مرفقات: ${r.plate || r.name}`) }, 'المرفقات') : null,
          isAdmin() ? h('button', { class: 'btn small danger', type: 'button', onclick: async () => {
            if (!confirm(`حذف هذا ${cfg.noun} نهائياً؟`)) return;
            try { await api('DELETE', `/api/${cfg.entity}/${r.id}`); toast('تم الحذف'); load(); } catch (ex) { toast(ex.message, true); }
          } }, 'حذف') : null,
        ] }]);
        result.replaceChildren(...[table(cols, rows, cfg.empty), rows.length >= 500 ? h('p', { class: 'muted' }, 'تم عرض أحدث 500 سجل. ضيّق الفترة أو صدّر إلى Excel لرؤية الباقي.') : null].filter(Boolean));
      } catch (ex) { result.replaceChildren(h('p', { class: 'form-error' }, ex.message)); }
    }
    out.append(
      pageHead(cfg.title, cfg.sub,
        h('a', { class: 'btn noprint', href: '#', onclick: (e) => { e.preventDefault(); location.href = `/api/${cfg.entity}?${qs({ ...params(), format: 'xlsx' })}`; } }, 'تصدير Excel'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => openEdit(null) }, cfg.addLabel)),
      ...(fdefs.length ? [filterBox] : []), result);
    view.replaceChildren(out);
    load();
  };
}

const PAGES = {};

PAGES.trips = crudPage({
  entity: 'trips', title: 'حركة الباصات', sub: 'سجّل عدد الرحلات وقراءات العداد لكل باص.', noun: 'التسجيل', addLabel: 'تسجيل حركة',
  defaults: () => ({ from: monthStart() }),
  filters: (L) => [
    { name: 'from', label: 'من', type: 'date' }, { name: 'to', label: 'إلى', type: 'date' },
    { name: 'bus_id', label: 'الباص', type: 'select', options: busOpts(L, 'كل الباصات') },
    ...branchFilter(L),
    ...(isAdmin() ? [{ name: 'supervisor_id', label: 'المشرف', type: 'select', options: supOpts(L, 'كل المشرفين') }] : []),
  ],
  columns: () => [
    { label: 'التاريخ', render: (r) => dt(r.date) }, { label: 'الباص', key: 'bus_plate' }, { label: 'السائق', key: 'driver_name' },
    { label: 'الرحلات', render: (r) => num(r.trips_count) },
    { label: 'العداد', render: (r) => (r.odometer_start != null || r.odometer_end != null ? h('span', {}, num(r.odometer_start), ' ← ', num(r.odometer_end)) : '—') },
    { label: 'المسافة (كم)', render: (r) => num(r.odometer_start != null && r.odometer_end != null ? r.odometer_end - r.odometer_start : null) },
    ...adminCols(),
    { label: 'ملاحظات', key: 'notes', cls: 'sub' },
  ],
  newValues: () => ({ date: me.today }),
  fields: (L) => [
    { name: 'date', label: 'التاريخ', type: 'date', required: true, past: true },
    { name: 'bus_id', label: 'الباص', type: 'select', required: true, options: busOpts(L) },
    { name: 'driver_id', label: 'السائق', type: 'select', options: driverOpts(L, '— بدون —') },
    { name: 'trips_count', label: 'عدد الرحلات', type: 'number', required: true },
    { name: 'odometer_start', label: 'عداد البداية', type: 'number' },
    { name: 'odometer_end', label: 'عداد النهاية', type: 'number' },
    ...(isAdmin() ? [{ name: 'odometer_reset', label: 'استبدال العداد', type: 'select', options: [{ value: '0', label: 'لا' }, { value: '1', label: 'نعم: عداد جديد يبدأ من هذه القراءة' }], hint: 'اختر «نعم» فقط عند تغيير العداد أو إعادة ضبطه' }] : []),
    ...(isAdmin() ? [{ name: 'supervisor_id', label: 'مسجّل باسم المشرف', type: 'select', options: supOpts(L), wide: true }] : []),
    { name: 'notes', label: 'ملاحظات', type: 'textarea', wide: true },
  ],
  empty: 'لا توجد حركة مسجّلة في هذه الفترة. اضغط «تسجيل حركة» لإضافة أول تسجيل.',
});

PAGES.maintenance = crudPage({
  entity: 'maintenance', title: 'الصيانة والزيت والوقود', sub: 'سجّل كل تعبئة وقود أو تغيير زيت أو صيانة مع قراءة العداد.', noun: 'السجل', addLabel: 'تسجيل صيانة / زيت / وقود',
  defaults: () => ({}),
  filters: (L) => [
    { name: 'from', label: 'من', type: 'date' }, { name: 'to', label: 'إلى', type: 'date' },
    { name: 'bus_id', label: 'الباص', type: 'select', options: busOpts(L, 'كل الباصات') },
    { name: 'kind', label: 'النوع', type: 'select', options: [{ value: '', label: 'الكل' }, ...opts(KIND)] },
    ...branchFilter(L),
    ...(isAdmin() ? [{ name: 'supervisor_id', label: 'المشرف', type: 'select', options: supOpts(L, 'كل المشرفين') }] : []),
  ],
  columns: () => [
    { label: 'التاريخ', render: (r) => dt(r.date) }, { label: 'الباص', key: 'bus_plate' },
    { label: 'النوع', render: (r) => KIND[r.kind] }, { label: 'الوصف', key: 'description' },
    { label: 'العداد', render: (r) => num(r.odometer) }, { label: 'اللترات', render: (r) => (r.kind === 'fuel' ? num(r.liters) : '—') },
    { label: 'التكلفة', render: (r) => num(r.cost) },
    { label: 'الزيت القادم عند', render: (r) => num(r.next_oil_km) },
    ...adminCols(),
  ],
  newValues: () => ({ date: me.today, kind: 'fuel' }),
  fields: (L) => [
    { name: 'date', label: 'التاريخ', type: 'date', required: true, past: true },
    { name: 'bus_id', label: 'الباص', type: 'select', required: true, options: busOpts(L) },
    { name: 'kind', label: 'النوع', type: 'select', required: true, options: [{ value: 'fuel', label: KIND.fuel }, { value: 'oil', label: KIND.oil }, { value: 'maintenance', label: KIND.maintenance }] },
    { name: 'odometer', label: 'قراءة العداد الآن', type: 'number' },
    { name: 'liters', label: 'عدد اللترات', type: 'number', required: true, showIf: (g) => g('kind') === 'fuel' },
    { name: 'next_oil_km', label: 'تغيير الزيت القادم عند (كم)', type: 'number', showIf: (g) => g('kind') === 'oil', hint: 'مثال: لو العداد 120000 والزيت كل 10000 اكتب 130000' },
    { name: 'cost', label: 'التكلفة', type: 'number' },
    ...(isAdmin() ? [{ name: 'odometer_reset', label: 'استبدال العداد', type: 'select', options: [{ value: '0', label: 'لا' }, { value: '1', label: 'نعم: عداد جديد يبدأ من هذه القراءة' }], hint: 'اختر «نعم» فقط عند تغيير العداد أو إعادة ضبطه' }] : []),
    ...(isAdmin() ? [{ name: 'supervisor_id', label: 'مسجّل باسم المشرف', type: 'select', options: supOpts(L), wide: true }] : []),
    { name: 'description', label: 'الوصف', type: 'textarea', wide: true },
  ],
  empty: 'لا توجد سجلات. اضغط «تسجيل صيانة / زيت / وقود» لإضافة أول سجل.',
});

const isNewBus = (g) => g('bus_id') === '__new__';
PAGES.drivers = crudPage({
  entity: 'drivers', title: 'السائقون', sub: 'بيانات السائق والباص المفوض عليه والرخصة واستمارة السائق.', noun: 'السائق', addLabel: 'إضافة سائق', files: 'driver',
  filters: (L) => [{ name: 'q', label: 'بحث', placeholder: 'الاسم أو الهوية أو الجوال أو اللوحة' }, ...branchFilter(L)],
  columns: () => [
    { label: 'الاسم', key: 'name' },
    { label: 'رقم الهوية', render: (r) => (r.national_id ? h('span', { class: 'num' }, r.national_id) : '—') },
    { label: 'رقم الجوال', render: (r) => (r.phone ? h('span', { class: 'num' }, r.phone) : '—') },
    { label: 'الباص المفوض عليه', render: (r) => (r.bus_plate ? h('div', {},
      h('strong', {}, r.bus_plate),
      busDesc({ make: r.bus_make, model: r.bus_model }) ? h('div', {}, busDesc({ make: r.bus_make, model: r.bus_model })) : null,
      r.bus_serial ? h('div', { class: 'subline' }, 'الرقم التسلسلي: ', h('span', { class: 'num' }, r.bus_serial)) : null) : h('span', { class: 'muted' }, 'غير محدد')) },
    { label: 'الرخصة', render: (r) => h('div', {}, r.license_no ? h('div', { class: 'num' }, r.license_no) : null, expiry(r.license_expiry)) },
    { label: 'استمارة السائق', render: (r) => h('div', {}, r.form_no ? h('div', { class: 'num' }, r.form_no) : null, expiry(r.form_expiry)) },
    { label: 'الحالة', render: (r) => h('span', { class: 'badge ' + (r.active ? 'ok' : 'none') }, r.active ? 'على رأس العمل' : 'موقوف') },
    ...adminCols(),
  ],
  newValues: () => ({ active: 1 }),
  prepare: (v) => {
    const b = { ...v };
    if (v.bus_id === '__new__') {
      b.new_bus = { plate: v.nb_plate, make: v.nb_make, model: v.nb_model, serial_no: v.nb_serial, reg_form_no: v.nb_reg_no, reg_expiry: v.nb_reg_expiry, inspection_due: v.nb_inspection };
      b.bus_id = '';
    }
    for (const k of Object.keys(b)) if (k.startsWith('nb_')) delete b[k];
    return b;
  },
  fields: (L) => [
    { name: 'name', label: 'اسم السائق', required: true, wide: true },
    { name: 'national_id', label: 'رقم الهوية', dir: 'ltr', required: true, hint: 'أرقام فقط' },
    { name: 'phone', label: 'رقم الجوال', dir: 'ltr', required: true, hint: 'مثال: 0501234567' },
    { name: 'bus_id', label: 'الباص المفوض عليه (رقم اللوحة)', type: 'select', wide: true,
      options: [{ value: '', label: '— غير محدد —' }, { value: '__new__', label: '+ باص جديد (اكتب بياناته)' }, ...busOpts(L)],
      info: (g) => { const b = L.buses.find((x) => String(x.id) === String(g('bus_id'))); return b ? `الماركة: ${b.make || '—'}   |   الموديل: ${b.model || '—'}   |   الرقم التسلسلي: ${b.serial_no || '—'}` : ''; } },
    { name: 'nb_plate', label: 'رقم لوحة الباص الجديد', required: true, showIf: isNewBus },
    { name: 'nb_serial', label: 'الرقم التسلسلي للباص', dir: 'ltr', showIf: isNewBus },
    { name: 'nb_make', label: 'ماركة المركبة', hint: 'مثال: تويوتا', showIf: isNewBus },
    { name: 'nb_model', label: 'موديل المركبة', hint: 'مثال: كوستر 2022', showIf: isNewBus },
    { name: 'nb_reg_no', label: 'رقم استمارة المركبة', dir: 'ltr', showIf: isNewBus },
    { name: 'nb_reg_expiry', label: 'انتهاء استمارة المركبة', type: 'date', showIf: isNewBus },
    { name: 'nb_inspection', label: 'ميعاد الفحص الدوري', type: 'date', showIf: isNewBus },
    { name: 'license_no', label: 'رقم الرخصة', dir: 'ltr' }, { name: 'license_expiry', label: 'انتهاء الرخصة', type: 'date' },
    { name: 'form_no', label: 'رقم استمارة السائق', dir: 'ltr' }, { name: 'form_expiry', label: 'انتهاء استمارة السائق', type: 'date' },
    { name: 'active', label: 'الحالة', type: 'select', options: [{ value: '1', label: 'على رأس العمل' }, { value: '0', label: 'موقوف' }] },
    ...(isAdmin() ? [{ name: 'supervisor_id', label: 'المشرف المسؤول', type: 'select', options: supOpts(L), wide: true }] : []),
    { name: 'notes', label: 'ملاحظات', type: 'textarea', wide: true },
  ],
  empty: 'لا يوجد سائقون مسجّلون. اضغط «إضافة سائق» لتسجيل أول سائق.',
});

PAGES.buses = crudPage({
  entity: 'buses', title: 'الباصات', sub: 'بيانات كل باص واستمارة المركبة وميعاد الفحص الدوري.', noun: 'الباص', addLabel: 'إضافة باص', files: 'bus',
  filters: (L) => [
    { name: 'q', label: 'بحث', placeholder: 'اللوحة أو الماركة أو الرقم التسلسلي' },
    { name: 'status', label: 'الحالة', type: 'select', options: [{ value: '', label: 'الكل' }, ...opts(STATUS)] },
    ...branchFilter(L),
  ],
  columns: () => [
    { label: 'اللوحة', key: 'plate' }, { label: 'رقم الباص', key: 'fleet_no' }, { label: 'الماركة', key: 'make' }, { label: 'الموديل', key: 'model' },
    { label: 'الرقم التسلسلي', render: (r) => (r.serial_no ? h('span', { class: 'num' }, r.serial_no) : '—') },
    { label: 'السعة', render: (r) => num(r.capacity) },
    { label: 'استمارة المركبة', render: (r) => h('div', {}, r.reg_form_no ? h('div', { class: 'num' }, r.reg_form_no) : null, expiry(r.reg_expiry)) },
    { label: 'الفحص الدوري', render: (r) => expiry(r.inspection_due) },
    { label: 'الحالة', render: (r) => h('span', { class: 'badge ' + (r.status === 'active' ? 'ok' : r.status === 'maintenance' ? 'soon' : 'none') }, STATUS[r.status]) },
    ...adminCols(),
  ],
  extra: (r) => h('a', { class: 'btn small', href: `#/busreport?bus=${r.id}` }, 'تقرير'),
  newValues: () => ({ status: 'active' }),
  fields: (L) => [
    { name: 'plate', label: 'رقم اللوحة', required: true }, { name: 'fleet_no', label: 'رقم الباص' },
    { name: 'make', label: 'ماركة المركبة', hint: 'مثال: تويوتا' }, { name: 'model', label: 'موديل المركبة', hint: 'مثال: كوستر 2022' },
    { name: 'serial_no', label: 'الرقم التسلسلي للباص', dir: 'ltr' }, { name: 'capacity', label: 'السعة (راكب)', type: 'number' },
    { name: 'reg_form_no', label: 'رقم استمارة المركبة', dir: 'ltr' }, { name: 'reg_expiry', label: 'انتهاء الاستمارة', type: 'date' },
    { name: 'inspection_due', label: 'ميعاد الفحص الدوري القادم', type: 'date' },
    { name: 'status', label: 'الحالة', type: 'select', options: opts(STATUS) },
    ...(isAdmin() ? [{ name: 'supervisor_id', label: 'المشرف المسؤول', type: 'select', options: supOpts(L), wide: true }] : []),
    { name: 'notes', label: 'ملاحظات', type: 'textarea', wide: true },
  ],
  empty: 'لا توجد باصات مسجّلة. اضغط «إضافة باص» لتسجيل أول باص، وبعدها تقدر تسجّل حركته.',
});

/* --------------------------------------------------------------- dashboard */
function odometer(n) {
  const digits = String(n).padStart(4, '0').split('');
  const box = h('div', { class: 'odo', role: 'img', 'aria-label': String(n) }, digits.map(() => h('span', { 'aria-hidden': 'true' }, '0')));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const set = (v) => { const s = String(Math.round(v)).padStart(digits.length, '0'); [...box.children].forEach((c, i) => (c.textContent = s[i] || '0')); };
  if (reduce || n === 0) set(n);
  else { const t0 = performance.now(); const step = (t) => { const k = Math.min(1, (t - t0) / 800); set(n * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }
  return box;
}
const ALERT_TXT = (a) => (a.type === 'oil'
  ? (a.km_left <= 0 ? `متأخر ${fmt(Math.abs(a.km_left))} كم` : `باقي ${fmt(a.km_left)} كم`)
  : (a.days_left < 0 ? `منتهية منذ ${fmt(-a.days_left)} يوم` : a.days_left === 0 ? 'تنتهي اليوم' : `تنتهي بعد ${fmt(a.days_left)} يوم`));
const SEV = { overdue: ['overdue', 'عاجل'], urgent: ['urgent', 'قريب جداً'], soon: ['soon', 'قريب'] };

async function refreshAlerts() {
  try { alertCount = (await api('GET', '/api/summary')).alerts; } catch { return; }
  const c = $('#nav .count');
  if (c) { c.textContent = fmt(alertCount); c.hidden = !alertCount; }
}

PAGES.dashboard = async function (view) {
  const [s, al] = await Promise.all([api('GET', '/api/summary'), api('GET', '/api/alerts')]);
  alertCount = s.alerts;
  const alertTable = table([
    { label: 'التنبيه', render: (a) => `${a.label}: ${a.subject}` },
    { label: 'الموعد', render: (a) => h('span', { class: 'badge ' + SEV[a.severity][0] }, ALERT_TXT(a)) },
  ], al.rows.slice(0, 6), 'لا توجد تنبيهات. كل الأوراق سارية.');
  const board = isAdmin() ? table([
    { label: 'المشرف', key: 'name' }, { label: 'الفرع', render: (r) => r.branch_name || '—' },
    { label: 'اليوم', render: (r) => h('span', { class: 'badge ' + (r.entries ? 'ok' : 'soon') }, r.entries ? 'سجّل' : 'لم يسجّل بعد') },
    { label: 'الرحلات', render: (r) => num(r.trips) },
    { label: 'آخر تسجيل', render: (r) => (r.last_at ? h('span', { class: 'num' }, new Date(r.last_at.replace(' ', 'T') + 'Z').toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })) : '—') },
  ], s.board, 'لم تُضف حسابات مشرفين بعد. أضفهم من صفحة «المشرفون والفروع».') : null;
  const steps = isAdmin() && s.setup ? [
    ['branches', 'أضف الفروع', '#/users'], ['supervisors', 'أضف مشرفي الفروع', '#/users'],
    ['buses', 'أضف الباصات وبياناتها', '#/buses'], ['drivers', 'أضف السائقين', '#/drivers'],
  ] : [];
  const setup = steps.some(([k]) => !s.setup[k])
    ? h('section', { class: 'setup' }, h('h2', {}, 'خطوات تجهيز المنصة'),
      h('ol', {}, steps.map(([k, label, href]) => h('li', { class: s.setup[k] ? 'done' : '' },
        h('a', { href }, label), s.setup[k] ? h('span', { class: 'badge ok' }, `تم (${fmt(s.setup[k])})`) : null)))) : null;

  view.replaceChildren(...[
    pageHead('لوحة اليوم', fmtDate(s.today), h('button', { class: 'btn primary', type: 'button', onclick: () => { location.hash = '#/trips'; } }, 'تسجيل حركة')),
    setup,
    h('div', { class: 'hero' },
      h('div', { class: 'counter' },
        h('div', { class: 'label' }, isAdmin() ? 'رحلات اليوم لكل المشرفين' : 'رحلاتك اليوم'),
        odometer(s.trips_today),
        h('div', { class: 'foot' }, s.entries_today ? `من ${fmt(s.entries_today)} تسجيل` : 'لم يُسجَّل شيء اليوم بعد')),
      h('div', { class: 'facts' },
        h('div', { class: 'fact' }, h('b', {}, fmt(s.trips_month)), h('span', {}, 'رحلات هذا الشهر')),
        h('div', { class: 'fact' }, h('b', {}, fmt(s.buses)), h('span', {}, 'باصات تعمل')),
        h('div', { class: 'fact' }, h('b', {}, fmt(s.drivers)), h('span', {}, 'سائقون على رأس العمل')),
        h('a', { class: 'fact' + (s.alerts ? ' hot' : ''), href: '#/alerts' }, h('b', {}, fmt(s.alerts)), h('span', {}, 'تنبيهات تحتاج متابعة')))),
    h('div', { class: 'cols' },
      h('section', {}, h('h2', { class: 'section-title' }, 'أقرب التنبيهات', h('a', { href: '#/alerts' }, 'عرض الكل')), alertTable),
      board ? h('section', {}, h('h2', { class: 'section-title' }, 'تسجيل المشرفين اليوم'), board) : null),
  ].filter(Boolean));
};

/* ------------------------------------------------------------------ alerts */
PAGES.alerts = async function (view) {
  const { rows } = await api('GET', '/api/alerts');
  view.replaceChildren(
    pageHead('التنبيهات', 'أوراق منتهية أو تنتهي خلال 30 يوماً، وباصات اقترب موعد زيتها.'),
    table([
      { label: 'الأولوية', render: (a) => h('span', { class: 'badge ' + SEV[a.severity][0] }, SEV[a.severity][1]) },
      { label: 'البند', key: 'label' }, { label: 'الباص / السائق', key: 'subject' },
      { label: 'الموعد', render: (a) => (a.type === 'oil' ? h('span', {}, ALERT_TXT(a)) : h('span', {}, dt(a.due), ' — ', ALERT_TXT(a))) },
      ...(isAdmin() ? [{ label: 'المشرف', key: 'supervisor_name' }] : []),
      { label: '', cls: 'acts', render: (a) => h('a', { class: 'btn small', href: a.owner === 'bus' ? '#/buses' : '#/drivers' }, a.owner === 'bus' ? 'فتح الباصات' : 'فتح السائقين') },
    ], rows, 'لا توجد تنبيهات. كل الأوراق سارية وكل الباصات سليمة.'));
};

/* ----------------------------------------------------------------- reports */
PAGES.reports = async function (view) {
  const L = await lookups();
  let tab = 'traffic';
  const box = h('div', {});
  const TABS = { traffic: 'حركة الباصات', maintenance: 'الصيانة والزيت والوقود', oil: 'حالة الزيت', ...(isAdmin() ? { odometer: 'فحص العدادات' } : {}) };
  const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'نوع التقرير' });
  const result = h('div', {});
  const controls = h('form', { class: 'filters', onsubmit: (e) => { e.preventDefault(); run(); } });
  const printhead = h('div', { class: 'printhead' });
  const sigBox = h('div', {});
  let ctl = {};
  function currentParams() { return Object.fromEntries(Object.entries(ctl).map(([k, el]) => [k, el.value])); }

  function drawControls() {
    ctl = {};
    controls.replaceChildren();
    const add = (name, label, el) => { ctl[name] = el; controls.append(field(label, el)); };
    if (tab !== 'oil' && tab !== 'odometer') {
      add('from', 'من', dateField({ value: monthStart(), yearsBack: 3, yearsAhead: 1 }));
      add('to', 'إلى', dateField({ value: me.today, yearsBack: 3, yearsAhead: 1 }));
      add('bus_id', 'الباص', selectEl('bus_id', busOpts(L, 'كل الباصات')));
      if (isAdmin()) {
        if (L.branches.length) add('branch_id', 'الفرع', selectEl('branch_id', branchOpts(L, 'كل الفروع')));
        add('supervisor_id', 'المشرف', selectEl('supervisor_id', supOpts(L, 'كل المشرفين')));
      }
    }
    if (tab === 'traffic') {
      add('by', 'تجميع حسب', selectEl('by', [{ value: 'day', label: 'اليوم' }, { value: 'month', label: 'الشهر' }, { value: 'bus', label: 'الباص' },
        ...(isAdmin() ? [{ value: 'branch', label: 'الفرع' }] : []), { value: 'supervisor', label: 'المشرف' }], 'day'));
    }
    if (tab === 'maintenance') add('kind', 'النوع', selectEl('kind', [{ value: '', label: 'الكل' }, ...opts(KIND)]));
    controls.append(h('button', { class: 'btn primary', type: 'submit' }, 'عرض التقرير'));
  }
  async function run() {
    const p = currentParams();
    result.replaceChildren(h('p', { class: 'muted' }, 'جارٍ التحميل…'));
    const range = tab === 'oil' || tab === 'odometer' ? `حتى ${fmtDate(me.today)}` : `من ${p.from ? fmtDate(p.from) : 'البداية'} إلى ${p.to ? fmtDate(p.to) : fmtDate(me.today)}`;
    printhead.replaceChildren(h('img', { class: 'print-logo', src: 'logo.png', alt: 'شعار ابن رشد التعليمية القابضة' }),
      h('div', {}, h('h1', {}, TABS[tab]), h('div', {}, `${range} — أعدّه: ${me.name} — ${fmtDate(me.today)}`)));
    sigBox.replaceChildren();
    try {
      const data = await api('GET', `/api/reports/${tab}?${qs(p)}`);
      if (tab !== 'odometer') sigBox.replaceChildren(signatures(data.signers, 'rp-foot report-sign'));
      if (tab === 'traffic') {
        result.replaceChildren(table([
          { label: data.group_label, render: (r) => (p.by === 'day' || p.by === 'month' ? (p.by === 'day' ? dt(r.k) : h('span', { class: 'num' }, r.k)) : r.k) },
          { label: 'عدد التسجيلات', render: (r) => num(r.records) }, { label: 'عدد الرحلات', render: (r) => num(r.trips) }, { label: 'المسافة (كم)', render: (r) => num(r.km) },
        ], data.rows, 'لا توجد حركة في هذه الفترة.',
        h('tr', {}, h('td', {}, 'الإجمالي'), h('td', {}, num(data.totals.records)), h('td', {}, num(data.totals.trips)), h('td', {}, num(data.totals.km)))));
      } else if (tab === 'maintenance') {
        result.replaceChildren(table([
          { label: 'التاريخ', render: (r) => dt(r.date) }, { label: 'الباص', key: 'bus_plate' }, { label: 'النوع', render: (r) => KIND[r.kind] },
          { label: 'الوصف', key: 'description' }, { label: 'العداد', render: (r) => num(r.odometer) },
          { label: 'اللترات', render: (r) => (r.kind === 'fuel' ? num(r.liters) : '—') }, { label: 'التكلفة', render: (r) => num(r.cost) },
          { label: 'المشرف', key: 'supervisor_name' },
        ], data.rows, 'لا توجد سجلات في هذه الفترة.',
        h('tr', {}, h('td', { colspan: 5 }, `الإجمالي: ${fmt(data.totals.records)} سجل (وقود ${fmt(data.totals.fuel)}، زيت ${fmt(data.totals.oil)})`),
          h('td', {}, num(data.totals.liters)), h('td', {}, num(data.totals.cost)), h('td', {}))));
      } else if (tab === 'odometer') {
        result.replaceChildren(h('p', { class: 'muted' }, 'قراءات متعارضة في البيانات المسجّلة. صحّح السجل الخاطئ من صفحة الحركة أو الصيانة، أو علّم سجل تغيير العداد بـ «استبدال العداد».'),
          table([
            { label: 'الباص', key: 'plate' }, { label: 'نوع السجل', key: 'record' }, { label: 'التاريخ', render: (r) => dt(r.date) },
            { label: 'المشكلة', key: 'problem' }, { label: 'القراءة', render: (r) => num(r.reading) },
            { label: 'القراءة المقابلة', render: (r) => h('span', {}, num(r.other_reading), ' (', dt(r.other_date), ')') },
            { label: '', cls: 'acts', render: (r) => h('a', { class: 'btn small', href: r.table === 'trips' ? '#/trips' : '#/maintenance' }, 'فتح السجلات') },
          ], data.rows, 'لا توجد تعارضات في قراءات العدادات.'));
      } else {
        const S = { overdue: ['overdue', 'متأخر'], soon: ['soon', 'قريب'], ok: ['ok', 'سليم'], unknown: ['none', 'لا توجد بيانات'] };
        result.replaceChildren(table([
          { label: 'الباص', key: 'plate' }, { label: 'المشرف', key: 'supervisor_name' },
          { label: 'آخر تغيير', render: (r) => dt(r.last_oil_date) },
          { label: 'العداد الحالي', render: (r) => num(r.current_km) }, { label: 'الزيت القادم عند', render: (r) => num(r.next_oil_km) },
          { label: 'المتبقي (كم)', render: (r) => num(r.km_left) },
          { label: 'الحالة', render: (r) => h('span', { class: 'badge ' + S[r.state][0] }, S[r.state][1]) },
        ], data.rows, 'لا توجد باصات مسجّلة.'));
      }
    } catch (ex) { result.replaceChildren(h('p', { class: 'form-error' }, ex.message)); }
  }
  function drawTabs() {
    tabs.replaceChildren(...Object.entries(TABS).map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(k === tab), onclick: () => { tab = k; drawTabs(); drawControls(); run(); } }, label)));
  }
  view.replaceChildren(box);
  box.append(
    pageHead('التقارير', 'اختر نوع التقرير والفترة، ثم اعرضه أو صدّره.',
      h('a', { class: 'btn', href: '#/busreport' }, 'تقرير باص واحد'),
      h('button', { class: 'btn', type: 'button', onclick: () => { location.href = `/api/reports/${tab}?${qs({ ...currentParams(), format: 'xlsx' })}`; } }, 'تصدير Excel'),
      h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'طباعة / حفظ PDF')),
    tabs, controls, printhead, result, sigBox);
  drawTabs(); drawControls(); run();
};

/* ------------------------------------------------- تقرير حالة باص واحد (PDF) */
PAGES.busreport = async function (view) {
  const L = await lookups();
  const sp = new URLSearchParams(location.hash.split('?')[1] || '');
  const state = { bus: sp.get('bus') || '', from: sp.has('from') ? sp.get('from') : monthStart(), to: sp.has('to') ? sp.get('to') : me.today };
  /* الطباعة بدون هوامش المتصفح حتى لا تظهر ترويسة وتذييل المتصفح فوق التقرير */
  document.head.append(h('style', { id: 'pageStyle' }, '@page { size: A4; margin: 0; }'));

  const busSel = selectEl('bus', [{ value: '', label: '— اختر الباص —' }, ...busOpts(L)], state.bus);
  const fromEl = dateField({ value: state.from, yearsBack: 3, yearsAhead: 1 });
  const toEl = dateField({ value: state.to, yearsBack: 3, yearsAhead: 1 });
  const paper = h('article', { class: 'paper' });
  let current = null;
  const printBtn = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => printReport() }, 'تصدير PDF');

  function printReport() {
    if (!current) return;
    const old = document.title;
    document.title = `تقرير-باص-${current.bus.plate}-${me.today}`.replace(/\s+/g, '-');
    const restore = () => { document.title = old; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    window.print();
  }

  const docChip = (date) => {
    if (!date) return null;
    const d = daysLeft(date);
    const txt = d < 0 ? `منتهية منذ ${fmt(-d)} يوم` : d === 0 ? 'تنتهي اليوم' : `سارية، تنتهي بعد ${fmt(d)} يوم`;
    return h('span', {}, dt(date), ' ', h('span', { class: 'chip ' + (d < 0 ? 'overdue' : d <= 30 ? 'soon' : 'ok') }, txt));
  };
  const kv = (k, v, cls) => h('div', { class: 'kv' + (cls ? ' ' + cls : '') }, h('dt', {}, k), h('dd', {}, v === null || v === undefined || v === '' ? '—' : v));
  const sec = (title, ...kids) => h('section', { class: 'rp-sec' }, h('h2', {}, title), ...kids);
  const none = 'لا توجد سجلات في هذه الفترة.';

  function drawPaper(d) {
    const b = d.bus, t = d.totals, o = d.oil_status;
    const periodTxt = d.period.from || d.period.to
      ? `الفترة: من ${d.period.from ? fmtDate(d.period.from) : 'البداية'} إلى ${d.period.to ? fmtDate(d.period.to) : fmtDate(d.today)}`
      : 'الفترة: كل السجلات';

    const header = h('header', { class: 'rp-head' },
      h('img', { class: 'rp-logo', src: 'logo.png', alt: 'شعار ابن رشد التعليمية القابضة' }),
      h('div', { class: 'rp-title' }, h('h1', {}, 'تقرير حالة الباص'), h('div', { class: 'rp-plate' }, b.plate),
        h('div', { class: 'rp-period' }, periodTxt), h('div', { class: 'rp-period' }, `تاريخ الإصدار: ${fmtDate(d.today)}`)));

    const info = h('dl', { class: 'kvs' },
      kv('رقم اللوحة', h('strong', {}, b.plate)),
      kv('الرقم التسلسلي', b.serial_no ? h('span', { class: 'num' }, b.serial_no) : null),
      kv('ماركة المركبة', b.make), kv('موديل المركبة', b.model),
      kv('رقم الباص', b.fleet_no), kv('السعة', b.capacity ? `${fmt(b.capacity)} راكب` : null),
      kv('رقم استمارة المركبة', b.reg_form_no ? h('span', { class: 'num' }, b.reg_form_no) : null),
      kv('انتهاء الاستمارة', docChip(b.reg_expiry)),
      kv('ميعاد الفحص الدوري', docChip(b.inspection_due)),
      kv('الحالة', STATUS[b.status]), kv('الفرع', b.branch_name), kv('المشرف المسؤول', b.supervisor_name),
      kv('السائق المفوض', d.drivers.length ? d.drivers.map((x) => h('div', {}, x.name, ' ', x.phone ? h('span', { class: 'num' }, x.phone) : null)) : null, 'wide'));

    const stats = h('div', { class: 'stats' }, [
      ['عدد الرحلات', t.trips], ['المسافة المقطوعة (كم)', t.km], ['أيام التشغيل', t.days], ['الوقود (لتر)', t.fuel_liters],
      ['تكلفة الوقود', t.fuel_cost], ['مرات تغيير الزيت', t.oil_count], ['مرات الصيانة', t.maint_count], ['إجمالي التكاليف', t.total_cost],
    ].map(([k, v]) => h('div', { class: 'stat' }, h('b', { class: 'num' }, fmt(v)), h('span', {}, k))));

    const oilLine = o
      ? h('p', { class: 'oilline' }, 'آخر تغيير زيت: ', dt(o.last_date), o.last_odometer != null ? [' عند ', num(o.last_odometer), ' كم'] : '',
        o.next_km != null ? [' — القادم عند ', num(o.next_km), ' كم — ',
          h('span', { class: 'chip ' + (o.km_left <= 0 ? 'overdue' : o.km_left <= 500 ? 'soon' : 'ok') }, o.km_left <= 0 ? `متأخر ${fmt(-o.km_left)} كم` : `المتبقي ${fmt(o.km_left)} كم`)] : '')
      : h('p', { class: 'muted' }, 'لا يوجد تغيير زيت مسجّل لهذا الباص.');

    const tripsTable = table([
      { label: 'التاريخ', render: (r) => dt(r.date) }, { label: 'السائق', key: 'driver_name' }, { label: 'الرحلات', render: (r) => num(r.trips_count) },
      { label: 'عداد البداية', render: (r) => num(r.odometer_start) }, { label: 'عداد النهاية', render: (r) => num(r.odometer_end) }, { label: 'المسافة (كم)', render: (r) => num(r.km) },
    ], d.trips, none, h('tr', {}, h('td', { colspan: 2 }, 'الإجمالي'), h('td', {}, num(t.trips)), h('td', {}), h('td', {}), h('td', {}, num(t.km))));
    const fuelTable = table([
      { label: 'التاريخ', render: (r) => dt(r.date) }, { label: 'اللترات', render: (r) => num(r.liters) }, { label: 'التكلفة', render: (r) => num(r.cost) },
      { label: 'قراءة العداد', render: (r) => num(r.odometer) }, { label: 'ملاحظات', key: 'description', cls: 'sub' },
    ], d.fuel, none, h('tr', {}, h('td', {}, 'الإجمالي'), h('td', {}, num(t.fuel_liters)), h('td', {}, num(t.fuel_cost)), h('td', { colspan: 2 })));
    const oilTable = table([
      { label: 'التاريخ', render: (r) => dt(r.date) }, { label: 'قراءة العداد', render: (r) => num(r.odometer) }, { label: 'الزيت القادم عند', render: (r) => num(r.next_oil_km) },
      { label: 'التكلفة', render: (r) => num(r.cost) }, { label: 'ملاحظات', key: 'description', cls: 'sub' },
    ], d.oil, none, h('tr', {}, h('td', { colspan: 3 }, 'الإجمالي'), h('td', {}, num(t.oil_cost)), h('td', {})));
    const maintTable = table([
      { label: 'التاريخ', render: (r) => dt(r.date) }, { label: 'الوصف', key: 'description' }, { label: 'قراءة العداد', render: (r) => num(r.odometer) }, { label: 'التكلفة', render: (r) => num(r.cost) },
    ], d.maintenance, none, h('tr', {}, h('td', { colspan: 3 }, 'الإجمالي'), h('td', {}, num(t.maint_cost))));

    const foot = signatures(d.signers);

    const content = [header, sec('بيانات الباص', info), sec('ملخص الفترة', stats),
      sec('حالة الزيت', oilLine), sec('الحركة والمسافات المقطوعة', tripsTable), sec('الوقود', fuelTable),
      sec('تغيير الزيت', oilTable), sec('الصيانة', maintTable)];
    paper.replaceChildren(
      h('table', { class: 'sheet' },
        h('thead', {}, h('tr', {}, h('td', {}, h('div', { class: 'sheet-gap-top' })))),
        h('tbody', {}, h('tr', {}, h('td', {}, content))),
        h('tfoot', {}, h('tr', {}, h('td', {}, h('div', { class: 'sheet-gap-bottom' }))))),
      foot);
  }

  async function load() {
    state.bus = busSel.value;
    history.replaceState(null, '', `#/busreport?${qs({ bus: state.bus, from: fromEl.value, to: toEl.value })}`);
    current = null;
    printBtn.disabled = true;
    if (!state.bus) { paper.replaceChildren(h('p', { class: 'empty' }, L.buses.length ? 'اختر الباص من القائمة لعرض تقريره.' : 'لا توجد باصات مسجّلة بعد. أضف باصاً من صفحة «الباصات».')); return; }
    paper.replaceChildren(h('p', { class: 'muted' }, 'جارٍ التحميل…'));
    try {
      current = await api('GET', `/api/reports/bus/${state.bus}?${qs({ from: fromEl.value, to: toEl.value })}`);
      drawPaper(current);
      printBtn.disabled = false;
    } catch (ex) { paper.replaceChildren(h('p', { class: 'form-error' }, ex.message)); }
  }

  view.replaceChildren(
    pageHead('تقرير حالة باص', 'كل بيانات الباص والوقود والزيت والصيانة والمسافات في صفحة واحدة جاهزة للتصدير.'),
    h('form', { class: 'filters noprint', onsubmit: (e) => { e.preventDefault(); load(); } },
      field('الباص', busSel), field('من', fromEl), field('إلى', toEl),
      h('button', { class: 'btn', type: 'submit' }, 'عرض التقرير'), printBtn),
    h('p', { class: 'muted noprint pdfhint' }, 'زر «تصدير PDF» يفتح نافذة الطباعة، اختر منها «حفظ كملف PDF».'),
    paper);
  load();
};

/* --------------------------------------------------- المشرفون والفروع والإعدادات */
PAGES.users = async function (view) {
  if (!isAdmin()) { location.hash = '#/dashboard'; return; }
  const [{ users }, { rows: branches }, settings] = await Promise.all([api('GET', '/api/users'), api('GET', '/api/branches'), api('GET', '/api/settings')]);
  const redraw = () => PAGES.users(view);
  const roleTxt = { admin: 'مدير', supervisor: 'مشرف' };

  const editBranch = (b) => openForm({
    title: b ? `تعديل الفرع: ${b.name}` : 'إضافة فرع', values: b || {},
    fields: [{ name: 'name', label: 'اسم الفرع', required: true, wide: true }, { name: 'notes', label: 'ملاحظات', type: 'textarea', wide: true }],
    onSubmit: async (v) => { if (b) await api('PUT', `/api/branches/${b.id}`, v); else await api('POST', '/api/branches', v); toast('تم الحفظ'); redraw(); },
  });
  const editUser = (u) => openForm({
    title: u ? `تعديل: ${u.name}` : 'إضافة مشرف فرع',
    values: u || { role: 'supervisor', active: 1 },
    fields: [
      { name: 'name', label: 'الاسم', required: true, wide: true },
      ...(u ? [] : [{ name: 'username', label: 'اسم المستخدم (إنجليزي)', required: true, dir: 'ltr', hint: 'حروف وأرقام بدون مسافات' }]),
      { name: 'password', label: u ? 'كلمة سر جديدة' : 'كلمة السر', type: 'password', required: !u, hint: u ? 'اتركها فارغة بدون تغيير' : '8 أحرف على الأقل' },
      { name: 'branch_id', label: 'الفرع', type: 'select', options: [{ value: '', label: '— بدون فرع —' }, ...branches.map((x) => ({ value: x.id, label: x.name }))] },
      { name: 'role', label: 'الدور', type: 'select', options: [{ value: 'supervisor', label: 'مشرف' }, { value: 'admin', label: 'مدير' }] },
      ...(u ? [{ name: 'active', label: 'الحالة', type: 'select', options: [{ value: '1', label: 'نشط' }, { value: '0', label: 'موقوف' }] }] : []),
    ],
    onSubmit: async (v) => {
      if (u) { const body = { name: v.name, role: v.role, active: v.active === '1', branch_id: v.branch_id }; if (v.password) body.password = v.password; await api('PUT', `/api/users/${u.id}`, body); }
      else await api('POST', '/api/users', v);
      toast('تم الحفظ'); redraw();
    },
  });

  const logistics = h('input', { name: 'logistics_officer', value: settings.logistics_officer || '', maxlength: '100' });
  const block = (title, action, ...kids) => h('section', { class: 'block' }, h('div', { class: 'block-head' }, h('h2', {}, title), action), ...kids);

  view.replaceChildren(
    pageHead('المشرفون والفروع', 'أنشئ الفروع أولاً، ثم أضف مشرف كل فرع وسلّمه اسم المستخدم وكلمة السر. أنت وحدك ترى بيانات كل الفروع.'),
    block('الفروع', h('button', { class: 'btn primary', type: 'button', onclick: () => editBranch(null) }, 'إضافة فرع'),
      table([
        { label: 'اسم الفرع', key: 'name' }, { label: 'عدد المشرفين', render: (b) => num(b.supervisors) }, { label: 'ملاحظات', key: 'notes', cls: 'sub' },
        { label: '', cls: 'acts', render: (b) => [
          h('button', { class: 'btn small', type: 'button', onclick: () => editBranch(b) }, 'تعديل'),
          h('button', { class: 'btn small danger', type: 'button', onclick: async () => {
            if (!confirm(`حذف فرع «${b.name}»؟`)) return;
            try { await api('DELETE', `/api/branches/${b.id}`); toast('تم الحذف'); redraw(); } catch (ex) { toast(ex.message, true); }
          } }, 'حذف')] },
      ], branches, 'لا توجد فروع بعد. اضغط «إضافة فرع» لتسجيل أول فرع.')),
    block('مشرفو الفروع', h('button', { class: 'btn primary', type: 'button', onclick: () => editUser(null) }, 'إضافة مشرف'),
      table([
        { label: 'الاسم', key: 'name' }, { label: 'اسم المستخدم', render: (u) => h('span', { class: 'num' }, u.username) },
        { label: 'الفرع', render: (u) => u.branch_name || '—' }, { label: 'الدور', render: (u) => roleTxt[u.role] },
        { label: 'الحالة', render: (u) => h('span', { class: 'badge ' + (u.active ? 'ok' : 'none') }, u.active ? 'نشط' : 'موقوف') },
        { label: '', cls: 'acts', render: (u) => h('button', { class: 'btn small', type: 'button', onclick: () => editUser(u) }, 'تعديل') },
      ], users)),
    block('أسماء الموقّعين على التقارير', null,
      h('form', { class: 'filters', onsubmit: async (e) => {
        e.preventDefault();
        try { await api('PUT', '/api/settings', { logistics_officer: logistics.value }); toast('تم حفظ الأسماء'); } catch (ex) { toast(ex.message, true); }
      } }, field('اسم مسؤول الخدمات اللوجستية (يسار التقرير)', logistics),
      h('p', { class: 'muted' }, 'يمين التقرير: اسم مشرف الفرع يُؤخذ تلقائياً من المشرف المرتبط بالفرع أو بالباص.'),
      h('button', { class: 'btn primary', type: 'submit' }, 'حفظ الأسماء'))),
    block('نسخة احتياطية', null,
      h('p', { class: 'muted' }, 'نزّل نسخة من قاعدة البيانات بشكل دوري واحتفظ بها في مكان آمن. النسخة تحتوي بيانات الحسابات، فلا تشاركها مع أحد.'),
      h('a', { class: 'btn', href: '/api/backup' }, 'تنزيل نسخة احتياطية')));
};

/* ------------------------------------------------------------------- audit */
PAGES.audit = async function (view) {
  if (!isAdmin()) { location.hash = '#/dashboard'; return; }
  const { rows } = await api('GET', '/api/audit');
  const A = { create: 'إضافة', update: 'تعديل', delete: 'حذف', login: 'دخول', login_failed: 'محاولة دخول فاشلة', upload: 'رفع ملف', delete_file: 'حذف ملف', change_password: 'تغيير كلمة السر', backup: 'نسخة احتياطية' };
  const E = { buses: 'الباصات', drivers: 'السائقون', trips: 'الحركة', maintenance: 'الصيانة', users: 'المستخدمون', branches: 'الفروع', settings: 'الإعدادات' };
  view.replaceChildren(
    pageHead('سجل العمليات', 'آخر 300 عملية: من أضاف أو عدّل أو حذف.'),
    table([
      { label: 'الوقت', render: (r) => h('span', { class: 'num' }, new Date(r.ts.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { hour12: false })) },
      { label: 'المستخدم', render: (r) => r.user_name || '—' }, { label: 'العملية', render: (r) => A[r.action] || r.action },
      { label: 'القسم', render: (r) => E[r.entity] || '—' }, { label: 'التفاصيل', key: 'detail', cls: 'sub' },
    ], rows, 'لا توجد عمليات مسجّلة.'));
};

/* ------------------------------------------------------------------ router */
const NAV = [
  ['dashboard', 'لوحة اليوم'], ['trips', 'الحركة'], ['maintenance', 'الصيانة والزيت والوقود'], ['drivers', 'السائقون'], ['buses', 'الباصات'],
  ['reports', 'التقارير'], ['busreport', 'تقرير باص'], ['alerts', 'التنبيهات'], ['users', 'المشرفون والفروع', true], ['audit', 'سجل العمليات', true],
];
function drawNav(current) {
  $('#nav').replaceChildren(...NAV.filter((n) => !n[2] || isAdmin()).map(([k, label]) => h('a', { href: '#/' + k, 'aria-current': k === current ? 'page' : null },
    label, k === 'alerts' ? h('span', { class: 'count', hidden: !alertCount }, fmt(alertCount)) : null)));
}
async function route() {
  if (!me) return;
  const key = (location.hash.match(/^#\/(\w+)/) || [])[1];
  const page = PAGES[key] ? key : 'dashboard';
  const ps = document.getElementById('pageStyle');
  if (ps) ps.remove();
  drawNav(page);
  const view = $('#view');
  try { await PAGES[page](view); drawNav(page); }
  catch (ex) { view.replaceChildren(h('p', { class: 'form-error' }, ex.message)); }
  document.title = (NAV.find((n) => n[0] === page) || [0, 'المنصة'])[1] + ' — مشرفو الحركة';
}
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

async function boot() {
  try {
    const r = await api('GET', '/api/me');
    me = { ...r.user, today: r.today };
  } catch { showLogin(); return; }
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#whoami').textContent = me.name;
  $('#roleLabel').textContent = isAdmin() ? 'المدير' : 'مشرف حركة';
  try { alertCount = (await api('GET', '/api/summary')).alerts; } catch { /* ignore */ }
  route();
}
boot();
