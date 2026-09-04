begin;

-- Official detail enrichment has one independent state row per company. These
-- fields make scheduling durable across restarts and safe for multiple workers.
alter table public.job_sync_state
  add column if not exists last_attempted_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists next_retry_at timestamptz,
  add column if not exists priority integer not null default 0;

create index if not exists job_sync_state_scheduler_idx
  on public.job_sync_state(source_system, next_retry_at, last_attempted_at, priority desc);

commit;
