begin;

-- `valid_through` is the collector's explicit application closing date. Keep
-- the cleanup query index-backed as the public jobs table grows.
alter table public.jobs
  add column if not exists valid_through timestamptz;

create index if not exists jobs_active_valid_through_idx
  on public.jobs (valid_through)
  where is_active = true and valid_through is not null;

notify pgrst, 'reload schema';

commit;
