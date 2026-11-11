/* =====================================================================
   CrewPulse — Field Manpower & Workfront Log (offline browser prototype)
   Data model + local persistence + rule-based analytics
   ===================================================================== */
'use strict';

const KEY = 'crewpulse.v1';
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ------------------------------ Constraint catalogue ------------------------------ */
const CATALOG = [
  { code: 'SCAFF',  ar: 'سقالات غير جاهزة',      en: 'Scaffolding not ready',   owner: 'Scaffolding Superintendent' },
  { code: 'MATL',   ar: 'عدم تسليم مواد',        en: 'Material not delivered',  owner: 'Materials / Procurement' },
  { code: 'PERMIT', ar: 'تصريح عمل معلّق',       en: 'Permit to work pending',  owner: 'HSE / Operations' },
  { code: 'NDT',    ar: 'فحص NDT غير مكتمل',     en: 'NDT clearance pending',   owner: 'QA/QC' },
  { code: 'WFR',    ar: 'مساحة عمل غير متاحة',   en: 'Workfront not released',  owner: 'Construction Manager' },
  { code: 'EQUIP',  ar: 'معدات معطلة',           en: 'Equipment breakdown',     owner: 'Plant / Maintenance' },
  { code: 'ENG',    ar: 'استفسار هندسي',         en: 'Engineering query',       owner: 'Engineering' },
  { code: 'MANP',   ar: 'نقص عمالة',             en: 'Manpower shortage',       owner: 'Subcontractor' },
  { code: 'WEA',    ar: 'ظروف جوية',             en: 'Weather',                 owner: 'Construction Manager' }
];
const catOf = c => CATALOG.find(x => x.code === c) || { code: c, ar: c, en: c, owner: '—' };

/* ------------------------------ Utilities ------------------------------ */
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const num = (n, d = 0) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const dayName = s => parseISO(s).toLocaleDateString('ar-EG', { weekday: 'long' });

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.className = 'toast' + (bad ? ' bad' : ''); }, 3200);
}

/* ------------------------------ State ------------------------------ */
let S = null;

function defaultState() {
  return {
    project: 'حقل غاز — حزمة EPC-2 (تجريبي)',
    targetDays: 3,
    workfronts: [],
    logs: [],
    constraints: []
  };
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
    $('#syncTxt').textContent = 'محفوظ على الجهاز';
    $('#syncDot').classList.remove('off');
  } catch (e) {
    $('#syncTxt').textContent = 'فشل الحفظ';
    $('#syncDot').classList.add('off');
  }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    S = raw ? JSON.parse(raw) : null;
  } catch (e) { S = null; }
  if (!S || !Array.isArray(S.logs)) { S = defaultState(); seed(true); }
}

/* ------------------------------ Seed demo data ------------------------------ */
function seed(silent) {
  const wf = [
    ['Process Area 100', 'Piping System 1', 'Piping',      'Line 6"-P-101 (DI)', 5000, 'DI'],
    ['Process Area 100', 'Piping System 1', 'Welding',     'Weld joints — P-101', 120, 'Weld'],
    ['Process Area 100', 'Structural Steel', 'Scaffolding','Scaffold volume',     5100, 'm²'],
    ['Utility Area 200', 'Equipment Package', 'Mechanical','Pump / exchanger set', 165, 'EA'],
    ['Utility Area 200', 'Civil Works', 'Civil',           'Concrete & foundations', 3150, 'm³'],
    ['Tank Farm 300',    'Electrical & Inst.', 'Electrical','Cable tray & pulling', 4800, 'm']
  ].map(([area, system, discipline, item, planned, unit]) => ({ area, system, discipline, item, planned, unit }));

  const crews = [
    { leader: 'محمد سعيد',    area: 'Process Area 100', system: 'Piping System 1', discipline: 'Piping',      unit: 'DI',   head: 9,  hours: 81,  rate: 5.6 },
    { leader: 'عبدالله الحربي', area: 'Process Area 100', system: 'Piping System 1', discipline: 'Welding',     unit: 'Weld', head: 6,  hours: 54,  rate: 0.19 },
    { leader: 'سامي منصور',   area: 'Process Area 100', system: 'Structural Steel', discipline: 'Scaffolding', unit: 'm²',  head: 8,  hours: 72,  rate: 6.1 },
    { leader: 'رامي خليل',    area: 'Utility Area 200', system: 'Equipment Package', discipline: 'Mechanical', unit: 'EA',  head: 7,  hours: 63,  rate: 0.22 },
    { leader: 'فهد العتيبي',  area: 'Utility Area 200', system: 'Civil Works', discipline: 'Civil',           unit: 'm³',  head: 6,  hours: 54,  rate: 3.5 },
    { leader: 'ياسر عبده',    area: 'Tank Farm 300',    system: 'Electrical & Inst.', discipline: 'Electrical', unit: 'm',   head: 10, hours: 90,  rate: 4.4 }
  ];

  const logs = [], cons = [];
  let rnd = 7;
  const rand = () => { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280; };

  for (let d = 11; d >= 0; d--) {
    const date = iso(addDays(new Date(), -d));
    crews.forEach((c, ci) => {
      // occasional missing log to make "no report" visible
      if (rand() < 0.06) return;
      let factor = 0.92 + rand() * 0.16;
      let consCodes = [];

      // scaffolding stalling two crews across two areas (piping + mechanical)
      if (d <= 4 && (ci === 0 || ci === 3) && rand() < 0.75) { consCodes.push('SCAFF'); factor *= 0.55; }
      if (d <= 6 && ci === 1 && rand() < 0.5) { consCodes.push('NDT'); factor *= 0.62; }
      if (d <= 2 && ci === 2 && rand() < 0.6) { consCodes.push('MATL'); factor *= 0.6; }
      if (d <= 3 && ci === 5 && rand() < 0.35) { consCodes.push('PERMIT'); factor *= 0.7; }

      const hours = c.hours + Math.round((rand() - 0.5) * 6);
      const qty = +(c.rate * hours * factor).toFixed(1);
      const log = {
        id: uid(), date, shift: rand() < 0.5 ? 'Day' : 'Night',
        area: c.area, system: c.system, discipline: c.discipline, leader: c.leader,
        head: c.head, hours, qty, unit: c.unit, constraints: consCodes,
        note: consCodes.length ? 'توقف جزئي بسبب ' + consCodes.map(k => catOf(k).ar).join(' + ') : '',
        ts: Date.now() - d * 86400000
      };
      logs.push(log);
      consCodes.forEach(code => cons.push({
        id: uid(), code, area: c.area, system: c.system, leader: c.leader,
        owner: catOf(code).owner, openedAt: date,
        closedAt: (d > 2 && rand() < 0.45) ? iso(addDays(parseISO(date), 2)) : null,
        logId: log.id
      }));
    });
  }

  S.workfronts = wf;
  S.logs = logs;
  S.constraints = cons;
  save();
  if (!silent) toast('تم تحميل بيانات تجريبية: ' + logs.length + ' وردية');
}

/* ------------------------------ Derived analytics ------------------------------ */
function logsInRange(days, area) {
  let arr = S.logs.slice();
  if (area && area !== 'all') arr = arr.filter(l => l.area === area);
  if (days > 0) {
    const from = iso(addDays(new Date(), -days + 1));
    arr = arr.filter(l => l.date >= from);
  }
  return arr.sort((a, b) => (a.date === b.date ? b.ts - a.ts : b.date.localeCompare(a.date)));
}

function plannedFor(area, system, discipline) {
  return S.workfronts.reduce((t, w) => {
    if (area && w.area !== area) return t;
    if (system && w.system !== system) return t;
    if (discipline && w.discipline !== discipline) return t;
    return t + Number(w.planned || 0);
  }, 0);
}

function unitFor(area, system, discipline) {
  const set = new Set(S.workfronts.filter(w => w.area === area && w.system === system && (!discipline || w.discipline === discipline)).map(w => w.unit));
  return set.size === 1 ? [...set][0] : (set.size ? 'مختلط' : '—');
}

/* productivity flags: latest log rate vs crew's own prior average */
function productivityFlags() {
  const groups = {};
  S.logs.forEach(l => {
    const k = l.leader + '|' + l.area + '|' + l.discipline;
    (groups[k] = groups[k] || []).push(l);
  });

  const flags = [];
  Object.values(groups).forEach(list => {
    list.sort((a, b) => (a.date === b.date ? a.ts - b.ts : a.date.localeCompare(b.date)));
    if (list.length < 2) return;
    const last = list[list.length - 1];
    const prior = list.slice(-4, -1).filter(l => Number(l.hours) > 0);
    if (!prior.length) return;
    const avgRate = prior.reduce((t, l) => t + Number(l.qty) / Number(l.hours), 0) / prior.length;
    const rate = Number(last.hours) > 0 ? Number(last.qty) / Number(last.hours) : 0;
    if (!avgRate) return;
    const delta = (rate - avgRate) / avgRate;
    if (delta <= -0.25) {
      flags.push({
        level: last.constraints.length ? 'warn' : 'bad',
        leader: last.leader, area: last.area, discipline: last.discipline,
        date: last.date, delta, rate, avgRate, unit: last.unit,
        constraints: last.constraints
      });
    }
  });

  // crews that logged yesterday but not today
  const todayLogs = S.logs.filter(l => l.date === today());
  const todayLeaders = new Set(todayLogs.map(l => l.leader));
  const yLeaders = new Set(S.logs.filter(l => l.date === iso(addDays(new Date(), -1))).map(l => l.leader));
  yLeaders.forEach(l => {
    if (!todayLeaders.has(l)) flags.push({ level: 'info', missing: true, leader: l });
  });

  return flags.sort((a, b) => (a.level === 'bad' ? -1 : 1) - (b.level === 'bad' ? -1 : 1));
}

function constraintStats() {
  const open = S.constraints.filter(c => !c.closedAt);
  const ages = open.map(c => Math.max(0, daysBetween(c.openedAt, today())));
  return {
    open: open.length,
    closed: S.constraints.filter(c => c.closedAt).length,
    avgAge: ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0,
    late: ages.filter(a => a > (S.targetDays || 3)).length
  };
}

/* ------------------------------ Dashboard ------------------------------ */
function renderDashboard() {
  const area = $('#filterArea').value || 'all';
  const days = Number($('#filterDays').value || 30);
  const logs = logsInRange(days, area);

  const actual = logs.reduce((t, l) => t + Number(l.qty), 0);
  const planned = plannedFor(area === 'all' ? null : area);
  const pct = planned ? Math.min(999, actual / planned * 100) : 0;
  const hours = logs.reduce((t, l) => t + Number(l.hours), 0);

  $('#kProgress').innerHTML = num(pct, 0) + '<small>%</small>';
  $('#kProgressBar').style.width = Math.min(100, pct) + '%';
  $('#kProgressFoot').textContent = `فعلي ${num(actual, 0)} مقابل مخطط ${num(planned, 0)}`;
  $('#kpiProgress').className = 'card kpi ' + (pct >= 85 ? 'ok' : pct >= 60 ? 'warn' : 'bad');

  $('#kHours').textContent = num(hours);
  $('#kHoursFoot').textContent = `${logs.length} وردية · متوسط ${logs.length ? num(hours / logs.length) : 0} ساعة/وردية`;

  const leaders = new Set(logs.map(l => l.leader));
  const allLeaders = new Set(S.logs.map(l => l.leader));
  $('#kCrews').textContent = `${leaders.size} / ${allLeaders.size || 0}`;
  const todayLogs = S.logs.filter(l => l.date === today());
  $('#kCrewsFoot').textContent = `سجّلت اليوم: ${new Set(todayLogs.map(l => l.leader)).size} فرقة`;

  const cs = constraintStats();
  $('#kCons').textContent = cs.open;
  $('#kConsFoot').textContent = `${cs.late} متأخرة · متوسط العمر ${num(cs.avgAge, 1)} يوم`;
  $('#tabConsN').textContent = cs.open;
  $('#tabDashN').textContent = logs.length;

  /* chart by area+system package */
  const packages = [];
  const seen = new Set();
  S.workfronts.forEach(w => {
    const k = w.area + '|' + w.system + '|' + w.discipline;
    if (seen.has(k)) return;
    seen.add(k);
    if (area !== 'all' && w.area !== area) return;
    packages.push({ area: w.area, system: w.system, discipline: w.discipline });
  });

  const rows = packages.map(p => {
    const act = logs.filter(l => l.area === p.area && l.system === p.system && l.discipline === p.discipline)
      .reduce((t, l) => t + Number(l.qty), 0);
    const plan = plannedFor(p.area, p.system, p.discipline);
    return { ...p, act, plan, pct: plan ? act / plan * 100 : 0, unit: unitFor(p.area, p.system, p.discipline) };
  }).sort((a, b) => b.plan - a.plan);

  const max = Math.max(1, ...rows.map(r => Math.max(r.plan, r.act)));
  $('#areaChart').innerHTML = rows.length ? rows.map(r => `
    <div class="crow">
      <div class="name" title="${esc(r.area + ' — ' + r.system + ' — ' + r.discipline)}">${esc(r.area)}<br><span style="color:var(--txt-3);font-weight:500;font-size:11px">${esc(r.discipline)} · ${esc(r.system)}</span></div>
      <div class="bars">
        <div class="track"><i class="plan" style="width:${(r.plan / max * 100).toFixed(1)}%"></i></div>
        <div class="track"><i class="act ${r.pct < 85 ? 'behind' : ''}" style="width:${(r.act / max * 100).toFixed(1)}%"></i></div>
      </div>
      <div class="num"><b>${num(r.pct, 0)}%</b><br><span style="font-size:10.5px">${num(r.act, 0)}/${num(r.plan, 0)} ${esc(r.unit)}</span></div>
    </div>`).join('') : `<div class="empty">لا توجد بنود في القائمة المرجعية — استوردها من شاشة الإعدادات.</div>`;

  /* discipline table */
  const disc = {};
  logs.forEach(l => {
    const d = disc[l.discipline] = disc[l.discipline] || { hours: 0, qty: 0, plan: 0 };
    d.hours += Number(l.hours); d.qty += Number(l.qty);
  });
  Object.keys(disc).forEach(k => { disc[k].plan = plannedFor(area === 'all' ? null : area, null, k); });

  $('#discTable').innerHTML = Object.keys(disc).length ? Object.entries(disc)
    .sort((a, b) => b[1].qty - a[1].qty)
    .map(([k, v]) => `<tr>
      <td><b>${esc(k)}</b></td>
      <td class="num">${num(v.hours)}</td>
      <td class="num">${v.hours ? num(v.qty / v.hours, 2) : '—'}</td>
      <td class="num">${num(v.qty, 0)}</td>
      <td class="num">${num(v.plan, 0)}</td>
      <td class="num">${v.plan ? `<span class="tag ${v.qty / v.plan >= .85 ? 'ok' : 'warn'}">${num(v.qty / v.plan * 100, 0)}%</span>` : '—'}</td>
    </tr>`).join('') : `<tr><td colspan="6" class="empty">لا سجلات بعد.</td></tr>`;

  /* recent logs */
  const recent = logs.slice(0, 8);
  $('#recentLogs').innerHTML = recent.length ? recent.map(l => `<tr>
      <td class="num" style="font-size:11.5px">${esc(l.date)}</td>
      <td>${esc(l.leader)}<div class="muted">${esc(l.discipline)}</div></td>
      <td>${esc(l.area)}</td>
      <td class="num">${num(l.head)}</td>
      <td class="num">${num(l.hours)}</td>
      <td class="num">${num(l.qty, 1)} <span class="muted">${esc(l.unit)}</span></td>
    </tr>`).join('') : `<tr><td colspan="6" class="empty">لا سجلات في هذه الفترة.</td></tr>`;
  $('#logCount').textContent = `${logs.length} سجل`;

  /* flags */
  const flags = productivityFlags();
  $('#flagsBox').innerHTML = flags.length ? flags.map(f => {
    if (f.missing) return `<div class="flag warn">
        <div class="ico">⏳</div>
        <div class="body"><div class="t">${esc(f.leader)} — لا يوجد سجل اليوم</div>
        <div class="d">سجّل أمس ولم يُسجّل وردية اليوم. تنبيه تلقائي قبل نهاية الوردية.</div></div>
        <div class="side">مفقود</div></div>`;
    const cons = f.constraints.length ? f.constraints.map(c => catOf(c).ar).join(' + ') : '';
    return `<div class="flag ${f.level}">
      <div class="ico">${f.constraints.length ? '⚠️' : '❓'}</div>
      <div class="body">
        <div class="t">${esc(f.leader)} — ${esc(f.discipline)} · ${esc(f.area)}</div>
        <div class="d">${f.constraints.length
          ? `الإنتاج/ساعة انخفض ${num(Math.abs(f.delta) * 100, 0)}% — يُعزى إلى: <b style="color:var(--warn)">${esc(cons)}</b>`
          : `الإنتاج/ساعة انخفض ${num(Math.abs(f.delta) * 100, 0)}% بدون تسجيل معوق — اسأل المشرف عن السبب.`}</div>
      </div>
      <div class="side">${num(f.rate, 2)}<br><span style="color:var(--txt-3)">متوسط ${num(f.avgRate, 2)}</span></div>
    </div>`;
  }).join('') : `<div class="empty">لا رايات — كل الفرَق عند متوسطها الطبيعي.</div>`;
}

/* ------------------------------ Shift log ------------------------------ */
let selectedConstraints = new Set();
let timerStart = null, timerInt = null;

function buildConstraintChips() {
  $('#constraintChips').innerHTML = CATALOG.map(c =>
    `<button type="button" class="chip" data-code="${c.code}" title="${esc(c.en)}">${esc(c.ar)}</button>`).join('');
  $$('#constraintChips .chip').forEach(ch => ch.addEventListener('click', () => {
    const code = ch.dataset.code;
    if (selectedConstraints.has(code)) { selectedConstraints.delete(code); ch.classList.remove('on'); }
    else { selectedConstraints.add(code); ch.classList.add('on'); }
  }));
}

function fillSelects() {
  const areas = [...new Set(S.workfronts.map(w => w.area))];
  const areaSel = $('#fArea');
  const cur = areaSel.value;
  areaSel.innerHTML = areas.map(a => `<option>${esc(a)}</option>`).join('') || '<option value="">— استورد القائمة —</option>';
  if (areas.includes(cur)) areaSel.value = cur;
  syncSystems();

  const fArea = $('#filterArea');
  const fCur = fArea.value;
  fArea.innerHTML = '<option value="all">كل المناطق</option>' + areas.map(a => `<option>${esc(a)}</option>`).join('');
  fArea.value = areas.includes(fCur) ? fCur : 'all';

  const leaders = [...new Set(S.logs.map(l => l.leader))];
  $('#leadersList').innerHTML = leaders.map(l => `<option value="${esc(l)}">`).join('');
}

function syncSystems() {
  const area = $('#fArea').value;
  const systems = [...new Set(S.workfronts.filter(w => w.area === area).map(w => w.system))];
  const sel = $('#fSystem');
  const cur = sel.value;
  sel.innerHTML = systems.map(s => `<option>${esc(s)}</option>`).join('') || '<option value="">—</option>';
  if (systems.includes(cur)) sel.value = cur;
  syncDiscipline();
}

function syncDiscipline() {
  const area = $('#fArea').value, system = $('#fSystem').value;
  const ds = [...new Set(S.workfronts.filter(w => w.area === area && w.system === system).map(w => w.discipline))];
  if (!ds.length) return;
  const sel = $('#fDiscipline');
  sel.innerHTML = ds.map(d => `<option>${esc(d)}</option>`).join('');
  const unit = unitFor(area, system);
  if (unit !== 'مختلط' && unit !== '—') {
    const opt = [...$('#fUnit').options].find(o => o.value === unit);
    if (opt) $('#fUnit').value = unit;
  }
}

function startTimer() {
  if (timerInt) return;
  timerStart = Date.now();
  timerInt = setInterval(() => {
    const s = Math.floor((Date.now() - timerStart) / 1000);
    $('#timer').textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  }, 1000);
}

function resetForm() {
  $('#fQty').value = '';
  $('#fNote').value = '';
  $('#fDate').value = today();
  selectedConstraints.clear();
  $$('#constraintChips .chip').forEach(c => c.classList.remove('on'));
  $('#fHours').value = 80;
  $('#fHead').value = 8;
  startTimer();
}

function renderLogTable() {
  const logs = S.logs.slice().sort((a, b) => (a.date === b.date ? b.ts - a.ts : b.date.localeCompare(a.date)));
  $('#logTableCount').textContent = logs.length + ' سجل';
  $('#logTable').innerHTML = logs.length ? logs.slice(0, 40).map(l => `<tr>
      <td class="num" style="font-size:11.5px">${esc(l.date)}</td>
      <td><span class="tag mute">${l.shift === 'Day' ? 'نهارية' : 'ليلية'}</span></td>
      <td>${esc(l.area)}<div class="muted">${esc(l.system)}</div></td>
      <td>${esc(l.leader)}<div class="muted">${esc(l.discipline)}</div></td>
      <td class="num">${num(l.head)}</td>
      <td class="num">${num(l.hours)}</td>
      <td class="num">${num(l.qty, 1)} <span class="muted">${esc(l.unit)}</span></td>
      <td>${l.constraints.length ? l.constraints.map(c => `<span class="tag warn" style="margin:1px">${esc(catOf(c).ar)}</span>`).join('') : '<span class="muted">—</span>'}</td>
      <td><button class="btn sm danger" data-del="${l.id}" title="حذف">✕</button></td>
    </tr>`).join('') : `<tr><td colspan="9" class="empty">لا سجلات بعد — ابدأ بتسجيل وردية.</td></tr>`;

  $$('#logTable [data-del]').forEach(b => b.addEventListener('click', () => {
    if (!confirm('حذف هذا السجل؟')) return;
    S.logs = S.logs.filter(l => l.id !== b.dataset.del);
    S.constraints = S.constraints.filter(c => c.logId !== b.dataset.del);
    save(); renderAll(); toast('تم حذف السجل');
  }));
}

function submitLog(e) {
  e.preventDefault();
  const date = $('#fDate').value || today();
  const log = {
    id: uid(), date,
    shift: $('#fShift').value,
    area: $('#fArea').value,
    system: $('#fSystem').value,
    discipline: $('#fDiscipline').value,
    leader: $('#fLeader').value.trim(),
    head: Number($('#fHead').value || 0),
    hours: Number($('#fHours').value || 0),
    qty: Number($('#fQty').value || 0),
    unit: $('#fUnit').value,
    constraints: [...selectedConstraints],
    note: $('#fNote').value.trim(),
    ts: Date.now()
  };
  if (!log.leader) { toast('اكتب اسم قائد الفرقة', true); return; }

  S.logs.push(log);
  log.constraints.forEach(code => S.constraints.push({
    id: uid(), code, area: log.area, system: log.system, leader: log.leader,
    owner: catOf(code).owner, openedAt: date, closedAt: null, logId: log.id
  }));
  save();

  const elapsed = timerStart ? Math.round((Date.now() - timerStart) / 1000) : 0;
  toast(`تم حفظ الوردية (${elapsed} ثانية) — ${log.qty} ${log.unit}`);
  resetForm();
  renderAll();
  $$('.tab').find(t => t.dataset.view === 'dashboard').click();
}

/* ------------------------------ Handover ------------------------------ */
function handoverDates() {
  const dates = [...new Set(S.logs.map(l => l.date))].sort().reverse();
  if (!dates.length) dates.push(today());
  return dates;
}

function buildHandover() {
  const date = $('#handoverDate').value || handoverDates()[0];
  const logs = S.logs.filter(l => l.date === date);
  const cons = S.constraints.filter(c => c.openedAt === date || (c.openedAt <= date && (!c.closedAt || c.closedAt > date)));

  const hours = logs.reduce((t, l) => t + Number(l.hours), 0);
  const head = logs.reduce((t, l) => t + Number(l.head), 0);
  const qty = logs.reduce((t, l) => t + Number(l.qty), 0);

  /* daily plan = master-list plan spread over the working days recorded so far */
  const workDays = Math.max(1, new Set(S.logs.map(l => l.date)).size);
  const dailyPlan = a => plannedFor(a) / workDays;
  const plan = [...new Set(logs.map(l => l.area))].reduce((t, a) => t + dailyPlan(a), 0);
  const pct = plan ? qty / plan * 100 : 0;

  /* clustering */
  const clusters = {};
  cons.forEach(c => {
    const k = c.code;
    const o = clusters[k] = clusters[k] || { code: k, leaders: new Set(), areas: new Set(), open: 0 };
    o.leaders.add(c.leader); o.areas.add(c.area); if (!c.closedAt) o.open++;
  });
  const clusterArr = Object.values(clusters).map(c => ({ ...c, leaders: [...c.leaders], areas: [...c.areas] }))
    .sort((a, b) => b.leaders.length - a.leaders.length);

  $('#clusterBox').innerHTML = clusterArr.length ? clusterArr.map(c => `
    <div class="cluster">
      <div class="cnt">${c.leaders.length}×</div>
      <div class="txt">${esc(catOf(c.code).ar)} — ${esc(catOf(c.code).en)}
        <small>${c.leaders.length} فرقة · ${c.areas.length} منطقة: ${esc(c.areas.join('، '))}</small></div>
      <span class="tag ${c.leaders.length >= 2 ? 'bad' : 'warn'}">${c.leaders.length >= 2 ? 'يُرفع' : 'فردي'}</span>
    </div>`).join('') : `<div class="empty">لا معوقات مسجّلة في هذا اليوم.</div>`;

  /* flags for that date */
  const flags = productivityFlags().filter(f => !f.missing);

  /* doc */
  const areaKeys = [...new Set(logs.map(l => l.area + '|' + l.discipline))];
  const areaLines = areaKeys.map(k => {
    const [a, disc] = k.split('|');
    const la = logs.filter(l => l.area === a && l.discipline === disc);
    const q = la.reduce((t, l) => t + Number(l.qty), 0);
    const u = la[0].unit;
    const p = plannedFor(a, null, disc) / workDays;
    return `<li><b>${esc(a)} — ${esc(disc)}</b>: ${num(q, 1)} ${esc(u)} في ${num(la.length)} وردية و${num(la.reduce((t, l) => t + Number(l.hours), 0))} ساعة عمل${p ? ` (${num(q / p * 100, 0)}% من المخطط اليومي)` : ''}.</li>`;
  }).join('');

  const consLines = clusterArr.length ? clusterArr.map(c =>
    `<li><b>${esc(catOf(c.code).ar)}</b> (${esc(catOf(c.code).en)}) — ${c.leaders.length} فرقة في ${c.areas.length} منطقة. المالك: ${esc(catOf(c.code).owner)}.${c.leaders.length >= 2 ? ' <b>يتطلب تصعيدًا.</b>' : ''}</li>`
  ).join('') : '<li>لا معوقات مسجّلة.</li>';

  const flagLines = flags.length ? flags.slice(0, 5).map(f =>
    `<li>${esc(f.leader)} (${esc(f.discipline)}): ${num(Math.abs(f.delta) * 100, 0)}% انخفاض في الإنتاج/ساعة${f.constraints.length ? ' — مرتبط بـ ' + esc(f.constraints.map(c => catOf(c).ar).join(' + ')) : ' — بدون معوق مسجّل، يحتاج توضيحًا'}.</li>`
  ).join('') : '<li>لا انخفاضات جوهرية في الإنتاجية.</li>';

  const recs = [];
  clusterArr.filter(c => c.leaders.length >= 2).forEach(c =>
    recs.push(`تصعيد معوق «${catOf(c.code).ar}» إلى ${catOf(c.code).owner} قبل بداية الوردية القادمة.`));
  if (pct && pct < 85) recs.push('مراجعة أسباب التأخر مع مشرفي المناطق وتحديث خطة الأسبوع.');
  if (flags.some(f => !f.constraints.length)) recs.push('مقابلة المشرفين الذين انخفض إنتاجهم بدون معوق مسجّل لتوثيق السبب.');
  if (!recs.length) recs.push('الاستمرار على نفس الخطة مع متابعة إغلاق المعوقات المفتوحة.');

  $('#handoverDoc').innerHTML = `
    <h3>تقرير تسليم الوردية — ${esc(S.project)}</h3>
    <div class="meta">
      <span>📅 ${esc(date)} (${esc(dayName(date))})</span>
      <span>👷 ${logs.length} وردية</span>
      <span>🕒 ${num(hours)} ساعة عمل</span>
      <span>🏗️ ${num(head)} عامل</span>
    </div>
    <div class="stats">
      <div class="stat"><b>${num(qty, 1)}</b><span>الكمية المنجزة</span></div>
      <div class="stat"><b>${num(pct, 0)}%</b><span>مقابل المخطط</span></div>
      <div class="stat"><b>${num(hours)}</b><span>Man-hours</span></div>
      <div class="stat"><b>${clusterArr.filter(c => c.leaders.length >= 2).length}</b><span>معوقات مشتركة</span></div>
    </div>
    <h4>ملخص تنفيذي</h4>
    <p>تم تسجيل <b>${logs.length}</b> وردية في هذا اليوم بإجمالي <b>${num(hours)}</b> ساعة عمل و<b>${num(qty, 1)}</b> وحدة منجزة،
    مقابل مخطط يومي <b>${num(plan, 0)}</b> للأنشطة الجارية (نسبة إنجاز يومية <b>${num(pct, 0)}%</b>).
    <span style="font-size:11px;color:#7b8794">المخطط اليومي = إجمالي المخطط ÷ ${workDays} يوم عمل مسجّل.</span>
    ${clusterArr.length ? `أُبلغ عن <b>${cons.length}</b> معوقًا، أبرزها ${esc(catOf(clusterArr[0].code).ar)} الذي مسّ ${clusterArr[0].leaders.length} فرقة.` : 'لم تُسجّل معوقات تُذكر.'}</p>
    <h4>الإنتاج حسب المنطقة</h4>
    <ul>${areaLines || '<li>لا بيانات.</li>'}</ul>
    <h4>المعوقات وتجميعها</h4>
    <ul>${consLines}</ul>
    <h4>رايات الإنتاجية</h4>
    <ul>${flagLines}</ul>
    <h4>التوصيات للوردية القادمة</h4>
    <ul>${recs.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    <div class="sign">
      <div>مشرف الوردية الصادرة</div>
      <div>مشرف الوردية القادمة</div>
      <div>إدارة الإنشاءات</div>
    </div>`;

  $('#handoverKv').innerHTML = `
    <div class="kv"><span>الورديات المسجّلة</span><b>${logs.length}</b></div>
    <div class="kv"><span>ساعات العمل</span><b>${num(hours)}</b></div>
    <div class="kv"><span>متوسط الإنتاج/ساعة</span><b>${hours ? num(qty / hours, 2) : '—'}</b></div>
    <div class="kv"><span>معوقات اليوم</span><b>${cons.length}</b></div>
    <div class="kv"><span>معوقات مشتركة (2+ فرقة)</span><b>${clusterArr.filter(c => c.leaders.length >= 2).length}</b></div>
    <div class="kv"><span>معوقات مفتوحة إجمالًا</span><b>${constraintStats().open}</b></div>`;
}

/* ------------------------------ Constraints ------------------------------ */
function renderConstraints() {
  const mode = $('#filterConsStatus').value;
  let list = S.constraints.slice();
  if (mode === 'open') list = list.filter(c => !c.closedAt);
  if (mode === 'closed') list = list.filter(c => c.closedAt);
  list.sort((a, b) => (a.closedAt ? 1 : 0) - (b.closedAt ? 1 : 0) || b.openedAt.localeCompare(a.openedAt));

  const cs = constraintStats();
  $('#cOpen').textContent = cs.open;
  $('#cAge').innerHTML = num(cs.avgAge, 1) + '<small>يوم</small>';
  $('#cLate').textContent = cs.late;
  $('#cClosed').textContent = cs.closed;
  $('#consCount').textContent = list.length + ' معوق';

  /* mark shared constraints */
  const byCode = {};
  S.constraints.filter(c => !c.closedAt).forEach(c => (byCode[c.code] = byCode[c.code] || new Set()).add(c.leader));

  $('#consTable').innerHTML = list.length ? list.map(c => {
    const age = c.closedAt ? daysBetween(c.openedAt, c.closedAt) : daysBetween(c.openedAt, today());
    const late = !c.closedAt && age > (S.targetDays || 3);
    const shared = (byCode[c.code] || new Set()).size;
    return `<tr>
      <td><b>${esc(catOf(c.code).ar)}</b><div class="muted">${esc(catOf(c.code).en)}</div></td>
      <td>${esc(c.area)}<div class="muted">${esc(c.system)}</div></td>
      <td>${esc(c.leader)}${shared >= 2 ? ` <span class="tag bad">${shared} فرق</span>` : ''}</td>
      <td style="font-size:12px">${esc(c.owner)}</td>
      <td class="num"><span class="tag ${late ? 'bad' : age > 1 ? 'warn' : 'mute'}">${age} يوم</span></td>
      <td>${c.closedAt ? '<span class="tag ok">مغلق</span>' : '<span class="tag warn">مفتوح</span>'}</td>
      <td>${c.closedAt ? `<span class="muted">${esc(c.closedAt)}</span>` : `<button class="btn sm" data-close="${c.id}">إغلاق</button>`}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="7" class="empty">لا معوقات في هذا العرض.</td></tr>`;

  $$('#consTable [data-close]').forEach(b => b.addEventListener('click', () => {
    const c = S.constraints.find(x => x.id === b.dataset.close);
    if (!c) return;
    c.closedAt = today();
    save(); renderAll(); toast('تم إغلاق المعوق: ' + catOf(c.code).ar);
  }));
}

/* ------------------------------ Setup ------------------------------ */
function renderSetup() {
  $('#projectName').textContent = S.project;
  $('#setProject').value = S.project;
  $('#setTarget').value = S.targetDays || 3;

  $('#wfTable').innerHTML = S.workfronts.length ? S.workfronts.map(w => `<tr>
      <td>${esc(w.area)}</td><td>${esc(w.system)}</td><td>${esc(w.discipline)}</td>
      <td>${esc(w.item)}</td><td class="num">${num(w.planned)}</td><td>${esc(w.unit)}</td>
    </tr>`).join('') : `<tr><td colspan="6" class="empty">لا بنود — استورد قائمة الأعمال.</td></tr>`;
  $('#wfCount').textContent = S.workfronts.length + ' بند';

  $('#statLogs').textContent = S.logs.length;
  $('#statCons').textContent = S.constraints.length;
  $('#statWf').textContent = S.workfronts.length;
  const bytes = new Blob([JSON.stringify(S)]).size;
  $('#statSize').textContent = (bytes / 1024).toFixed(1) + ' KB';
}

/* ------------------------------ CSV ------------------------------ */
function csvParse(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function download(name, text, type) {
  const blob = new Blob(['\uFEFF' + text], { type: type || 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function exportCSV() {
  const head = ['date', 'shift', 'area', 'system', 'discipline', 'crew_leader', 'headcount', 'man_hours', 'qty', 'unit', 'constraints', 'note'];
  const lines = [head.join(',')];
  S.logs.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(l => {
    lines.push([l.date, l.shift, l.area, l.system, l.discipline, l.leader, l.head, l.hours, l.qty, l.unit,
      l.constraints.map(c => catOf(c).en).join(' | '), (l.note || '').replace(/"/g, "'")].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  });
  download(`crewpulse-logs-${today()}.csv`, lines.join('\n'));
  toast('تم تصدير ' + S.logs.length + ' سجل');
}

function importCSV(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const rows = csvParse(String(reader.result));
    if (rows.length < 2) { toast('الملف فارغ أو غير صالح', true); return; }
    const head = rows[0].map(h => h.trim().toLowerCase());
    const idx = k => head.indexOf(k);
    const need = ['area', 'system', 'discipline', 'item', 'planned_qty', 'unit'];
    const missing = need.filter(k => idx(k) === -1);
    if (missing.length) { toast('أعمدة ناقصة: ' + missing.join(', '), true); return; }

    const items = rows.slice(1).map(r => ({
      area: (r[idx('area')] || '').trim(),
      system: (r[idx('system')] || '').trim(),
      discipline: (r[idx('discipline')] || '').trim(),
      item: (r[idx('item')] || '').trim(),
      planned: Number(String(r[idx('planned_qty')] || '0').replace(/[^\d.-]/g, '')) || 0,
      unit: (r[idx('unit')] || '').trim()
    })).filter(x => x.area && x.system);

    if (!items.length) { toast('لم يتم العثور على بنود صالحة', true); return; }
    S.workfronts = items;
    save(); fillSelects(); renderAll();
    toast('تم استيراد ' + items.length + ' بند');
  };
  reader.readAsText(file, 'utf-8');
}

/* ------------------------------ Wiring ------------------------------ */
function renderAll() {
  renderDashboard();
  renderLogTable();
  renderConstraints();
  renderSetup();
  buildHandover();
}

function init() {
  load();
  buildConstraintChips();
  fillSelects();

  /* tabs */
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    $$('.tab').forEach(x => x.classList.remove('active'));
    $$('.view').forEach(v => v.classList.remove('active'));
    t.classList.add('active');
    $('#view-' + t.dataset.view).classList.add('active');
    if (t.dataset.view === 'log') startTimer();
    if (t.dataset.view === 'handover') buildHandover();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  /* dashboard filters */
  $('#filterArea').addEventListener('change', renderDashboard);
  $('#filterDays').addEventListener('change', renderDashboard);

  /* log form */
  $('#fDate').value = today();
  $('#fArea').addEventListener('change', syncSystems);
  $('#fSystem').addEventListener('change', syncDiscipline);
  $('#logForm').addEventListener('submit', submitLog);
  $('#btnResetForm').addEventListener('click', () => { resetForm(); toast('تم مسح الحقول'); });
  $('#fLeader').addEventListener('input', startTimer);

  /* handover */
  const dates = handoverDates();
  $('#handoverDate').innerHTML = dates.map(d => `<option value="${d}">${d} — ${dayName(d)}</option>`).join('');
  $('#handoverDate').addEventListener('change', buildHandover);
  $('#btnPrintHandover').addEventListener('click', () => window.print());
  $('#btnCopyHandover').addEventListener('click', () => {
    const txt = $('#handoverDoc').innerText;
    navigator.clipboard?.writeText(txt).then(() => toast('تم نسخ نص التقرير'), () => toast('تعذّر النسخ', true));
  });

  /* constraints */
  $('#filterConsStatus').addEventListener('change', renderConstraints);

  /* setup */
  $('#btnSaveSettings').addEventListener('click', () => {
    S.project = $('#setProject').value.trim() || 'مشروع بدون اسم';
    S.targetDays = Math.max(1, Number($('#setTarget').value) || 3);
    save(); renderAll(); toast('تم حفظ الإعدادات');
  });
  $('#btnSeed').addEventListener('click', () => {
    if (!confirm('سيتم استبدال البيانات الحالية ببيانات تجريبية. متابعة؟')) return;
    seed(false); fillSelects(); renderAll();
    const d = handoverDates();
    $('#handoverDate').innerHTML = d.map(x => `<option value="${x}">${x} — ${dayName(x)}</option>`).join('');
  });
  $('#btnWipe').addEventListener('click', () => {
    if (!confirm('مسح كل السجلات والمعوقات؟ لا يمكن التراجع.')) return;
    S = defaultState(); save(); fillSelects(); renderAll(); toast('تم مسح البيانات');
  });
  $('#btnImport').addEventListener('click', () => $('#fileImport').click());
  $('#fileImport').addEventListener('change', e => { if (e.target.files[0]) importCSV(e.target.files[0]); e.target.value = ''; });
  $('#btnTemplate').addEventListener('click', () => {
    const t = ['area,system,discipline,item,planned_qty,unit',
      'Process Area 100,Piping System 1,Piping,"Line 6""-P-101",4200,DI',
      'Process Area 100,Piping System 1,Welding,Weld joints P-101,260,Weld',
      'Utility Area 200,Equipment Package,Mechanical,Pump set,42,EA'].join('\n');
    download('crewpulse-masterlist-template.csv', t);
    toast('تم تنزيل القالب');
  });

  $('#btnExport').addEventListener('click', exportCSV);
  $('#btnPrint').addEventListener('click', () => window.print());

  /* online/offline badge */
  const setNet = () => {
    const on = navigator.onLine;
    $('#syncDot').classList.toggle('off', !on);
    $('#syncTxt').textContent = on ? 'محفوظ على الجهاز' : 'أوفلاين — الحفظ محلي';
  };
  window.addEventListener('online', setNet);
  window.addEventListener('offline', setNet);
  setNet();

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
