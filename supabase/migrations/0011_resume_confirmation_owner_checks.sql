begin;

-- A confirmation can only be authored by the owner of the resume snapshot.
-- Keep this constraint at the database boundary in addition to API checks.
alter table if exists public.resumes
  drop constraint if exists resumes_profile_confirmed_by_owner_check;

alter table if exists public.resumes
  add constraint resumes_profile_confirmed_by_owner_check
  check (
    profile_confirmed_by is null
    or profile_confirmed_by = user_id
  );

alter table if exists public.resume_profile_versions
  drop constraint if exists resume_profile_versions_confirmed_by_owner_check;

alter table if exists public.resume_profile_versions
  add constraint resume_profile_versions_confirmed_by_owner_check
  check (
    confirmed_by is null
    or confirmed_by = user_id
  );

commit;
