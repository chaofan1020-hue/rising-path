-- Interview question strategy P0:
-- keep a stable DNA snapshot per session and retain enough metadata to exclude
-- repeated questions across fresh practice sessions.

alter table public.interview_sessions
  add column if not exists dna_snapshot jsonb,
  add column if not exists dna_source varchar(30),
  add column if not exists dna_version integer,
  add column if not exists dna_hash varchar(64),
  add column if not exists question_strategy_version integer not null default 1,
  add column if not exists session_seed varchar(64),
  add column if not exists practice_mode varchar(20) not null default 'fresh';

create index if not exists interview_sessions_question_history_idx
  on public.interview_sessions(user_id, target_company, job_id, created_at desc);

comment on column public.interview_sessions.dna_snapshot is
  'The exact company DNA JSON used when this interview session was created.';
comment on column public.interview_sessions.practice_mode is
  'fresh excludes recent questions; targeted revisits weak dimensions; review may repeat prior questions.';
