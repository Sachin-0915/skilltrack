-- =====================================================================
-- SkillTrack - Week 4 database update (security tidy-up).
-- Run AFTER week2.sql: Supabase > SQL Editor > paste > Run. Safe to run again.
-- =====================================================================

-- Learner actions can only be called by logged-in users (not anonymous visitors).
revoke execute on function public.complete_lesson(uuid, uuid) from public, anon;
revoke execute on function public.get_quiz(uuid)              from public, anon;
revoke execute on function public.submit_quiz(uuid, jsonb)    from public, anon;
grant  execute on function public.complete_lesson(uuid, uuid) to authenticated;
grant  execute on function public.get_quiz(uuid)              to authenticated;
grant  execute on function public.submit_quiz(uuid, jsonb)    to authenticated;

-- Internal trigger functions are never called directly.
revoke execute on function public.link_member_on_signup()     from public, anon, authenticated;
revoke execute on function public.check_user_limit()          from public, anon, authenticated;
revoke execute on function public.fill_company_from_course()  from public, anon, authenticated;
