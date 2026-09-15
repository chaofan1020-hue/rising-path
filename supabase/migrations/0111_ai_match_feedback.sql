begin;

create table if not exists public.ai_match_feedback (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  resume_id integer not null references public.resumes(id) on delete cascade,
  job_id integer not null references public.jobs(id) on delete cascade,
  resume_profile_version integer not null,
  feedback varchar(24) not null,
  locale varchar(10) not null default 'zh-CN',
  created_at timestamptz not null default now(),
  constraint ai_match_feedback_value_check
    check (feedback in ('interested', 'not_interested', 'inaccurate')),
  constraint ai_match_feedback_locale_check
    check (locale in ('zh-CN', 'zh-TW', 'en')),
  constraint ai_match_feedback_profile_version_check
    check (resume_profile_version > 0),
  constraint ai_match_feedback_user_resume_job_version_unique
    unique (user_id, resume_id, job_id, resume_profile_version)
);

create index if not exists ai_match_feedback_user_created_idx
  on public.ai_match_feedback(user_id, created_at desc);
create index if not exists ai_match_feedback_job_idx
  on public.ai_match_feedback(job_id, feedback);

alter table public.ai_match_feedback enable row level security;
drop policy if exists ai_match_feedback_owner_all on public.ai_match_feedback;
create policy ai_match_feedback_owner_all on public.ai_match_feedback
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.ai_match_feedback to authenticated;
grant usage, select on sequence public.ai_match_feedback_id_seq to authenticated;

notify pgrst, 'reload schema';
commit;
