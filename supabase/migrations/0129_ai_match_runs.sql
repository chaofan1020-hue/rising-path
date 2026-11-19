begin;

create table if not exists public.ai_match_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resume_id integer not null references public.resumes(id) on delete cascade,
  resume_profile_version integer not null,
  preview boolean not null default false,
  locale varchar(10) not null default 'zh-CN',
  filters jsonb not null default '{}'::jsonb,
  retrieved_count integer not null default 0,
  suitable_count integer not null default 0,
  selected_count integer not null default 0,
  explained_count integer not null default 0,
  exclusion_counts jsonb not null default '{}'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now(),
  constraint ai_match_runs_profile_version_check
    check (resume_profile_version > 0),
  constraint ai_match_runs_locale_check
    check (locale in ('zh-CN', 'zh-TW', 'en')),
  constraint ai_match_runs_counts_check
    check (
      retrieved_count >= 0
      and suitable_count >= 0
      and selected_count >= 0
      and explained_count >= 0
    )
);

create index if not exists ai_match_runs_user_resume_created_idx
  on public.ai_match_runs(user_id, resume_id, resume_profile_version, created_at desc);

alter table public.ai_match_runs enable row level security;
drop policy if exists ai_match_runs_owner_all on public.ai_match_runs;
create policy ai_match_runs_owner_all on public.ai_match_runs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert on public.ai_match_runs to authenticated;

comment on table public.ai_match_runs is
  'One batch AI match session per deep-match request, used for filter transparency and internal quality metrics.';

notify pgrst, 'reload schema';
commit;
