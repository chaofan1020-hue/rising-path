begin;

alter table if exists public.ai_match_runs
  add column if not exists job_ids jsonb not null default '[]'::jsonb;

comment on column public.ai_match_runs.job_ids is
  'Ordered job ids for a paid counselor report, used to restore the same 8 recommendations within 24 hours.';

notify pgrst, 'reload schema';
commit;
