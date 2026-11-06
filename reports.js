/* SkillTrack - Week 4: reports dashboard, at-risk list, reminders */

let rep = null;

async function renderReports(ctx) {
  view = 'reports';
  app.innerHTML = `${ctx.fromSuper ? `<button class="link" id="back">← All companies</button>` : ''}
    <h1>${esc(ctx.companyName || 'Reports')}</h1><p class="muted">Training completion, overdue work and who needs a nudge.</p>
    ${adminNav('reports', ctx)}<div id="repBody" class="card">Loading…</div>`;
  wireNav(ctx);
  if (ctx.fromSuper) $('#back').onclick = renderCompanies;
  const [{ data: members }, { data: courses }, { data: lessons }, { data: asg, error }] = await Promise.all([
    sb.from('members').select('id, full_name, email, department, manager_email, active').eq('company_id', ctx.companyId),
    sb.from('courses').select('id, title, status').eq('company_id', ctx.companyId),
    sb.from('lessons').select('id, course_id').eq('company_id', ctx.companyId),
    sb.from('assignments').select('*').eq('company_id', ctx.companyId)
  ]);
  if (error) return $('#repBody').innerHTML = `<div class="msg err">${esc(friendly(error))}</div>`;
  const lessonCount = {}; (lessons || []).forEach(l => lessonCount[l.course_id] = (lessonCount[l.course_id] || 0) + 1);
  const mem = Object.fromEntries((members || []).map(m => [m.id, m])), crs = Object.fromEntries((courses || []).map(c => [c.id, c]));
  const rows = (asg || []).filter(a => mem[a.member_id]?.active && crs[a.course_id]).map(a => {
    const n = lessonCount[a.course_id] || 0, pct = a.status === 'completed' ? 100 : n ? Math.round(100 * Math.min(a.completed_lessons.length, n) / n) : 0;
    return { ...a, m: mem[a.member_id], c: crs[a.course_id], pct, ...riskOf(a, pct) };
  });
  rep = { ctx, rows, course: '', dept: '', sel: new Set() };
  drawReports();
}

// At-risk rules (same idea as the Learner Analytics Dashboard)
function riskOf(a, pct) {
  if (a.status === 'completed') return { risk: null, reason: '' };
  const left = a.due_date ? daysUntil(a.due_date) : null, age = Math.round((Date.now() - new Date(a.assigned_at)) / 864e5);
  if (a.status === 'failed') return { risk: 'High', reason: 'Failed the quiz, no attempts left' };
  if (left !== null && left < 0) return { risk: 'High', reason: `Overdue by ${-left} day${left === -1 ? '' : 's'}` };
  if (left !== null && left <= 7 && pct < 50) return { risk: 'High', reason: `Due in ${left} day${left === 1 ? '' : 's'}, only ${pct}% done` };
  if (left !== null && left <= 14 && pct < 50) return { risk: 'Medium', reason: `Due in ${left} days, only ${pct}% done` };
  if (a.status === 'not_started' && age >= 7) return { risk: 'Medium', reason: `Not started ${age} days after assignment` };
  return { risk: null, reason: '' };
}

function drawReports() {
  const { rows: all, ctx } = rep;
  const courses = [...new Map(all.map(r => [r.c.id, r.c.title]))].sort((a, b) => a[1] > b[1] ? 1 : -1);
  const depts = [...new Set(all.map(r => r.m.department).filter(Boolean))].sort();
  const rows = all.filter(r => (!rep.course || r.c.id === rep.course) && (!rep.dept || r.m.department === rep.dept));
  const done = rows.filter(r => r.status === 'completed'), overdue = rows.filter(r => assignmentStatus(r).text === 'Overdue');
  const scores = done.map(r => r.best_score).filter(s => s != null);
  const risk = rows.filter(r => r.risk).sort((a, b) => (a.risk === b.risk ? 0 : a.risk === 'High' ? -1 : 1) || (a.due_date || '') .localeCompare(b.due_date || ''));
  const rate = list => list.length ? Math.round(100 * list.filter(r => r.status === 'completed').length / list.length) : 0;
  const group = key => Object.entries(rows.reduce((g, r) => ((g[key(r) || 'No department'] ??= []).push(r), g), {}))
    .map(([name, list]) => ({ name, rate: rate(list), n: list.length, late: list.filter(r => assignmentStatus(r).text === 'Overdue').length })).sort((a, b) => b.rate - a.rate);
  const byCourse = group(r => r.c.title), byDept = group(r => r.m.department);
  const bars = list => list.map(d => `<div class="rbar"><span title="${esc(d.name)}">${esc(d.name)}</span><div class="bar"><div style="width:${d.rate}%"></div></div><b>${d.rate}%</b><span class="muted small">${d.n} assigned${d.late ? ` · <span class="bad">${d.late} overdue</span>` : ''}</span></div>`).join('');

  const insights = [];
  if (rows.length) {
    insights.push(`Overall completion is <b>${rate(rows)}%</b> across ${new Set(rows.map(r => r.member_id)).size} people and ${rows.length} assignments.`);
    const realDepts = byDept.filter(d => d.name !== 'No department');
    if (realDepts.length > 1) insights.push(`<b>${esc(realDepts.at(-1).name)}</b> has the lowest completion (${realDepts.at(-1).rate}%), compared with <b>${esc(realDepts[0].name)}</b> at ${realDepts[0].rate}%.`);
    if (overdue.length) { const worst = [...byCourse].sort((a, b) => b.late - a.late)[0]; insights.push(`<b>${overdue.length}</b> ${overdue.length === 1 ? 'assignment is' : 'assignments are'} overdue${overdue.length === 1 ? ` in "${esc(worst.name)}"` : worst.late ? `, most of them in "${esc(worst.name)}" (${worst.late})` : ''}.`); }
    const high = new Set(risk.filter(r => r.risk === 'High').map(r => r.member_id)).size;
    if (high) insights.push(`Suggested action: send a reminder to the <b>${high}</b> people with high-risk training this week.`);
    const med = new Set(risk.filter(r => r.risk === 'Medium').map(r => r.member_id)).size;
    if (!high) insights.push(med ? `No high-risk training right now, but <b>${med}</b> ${med === 1 ? 'person is' : 'people are'} at medium risk. A gentle reminder now prevents overdue training.` : 'No high-risk training right now. Good work!');
  }

  $('#repBody').outerHTML = `<div id="repBody">
    <div class="card row" style="justify-content:space-between">
      <div class="row"><select id="rCourse" style="width:auto"><option value="">All courses</option>${courses.map(([id, t]) => `<option value="${id}" ${id === rep.course ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <select id="rDept" style="width:auto"><option value="">All departments</option>${depts.map(d => `<option ${d === rep.dept ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></div>
      <button class="sec" id="expAll">Export full report (CSV)</button></div>
    ${!rows.length ? `<div class="card"><p class="muted">No training assigned yet. Assign a course from the Courses tab and the report will fill in here.</p></div>` : `
    <div class="grid" style="margin-top:16px">
      <div class="stat"><b>${rate(rows)}%</b><span class="muted small">Completion rate</span></div>
      <div class="stat"><b>${done.length} / ${rows.length}</b><span class="muted small">Assignments completed</span></div>
      <div class="stat"><b class="${overdue.length ? 'bad' : ''}">${overdue.length}</b><span class="muted small">Overdue</span></div>
      <div class="stat"><b>${new Set(risk.map(r => r.member_id)).size}</b><span class="muted small">People at risk</span></div>
      <div class="stat"><b>${scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) + '%' : '–'}</b><span class="muted small">Average quiz score</span></div>
    </div>
    <div class="card"><h2>Key insights</h2><ul>${insights.map(i => `<li>${i}</li>`).join('')}</ul></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
      <div class="card"><h2>Completion by course</h2>${bars(byCourse)}</div>
      <div class="card"><h2>Completion by department</h2>${bars(byDept)}</div></div>
    <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">At-risk training (${risk.length})</h2>
      <div class="row"><button class="sec" id="expRisk" ${risk.length ? '' : 'disabled'}>Export (CSV)</button><button id="remind" ${risk.length ? '' : 'disabled'}>Email reminder to selected</button></div></div>
      <p class="muted small">High: overdue, failed, or due within 7 days and under 50% done. Medium: due within 14 days and under 50% done, or not started a week after assignment.</p>
      <div class="tbl">${risk.length ? `<table><thead><tr><th><input type="checkbox" id="selAll" style="width:auto" checked></th><th>Learner</th><th>Department</th><th>Course</th><th>Progress</th><th>Due</th><th>Risk</th><th>Reason</th></tr></thead><tbody>
        ${risk.map(r => `<tr><td><input type="checkbox" class="rsel" value="${r.id}" style="width:auto" checked></td><td>${esc(r.m.full_name)}</td><td>${esc(r.m.department || '–')}</td><td>${esc(r.c.title)}</td><td>${r.pct}%</td><td>${fmtDate(r.due_date)}</td>
        <td><span class="tag ${r.risk === 'High' ? 'bad' : 'warn'}">${r.risk}</span></td><td>${esc(r.reason)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nobody is at risk right now.</p>'}</div></div>`}
  </div>`;

  $('#rCourse').onchange = e => { rep.course = e.target.value; drawReports(); };
  $('#rDept').onchange = e => { rep.dept = e.target.value; drawReports(); };
  $('#expAll').onclick = () => rows.length ? download('skilltrack-training-report.csv', csvOf(rows)) : toast('Nothing to export yet.');
  if (!risk.length) return;
  const selected = () => risk.filter(r => [...app.querySelectorAll('.rsel:checked')].some(i => i.value === r.id));
  $('#selAll').onchange = e => app.querySelectorAll('.rsel').forEach(i => i.checked = e.target.checked);
  $('#expRisk').onclick = () => download('skilltrack-at-risk.csv', csvOf(selected().length ? selected() : risk, true));
  $('#remind').onclick = () => reminderEmail(selected());
}

function csvOf(list, withRisk) {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Learner', 'Email', 'Department', 'Manager email', 'Course', 'Status', 'Progress %', 'Best score %', 'Attempts', 'Assigned', 'Due date', 'Completed', 'Certificate no'].concat(withRisk ? ['Risk', 'Reason'] : []);
  const lines = list.map(r => [r.m.full_name, r.m.email, r.m.department, r.m.manager_email, r.c.title, assignmentStatus(r).text, r.pct, r.best_score, r.attempts,
    (r.assigned_at || '').slice(0, 10), r.due_date, (r.completed_at || '').slice(0, 10), r.certificate_no].concat(withRisk ? [r.risk, r.reason] : []).map(cell).join(','));
  return [head.map(cell).join(','), ...lines].join('\n');
}

// Opens HR's own email app with the learners in BCC and a ready message.
function reminderEmail(list) {
  if (!list.length) return toast('Tick at least one learner.');
  const emails = [...new Set(list.map(r => r.m.email))];
  const courses = [...new Set(list.map(r => r.c.title))];
  const subject = courses.length === 1 ? `Reminder: please complete "${courses[0]}"` : 'Reminder: please complete your assigned training';
  const body = `Hi,\n\nThis is a friendly reminder that you have training to complete in SkillTrack:\n\n${courses.map(c => `- ${c}`).join('\n')}\n\nPlease log in at ${SITE} and finish it before the due date.\n\nThank you,\n${me.member?.full_name || 'HR team'}`;
  const url = `mailto:?bcc=${encodeURIComponent(emails.join(','))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  if (url.length > 1900) {
    navigator.clipboard?.writeText(emails.join(', '));
    toast(`${emails.length} email addresses copied. Paste them into BCC in your email app.`, 6000);
    location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  } else location.href = url;
}
