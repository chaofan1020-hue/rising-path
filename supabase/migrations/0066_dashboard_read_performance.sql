begin;

-- Dashboard and onboarding repeatedly filter a user's records and then read
-- the newest rows. These compound indexes avoid bitmap scans plus sorting as
-- each user's history grows.
create index if not exists resumes_user_created_desc_idx
  on public.resumes(user_id, created_at desc);

create index if not exists applications_user_created_desc_idx
  on public.applications(user_id, created_at desc);

create index if not exists ai_matches_user_created_desc_idx
  on public.ai_matches(user_id, created_at desc);

create index if not exists interview_sessions_user_created_desc_idx
  on public.interview_sessions(user_id, created_at desc);

create index if not exists interview_sessions_user_completed_created_desc_idx
  on public.interview_sessions(user_id, created_at desc)
  where status = 'completed';

commit;
