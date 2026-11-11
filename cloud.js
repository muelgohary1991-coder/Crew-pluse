/* CrewPulse — Supabase sync layer (local-first, offline outbox) */
(function () {
  'use strict';
  const CFG = window.CREWPULSE_CONFIG || {};
  const BOX_KEY = 'crewpulse.outbox.v1';
  const FAIL_KEY = 'crewpulse.failed.v1';
  const LINK_KEY = 'crewpulse.link.v1';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  let sb = null, host = null, session = null, flushing = false, lastError = false, pulling = false;

  const configured = () => !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && !/YOUR_/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY) && window.supabase);
  const jget = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const link = () => jget(LINK_KEY, null);               // { userId, projectId, role }
  const linked = () => configured() && !!link();
  const box = () => jget(BOX_KEY, []);
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

  /* ---------- status pill ---------- */
  function refreshStatus() {
    if (!host) return;
    if (!linked()) { host.status(navigator.onLine ? 'محفوظ على الجهاز' : 'أوفلاين — الحفظ محلي', !navigator.onLine); return; }
    const n = box().length;
    if (!navigator.onLine) host.status(n ? `أوفلاين — ${n} بانتظار الرفع` : 'أوفلاين — الحفظ محلي', true);
    else if (lastError) host.status('تعذّرت المزامنة — سيُعاد المحاولة', true);
    else if (n) host.status(`جارٍ المزامنة (${n})`, false);
    else host.status('متزامن مع السحابة ✓', false);
  }

  /* ---------- row mapping ---------- */
  const pid = () => (link() || {}).projectId;
  const logRow = l => ({ id: l.id, project_id: pid(), log_date: l.date, shift: l.shift, area: l.area || '', system_name: l.system || '', discipline: l.discipline || '', crew_leader: l.leader, headcount: Number(l.head) || 0, man_hours: Number(l.hours) || 0, qty: Number(l.qty) || 0, unit: l.unit || '', note: l.note || '' });
  const conRow = c => ({ id: c.id, project_id: pid(), log_id: c.logId || null, code: c.code, area: c.area || '', system_name: c.system || '', crew_leader: c.leader || '', owner_role: c.owner || '', opened_at: c.openedAt, closed_at: c.closedAt || null });
  const wfRow = w => ({ id: uuid(), project_id: pid(), area: w.area, system_name: w.system, discipline: w.discipline || '', item: w.item || '', planned_qty: Number(w.planned) || 0, unit: w.unit || '' });

  /* ---------- outbox ---------- */
  function enqueue(ops) {
    if (!linked()) return;
    const b = box(); ops.forEach(o => b.push(o)); jset(BOX_KEY, b);
    refreshStatus(); flush();
  }

  async function run(op) {
    try {
      let r;
      if (op.t === 'upsert') r = await sb.from(op.table).upsert(op.rows, { onConflict: 'id' });
      else if (op.t === 'update') { let q = sb.from(op.table).update(op.values); for (const [k, v] of Object.entries(op.match)) q = q.eq(k, v); r = await q; }
      else if (op.t === 'delete') { let q = sb.from(op.table).delete(); for (const [k, v] of Object.entries(op.match)) q = q.eq(k, v); r = await q; }
      else return null;
      return r.error || null;
    } catch (e) { return e; }
  }
  const retryable = e => !navigator.onLine || e.status === 0 || e.status === 401 || /fetch|network|load failed|jwt|timeout/i.test(String(e.message || ''));

  async function flush() {
    if (flushing || !sb || !linked() || !navigator.onLine) return;
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) return;
    flushing = true; lastError = false;
    try {
      while (box().length) {
        const op = box()[0];
        const err = await run(op);
        if (err) {
          if (retryable(err)) { lastError = true; break; }
          const f = jget(FAIL_KEY, []); f.push({ op, error: String(err.message || err), at: new Date().toISOString() }); jset(FAIL_KEY, f.slice(-50));
          host.toast('تعذّر رفع عملية: ' + (err.message || err), true);
        }
        const b = box(); b.shift(); jset(BOX_KEY, b); refreshStatus();
      }
    } finally { flushing = false; refreshStatus(); }
    if (!box().length && !lastError) pull();
  }

  /* ---------- pull ---------- */
  async function fetchAll(table) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select('*').eq('project_id', pid()).order('created_at').order('id').range(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  }

  async function pull() {
    if (pulling || !sb || !linked() || !navigator.onLine || box().length) return false;
    pulling = true;
    try {
      const { data: p, error: pe } = await sb.from('projects').select('name,target_days').eq('id', pid()).single();
      if (pe) throw pe;
      const [wf, logs, cons] = await Promise.all([fetchAll('workfronts'), fetchAll('shift_logs'), fetchAll('constraint_log')]);
      if (box().length) return false;               // user changed something meanwhile
      const byLog = {};
      cons.forEach(c => { if (c.log_id) (byLog[c.log_id] = byLog[c.log_id] || []).push(c.code); });
      host.apply({
        project: p.name, targetDays: p.target_days,
        workfronts: wf.map(w => ({ area: w.area, system: w.system_name, discipline: w.discipline, item: w.item, planned: Number(w.planned_qty), unit: w.unit })),
        logs: logs.map(l => ({ id: l.id, date: l.log_date, shift: l.shift, area: l.area, system: l.system_name, discipline: l.discipline, leader: l.crew_leader, head: l.headcount, hours: Number(l.man_hours), qty: Number(l.qty), unit: l.unit, constraints: byLog[l.id] || [], note: l.note, ts: Date.parse(l.created_at) })),
        constraints: cons.map(c => ({ id: c.id, code: c.code, area: c.area, system: c.system_name, leader: c.crew_leader, owner: c.owner_role, openedAt: c.opened_at, closedAt: c.closed_at, logId: c.log_id }))
      });
      lastError = false; return true;
    } catch (e) { lastError = true; host.toast('تعذّر تحميل البيانات: ' + (e.message || e), true); return false; }
    finally { pulling = false; refreshStatus(); }
  }

  /* ---------- session / project bootstrap ---------- */
  async function bootstrap(user) {
    const prev = link();
    if (prev && prev.userId !== user.id) { jset(BOX_KEY, []); }
    const { data: mem, error } = await sb.from('project_members').select('project_id,role,created_at').eq('user_id', user.id).order('created_at');
    if (error) { host.toast('تعذّر قراءة المشاريع: ' + error.message, true); return; }
    let projectId, role, created = false;
    if (mem.length) {
      const m = (prev && mem.find(x => x.project_id === prev.projectId)) || mem[0];
      projectId = m.project_id; role = m.role;
    } else {
      const st = host.state();
      const { data, error: e2 } = await sb.rpc('create_project', { p_name: st.project, p_target_days: st.targetDays });
      if (e2) { host.toast('تعذّر إنشاء المشروع: ' + e2.message, true); return; }
      projectId = data; role = 'owner'; created = true;
    }
    jset(LINK_KEY, { userId: user.id, projectId, role });

    if (created) {
      const st = host.state();
      if ((st.logs.length || st.workfronts.length) && confirm('رفع البيانات الموجودة على هذا الجهاز إلى السحابة؟\n(قد تكون بيانات تجريبية — اضغط إلغاء للبدء بمشروع فارغ)')) {
        uploadLocal(st); await flush(); await pull(); renderAccount(); return;
      }
      host.apply({ project: st.project, targetDays: st.targetDays, workfronts: [], logs: [], constraints: [] });
    }
    await flush(); await pull(); renderAccount();
  }

  function uploadLocal(st) {
    const map = {};
    const nid = id => (UUID_RE.test(id) ? id : (map[id] = map[id] || uuid()));
    const chunks = (rows, n = 400) => { const o = []; for (let i = 0; i < rows.length; i += n) o.push(rows.slice(i, i + n)); return o; };
    const ops = [];
    chunks(st.workfronts.map(wfRow)).forEach(r => ops.push({ t: 'upsert', table: 'workfronts', rows: r }));
    chunks(st.logs.map(l => logRow({ ...l, id: nid(l.id) }))).forEach(r => ops.push({ t: 'upsert', table: 'shift_logs', rows: r }));
    chunks(st.constraints.map(c => conRow({ ...c, id: nid(c.id), logId: c.logId ? nid(c.logId) : null }))).forEach(r => ops.push({ t: 'upsert', table: 'constraint_log', rows: r }));
    ops.push({ t: 'update', table: 'projects', values: { name: st.project, target_days: st.targetDays }, match: { id: pid() } });
    enqueue(ops);
  }

  /* ---------- public mutation hooks ---------- */
  const api = {
    configured, linked, refreshStatus, pull, flush,
    isOwner: () => !!(link() && link().role === 'owner'),
    logAdded(log, cons) {
      const ops = [{ t: 'upsert', table: 'shift_logs', rows: [logRow(log)] }];
      if (cons.length) ops.push({ t: 'upsert', table: 'constraint_log', rows: cons.map(conRow) });
      enqueue(ops);
    },
    logDeleted(id) { enqueue([{ t: 'delete', table: 'shift_logs', match: { id } }]); },
    constraintClosed(c) { enqueue([{ t: 'upsert', table: 'constraint_log', rows: [conRow(c)] }]); },
    workfrontsReplaced(items) {
      const ops = [{ t: 'delete', table: 'workfronts', match: { project_id: pid() } }];
      for (let i = 0; i < items.length; i += 400) ops.push({ t: 'upsert', table: 'workfronts', rows: items.slice(i, i + 400).map(wfRow) });
      enqueue(ops);
    },
    settingsSaved(name, days) { enqueue([{ t: 'update', table: 'projects', values: { name, target_days: days }, match: { id: pid() } }]); },
    wipe() {
      enqueue([{ t: 'delete', table: 'constraint_log', match: { project_id: pid() } },
               { t: 'delete', table: 'shift_logs', match: { project_id: pid() } },
               { t: 'delete', table: 'workfronts', match: { project_id: pid() } }]);
    }
  };

  /* ---------- account modal ---------- */
  let modal;
  function buildModal() {
    const css = document.createElement('style');
    css.textContent = '.cp-ov{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:200;padding:16px}.cp-ov.show{display:flex}.cp-box{width:min(420px,100%);padding:20px;display:flex;flex-direction:column;gap:12px}.cp-box h3{font-size:17px}.cp-row{display:flex;gap:8px;flex-wrap:wrap}.cp-msg{font-size:12.5px;color:var(--txt-2);min-height:18px}.cp-msg.bad{color:var(--bad)}.cp-msg.ok{color:var(--ok)}';
    document.head.appendChild(css);
    modal = document.createElement('div');
    modal.className = 'cp-ov';
    modal.innerHTML = '<div class="card cp-box" role="dialog" aria-modal="true">' +
      '<h3>☁️ الحساب والمزامنة</h3>' +
      '<div id="cpOut"><div class="field"><label>الإيميل</label><input id="cpEmail" type="email" autocomplete="email" dir="ltr"></div>' +
      '<div class="field" style="margin-top:8px"><label>كلمة المرور <span>(6 أحرف على الأقل)</span></label><input id="cpPass" type="password" autocomplete="current-password" dir="ltr"></div>' +
      '<div class="cp-row" style="margin-top:12px"><button class="btn primary" id="cpIn">دخول</button><button class="btn" id="cpUp">إنشاء حساب</button></div></div>' +
      '<div id="cpIn2" style="display:none"><div class="cp-msg" id="cpWho"></div>' +
      '<div class="cp-row" style="margin-top:8px"><button class="btn" id="cpSync">🔄 مزامنة الآن</button><button class="btn danger" id="cpOutBtn">تسجيل الخروج</button></div>' +
      '<div id="cpOwner" style="display:none;margin-top:14px"><div class="field"><label>إضافة عضو للمشروع <span>(يجب أن يكون مسجّلًا)</span></label><input id="cpMember" type="email" dir="ltr" placeholder="name@company.com"></div>' +
      '<button class="btn sm" id="cpAdd" style="margin-top:8px">إضافة</button></div></div>' +
      '<div class="cp-msg" id="cpMsg"></div>' +
      '<div class="cp-row"><button class="btn ghost sm" id="cpClose">إغلاق</button></div></div>';
    document.body.appendChild(modal);
    const $ = s => modal.querySelector(s);
    const msg = (t, k) => { const m = $('#cpMsg'); m.textContent = t || ''; m.className = 'cp-msg' + (k ? ' ' + k : ''); };
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
    $('#cpClose').onclick = () => modal.classList.remove('show');

    const creds = () => ({ email: $('#cpEmail').value.trim(), password: $('#cpPass').value });
    $('#cpIn').onclick = async () => {
      const c = creds(); if (!c.email || !c.password) return msg('اكتب الإيميل وكلمة المرور', 'bad');
      msg('جارٍ الدخول…');
      const { error } = await sb.auth.signInWithPassword(c);
      if (error) return msg(error.message, 'bad');
      msg('');
    };
    $('#cpUp').onclick = async () => {
      const c = creds(); if (!c.email || c.password.length < 6) return msg('إيميل صحيح وكلمة مرور 6 أحرف على الأقل', 'bad');
      msg('جارٍ إنشاء الحساب…');
      const { data, error } = await sb.auth.signUp(c);
      if (error) return msg(error.message, 'bad');
      if (!data.session) msg('تم إنشاء الحساب — افتح رسالة التأكيد في الإيميل ثم سجّل الدخول.', 'ok');
    };
    $('#cpSync').onclick = async () => { msg('جارٍ المزامنة…'); await flush(); const ok = await pull(); msg(ok ? 'تمت المزامنة' : 'لم تكتمل المزامنة', ok ? 'ok' : 'bad'); };
    $('#cpOutBtn').onclick = async () => {
      const n = box().length;
      if (n && !confirm(`يوجد ${n} عملية لم تُرفع بعد وستضيع إذا خرجت الآن. متابعة؟`)) return;
      await signOutLocal();
    };
    $('#cpAdd').onclick = async () => {
      const email = $('#cpMember').value.trim(); if (!email) return;
      const { error } = await sb.rpc('add_project_member', { p_project: pid(), p_email: email });
      if (error) return msg(/not found/.test(error.message) ? 'هذا الإيميل غير مسجّل بعد — اطلب منه إنشاء حساب أولًا' : error.message, 'bad');
      $('#cpMember').value = ''; msg('تمت إضافة العضو', 'ok');
    };
  }

  function renderAccount() {
    if (!modal) return;
    const $ = s => modal.querySelector(s);
    const L = link();
    const on = !!(session && L);
    $('#cpOut').style.display = on ? 'none' : '';
    $('#cpIn2').style.display = on ? '' : 'none';
    $('#cpOwner').style.display = on && L.role === 'owner' ? '' : 'none';
    if (on) $('#cpWho').textContent = `${session.user.email} — ${L.role === 'owner' ? 'مالك المشروع' : 'عضو'}`;
    const b = document.getElementById('btnAccount');
    if (b) b.textContent = on ? '☁️ ' + (session.user.email || '').split('@')[0] : '☁️ تسجيل الدخول';
  }

  async function signOutLocal() {
    await sb.auth.signOut();
    jset(BOX_KEY, []); try { localStorage.removeItem(LINK_KEY); } catch (e) {}
    host.apply({ project: 'مشروع بدون اسم', targetDays: 3, workfronts: [], logs: [], constraints: [] });
    session = null; renderAccount(); refreshStatus();
  }

  /* ---------- init ---------- */
  async function init(h) {
    host = h;
    const btn = document.getElementById('btnAccount');
    if (!configured()) { if (btn) btn.style.display = 'none'; refreshStatus(); return; }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    buildModal();
    if (btn) { btn.style.display = ''; btn.onclick = () => { renderAccount(); modal.classList.add('show'); }; }

    sb.auth.onAuthStateChange((evt, s) => {
      session = s;
      // لا نستدعي Supabase مباشرة داخل الـ callback
      if (evt === 'SIGNED_IN' && s) setTimeout(() => { const L = link(); if (!L || L.userId !== s.user.id || !host.__booted) { host.__booted = true; bootstrap(s.user); } else renderAccount(); }, 0);
      if (evt === 'SIGNED_OUT') setTimeout(renderAccount, 0);
    });

    let s0 = null;
    try { s0 = (await sb.auth.getSession()).data.session; } catch (e) {}
    session = s0; renderAccount(); refreshStatus();
    if (s0 && link()) { host.__booted = true; flush().then(pull); }

    window.addEventListener('online', () => { refreshStatus(); flush(); });
    window.addEventListener('offline', refreshStatus);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { flush(); pull(); } });
    setInterval(() => { if (!document.hidden) { flush(); pull(); } }, 90000);
  }

  api.init = init;
  window.Cloud = api;
})();
