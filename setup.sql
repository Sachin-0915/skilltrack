-- =====================================================================
-- SkillTrack - Week 1 database setup
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- BEFORE RUNNING: replace YOUR_EMAIL_HERE (near the bottom) with the
-- email you will use to log in as Super Admin.
-- Safe to run again: it only creates what is missing.
-- =====================================================================

-- ---------- Tables ----------
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  plan        text not null default 'pilot',
  max_users   int  not null default 100,
  status      text not null default 'active' check (status in ('active','paused')),
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  email          text not null,
  full_name      text not null,
  role           text not null default 'learner' check (role in ('org_admin','manager','learner')),
  department     text,
  manager_email  text,
  active         boolean not null default true,
  user_id        uuid unique references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create unique index if not exists members_email_unique on public.members (lower(email));
create index if not exists members_company_idx on public.members (company_id);

-- Super Admins (SkillTrack owner). Not readable through the API at all.
create table if not exists public.super_admins (
  email text primary key
);

-- ---------- Helper functions (used by the security rules) ----------
create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.super_admins
                 where lower(email) = lower(coalesce(auth.jwt() ->> 'email','')));
$$;

create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.members where user_id = auth.uid() and active limit 1;
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where user_id = auth.uid() and active limit 1;
$$;

-- Lets the sign-up page check an email before creating the account.
create or replace function public.can_sign_up(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m join public.companies c on c.id = m.company_id
                 where lower(m.email) = lower(p_email) and m.active and c.status = 'active')
      or exists (select 1 from public.super_admins where lower(email) = lower(p_email));
$$;

-- ---------- Link a new login to its invitation ----------
create or replace function public.link_member_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.members set user_id = new.id
   where lower(email) = lower(new.email) and user_id is null;
  if not found and not exists (select 1 from public.super_admins where lower(email) = lower(new.email)) then
    raise exception 'No invitation found for %. Ask your HR admin to add you first.', new.email;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.link_member_on_signup();

-- ---------- Enforce each company's user limit ----------
create or replace function public.check_user_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare used int; lim int;
begin
  select count(*) into used from public.members where company_id = new.company_id and active;
  select max_users into lim from public.companies where id = new.company_id;
  if used >= lim then
    raise exception 'User limit reached (% users). Contact SkillTrack to upgrade.', lim;
  end if;
  return new;
end $$;

drop trigger if exists members_user_limit on public.members;
create trigger members_user_limit before insert on public.members
  for each row execute function public.check_user_limit();

-- ---------- Security rules (Row Level Security) ----------
alter table public.companies    enable row level security;
alter table public.members      enable row level security;
alter table public.super_admins enable row level security;

drop policy if exists companies_read  on public.companies;
drop policy if exists companies_write on public.companies;
create policy companies_read  on public.companies for select
  using (public.is_super_admin() or id = public.my_company());
create policy companies_write on public.companies for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists members_read   on public.members;
drop policy if exists members_insert on public.members;
drop policy if exists members_update on public.members;
drop policy if exists members_delete on public.members;
-- Admins and managers see their company; learners see only themselves.
create policy members_read on public.members for select
  using (public.is_super_admin()
         or user_id = auth.uid()
         or (company_id = public.my_company() and public.my_role() in ('org_admin','manager')));
create policy members_insert on public.members for insert
  with check (public.is_super_admin()
              or (company_id = public.my_company() and public.my_role() = 'org_admin'));
create policy members_update on public.members for update
  using (public.is_super_admin()
         or (company_id = public.my_company() and public.my_role() = 'org_admin'))
  with check (public.is_super_admin()
         or (company_id = public.my_company() and public.my_role() = 'org_admin'));
create policy members_delete on public.members for delete
  using (public.is_super_admin());

-- Only these columns can be written from the app (user_id and email are locked).
revoke insert, update on public.members from anon, authenticated;
grant  select, delete on public.members to authenticated;
grant  insert (company_id, email, full_name, role, department, manager_email, active) on public.members to authenticated;
grant  update (full_name, role, department, manager_email, active) on public.members to authenticated;
grant  select, insert, update, delete on public.companies to authenticated;
grant  execute on function public.can_sign_up(text) to anon, authenticated;

-- ---------- Make yourself Super Admin ----------
insert into public.super_admins (email) values ('YOUR_EMAIL_HERE')
on conflict do nothing;
