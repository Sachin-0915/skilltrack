/* SkillTrack - Week 1: login, roles, companies, employees */
const cfg = window.SKILLTRACK_CONFIG || {};
const $ = s => document.querySelector(s);
const app = $('#app');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ROLES = { org_admin: 'Org Admin', manager: 'Manager', learner: 'Learner' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SITE = location.origin + location.pathname;

let sb = null;
let me = null;            // { user, member, isSuper, company }
let view = null;          // current screen name

function toast(text, ms = 3500) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, ms);
}
function friendly(err) {
  const m = (err && (err.message || err.error_description)) || String(err);
  if (/Database error saving new user/i.test(m)) return 'This email has not been added by your HR admin yet.';
  if (/duplicate key|members_email_unique/i.test(m)) return 'This email already exists in SkillTrack.';
  if (/row-level security/i.test(m)) return 'You do not have permission to do this.';
  if (/Invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/Email not confirmed/i.test(m)) return 'Please confirm your email first (check your inbox).';
  return m;
}

/* ---------------- start ---------------- */
async function start() {
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.startsWith('PASTE')) return renderNotConfigured();
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') return renderNewPassword();
    if (event === 'SIGNED_OUT') { me = null; $('#toast').hidden = true; renderAuth('login'); }
  });
  const { data } = await sb.auth.getSession();
  if (data.session) await loadMe(data.session.user); else renderAuth(location.hash === '#signup' ? 'signup' : 'login');
}

function renderNotConfigured() {
  app.innerHTML = `<div class="card narrow"><h2>Almost there</h2>
    <p>SkillTrack is not connected to its database yet.</p>
    <p class="muted small">Open <code>config.js</code> and paste your Supabase Project URL and anon public key, then upload it again.</p></div>`;
}

/* ---------------- auth screens ---------------- */
function renderAuth(tab) {
  $('#who').innerHTML = '';
  const t = (id, label) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${label}</button>`;
  app.innerHTML = `<div class="card narrow">
    <h1>Welcome to SkillTrack</h1>
    <p class="muted small">Training and compliance tracking for your company.</p>
    <div class="tabs">${t('login', 'Log in')}${t('signup', 'Create account')}${t('forgot', 'Forgot password')}</div>
    <form id="authForm">
      <label for="email">Work email</label><input id="email" type="email" required autocomplete="email">
      ${tab !== 'forgot' ? `<label for="pw">Password</label><input id="pw" type="password" required minlength="8" autocomplete="${tab === 'signup' ? 'new-password' : 'current-password'}">` : ''}
      ${tab === 'signup' ? `<p class="muted small">Your HR admin must add your email to SkillTrack before you can create an account.</p>` : ''}
      <div class="row" style="margin-top:16px"><button id="go">${tab === 'login' ? 'Log in' : tab === 'signup' ? 'Create account' : 'Send reset link'}</button></div>
      <div id="authMsg"></div>
    </form></div>`;
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => renderAuth(b.dataset.tab));
  $('#authForm').onsubmit = async e => {
    e.preventDefault();
    const email = $('#email').value.trim(), pw = $('#pw')?.value, btn = $('#go'), msg = $('#authMsg');
    btn.disabled = true; msg.innerHTML = '';
    try {
      if (tab === 'login') {
        const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
        await loadMe(data.user);
      } else if (tab === 'signup') {
        const { data: ok, error: e1 } = await sb.rpc('can_sign_up', { p_email: email });
        if (e1) throw e1;
        if (!ok) throw new Error('This email has not been added by your HR admin yet.');
        const { data, error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: SITE } });
        if (error) throw error;
        if (data.session) await loadMe(data.user);
        else msg.innerHTML = `<div class="msg ok">Account created. Check your inbox to confirm your email, then log in.</div>`;
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: SITE });
        if (error) throw error;
        msg.innerHTML = `<div class="msg ok">If this email is registered, a reset link is on its way.</div>`;
      }
    } catch (err) { msg.innerHTML = `<div class="msg err">${esc(friendly(err))}</div>`; }
    btn.disabled = false;
  };
}

function renderNewPassword(forced) {
  app.innerHTML = `<div class="card narrow"><h2>${forced ? 'Welcome! Choose your own password' : 'Set a new password'}</h2>
    ${forced ? '<p class="muted small">You logged in with a temporary password. Please choose a new one to continue (at least 8 characters).</p>' : ''}
    <form id="npForm"><label for="np">New password</label><input id="np" type="password" minlength="8" required autocomplete="new-password">
    <label for="np2">Confirm new password</label><input id="np2" type="password" minlength="8" required autocomplete="new-password">
    <div class="row" style="margin-top:16px"><button>Save password</button></div><div id="npMsg"></div></form></div>`;
  $('#npForm').onsubmit = async e => {
    e.preventDefault();
    if ($('#np').value !== $('#np2').value) return $('#npMsg').innerHTML = `<div class="msg err">The two passwords do not match.</div>`;
    const { data, error } = await sb.auth.updateUser({ password: $('#np').value });
    if (error) return $('#npMsg').innerHTML = `<div class="msg err">${esc(friendly(error))}</div>`;
    await sb.rpc('password_changed');
    toast('Password saved.'); await loadMe(data.user);
  };
}

/* ---------------- who am I ---------------- */
async function loadMe(user) {
  const [{ data: isSuper }, { data: member }] = await Promise.all([
    sb.rpc('is_super_admin'),
    sb.from('members').select('*, companies(name, status)').eq('user_id', user.id).maybeSingle()
  ]);
  me = { user, isSuper: !!isSuper, member, company: member?.companies || null };
  const roleLabel = me.isSuper ? 'Super Admin' : ROLES[member?.role] || 'No access';
  $('#who').innerHTML = `<span>${esc(member?.full_name || user.email)} · ${esc(roleLabel)}${me.company ? ' · ' + esc(me.company.name) : ''}</span>
    <button class="sec" id="logout">Log out</button>`;
  $('#logout').onclick = () => sb.auth.signOut();
  if (me.isSuper) return renderCompanies();
  if (!member || !member.active) {
    app.innerHTML = `<div class="card narrow"><h2>No access</h2><p class="muted">Your account is not active in any company. Please contact your HR admin.</p></div>`;
    return;
  }
  if (member.must_change_password) return renderNewPassword(true);
  const ctx = { companyId: member.company_id, companyName: me.company?.name, fromSuper: false };
  if (member.role === 'org_admin') return renderEmployees(ctx.companyId, ctx.companyName);
  if (member.role === 'manager') return renderTeam(ctx);
  renderMyLearning(ctx);
}

/* ---------------- navigation tabs ---------------- */
function adminNav(active, ctx) {
  const tabs = [];
  if (me.isSuper || me.member?.role === 'org_admin') tabs.push(['employees', 'Employees'], ['courses', 'Courses'], ['reports', 'Reports']);
  if (me.member?.role === 'manager') tabs.push(['team', 'My team']);
  if (me.member && !ctx.fromSuper) tabs.push(['learning', 'My learning']);
  return `<div class="nav">${tabs.map(([k, v]) => `<button data-nav="${k}" class="${k === active ? 'on' : ''}">${v}</button>`).join('')}</div>`;
}
function wireNav(ctx) {
  const go = { employees: () => renderEmployees(ctx.companyId, ctx.companyName, ctx.fromSuper), courses: () => renderCourses(ctx), reports: () => renderReports(ctx),
               team: () => renderTeam(ctx), learning: () => renderMyLearning(ctx) };
  app.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => go[b.dataset.nav]());
}

/* ---------------- Super Admin: companies ---------------- */
async function renderCompanies() {
  view = 'companies';
  app.innerHTML = `<h1>Companies</h1><p class="muted">Create client companies and their first HR admin.</p><div id="coList" class="card">Loading…</div>
  <div class="card"><h2>Add a company</h2>
    <form id="coForm"><div class="grid3">
      <div><label>Company name</label><input id="coName" required></div>
      <div><label>Plan</label><select id="coPlan"><option value="pilot">Pilot (free)</option><option value="starter">Starter</option><option value="growth">Growth</option></select></div>
      <div><label>Max users</label><input id="coMax" type="number" min="1" value="100" required></div>
      <div><label>HR admin name</label><input id="adName" required></div>
      <div><label>HR admin email</label><input id="adEmail" type="email" required></div>
    </div>${loginCheckbox('coLogin')}<div class="row" style="margin-top:16px"><button id="coGo">Create company</button></div><div id="coMsg"></div></form></div>`;
  $('#coForm').onsubmit = async e => {
    e.preventDefault(); const btn = $('#coGo'); btn.disabled = true; $('#coMsg').innerHTML = '';
    try {
      const { data: co, error } = await sb.from('companies')
        .insert({ name: $('#coName').value.trim(), plan: $('#coPlan').value, max_users: +$('#coMax').value }).select().single();
      if (error) throw error;
      const { data: hr, error: e2 } = await sb.from('members').insert({ company_id: co.id, full_name: $('#adName').value.trim(), email: $('#adEmail').value.trim().toLowerCase(), role: 'org_admin' }).select('id').single();
      if (e2) { await sb.from('companies').delete().eq('id', co.id); throw e2; }
      const withLogin = $('#coLogin').checked;
      $('#coMsg').innerHTML = `<div class="msg ok">${esc(co.name)} created.${withLogin ? '' : ` Ask the HR admin to open <b>${esc(SITE)}</b> and choose "Create account".`}</div>`;
      e.target.reset(); loadCompanies();
      if (withLogin) manageLogins('create_login', [hr.id]);
    } catch (err) { $('#coMsg').innerHTML = `<div class="msg err">${esc(friendly(err))}</div>`; }
    btn.disabled = false;
  };
  loadCompanies();
}
async function loadCompanies() {
  const [{ data: cos, error }, { data: mem }] = await Promise.all([
    sb.from('companies').select('*').order('created_at', { ascending: false }),
    sb.from('members').select('company_id, active, user_id')
  ]);
  if (error) return $('#coList').innerHTML = `<div class="msg err">${esc(friendly(error))}</div>`;
  if (!cos.length) return $('#coList').innerHTML = `<p class="muted">No companies yet. Add your first one below.</p>`;
  const count = id => (mem || []).filter(m => m.company_id === id && m.active);
  $('#coList').innerHTML = `<div class="tbl"><table><thead><tr><th>Company</th><th>Plan</th><th>Users</th><th>Joined</th><th>Status</th><th></th></tr></thead><tbody>
    ${cos.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.plan)}</td><td>${count(c.id).length} / ${c.max_users}</td>
      <td>${count(c.id).filter(m => m.user_id).length}</td>
      <td><span class="tag ${c.status === 'active' ? 'ok' : 'warn'}">${esc(c.status)}</span></td>
      <td><button class="link" data-open="${c.id}" data-name="${esc(c.name)}">Manage employees</button>
          <button class="link" data-toggle="${c.id}" data-status="${c.status}">${c.status === 'active' ? 'Pause' : 'Activate'}</button></td></tr>`).join('')}
    </tbody></table></div>`;
  $('#coList').querySelectorAll('[data-open]').forEach(b => b.onclick = () => renderEmployees(b.dataset.open, b.dataset.name, true));
  $('#coList').querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
    const { error } = await sb.from('companies').update({ status: b.dataset.status === 'active' ? 'paused' : 'active' }).eq('id', b.dataset.toggle);
    if (error) return toast(friendly(error)); loadCompanies();
  });
}

/* ---------------- Org Admin: employees ---------------- */
let emp = { companyId: null, rows: [], q: '', dept: '', status: '' };

function renderEmployees(companyId, companyName, fromSuper = false) {
  view = 'employees'; emp = { companyId, rows: [], q: '', dept: '', status: '' };
  const ctx = { companyId, companyName, fromSuper };
  app.innerHTML = `
    ${fromSuper ? `<button class="link" id="back">← All companies</button>` : ''}
    <h1>${esc(companyName || 'Your company')}</h1><p class="muted">Add your employees. Each person creates their own password with the email you add here.</p>
    ${adminNav('employees', ctx)}
    <div id="stats" class="grid" style="margin-top:16px"></div>
    <div class="card">
      <div class="row" style="justify-content:space-between"><h2 style="margin:0">Employees</h2>
        <div class="row"><button class="sec" id="copyLink">Copy sign-up link</button></div></div>
      <div class="grid3" style="margin-top:12px">
        <input id="fq" placeholder="Search name or email">
        <select id="fd"><option value="">All departments</option></select>
        <select id="fs"><option value="">All statuses</option><option>Joined</option><option>Invited</option><option>Inactive</option></select>
      </div>
      <div id="empList" class="tbl" style="margin-top:12px">Loading…</div>
    </div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
      <div class="card"><h2>Add one employee</h2>
        <form id="addForm">
          <label>Full name</label><input id="aName" required>
          <label>Work email</label><input id="aEmail" type="email" required>
          <label>Department</label><input id="aDept" placeholder="e.g. Sales">
          <label>Role</label><select id="aRole"><option value="learner">Learner</option><option value="manager">Manager</option><option value="org_admin">Org Admin</option></select>
          <label>Manager's email (optional)</label><input id="aMgr" type="email">
          ${loginCheckbox('aLogin')}
          <div class="row" style="margin-top:16px"><button id="aGo">Add employee</button></div><div id="aMsg"></div>
        </form></div>
      <div class="card"><h2>Upload many (CSV)</h2>
        <p class="muted small">Columns: <code>full_name, email, department, role, manager_email</code>. Role can be learner, manager or org_admin (blank = learner).</p>
        <div class="row"><button class="sec" id="tpl">Download template</button></div>
        <label for="csv">CSV file</label><input id="csv" type="file" accept=".csv">
        <div id="csvOut"></div>
      </div>
    </div>`;
  wireNav(ctx);
  if (fromSuper) $('#back').onclick = renderCompanies;
  $('#copyLink').onclick = async () => {
    const text = `You've been added to SkillTrack. Open ${SITE}#signup and create your account with your work email.`;
    try { await navigator.clipboard.writeText(text); toast('Invitation message copied. Paste it into an email or chat.'); }
    catch { prompt('Copy this message:', text); }
  };
  $('#fq').oninput = e => { emp.q = e.target.value.toLowerCase(); drawEmployees(); };
  $('#fd').onchange = e => { emp.dept = e.target.value; drawEmployees(); };
  $('#fs').onchange = e => { emp.status = e.target.value; drawEmployees(); };
  $('#addForm').onsubmit = async e => {
    e.preventDefault(); const btn = $('#aGo'); btn.disabled = true; $('#aMsg').innerHTML = '';
    const row = cleanRow({ full_name: $('#aName').value, email: $('#aEmail').value, department: $('#aDept').value, role: $('#aRole').value, manager_email: $('#aMgr').value });
    if (!EMAIL_RE.test(row.email) || /^www\./.test(row.email)) { btn.disabled = false; return $('#aMsg').innerHTML = `<div class="msg err">Please check the email address.</div>`; }
    const withLogin = $('#aLogin').checked;
    const { data: added, error } = await sb.from('members').insert({ ...row, company_id: emp.companyId }).select('id').single();
    btn.disabled = false;
    if (error) return $('#aMsg').innerHTML = `<div class="msg err">${esc(friendly(error))}</div>`;
    $('#aMsg').innerHTML = `<div class="msg ok">${esc(row.full_name)} added.${withLogin ? '' : ' Share the sign-up link with them, or click Create login in the list.'}</div>`;
    e.target.reset(); $('#aLogin').checked = true; loadEmployees();
    if (withLogin) manageLogins('create_login', [added.id]);
  };
  $('#tpl').onclick = () => download('skilltrack-employees-template.csv',
    'full_name,email,department,role,manager_email\nPriya Nair,priya@yourcompany.com,Sales,manager,\nRahul Verma,rahul@yourcompany.com,Sales,learner,priya@yourcompany.com\n');
  $('#csv').onchange = e => e.target.files[0] && e.target.files[0].text().then(previewCsv);
  loadEmployees();
}

async function loadEmployees() {
  const { data, error } = await sb.from('members').select('*').eq('company_id', emp.companyId).order('full_name');
  if (error) return $('#empList').innerHTML = `<div class="msg err">${esc(friendly(error))}</div>`;
  emp.rows = data;
  const depts = [...new Set(data.map(r => r.department).filter(Boolean))].sort();
  $('#fd').innerHTML = `<option value="">All departments</option>` + depts.map(d => `<option ${d === emp.dept ? 'selected' : ''}>${esc(d)}</option>`).join('');
  const active = data.filter(r => r.active), joined = active.filter(r => r.user_id);
  $('#stats').innerHTML = `
    <div class="stat"><b>${active.length}</b><span class="muted small">Active employees</span></div>
    <div class="stat"><b>${joined.length}</b><span class="muted small">Joined (account created)</span></div>
    <div class="stat"><b>${active.length - joined.length}</b><span class="muted small">Invited, not joined yet</span></div>
    <div class="stat"><b>${depts.length}</b><span class="muted small">Departments</span></div>`;
  drawEmployees();
}
const statusOf = r => !r.active ? 'Inactive' : r.user_id ? 'Joined' : 'Invited';

function drawEmployees() {
  const rows = emp.rows.filter(r =>
    (!emp.q || r.full_name.toLowerCase().includes(emp.q) || r.email.toLowerCase().includes(emp.q)) &&
    (!emp.dept || r.department === emp.dept) && (!emp.status || statusOf(r) === emp.status));
  const myId = me.member?.id;
  $('#empList').innerHTML = !emp.rows.length ? `<p class="muted">No employees yet. Add one or upload a CSV below.</p>` :
    `<table><thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Role</th><th>Manager</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(r => {
      const st = statusOf(r), cls = st === 'Joined' ? 'ok' : st === 'Invited' ? 'warn' : 'bad';
      const self = r.id === myId;
      return `<tr><td><b>${esc(r.full_name)}</b></td><td>${esc(r.email)}</td><td>${esc(r.department || '–')}</td>
        <td>${self ? esc(ROLES[r.role]) : `<select data-role="${r.id}">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === r.role ? 'selected' : ''}>${v}</option>`).join('')}</select>`}</td>
        <td>${esc(r.manager_email || '–')}</td><td><span class="tag ${cls}">${st}</span></td>
        <td>${self ? '<span class="muted small">You</span>' : `${r.active ? (r.user_id ? `<button class="link" data-reset="${r.id}">Reset password</button>` : `<button class="link" data-login="${r.id}">Create login</button>`) : ''}<button class="link" data-act="${r.id}" data-on="${r.active}">${r.active ? 'Deactivate' : 'Reactivate'}</button>`}</td></tr>`;
    }).join('') || `<tr><td colspan="7" class="muted">No employees match these filters.</td></tr>`}
    </tbody></table>`;
  $('#empList').querySelectorAll('[data-role]').forEach(s => s.onchange = async () => {
    const { error } = await sb.from('members').update({ role: s.value }).eq('id', s.dataset.role);
    toast(error ? friendly(error) : 'Role updated.'); loadEmployees();
  });
  $('#empList').querySelectorAll('[data-login]').forEach(b => b.onclick = () => manageLogins('create_login', [b.dataset.login]));
  $('#empList').querySelectorAll('[data-reset]').forEach(b => b.onclick = () => {
    const m = emp.rows.find(r => r.id === b.dataset.reset);
    if (confirm(`Reset the password for ${m.full_name}? Their current password will stop working and they will get a new temporary one.`)) manageLogins('reset_password', [m.id]);
  });
  $('#empList').querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
    const on = b.dataset.on === 'true';
    if (on && !confirm('Deactivate this employee? They will lose access, but their training history is kept.')) return;
    const { error } = await sb.from('members').update({ active: !on }).eq('id', b.dataset.act);
    toast(error ? friendly(error) : on ? 'Employee deactivated.' : 'Employee reactivated.'); loadEmployees();
  });
}

/* ---------------- CSV import ---------------- */
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim()));
}
function cleanRow(r) {
  const key = (r.role || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  const role = { '': 'learner', learner: 'learner', employee: 'learner', manager: 'manager', orgadmin: 'org_admin', admin: 'org_admin', hr: 'org_admin', hradmin: 'org_admin' }[key] ?? key;
  return {
    full_name: (r.full_name || '').trim(), email: (r.email || '').trim().toLowerCase(),
    department: (r.department || '').trim() || null, role,
    manager_email: (r.manager_email || '').trim().toLowerCase() || null
  };
}
let pending = [];
function previewCsv(text) {
  const out = $('#csvOut'); pending = [];
  const rows = parseCSV(text.replace(/^﻿/, ''));
  if (rows.length < 2) return out.innerHTML = `<div class="msg err">The file is empty.</div>`;
  const head = rows.shift().map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  if (!head.includes('email') || !head.includes('full_name')) return out.innerHTML = `<div class="msg err">The file needs at least the columns full_name and email. Use the template.</div>`;
  const existing = new Set(emp.rows.map(r => r.email.toLowerCase())), seen = new Set(), problems = [];
  rows.forEach((cells, i) => {
    const o = {}; head.forEach((h, j) => o[h] = cells[j] ?? '');
    const r = cleanRow(o), line = i + 2;
    if (!r.full_name) problems.push(`Row ${line}: name is missing`);
    else if (!EMAIL_RE.test(r.email)) problems.push(`Row ${line}: "${r.email}" is not a valid email`);
    else if (!ROLES[r.role]) problems.push(`Row ${line}: role "${r.role}" is not valid`);
    else if (existing.has(r.email)) problems.push(`Row ${line}: ${r.email} already exists`);
    else if (seen.has(r.email)) problems.push(`Row ${line}: ${r.email} appears twice in the file`);
    else { seen.add(r.email); pending.push(r); }
  });
  out.innerHTML = `<div class="msg info"><b>${pending.length}</b> employees ready to import${problems.length ? `, <b>${problems.length}</b> rows skipped` : ''}.</div>
    ${problems.length ? `<details style="margin-top:8px"><summary class="small">See skipped rows</summary><ul class="small">${problems.slice(0, 50).map(p => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}
    ${pending.length ? `${loginCheckbox('csvLogin', 'Create logins and send welcome emails')}<div class="row" style="margin-top:12px"><button id="doImport">Import ${pending.length} employees</button></div>` : ''}`;
  if (pending.length) $('#doImport').onclick = runImport;
}
async function runImport() {
  const btn = $('#doImport'); btn.disabled = true; let ok = 0; const fails = [], newIds = [];
  const withLogin = $('#csvLogin').checked;
  for (let i = 0; i < pending.length; i++) {
    btn.textContent = `Importing ${i + 1} of ${pending.length}…`;
    const r = pending[i];
    const { data, error } = await sb.from('members').insert({ ...r, company_id: emp.companyId }).select('id').single();
    if (error) { fails.push(`${r.email}: ${friendly(error)}`); if (/limit reached/i.test(error.message)) break; } else { ok++; newIds.push(data.id); }
  }
  if (withLogin && newIds.length) manageLogins('create_login', newIds);
  $('#csvOut').innerHTML = `<div class="msg ${fails.length ? 'err' : 'ok'}">${ok} employees imported.${fails.length ? ` ${fails.length} failed.` : ''}</div>
    ${fails.length ? `<ul class="small">${fails.slice(0, 50).map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}`;
  $('#csv').value = ''; pending = []; loadEmployees();
}
function download(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click();
}

/* ---------------- Manager and Learner ---------------- */
async function renderTeam(ctx) {
  view = 'team';
  const myEmail = me.member.email.toLowerCase();
  const [{ data, error }, { data: asg }] = await Promise.all([
    sb.from('members').select('*').eq('company_id', me.member.company_id).eq('manager_email', myEmail).order('full_name'),
    sb.from('assignments').select('*, courses(title)').eq('company_id', me.member.company_id)
  ]);
  const team = data || [], ids = new Set(team.map(r => r.id));
  const work = (asg || []).filter(a => ids.has(a.member_id) && a.courses);
  const who = id => team.find(r => r.id === id)?.full_name || '';
  app.innerHTML = `<h1>My team</h1><p class="muted">People who report to you and their training.</p>${adminNav('team', ctx)}
    <div class="card tbl"><h2>Team members</h2>${error ? `<div class="msg err">${esc(friendly(error))}</div>` : !team.length ? `<p class="muted">Nobody is linked to you as their manager yet. Your HR admin sets this.</p>` :
    `<table><thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Account</th></tr></thead><tbody>${team.map(r => `<tr><td>${esc(r.full_name)}</td><td>${esc(r.email)}</td><td>${esc(r.department || '–')}</td><td>${statusOf(r)}</td></tr>`).join('')}</tbody></table>`}</div>
    <div class="card tbl"><h2>Team training</h2>${!work.length ? '<p class="muted">No training assigned to your team yet.</p>' :
    `<table><thead><tr><th>Name</th><th>Course</th><th>Status</th><th>Score</th><th>Due</th></tr></thead><tbody>
    ${work.sort((a, b) => assignmentStatus(a).text === 'Overdue' ? -1 : 1).map(a => { const s = assignmentStatus(a);
      return `<tr><td>${esc(who(a.member_id))}</td><td>${esc(a.courses.title)}</td><td><span class="tag ${s.cls}">${s.text}</span></td><td>${a.best_score ?? '–'}${a.best_score != null ? '%' : ''}</td><td>${fmtDate(a.due_date)}</td></tr>`; }).join('')}</tbody></table>`}</div>`;
  wireNav(ctx);
}

/* ---------------- Logins created by admins (Week 6) ---------------- */
function loginCheckbox(id, label = 'Create login and send welcome email') {
  return `<label class="pickrow" style="margin-top:14px"><input type="checkbox" id="${id}" checked style="width:auto"> ${label}</label>
    <p class="muted small" style="margin:2px 0 0 26px">A temporary password is created, shown to you once and emailed (if email is set up). They choose their own password at first login.</p>`;
}

async function manageLogins(action, ids) {
  const busy = showModal(`<h2>${action === 'reset_password' ? 'Resetting password…' : `Creating ${ids.length === 1 ? 'login' : ids.length + ' logins'}…`}</h2><p class="muted">Please wait.</p>`);
  const { data, error } = await sb.functions.invoke('manage-users', { body: { action, member_ids: ids, app_url: SITE } });
  busy.close();
  if (error) {
    let msg = 'Login management is not set up yet: deploy the "manage-users" function in Supabase (see README).';
    if (error.context?.status && error.context.status !== 404) try { const j = await error.context.json(); if (j.error) msg = j.error; } catch { /* keep message */ }
    return toast(msg, 8000);
  }
  if (typeof loadEmployees === 'function' && view === 'employees') loadEmployees();
  if (view === 'companies') loadCompanies();
  showLogins(action, data.results || [], data.email_configured);
}

function showLogins(action, results, emailConfigured) {
  const good = results.filter(r => r.password), bad = results.filter(r => !r.password);
  const lines = good.map(r => `${r.full_name} | ${r.email} | ${r.password}`).join('\n');
  const m = showModal(`<h2>${action === 'reset_password' ? 'New temporary password' : good.length === 1 ? 'Login created' : `${good.length} logins created`}</h2>
    <p class="msg info small">Copy these now: for security, SkillTrack does not store passwords and cannot show them again. ${action === 'reset_password' ? 'The old password no longer works.' : ''} Each person must choose their own password at first login.</p>
    ${!emailConfigured && good.length ? '<p class="msg err small">Welcome emails are not set up yet, so nothing was emailed. Share the login page, email and password with each person yourself.</p>' : ''}
    ${good.length ? `<div class="tbl"><table><thead><tr><th>Name</th><th>Email (login ID)</th><th>Temporary password</th><th></th><th>Email sent</th></tr></thead><tbody>
      ${good.map((r, i) => `<tr><td>${esc(r.full_name)}</td><td>${esc(r.email)}</td><td><code class="pw">${esc(r.password)}</code></td>
        <td><button class="link" data-copy="${i}">Copy</button></td><td>${r.emailed ? '<span class="tag ok">Sent</span>' : '<span class="tag warn">Not sent</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted">Login page: <b>${esc(SITE)}</b></p>` : ''}
    ${bad.length ? `<p class="small"><b>Not done:</b></p><ul class="small">${bad.map(r => `<li>${esc(r.full_name)} (${esc(r.email)}): ${esc(r.error || 'failed')}</li>`).join('')}</ul>` : ''}
    <div class="row" style="margin-top:14px">${good.length > 1 ? '<button class="sec" id="copyAll">Copy all</button><button class="sec" id="dlLogins">Download CSV</button>' : ''}<button id="doneLogins">Done</button></div>`);
  const copy = async text => { try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch { prompt('Copy this:', text); } };
  m.el.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
    const r = good[+b.dataset.copy];
    copy(`Login page: ${SITE}\nEmail: ${r.email}\nTemporary password: ${r.password}\nYou will be asked to choose your own password when you log in.`);
  });
  if (m.el.querySelector('#copyAll')) m.el.querySelector('#copyAll').onclick = () => copy(`Login page: ${SITE}\n${lines}`);
  if (m.el.querySelector('#dlLogins')) m.el.querySelector('#dlLogins').onclick = () =>
    download('skilltrack-logins.csv', ['full_name,email,temporary_password', ...good.map(r => [r.full_name, r.email, r.password].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n'));
  m.el.querySelector('#doneLogins').onclick = () => {
    if (good.length && !confirm('Have you copied the passwords? They cannot be shown again.')) return;
    m.close();
  };
}

function showModal(html) {
  const el = document.createElement('div');
  el.className = 'modal-bg';
  el.innerHTML = `<div class="modal card" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(el);
  return { el, close: () => el.remove() };
}
