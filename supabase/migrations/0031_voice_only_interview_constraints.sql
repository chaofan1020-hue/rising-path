begin;

-- The voice-only product contract must also be enforced by the database.
alter table public.interview_turns
  drop constraint if exists interview_turns_input_source_check;
alter table public.interview_turns
  add constraint interview_turns_input_source_check
  check (input_source is null or input_source in ('asr', 'asr_fallback', 'system'));

-- 0015 predates the core upgrade in some environments. Keep this migration
-- idempotent so deployments missing that migration can still create sessions.
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

commit;
