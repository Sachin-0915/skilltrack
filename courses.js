/* SkillTrack - Week 2: course builder and assignment (Org Admin) */

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysUntil = d => Math.round((new Date(d + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 864e5);

// Status shown to people: overdue is calculated from the due date.
function assignmentStatus(a) {
  if (a.status === 'completed') return { text: 'Completed', cls: 'ok' };
  if (a.status === 'failed') return { text: 'Failed', cls: 'bad' };
  if (a.due_date && daysUntil(a.due_date) < 0) return { text: 'Overdue', cls: 'bad' };
  if (a.status === 'in_progress') return { text: 'In progress', cls: 'warn' };
  return { text: 'Not started', cls: '' };
}
const fmtDate = d => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';
const safeUrl = u => /^https?:\/\//i.test((u || '').trim()) ? u.trim() : '';

/* ---------------- course list ---------------- */
async function renderCourses(ctx) {
  view = 'courses';
  app.innerHTML = `${ctx.fromSuper ? `<button class="link" id="back">← All companies</button>` : ''}
    <h1>${esc(ctx.companyName || 'Courses')}</h1><p class="muted">Build courses, publish them and assign them with a due date.</p>
    ${adminNav('courses', ctx)}
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
      <div class="card"><h2>Create a course yourself</h2><form id="newCourse"><label>Course title</label><input id="ncTitle" placeholder="e.g. Information Security Awareness" required>
        <div class="row" style="margin-top:14px"><button>Create course</button></div></form></div>
      <div class="card ai"><h2>✨ Create a course with AI</h2><p class="muted small" style="margin-top:-6px">Type a topic, or paste your policy, and AI drafts the lessons and quiz. You review everything before publishing.</p>
        <button id="openAi">Start</button></div></div>
    <div id="aiPanel"></div>
    <div id="courseList" class="card">Loading…</div>`;
  wireNav(ctx);
  $('#openAi').onclick = () => renderAiForm(ctx);
  if (ctx.fromSuper) $('#back').onclick = renderCompanies;
  $('#newCourse').onsubmit = async e => {
    e.preventDefault();
    const { data, error } = await sb.from('courses').insert({ company_id: ctx.companyId, title: $('#ncTitle').value.trim() }).select().single();
    if (error) return toast(friendly(error));
    renderCourseEditor(ctx, data.id);
  };
  const [{ data: courses, error }, { data: lessons }, { data: asg }] = await Promise.all([
    sb.from('courses').select('*').eq('company_id', ctx.companyId).order('created_at', { ascending: false }),
    sb.from('lessons').select('id, course_id').eq('company_id', ctx.companyId),
    sb.from('assignments').select('course_id, status, due_date').eq('company_id', ctx.companyId)
  ]);
  if (error) return $('#courseList').innerHTML = `<div class="msg err">${esc(friendly(error))}</div>`;
  if (!courses.length) return $('#courseList').innerHTML = `<p class="muted">No courses yet. Type a title above to create your first course.</p>`;
  const by = (arr, id) => (arr || []).filter(x => x.course_id === id);
  $('#courseList').innerHTML = `<div class="tbl"><table><thead><tr><th>Course</th><th>Status</th><th>Lessons</th><th>Assigned</th><th>Completed</th><th>Overdue</th><th></th></tr></thead><tbody>
    ${courses.map(c => { const a = by(asg, c.id), done = a.filter(x => x.status === 'completed').length;
      return `<tr><td><b>${esc(c.title)}</b></td><td><span class="tag ${c.status === 'published' ? 'ok' : 'warn'}">${c.status === 'published' ? 'Published' : 'Draft'}</span></td>
      <td>${by(lessons, c.id).length}</td><td>${a.length}</td><td>${a.length ? `${done} (${Math.round(100 * done / a.length)}%)` : '–'}</td>
      <td>${a.filter(x => assignmentStatus(x).text === 'Overdue').length || '–'}</td>
      <td><button class="link" data-edit="${c.id}">Open</button></td></tr>`; }).join('')}
    </tbody></table></div>`;
  $('#courseList').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => renderCourseEditor(ctx, b.dataset.edit));
}

/* ---------------- course editor ---------------- */
let ed = null; // editor state

async function renderCourseEditor(ctx, courseId) {
  view = 'course-editor';
  const [{ data: course, error }, { data: lessons }, { data: questions }, { data: members }, { data: asg }] = await Promise.all([
    sb.from('courses').select('*').eq('id', courseId).single(),
    sb.from('lessons').select('*').eq('course_id', courseId).order('position'),
    sb.from('questions').select('*').eq('course_id', courseId).order('position'),
    sb.from('members').select('id, full_name, email, department, active').eq('company_id', ctx.companyId).order('full_name'),
    sb.from('assignments').select('*').eq('course_id', courseId)
  ]);
  if (error) return toast(friendly(error));
  ed = { ctx, course, lessons: lessons || [], questions: questions || [], members: (members || []).filter(m => m.active), asg: asg || [], editLesson: null, editQ: null };
  drawEditor();
}

function drawEditor() {
  const { course: c, lessons, questions, ctx } = ed, pub = c.status === 'published';
  app.innerHTML = `<button class="link" id="toList">← All courses</button>
    <div class="row" style="justify-content:space-between;margin-top:6px"><div><h1>${esc(c.title)}</h1>
      <span class="tag ${pub ? 'ok' : 'warn'}">${pub ? 'Published' : 'Draft'}</span> <span class="muted small">${lessons.length} lessons · ${questions.length} quiz questions · pass mark ${c.pass_mark}%</span></div>
      <div class="row"><button class="${pub ? 'sec' : ''}" id="pubBtn">${pub ? 'Unpublish' : 'Publish course'}</button><button class="danger" id="delCourse">Delete</button></div></div>

    <div class="card"><h2>1. Course details</h2><form id="detForm">
      <label>Title</label><input id="dTitle" value="${esc(c.title)}" required>
      <label>Description</label><textarea id="dDesc" rows="2">${esc(c.description || '')}</textarea>
      <div class="grid3"><div><label>Duration (minutes)</label><input id="dDur" type="number" min="1" value="${c.duration_minutes}"></div>
        <div><label>Pass mark (%)</label><input id="dPass" type="number" min="1" max="100" value="${c.pass_mark}"></div>
        <div><label>Quiz attempts allowed</label><input id="dAtt" type="number" min="1" max="10" value="${c.max_attempts}"></div></div>
      <div class="row" style="margin-top:14px"><button>Save details</button></div></form></div>

    <div class="card"><h2>2. Lessons</h2>
      ${lessons.length ? `<div class="tbl"><table><tbody>${lessons.map((l, i) => `<tr><td class="muted">${i + 1}</td><td><b>${esc(l.title)}</b></td><td>${{ text: 'Text', video: 'Video', pdf: 'PDF' }[l.type]}</td>
        <td style="text-align:right"><button class="link" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="link" data-down="${i}" ${i === lessons.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="link" data-le="${l.id}">Edit</button><button class="link" data-ld="${l.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>`
        : `<p class="muted">No lessons yet. Add the first one below.</p>`}
      <form id="lesForm" style="margin-top:12px"><h3 class="small muted" style="margin:0">${ed.editLesson ? 'Edit lesson' : 'Add a lesson'}</h3>
        <div class="grid3"><div style="grid-column:span 2"><label>Lesson title</label><input id="lTitle" required></div>
          <div><label>Type</label><select id="lType"><option value="text">Text</option><option value="video">Video link (YouTube / Vimeo)</option><option value="pdf">PDF link</option></select></div></div>
        <label id="lContentLabel">Content</label><textarea id="lContent" rows="6" required></textarea>
        <p class="muted small" id="lHint"></p>
        <div class="row"><button>${ed.editLesson ? 'Save lesson' : 'Add lesson'}</button>${ed.editLesson ? '<button type="button" class="sec" id="lCancel">Cancel</button>' : ''}</div></form></div>

    <div class="card"><h2>3. Final quiz</h2>
      <p class="muted small">Learners take the quiz after finishing all lessons. Leave it empty if the course has no quiz.</p>
      ${questions.map((q, i) => `<div class="qbox"><div class="row" style="justify-content:space-between"><b>${i + 1}. ${esc(q.question)}</b>
        <span><button class="link" data-qe="${q.id}">Edit</button><button class="link" data-qd="${q.id}">Delete</button></span></div>
        <ol type="A" class="small">${q.options.map((o, j) => `<li${j === q.correct ? ' class="right"' : ''}>${esc(o)}${j === q.correct ? ' ✓' : ''}</li>`).join('')}</ol></div>`).join('')}
      <form id="qForm" style="margin-top:12px"><h3 class="small muted" style="margin:0">${ed.editQ ? 'Edit question' : 'Add a question'}</h3>
        <label>Question</label><input id="qText" required>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">${[0, 1, 2, 3].map(j => `<div><label><input type="radio" name="qc" value="${j}" ${j === 0 ? 'checked' : ''} style="width:auto"> Option ${'ABCD'[j]} ${j === 0 ? '(select the correct one)' : ''}</label><input id="qo${j}" required></div>`).join('')}</div>
        <label>Explanation (optional, shown in your records)</label><input id="qExp">
        <div class="row" style="margin-top:14px"><button>${ed.editQ ? 'Save question' : 'Add question'}</button>${ed.editQ ? '<button type="button" class="sec" id="qCancel">Cancel</button>' : ''}</div></form></div>

    <div class="card"><h2>4. Assign to employees</h2>${pub ? assignFormHtml() : `<p class="muted">Publish the course first, then assign it here.</p>`}</div>
    <div class="card"><h2>Assigned learners (${ed.asg.length})</h2><div id="asgTable" class="tbl"></div></div>`;
  wireEditor();
}

function wireEditor() {
  const { course: c, ctx } = ed;
  $('#toList').onclick = () => renderCourses(ctx);
  const reload = () => renderCourseEditor(ctx, c.id);

  $('#pubBtn').onclick = async () => {
    if (c.status !== 'published' && !ed.lessons.length) return toast('Add at least one lesson before publishing.');
    if (c.status !== 'published' && !ed.questions.length && !confirm('This course has no quiz. Learners will complete it after the lessons. Publish anyway?')) return;
    if (c.status === 'published' && !confirm('Unpublish? Learners will not be able to open this course until you publish it again.')) return;
    const { error } = await sb.from('courses').update({ status: c.status === 'published' ? 'draft' : 'published' }).eq('id', c.id);
    toast(error ? friendly(error) : c.status === 'published' ? 'Course unpublished.' : 'Course published. You can now assign it.'); reload();
  };
  $('#delCourse').onclick = async () => {
    if (!confirm(`Delete "${c.title}"? All its lessons, quiz questions, assignments and learner progress will be removed. This cannot be undone.`)) return;
    const { error } = await sb.from('courses').delete().eq('id', c.id);
    if (error) return toast(friendly(error)); toast('Course deleted.'); renderCourses(ctx);
  };
  $('#detForm').onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.from('courses').update({ title: $('#dTitle').value.trim(), description: $('#dDesc').value.trim(),
      duration_minutes: +$('#dDur').value || 30, pass_mark: +$('#dPass').value || 80, max_attempts: +$('#dAtt').value || 3 }).eq('id', c.id);
    toast(error ? friendly(error) : 'Details saved.'); if (!error) reload();
  };

  // lessons
  const hints = { text: ['Content', 'Write or paste the lesson text. Leave a blank line between paragraphs.'],
    video: ['Video link', 'Paste a YouTube or Vimeo link, e.g. https://www.youtube.com/watch?v=…'],
    pdf: ['PDF link', 'Paste a public link to a PDF (e.g. a Google Drive file shared as "Anyone with the link").'] };
  const setHint = () => { const [l, h] = hints[$('#lType').value]; $('#lContentLabel').textContent = l; $('#lHint').textContent = h; $('#lContent').rows = $('#lType').value === 'text' ? 6 : 1; };
  $('#lType').onchange = setHint;
  if (ed.editLesson) { const l = ed.lessons.find(x => x.id === ed.editLesson); $('#lTitle').value = l.title; $('#lType').value = l.type; $('#lContent').value = l.content; }
  setHint();
  $('#lesForm').onsubmit = async e => {
    e.preventDefault();
    const type = $('#lType').value, content = $('#lContent').value.trim();
    if (type !== 'text' && !safeUrl(content)) return toast('Please paste a full link starting with https://');
    const row = { title: $('#lTitle').value.trim(), type, content };
    const { error } = ed.editLesson
      ? await sb.from('lessons').update(row).eq('id', ed.editLesson)
      : await sb.from('lessons').insert({ ...row, course_id: c.id, company_id: c.company_id, position: ed.lessons.length + 1 });
    if (error) return toast(friendly(error));
    toast(ed.editLesson ? 'Lesson saved.' : 'Lesson added.'); ed.editLesson = null; reload();
  };
  if ($('#lCancel')) $('#lCancel').onclick = () => { ed.editLesson = null; drawEditor(); };
  app.querySelectorAll('[data-le]').forEach(b => b.onclick = () => { ed.editLesson = b.dataset.le; drawEditor(); $('#lesForm').scrollIntoView({ behavior: 'smooth' }); });
  app.querySelectorAll('[data-ld]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this lesson?')) return;
    const { error } = await sb.from('lessons').delete().eq('id', b.dataset.ld); toast(error ? friendly(error) : 'Lesson deleted.'); reload();
  });
  const move = async (i, j) => {
    const a = ed.lessons[i], b = ed.lessons[j];
    await Promise.all([sb.from('lessons').update({ position: j + 1 }).eq('id', a.id), sb.from('lessons').update({ position: i + 1 }).eq('id', b.id)]);
    reload();
  };
  app.querySelectorAll('[data-up]').forEach(b => b.onclick = () => move(+b.dataset.up, +b.dataset.up - 1));
  app.querySelectorAll('[data-down]').forEach(b => b.onclick = () => move(+b.dataset.down, +b.dataset.down + 1));

  // questions
  if (ed.editQ) { const q = ed.questions.find(x => x.id === ed.editQ); $('#qText').value = q.question; q.options.forEach((o, j) => $('#qo' + j).value = o);
    app.querySelector(`[name=qc][value="${q.correct}"]`).checked = true; $('#qExp').value = q.explanation || ''; }
  $('#qForm').onsubmit = async e => {
    e.preventDefault();
    const row = { question: $('#qText').value.trim(), options: [0, 1, 2, 3].map(j => $('#qo' + j).value.trim()),
      correct: +app.querySelector('[name=qc]:checked').value, explanation: $('#qExp').value.trim() || null };
    const { error } = ed.editQ
      ? await sb.from('questions').update(row).eq('id', ed.editQ)
      : await sb.from('questions').insert({ ...row, course_id: c.id, company_id: c.company_id, position: ed.questions.length + 1 });
    if (error) return toast(friendly(error));
    toast(ed.editQ ? 'Question saved.' : 'Question added.'); ed.editQ = null; reload();
  };
  if ($('#qCancel')) $('#qCancel').onclick = () => { ed.editQ = null; drawEditor(); };
  app.querySelectorAll('[data-qe]').forEach(b => b.onclick = () => { ed.editQ = b.dataset.qe; drawEditor(); $('#qForm').scrollIntoView({ behavior: 'smooth' }); });
  app.querySelectorAll('[data-qd]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this question?')) return;
    const { error } = await sb.from('questions').delete().eq('id', b.dataset.qd); toast(error ? friendly(error) : 'Question deleted.'); reload();
  });

  if (c.status === 'published') wireAssign(reload);
  drawAssigned(reload);
}

/* ---------------- assignment ---------------- */
function assignFormHtml() {
  const depts = [...new Set(ed.members.map(m => m.department).filter(Boolean))].sort();
  return `<form id="asgForm">
    <div class="row" style="gap:18px">
      <label style="margin:0"><input type="radio" name="tgt" value="all" checked style="width:auto"> Everyone</label>
      <label style="margin:0"><input type="radio" name="tgt" value="dept" style="width:auto"> A department</label>
      <label style="margin:0"><input type="radio" name="tgt" value="people" style="width:auto"> Selected people</label></div>
    <div id="tDept" hidden><label>Department</label><select id="aDeptSel">${depts.map(d => `<option>${esc(d)}</option>`).join('') || '<option value="">No departments yet</option>'}</select></div>
    <div id="tPeople" hidden><label>Choose people</label><input id="pSearch" placeholder="Search…">
      <div class="pick">${ed.members.map(m => `<label class="pickrow"><input type="checkbox" value="${m.id}" style="width:auto"> ${esc(m.full_name)} <span class="muted small">${esc(m.department || '')} · ${esc(m.email)}</span></label>`).join('')}</div></div>
    <div class="grid3"><div><label>Due date</label><input id="aDue" type="date" min="${todayISO()}" required></div></div>
    <div class="row" style="margin-top:14px"><button id="asgGo">Assign course</button><span class="muted small" id="asgCount"></span></div></form>`;
}
function wireAssign(reload) {
  const d = new Date(); d.setDate(d.getDate() + 14); $('#aDue').value = d.toISOString().slice(0, 10);
  const targets = () => {
    const t = app.querySelector('[name=tgt]:checked').value;
    if (t === 'all') return ed.members;
    if (t === 'dept') return ed.members.filter(m => m.department === $('#aDeptSel').value);
    const ids = new Set([...app.querySelectorAll('.pick input:checked')].map(i => i.value));
    return ed.members.filter(m => ids.has(m.id));
  };
  const already = new Set(ed.asg.map(a => a.member_id));
  const count = () => { const all = targets(), fresh = all.filter(m => !already.has(m.id));
    $('#asgCount').textContent = `${fresh.length} people will be assigned${all.length - fresh.length ? ` (${all.length - fresh.length} already have it)` : ''}.`; };
  app.querySelectorAll('[name=tgt]').forEach(r => r.onchange = () => { const v = app.querySelector('[name=tgt]:checked').value; $('#tDept').hidden = v !== 'dept'; $('#tPeople').hidden = v !== 'people'; count(); });
  $('#aDeptSel').onchange = count;
  app.querySelectorAll('.pick input').forEach(i => i.onchange = count);
  $('#pSearch').oninput = e => { const q = e.target.value.toLowerCase(); app.querySelectorAll('.pickrow').forEach(r => r.hidden = !r.textContent.toLowerCase().includes(q)); };
  count();
  $('#asgForm').onsubmit = async e => {
    e.preventDefault();
    const fresh = targets().filter(m => !already.has(m.id));
    if (!fresh.length) return toast('Nobody new to assign.');
    const btn = $('#asgGo'); btn.disabled = true;
    const { error } = await sb.from('assignments').insert(fresh.map(m => ({ course_id: ed.course.id, company_id: ed.course.company_id, member_id: m.id, due_date: $('#aDue').value })));
    btn.disabled = false;
    if (error) return toast(friendly(error));
    toast(`Assigned to ${fresh.length} people. They will see it under My learning.`); reload();
  };
}
function drawAssigned(reload) {
  const name = id => ed.members.find(m => m.id === id) || { full_name: '(inactive employee)', department: '' };
  const total = ed.lessons.length || 1;
  $('#asgTable').innerHTML = !ed.asg.length ? `<p class="muted">Nobody is assigned yet.</p>` :
    `<table><thead><tr><th>Learner</th><th>Department</th><th>Status</th><th>Lessons</th><th>Best score</th><th>Attempts</th><th>Due</th><th></th></tr></thead><tbody>
    ${ed.asg.map(a => { const s = assignmentStatus(a), m = name(a.member_id);
      return `<tr><td>${esc(m.full_name)}</td><td>${esc(m.department || '–')}</td><td><span class="tag ${s.cls}">${s.text}</span></td>
      <td>${Math.min(a.completed_lessons.length, total)} / ${ed.lessons.length}</td><td>${a.best_score ?? '–'}${a.best_score != null ? '%' : ''}</td>
      <td>${a.attempts} / ${ed.course.max_attempts}</td><td>${fmtDate(a.due_date)}</td>
      <td>${a.status === 'failed' ? `<button class="link" data-reset="${a.id}">Reset attempts</button>` : ''}<button class="link" data-unassign="${a.id}">Remove</button></td></tr>`; }).join('')}
    </tbody></table>`;
  $('#asgTable').querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
    const { error } = await sb.from('assignments').update({ attempts: 0, status: 'in_progress' }).eq('id', b.dataset.reset);
    toast(error ? friendly(error) : 'Attempts reset. The learner can take the quiz again.'); reload();
  });
  $('#asgTable').querySelectorAll('[data-unassign]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this assignment? The learner\'s progress on this course will be deleted.')) return;
    const { error } = await sb.from('assignments').delete().eq('id', b.dataset.unassign); toast(error ? friendly(error) : 'Assignment removed.'); reload();
  });
}

/* ---------------- AI course generator (Week 5) ---------------- */
function renderAiForm(ctx) {
  const p = $('#aiPanel');
  p.innerHTML = `<div class="card ai"><div class="row" style="justify-content:space-between"><h2 style="margin:0">✨ Create a course with AI</h2><button class="link" id="aiClose">Close</button></div>
    <form id="aiForm">
      <label>Topic</label><input id="aiTopic" placeholder="e.g. POSH awareness for new joiners">
      <div class="grid3"><div><label>Audience</label><select id="aiAud"><option>All employees</option><option>New joiners</option><option>Managers</option><option>Sales team</option><option>Customer support team</option><option>Engineering team</option></select></div>
        <div><label>Level</label><select id="aiLvl"><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px"><div><label>Lessons</label><select id="aiLes">${[2, 3, 4, 5, 6].map(n => `<option ${n === 4 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div><label>Questions</label><select id="aiQ">${[3, 5, 8, 10].map(n => `<option ${n === 5 ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div></div>
      <label>Source material (optional but recommended)</label>
      <textarea id="aiSrc" rows="6" placeholder="Paste your policy, SOP or training notes. The course will then use only this content, so it matches your company's rules."></textarea>
      <p class="muted small" id="aiCount">0 / 40,000 characters</p>
      <div class="row"><button id="aiGo">Generate draft</button><button type="button" class="sec" id="aiChat">No AI key? Use a free AI chat</button><span class="muted small" id="aiWait"></span></div></form>
      <div id="chatFlow"></div></div>`;
  p.scrollIntoView({ behavior: 'smooth' });
  $('#aiClose').onclick = () => p.innerHTML = '';
  $('#aiSrc').oninput = e => $('#aiCount').textContent = `${e.target.value.length.toLocaleString()} / 40,000 characters`;
  const readForm = () => {
    const body = { topic: $('#aiTopic').value.trim(), audience: $('#aiAud').value, level: $('#aiLvl').value,
      lessons: +$('#aiLes').value, questions: +$('#aiQ').value, source: $('#aiSrc').value.trim() };
    if (!body.topic && !body.source) { toast('Enter a topic or paste some source material.'); return null; }
    if (body.source.length > 40000) { toast('Source material is too long. Paste at most 40,000 characters.'); return null; }
    return body;
  };
  $('#aiChat').onclick = () => { const body = readForm(); if (body) renderChatFlow(ctx, body); };
  $('#aiForm').onsubmit = async e => {
    e.preventDefault();
    const body = readForm(); if (!body) return;
    const btn = $('#aiGo'); btn.disabled = true; btn.textContent = 'Generating…';
    $('#aiWait').textContent = 'This usually takes 20 to 60 seconds.';
    const { data, error } = await sb.functions.invoke('ai-course', { body });
    btn.disabled = false; btn.textContent = 'Generate draft'; $('#aiWait').textContent = '';
    if (error) {
      let msg = 'Automatic AI is not set up yet. Use "No AI key? Use a free AI chat" instead.';
      if (error.context?.status !== 404) try { const j = await error.context.json(); if (j.error) msg = j.error; } catch { /* keep the setup message */ }
      return toast(msg, 7000);
    }
    renderAiPreview(ctx, data.course);
  };
}

function renderAiPreview(ctx, c) {
  const p = $('#aiPanel');
  p.innerHTML = `<div class="card ai"><span class="tag warn">AI draft · review before publishing</span>
    <h2 style="margin:10px 0 4px">${esc(c.title)}</h2><p class="muted">${esc(c.description)}</p>
    <p class="small muted">${c.lessons.length} lessons · ${c.questions.length} quiz questions · about ${c.duration_minutes} minutes</p>
    <h3>Lessons</h3>${c.lessons.map((l, i) => `<details class="qbox"><summary><b>${i + 1}. ${esc(l.title)}</b></summary><div class="lesson-body small">${lessonBody({ type: 'text', content: l.content })}</div></details>`).join('')}
    <h3 style="margin-top:16px">Quiz</h3>${c.questions.map((q, i) => `<div class="qbox"><b>${i + 1}. ${esc(q.question)}</b><ol type="A" class="small">${q.options.map((o, j) => `<li${j === q.correct ? ' class="right"' : ''}>${esc(o)}${j === q.correct ? ' ✓' : ''}</li>`).join('')}</ol><p class="muted small" style="margin:4px 0 0">${esc(q.explanation || '')}</p></div>`).join('')}
    <p class="msg info small">AI can make mistakes. Check every lesson and answer against your policy before publishing.</p>
    <div class="row" style="margin-top:12px"><button id="aiSave">Save as draft course</button><button class="sec" id="aiAgain">Try again</button><button class="link" id="aiDiscard">Discard</button></div></div>`;
  $('#aiDiscard').onclick = () => p.innerHTML = '';
  $('#aiAgain').onclick = () => renderAiForm(ctx);
  $('#aiSave').onclick = async () => {
    const btn = $('#aiSave'); btn.disabled = true; btn.textContent = 'Saving…';
    const { data: course, error } = await sb.from('courses').insert({ company_id: ctx.companyId, title: c.title.slice(0, 200),
      description: c.description, duration_minutes: Math.max(5, Math.min(600, c.duration_minutes || 30)) }).select().single();
    if (error) { btn.disabled = false; btn.textContent = 'Save as draft course'; return toast(friendly(error)); }
    const [r1, r2] = await Promise.all([
      sb.from('lessons').insert(c.lessons.map((l, i) => ({ course_id: course.id, company_id: ctx.companyId, position: i + 1, title: l.title, type: 'text', content: l.content }))),
      c.questions.length ? sb.from('questions').insert(c.questions.map((q, i) => ({ course_id: course.id, company_id: ctx.companyId, position: i + 1, question: q.question, options: q.options, correct: q.correct, explanation: q.explanation || null }))) : { error: null }
    ]);
    if (r1.error || r2.error) toast('The course was saved, but some lessons or questions failed. Please check it.', 6000);
    else toast('Draft saved. Review it, add videos if you like, then publish.');
    renderCourseEditor(ctx, course.id);
  };
}

/* ---------------- Free option: copy a prompt into any AI chat, paste the answer back ---------------- */
function chatPrompt(b) {
  return `Create a workplace training course and reply with ONLY one JSON object, no other text before or after it.

Topic: ${b.topic || '(take it from the source material)'}
Audience: ${b.audience}
Level: ${b.level}
Number of lessons: exactly ${b.lessons}
Number of quiz questions: exactly ${b.questions}

Put the JSON inside a single \`\`\`json code block, using plain straight double quotes.

Use exactly this JSON shape:
{"title": "...", "description": "one or two sentences", "duration_minutes": 30,
 "lessons": [{"title": "...", "content": "..."}],
 "questions": [{"question": "...", "options": ["...", "...", "...", "..."], "correct": 0, "explanation": "..."}]}

Lesson rules: plain text only, no markdown headings or bold. Separate paragraphs with a blank line (\\n\\n inside the JSON string). Short lists may use lines starting with "- ". 150 to 300 words per lesson, practical, with an everyday workplace example.
Quiz rules: exactly 4 options per question; "correct" is the 0-based index of the right option; vary its position; "explanation" is one sentence.${b.source ? `

Build the course ONLY from the source material below. Do not add facts, numbers or rules that are not in it.

<source_material>
${b.source}
</source_material>` : ''}`;
}

// Chat apps often turn " into curly quotes when text is copied. Try the text as it is, then repair the
// quotes that act as JSON delimiters (curly quotes inside sentences are valid and are kept), then all of them.
function parseLooseJson(text) {
  // Line breaks typed inside a text value are not allowed in JSON: turn them into \n.
  const fixBreaks = x => { let out = '', inStr = false, esc = false;
    for (const ch of x) {
      if (inStr && !esc && (ch === '\n' || ch === '\r' || ch === '\t')) { out += ch === '\t' ? '\\t' : ch === '\n' ? '\\n' : ''; continue; }
      if (ch === '"' && !esc) inStr = !inStr;
      esc = ch === '\\' && !esc; out += ch;
    }
    return out; };
  const t = text.replace(/\u00a0/g, ' ');
  const tries = [t,
    t.replace(/([{\[,:]\s*)[\u201c\u201d]/g, '$1"').replace(/[\u201c\u201d](\s*[:,}\]])/g, '"$1'),
    t.replace(/[\u201c\u201d]/g, '"')];
  let firstError;
  for (const x of tries) for (const y of [x, fixBreaks(x)]) { try { return JSON.parse(y); } catch (e) { firstError ??= e; } }
  throw firstError;
}

// Same checks the server function applies, so bad data never reaches the database.
function cleanCourse(c) {
  if (!c || typeof c !== 'object') throw new Error('That does not look like a course.');
  const str = v => (typeof v === 'string' ? v.trim() : '');
  const lessons = (Array.isArray(c.lessons) ? c.lessons : []).map(l => ({ title: str(l?.title).slice(0, 200), content: str(l?.content) })).filter(l => l.title && l.content);
  const questions = (Array.isArray(c.questions) ? c.questions : []).map(q => ({ question: str(q?.question), options: Array.isArray(q?.options) ? q.options.map(str) : [],
    correct: Number(q?.correct), explanation: str(q?.explanation) })).filter(q => q.question && q.options.length === 4 && q.options.every(Boolean) && Number.isInteger(q.correct) && q.correct >= 0 && q.correct <= 3);
  if (!lessons.length) throw new Error('No lessons found in the answer.');
  if ([c.title, ...lessons.map(l => l.content)].some(v => str(v) === '...')) throw new Error('The answer still contains the "..." template.');
  return { title: str(c.title) || 'New course', description: str(c.description), duration_minutes: Number(c.duration_minutes) || 30, lessons, questions };
}

function renderChatFlow(ctx, body) {
  const box = $('#chatFlow'), prompt = chatPrompt(body);
  box.innerHTML = `<div class="chatflow">
    <h3>Step 1 · Copy this prompt and send it in a free AI chat</h3>
    <p class="muted small">Open <a href="https://claude.ai" target="_blank" rel="noopener">claude.ai</a> (the free plan works) in a new tab, start a new chat, paste the prompt and press send. Wait for the AI to finish writing.</p>
    <textarea id="cfPrompt" rows="6" readonly>${esc(prompt)}</textarea>
    <div class="row" style="margin-top:8px"><button type="button" class="sec" id="cfCopy">Copy prompt</button></div>
    <h3 style="margin-top:18px">Step 2 · Copy the AI's reply and paste it here</h3>
    <p class="muted small">Not the prompt: the AI's reply. It contains your course title and lesson text. Best: use the <b>copy button on the code block</b> in the AI's reply.</p>
    <textarea id="cfAnswer" rows="6" placeholder="Paste the AI's reply here"></textarea>
    <div class="row" style="margin-top:8px"><button type="button" id="cfPreview">Preview course</button></div></div>`;
  box.scrollIntoView({ behavior: 'smooth' });
  $('#cfCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(prompt); toast('Prompt copied. Paste it into the AI chat.'); }
    catch { $('#cfPrompt').select(); toast('Press Ctrl + C to copy the selected prompt.'); }
  };
  $('#cfPreview').onclick = () => {
    const raw = $('#cfAnswer').value, a = raw.indexOf('{'), z = raw.lastIndexOf('}');
    if (raw.includes('reply with ONLY one JSON object') || raw.includes('"title": "...", "description": "one or two sentences"'))
      return toast('That is the prompt, not the answer. Paste the prompt into the AI chat, send it, then copy the AI\'s reply and paste it here.', 9000);
    if (a < 0 || z <= a) return toast('Paste the whole answer, from the first { to the last }.', 5000);
    let course;
    try { course = cleanCourse(parseLooseJson(raw.slice(a, z + 1))); }
    catch (e) { return toast(`Could not read the answer: ${e.message} Ask the AI to "put the JSON in a code block" and copy it with the code block's copy button.`, 8000); }
    if (course.questions.length < body.questions) toast(`Note: ${course.questions.length} usable quiz questions were found.`, 5000);
    renderAiPreview(ctx, course);
  };
}
