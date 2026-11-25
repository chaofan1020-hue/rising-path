-- Feed liveness and catch-up observability.
-- `last_page_at` advances on every fetched page; `caught_up_at` only advances
-- when a round reaches the end of the feed. This keeps a busy catch-up worker
-- from looking healthy merely because its cursor heartbeat is recent.
alter table public.job_sync_state
  add column if not exists last_page_at timestamptz,
  add column if not exists caught_up_at timestamptz;

comment on column public.job_sync_state.last_page_at is 'Last successful feed page write timestamp';
comment on column public.job_sync_state.caught_up_at is 'Last time the feed reached has_more=false';

update public.job_sync_state
set caught_up_at = coalesce(caught_up_at, last_incremental_success_at)
where last_incremental_success_at is not null;

notify pgrst, 'reload schema';