-- =====================================================================
-- SkillTrack - Week 7 database update: file uploads and company branding.
-- Run AFTER week6.sql: Supabase > SQL Editor > paste > Run. Safe to run again.
-- =====================================================================

-- ---------- Company branding and tenant login link ----------
alter table public.companies add column if not exists slug        text;
alter table public.companies add column if not exists logo_url    text;
alter table public.companies add column if not exists brand_color text;
create unique index if not exists companies_slug_unique on public.companies (slug);

-- Turns "Demo Company Pvt Ltd" into "demo-company-pvt-ltd" (adds -2, -3 ... if taken).
create or replace function public.make_company_slug(p_name text, p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare base text; candidate text; n int := 1;
begin
  base := trim(both '-' from regexp_replace(lower(coalesce(p_name, 'company')), '[^a-z0-9]+', '-', 'g'));
  if base = '' then base := 'company'; end if;
  base := left(base, 40); candidate := base;
  while exists (select 1 from public.companies where slug = candidate and id <> p_id) loop
    n := n + 1; candidate := base || '-' || n;
  end loop;
  return candidate;
end $$;

create or replace function public.set_company_slug() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.slug is null or new.slug = '' then new.slug := public.make_company_slug(new.name, new.id); end if;
  return new;
end $$;
drop trigger if exists companies_slug on public.companies;
create trigger companies_slug before insert or update on public.companies
  for each row execute function public.set_company_slug();
update public.companies set slug = public.make_company_slug(name, id) where slug is null;

-- Public, logged-out lookup for the tenant login page (name, logo and colour only).
create or replace function public.company_brand(p_slug text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('name', name, 'slug', slug, 'logo_url', logo_url, 'brand_color', brand_color)
  from public.companies where slug = lower(p_slug) and status = 'active';
$$;
grant execute on function public.company_brand(text) to anon, authenticated;

-- HR admins may change only their own company's logo and colour.
create or replace function public.update_branding(p_company uuid, p_logo_url text, p_color text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_of(p_company) then raise exception 'Only HR admins can change branding.'; end if;
  if p_color is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Invalid colour.'; end if;
  if p_logo_url is not null and p_logo_url !~ '^https://' then raise exception 'Invalid logo address.'; end if;
  update public.companies set logo_url = p_logo_url, brand_color = p_color where id = p_company;
end $$;
revoke execute on function public.update_branding(uuid, text, text) from public, anon;
grant  execute on function public.update_branding(uuid, text, text) to authenticated;

-- ---------- File storage ----------
-- course-files: private. Files live under <company id>/<course id>/...; people see only their own company's files.
-- logos: public (shown on the login page before anyone logs in).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-files', 'course-files', false, 52428800, array['application/pdf', 'video/mp4', 'video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Safe conversion of the first folder name to a company id (null if it is not one).
create or replace function public.folder_company(p_name text) returns uuid
language plpgsql immutable as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then return null;
end $$;

drop policy if exists "course files read"   on storage.objects;
drop policy if exists "course files write"  on storage.objects;
drop policy if exists "course files update" on storage.objects;
drop policy if exists "course files delete" on storage.objects;
create policy "course files read" on storage.objects for select to authenticated
  using (bucket_id = 'course-files' and (public.folder_company(name) = public.my_company() or public.is_super_admin()));
create policy "course files write" on storage.objects for insert to authenticated
  with check (bucket_id = 'course-files' and public.is_admin_of(public.folder_company(name)));
create policy "course files update" on storage.objects for update to authenticated
  using (bucket_id = 'course-files' and public.is_admin_of(public.folder_company(name)));
create policy "course files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'course-files' and public.is_admin_of(public.folder_company(name)));

drop policy if exists "logos write"  on storage.objects;
drop policy if exists "logos update" on storage.objects;
drop policy if exists "logos delete" on storage.objects;
create policy "logos write" on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and public.is_admin_of(public.folder_company(name)));
create policy "logos update" on storage.objects for update to authenticated
  using (bucket_id = 'logos' and public.is_admin_of(public.folder_company(name)));
create policy "logos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and public.is_admin_of(public.folder_company(name)));
