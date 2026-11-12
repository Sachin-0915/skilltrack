-- =====================================================================
-- SkillTrack - Week 6 database update: admin-created logins.
-- Run AFTER week4.sql: Supabase > SQL Editor > paste > Run. Safe to run again.
-- =====================================================================

-- Set when an admin creates a login or resets a password; the employee must
-- choose their own password at the next login. Only the server function can set it.
alter table public.members add column if not exists must_change_password boolean not null default false;

-- Called by the app after the employee sets their own password (clears only their own flag).
create or replace function public.password_changed() returns void
language sql security definer set search_path = public as $$
  update public.members set must_change_password = false where user_id = auth.uid();
$$;
revoke execute on function public.password_changed() from public, anon;
grant  execute on function public.password_changed() to authenticated;
