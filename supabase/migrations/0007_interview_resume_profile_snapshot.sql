begin;

-- A session must keep using the confirmed profile version selected at start.
alter table if exists public.interview_sessions
  add column if not exists resume_profile_version integer;

alter table if exists public.interview_sessions
  drop constraint if exists interview_sessions_resume_profile_version_check;

alter table if exists public.interview_sessions
  add constraint interview_sessions_resume_profile_version_check
  check (resume_profile_version is null or resume_profile_version > 0);

create index if not exists interview_sessions_resume_profile_version_idx
  on public.interview_sessions(resume_id, resume_profile_version);

commit;
