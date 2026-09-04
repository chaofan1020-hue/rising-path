begin;

create unique index if not exists application_profile_jobs_one_active_per_user_idx
  on public.application_profile_jobs(user_id)
  where status in ('pending', 'running');

commit;
