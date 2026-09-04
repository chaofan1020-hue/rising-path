begin;

create table if not exists public.application_profile_jobs (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  resume_id integer not null references public.resumes(id) on delete cascade,
  status varchar(20) not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed')),
  attempt_count integer not null default 0,
  result_version integer,
  last_error text,
  available_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.application_profile_jobs enable row level security;
drop policy if exists application_profile_jobs_owner_all on public.application_profile_jobs;
create policy application_profile_jobs_owner_all on public.application_profile_jobs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists application_profile_jobs_queue_idx
  on public.application_profile_jobs(status, available_at, created_at);
create index if not exists application_profile_jobs_user_idx
  on public.application_profile_jobs(user_id, created_at desc);
create index if not exists application_profile_jobs_active_resume_idx
  on public.application_profile_jobs(user_id, resume_id, created_at desc)
  where status in ('pending', 'running');

grant select, insert, update on public.application_profile_jobs to authenticated;

commit;
