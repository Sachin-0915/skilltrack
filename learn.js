/* SkillTrack - Week 2: learner experience (My learning, lessons, quiz, certificate) */

async function renderMyLearning(ctx) {
  view = 'learning';
  app.innerHTML = `<h1>${me.member.role === 'learner' ? `Hi ${esc(me.member.full_name.split(' ')[0])}` : 'My learning'}</h1>
    <p class="muted">Your assigned training at ${esc(me.company?.name || 'your company')}.</p>
    ${me.member.role !== 'learner' ? adminNav('learning', ctx) : ''}<div id="myList">Loading…</div>`;
  if (me.member.role !== 'learner') wireNav(ctx);
  const [{ data: asg, error }, { data: lessons }] = await Promise.all([
    sb.from('assignments').select('*, courses(id, title, description, duration_minutes, pass_mark, max_attempts)').eq('member_id', me.member.id),
    sb.from('lessons').select('id, course_id').eq('company_id', me.member.company_id)
  ]);
  if (error) return $('#myList').innerHTML = `<div class="msg err">${esc(friendly(error))}</div>`;
  const items = (asg || []).filter(a => a.courses); // hides unpublished courses
  const count = id => (lessons || []).filter(l => l.course_id === id).length;
  const todo = items.filter(a => a.status !== 'completed')
    .sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1);
  const done = items.filter(a => a.status === 'completed');
  const card = a => {
    const s = assignmentStatus(a), n = count(a.course_id), pct = a.status === 'completed' ? 100 : n ? Math.round(100 * Math.min(a.completed_lessons.length, n) / n) : 0;
    const due = a.due_date ? (s.text === 'Overdue' ? `Overdue since ${fmtDate(a.due_date)}` : a.status === 'completed' ? `Completed ${fmtDate(a.completed_at)}` : `Due ${fmtDate(a.due_date)} · ${daysUntil(a.due_date)} days left`) : '';
    return `<div class="card course">
      <div class="row" style="justify-content:space-between"><span class="tag ${s.cls}">${s.text}</span><span class="muted small">${a.courses.duration_minutes} min</span></div>
      <h2 style="margin:10px 0 4px">${esc(a.courses.title)}</h2>
      <p class="muted small" style="margin:0 0 10px">${esc(a.courses.description || '')}</p>
      <div class="bar"><div style="width:${pct}%"></div></div>
      <div class="row" style="justify-content:space-between;margin-top:10px"><span class="small ${s.text === 'Overdue' ? 'bad' : 'muted'}">${due}</span>
        ${a.status === 'completed' ? `<button class="sec" data-cert="${a.id}">Certificate</button>` : `<button data-open="${a.id}">${a.status === 'not_started' ? 'Start' : 'Continue'}</button>`}</div></div>`;
  };
  $('#myList').innerHTML = !items.length ? `<div class="card"><h2>My courses</h2><p class="muted">You have no courses assigned yet. When your HR team assigns training, it will appear here with its due date.</p></div>` :
    `<h2 style="margin-top:20px">To do (${todo.length})</h2>${todo.length ? `<div class="cards">${todo.map(card).join('')}</div>` : '<p class="muted">All done. Nice work!</p>'}
     ${done.length ? `<h2 style="margin-top:24px">Completed (${done.length})</h2><div class="cards">${done.map(card).join('')}</div>` : ''}`;
  $('#myList').querySelectorAll('[data-open]').forEach(b => b.onclick = () => renderPlayer(b.dataset.open, ctx));
  $('#myList').querySelectorAll('[data-cert]').forEach(b => b.onclick = () => openCertificate(items.find(a => a.id === b.dataset.cert)));
}

/* ---------------- course player ---------------- */
async function renderPlayer(assignmentId, ctx, lessonId) {
  view = 'player';
  const { data: a, error } = await sb.from('assignments').select('*, courses(*)').eq('id', assignmentId).single();
  if (error || !a.courses) return toast(error ? friendly(error) : 'This course is not available right now.');
  const { data: lessons } = await sb.from('lessons').select('*').eq('course_id', a.course_id).order('position');
  const doneSet = new Set(a.completed_lessons), allDone = lessons.every(l => doneSet.has(l.id));
  const current = lessons.find(l => l.id === lessonId) || lessons.find(l => !doneSet.has(l.id)) || null;
  const s = assignmentStatus(a);
  app.innerHTML = `<button class="link" id="back">← My learning</button>
    <h1 style="margin-top:6px">${esc(a.courses.title)}</h1><p class="muted small"><span class="tag ${s.cls}">${s.text}</span> ${a.due_date ? `Due ${fmtDate(a.due_date)}` : ''}</p>
    <div class="player">
      <aside class="card side"><b class="small muted">LESSONS</b>
        ${lessons.map((l, i) => `<button class="lesson ${current && l.id === current.id ? 'on' : ''}" data-l="${l.id}"><span class="tick ${doneSet.has(l.id) ? 'done' : ''}">${doneSet.has(l.id) ? '✓' : i + 1}</span>${esc(l.title)}</button>`).join('')}
        <button class="lesson ${!current ? 'on' : ''}" id="quizNav" ${allDone ? '' : 'disabled'}><span class="tick ${a.status === 'completed' ? 'done' : ''}">${a.status === 'completed' ? '✓' : '★'}</span>Final quiz</button>
      </aside>
      <section class="card main" id="stage"></section></div>`;
  $('#back').onclick = () => renderMyLearning(ctx);
  app.querySelectorAll('[data-l]').forEach(b => b.onclick = () => renderPlayer(a.id, ctx, b.dataset.l));
  $('#quizNav').onclick = () => renderPlayer(a.id, ctx, 'quiz');

  const stage = $('#stage');
  if (current) {
    // Uploaded files are private: get a link that works for one hour, for this learner only.
    let fileUrl = null;
    if (current.content.startsWith('file:')) {
      const { data: signed } = await sb.storage.from('course-files').createSignedUrl(current.content.slice(5), 3600);
      fileUrl = signed?.signedUrl || null;
    }
    stage.innerHTML = `<h2>${esc(current.title)}</h2><div class="lesson-body">${lessonBody(current, fileUrl)}</div>
      <div class="row" style="justify-content:flex-end;margin-top:20px">${doneSet.has(current.id) ? '<span class="muted small">Completed ✓</span>' : ''}
      <button id="doneBtn">${doneSet.has(current.id) ? 'Next' : 'Mark complete and continue'}</button></div>`;
    $('#doneBtn').onclick = async () => {
      if (!doneSet.has(current.id)) {
        const { error } = await sb.rpc('complete_lesson', { p_assignment: a.id, p_lesson: current.id });
        if (error) return toast(friendly(error));
      }
      const next = lessons[lessons.indexOf(current) + 1];
      renderPlayer(a.id, ctx, next ? next.id : 'quiz');
    };
  } else if (a.status === 'completed') {
    stage.innerHTML = `<h2>Course completed 🎉</h2><p>You passed with <b>${a.best_score}%</b> on ${fmtDate(a.completed_at)}.</p><button id="certBtn">Download certificate</button>`;
    $('#certBtn').onclick = () => openCertificate(a);
  } else if (a.status === 'failed') {
    stage.innerHTML = `<h2>No attempts left</h2><p class="muted">Your best score was ${a.best_score ?? 0}%, and the pass mark is ${a.courses.pass_mark}%. Please ask your HR admin to reset your attempts.</p>`;
  } else renderQuiz(a, ctx, stage);
}

function lessonBody(l, fileUrl) {
  if (l.type === 'text') return l.content.split(/\n\s*\n/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  if (l.content.startsWith('file:')) {
    if (!fileUrl) return `<p class="muted">This file could not be opened. Please refresh the page, or tell your HR admin.</p>`;
    return l.type === 'video'
      ? `<div class="video"><video src="${esc(fileUrl)}" controls preload="metadata" controlsList="nodownload"></video></div>`
      : `<div class="pdf"><iframe src="${esc(fileUrl)}" title="${esc(l.title)}"></iframe></div>
         <p class="small"><a href="${esc(fileUrl)}" target="_blank" rel="noopener">Open the PDF in a new tab</a> if it does not show above.</p>`;
  }
  const url = safeUrl(l.content);
  if (!url) return `<p class="muted">This lesson's link is missing. Please tell your HR admin.</p>`;
  if (l.type === 'video') {
    const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/), vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    const src = yt ? `https://www.youtube-nocookie.com/embed/${yt[1]}` : vm ? `https://player.vimeo.com/video/${vm[1]}` : '';
    return src ? `<div class="video"><iframe src="${src}" allow="fullscreen; picture-in-picture" allowfullscreen title="${esc(l.title)}"></iframe></div>`
               : `<p><a href="${esc(url)}" target="_blank" rel="noopener">Open the video in a new tab</a></p>`;
  }
  // Google Drive links use Drive's own viewer; other public PDF links use Google's document viewer,
  // because many websites refuse to be shown inside another page.
  const gd = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
  const src = gd ? `https://drive.google.com/file/d/${gd[1]}/preview`
    : `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`;
  return `<div class="pdf"><iframe src="${esc(src)}" title="${esc(l.title)}"></iframe></div>
    <p class="small"><a href="${esc(url)}" target="_blank" rel="noopener">Open the PDF in a new tab</a> if it does not show above.</p>`;
}

/* ---------------- quiz ---------------- */
async function renderQuiz(a, ctx, stage) {
  stage.innerHTML = 'Loading quiz…';
  const { data: quiz, error } = await sb.rpc('get_quiz', { p_assignment: a.id });
  if (error) return stage.innerHTML = `<div class="msg err">${esc(friendly(error))}</div>`;
  const qs = quiz.questions || [];
  if (!qs.length) {
    stage.innerHTML = `<h2>All lessons done</h2><p class="muted">This course has no quiz. Click below to finish it.</p><button id="finish">Finish course</button>`;
    $('#finish').onclick = () => submitQuiz(a, ctx, stage, {}, []);
    return;
  }
  stage.innerHTML = `<h2>Final quiz</h2><p class="muted small">${qs.length} questions · pass mark ${quiz.pass_mark}% · attempt ${quiz.attempts + 1} of ${quiz.max_attempts}</p>
    <form id="quizForm">${qs.map((q, i) => `<fieldset class="qbox"><legend><b>${i + 1}. ${esc(q.question)}</b></legend>
      ${q.options.map((o, j) => `<label class="opt"><input type="radio" name="${q.id}" value="${j}" required style="width:auto"> ${esc(o)}</label>`).join('')}</fieldset>`).join('')}
      <div class="row" style="margin-top:16px"><button id="submitQuiz">Submit answers</button></div></form>`;
  $('#quizForm').onsubmit = e => {
    e.preventDefault();
    const answers = Object.fromEntries(qs.map(q => [q.id, +stage.querySelector(`[name="${q.id}"]:checked`).value]));
    submitQuiz(a, ctx, stage, answers, qs);
  };
}
async function submitQuiz(a, ctx, stage, answers, qs) {
  const btn = stage.querySelector('button'); if (btn) btn.disabled = true;
  const { data: r, error } = await sb.rpc('submit_quiz', { p_assignment: a.id, p_answers: answers });
  if (error) { if (btn) btn.disabled = false; return toast(friendly(error)); }
  stage.innerHTML = `<h2>${r.passed ? 'You passed! 🎉' : 'Not passed yet'}</h2>
    <p style="font-size:28px;margin:6px 0"><b>${r.score}%</b> <span class="muted small">pass mark ${r.pass_mark}%</span></p>
    ${qs.length ? `<ul class="small">${qs.map((q, i) => `<li>${r.results[q.id] ? '✅' : '❌'} Question ${i + 1}</li>`).join('')}</ul>` : ''}
    <div class="row" style="margin-top:14px">${r.passed ? `<button id="certBtn">Download certificate</button>`
      : r.attempts_left > 0 ? `<button id="retry">Review lessons and try again (${r.attempts_left} left)</button>`
      : `<span class="msg err">No attempts left. Please ask your HR admin to reset your attempts.</span>`}
      <button class="sec" id="toList">Back to My learning</button></div>`;
  $('#toList').onclick = () => renderMyLearning(ctx);
  if ($('#retry')) $('#retry').onclick = () => renderPlayer(a.id, ctx, a.completed_lessons[0] || undefined);
  if ($('#certBtn')) $('#certBtn').onclick = async () => {
    const { data } = await sb.from('assignments').select('*, courses(*)').eq('id', a.id).single(); openCertificate(data);
  };
}

/* ---------------- certificate ---------------- */
function openCertificate(a) {
  const col = /^#[0-9a-f]{6}$/i.test(me.company?.brand_color || '') ? me.company.brand_color : '#2f5bea';
  const w = window.open('', '_blank');
  if (!w) return toast('Please allow pop-ups to download your certificate.');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Certificate - ${esc(a.courses.title)}</title>
  <style>@page{size:A4 landscape;margin:0}body{margin:0;font-family:Georgia,'Times New Roman',serif;color:#1d2433;background:#fff}
  .c{box-sizing:border-box;width:297mm;height:210mm;padding:22mm;border:10px solid ${col};outline:2px solid ${col};outline-offset:-22px;text-align:center;display:flex;flex-direction:column;justify-content:center}
  .co{font:600 16px system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:${col}}.lg{max-height:70px;max-width:260px;margin:0 auto 10px;display:block}h1{font-size:46px;margin:18px 0 8px}
  .n{font-size:38px;margin:14px 0;border-bottom:1px solid #ccd;display:inline-block;padding:0 40px 6px}.t{font-size:24px;font-style:italic}
  .meta{margin-top:30px;font:14px system-ui,sans-serif;color:#5d6678;display:flex;justify-content:space-around}
  .p{font:14px system-ui,sans-serif;margin:20px}@media print{.p{display:none}}</style></head><body>
  <p class="p">Use your browser's print window and choose <b>Save as PDF</b>.</p>
  <div class="c">${me.company?.logo_url ? `<img class="lg" src="${esc(me.company.logo_url)}" alt="">` : ''}<div class="co">${esc(me.company?.name || '')}</div><h1>Certificate of Completion</h1>
  <div>This certifies that</div><div class="n">${esc(me.member.full_name)}</div>
  <div>has successfully completed</div><div class="t">${esc(a.courses.title)}</div>
  <div class="meta"><span>Date: <b>${fmtDate(a.completed_at)}</b></span><span>Score: <b>${a.best_score ?? 100}%</b></span><span>Certificate no: <b>${esc(a.certificate_no || '')}</b></span></div>
  <div class="meta" style="margin-top:14px"><span>Issued via SkillTrack</span></div></div>
  <script>setTimeout(()=>print(),400)<\/script></body></html>`);
  w.document.close();
}
