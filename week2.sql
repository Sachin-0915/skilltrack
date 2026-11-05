-- =====================================================================
-- SkillTrack - Week 2 database update: courses, lessons, quizzes,
-- assignments, progress and certificates.
-- Run AFTER setup.sql: Supabase > SQL Editor > New query > paste > Run.
-- Safe to run again.
-- =====================================================================

create or replace function public.my_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.members where user_id = auth.uid() and active limit 1;
$$;

-- ---------- Tables ----------
create table if not exists public.courses (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  title            text not null,
  description      text,
  duration_minutes int  not null default 30,
  pass_mark        int  not null default 80 check (pass_mark between 1 and 100),
  max_attempts     int  not null default 3 check (max_attempts between 1 and 10),
  status           text not null default 'draft' check (status in ('draft','published')),
  created_at       timestamptz not null default now()
);
create index if not exists courses_company_idx on public.courses (company_id);

create table if not exists public.lessons (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  position    int  not null default 1,
  title       text not null,
  type        text not null default 'text' check (type in ('text','video','pdf')),
  content     text not null default ''
);
create index if not exists lessons_course_idx on public.lessons (course_id, position);

create table if not exists public.questions (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  position     int  not null default 1,
  question     text not null,
  options      jsonb not null,               -- ["A","B","C","D"]
  correct      int  not null,                -- 0-based index into options
  explanation  text
);
create index if not exists questions_course_idx on public.questions (course_id, position);

create table if not exists public.assignments (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  course_id          uuid not null references public.courses(id) on delete cascade,
  member_id          uuid not null references public.members(id) on delete cascade,
  due_date           date,
  assigned_at        timestamptz not null default now(),
  status             text not null default 'not_started' check (status in ('not_started','in_progress','completed','failed')),
  completed_lessons  uuid[] not null default '{}',
  attempts           int  not null default 0,
  best_score         int,
  started_at         timestamptz,
  completed_at       timestamptz,
  certificate_no     text unique,
  unique (course_id, member_id)
);
create index if not exists assignments_member_idx on public.assignments (member_id);
create index if not exists assignments_course_idx on public.assignments (course_id);

-- ---------- Keep company_id consistent with the course ----------
create or replace function public.fill_company_from_course() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select company_id into new.company_id from public.courses where id = new.course_id;
  if new.company_id is null then raise exception 'Course not found'; end if;
  if tg_table_name = 'assignments' then
    if not exists (select 1 from public.members m
                   where m.id = (to_jsonb(new) ->> 'member_id')::uuid and m.company_id = new.company_id) then
      raise exception 'Employee and course belong to different companies';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists lessons_company on public.lessons;
create trigger lessons_company before insert or update of course_id on public.lessons
  for each row execute function public.fill_company_from_course();
drop trigger if exists questions_company on public.questions;
create trigger questions_company before insert or update of course_id on public.questions
  for each row execute function public.fill_company_from_course();
drop trigger if exists assignments_company on public.assignments;
create trigger assignments_company before insert or update of course_id, member_id on public.assignments
  for each row execute function public.fill_company_from_course();

-- ---------- Security rules ----------
alter table public.courses     enable row level security;
alter table public.lessons     enable row level security;
alter table public.questions   enable row level security;
alter table public.assignments enable row level security;

-- Helper: is the caller HR admin (or Super Admin) for this company?
create or replace function public.is_admin_of(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or (p_company = public.my_company() and public.my_role() = 'org_admin');
$$;

drop policy if exists courses_read  on public.courses;
drop policy if exists courses_write on public.courses;
create policy courses_read on public.courses for select
  using (public.is_admin_of(company_id) or (company_id = public.my_company() and status = 'published'));
create policy courses_write on public.courses for all
  using (public.is_admin_of(company_id)) with check (public.is_admin_of(company_id));

drop policy if exists lessons_read  on public.lessons;
drop policy if exists lessons_write on public.lessons;
create policy lessons_read on public.lessons for select
  using (public.is_admin_of(company_id) or (company_id = public.my_company()
         and exists (select 1 from public.courses c where c.id = course_id and c.status = 'published')));
create policy lessons_write on public.lessons for all
  using (public.is_admin_of(company_id)) with check (public.is_admin_of(company_id));

-- Questions (with answers) are visible to admins only. Learners use get_quiz().
drop policy if exists questions_admin on public.questions;
create policy questions_admin on public.questions for all
  using (public.is_admin_of(company_id)) with check (public.is_admin_of(company_id));

drop policy if exists assignments_read  on public.assignments;
drop policy if exists assignments_write on public.assignments;
create policy assignments_read on public.assignments for select
  using (public.is_admin_of(company_id)
         or member_id = public.my_member_id()
         or (company_id = public.my_company() and public.my_role() = 'manager'));
create policy assignments_write on public.assignments for all
  using (public.is_admin_of(company_id)) with check (public.is_admin_of(company_id));

grant select, insert, update, delete on public.courses, public.lessons, public.questions, public.assignments to authenticated;

-- ---------- Learner actions (checked on the server) ----------
create or replace function public.complete_lesson(p_assignment uuid, p_lesson uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.assignments;
begin
  select * into a from public.assignments where id = p_assignment and member_id = public.my_member_id();
  if a.id is null then raise exception 'Assignment not found'; end if;
  if not exists (select 1 from public.lessons where id = p_lesson and course_id = a.course_id) then
    raise exception 'Lesson not in this course';
  end if;
  update public.assignments set
    completed_lessons = case when p_lesson = any(completed_lessons) then completed_lessons else completed_lessons || p_lesson end,
    status     = case when status = 'not_started' then 'in_progress' else status end,
    started_at = coalesce(started_at, now())
  where id = a.id;
end $$;

create or replace function public.get_quiz(p_assignment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.assignments; c public.courses;
begin
  select * into a from public.assignments where id = p_assignment and member_id = public.my_member_id();
  if a.id is null then raise exception 'Assignment not found'; end if;
  select * into c from public.courses where id = a.course_id;
  return jsonb_build_object(
    'pass_mark', c.pass_mark, 'max_attempts', c.max_attempts, 'attempts', a.attempts,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'question', q.question, 'options', q.options) order by q.position)
                  from public.questions q where q.course_id = a.course_id), '[]'::jsonb));
end $$;

create or replace function public.submit_quiz(p_assignment uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.assignments; c public.courses; total int; right_count int; score int; passed boolean; results jsonb; lesson_count int;
begin
  select * into a from public.assignments where id = p_assignment and member_id = public.my_member_id() for update;
  if a.id is null then raise exception 'Assignment not found'; end if;
  if a.status = 'completed' then raise exception 'You have already passed this course'; end if;
  select * into c from public.courses where id = a.course_id;
  if a.attempts >= c.max_attempts then raise exception 'No attempts left. Ask your HR admin to reset your attempts.'; end if;
  select count(*) into lesson_count from public.lessons where course_id = c.id
    and not (id = any(a.completed_lessons));
  if lesson_count > 0 then raise exception 'Please complete all lessons before the quiz.'; end if;

  select count(*), count(*) filter (where (p_answers ->> q.id::text)::int = q.correct),
         coalesce(jsonb_object_agg(q.id, (p_answers ->> q.id::text)::int = q.correct), '{}'::jsonb)
    into total, right_count, results
    from public.questions q where q.course_id = c.id;

  score  := case when total = 0 then 100 else round(100.0 * right_count / total) end;
  passed := score >= c.pass_mark;

  update public.assignments set
    attempts     = attempts + 1,
    best_score   = greatest(coalesce(best_score, 0), score),
    started_at   = coalesce(started_at, now()),
    status       = case when passed then 'completed' when attempts + 1 >= c.max_attempts then 'failed' else 'in_progress' end,
    completed_at = case when passed then now() else completed_at end,
    certificate_no = case when passed then 'ST-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(id::text, '-', ''), 1, 8)) else certificate_no end
  where id = a.id;

  return jsonb_build_object('score', score, 'passed', passed, 'pass_mark', c.pass_mark,
    'attempts_left', c.max_attempts - a.attempts - 1, 'results', results);
end $$;

revoke execute on function public.complete_lesson(uuid, uuid), public.get_quiz(uuid), public.submit_quiz(uuid, jsonb) from anon;
grant  execute on function public.complete_lesson(uuid, uuid), public.get_quiz(uuid), public.submit_quiz(uuid, jsonb) to authenticated;
