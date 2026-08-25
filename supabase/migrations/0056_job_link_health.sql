begin;

-- Preserve the upstream distinction between a confirmed closed posting and a
-- page that the fetcher could not verify (403/CAPTCHA/timeout/5xx).
alter table public.job_sync_records
  add column if not exists link_health text,
  add column if not exists last_link_error text,
  add column if not exists last_link_http_status integer,
  add column if not exists availability_status text,
  add column if not exists availability_checked_at timestamptz;

alter table public.job_sync_records
  drop constraint if exists job_sync_records_link_health_check;
alter table public.job_sync_records
  add constraint job_sync_records_link_health_check
  check (link_health is null or link_health in ('healthy', 'closed', 'blocked', 'timeout', 'unknown'));

alter table public.job_sync_records
  drop constraint if exists job_sync_records_availability_status_check;
alter table public.job_sync_records
  add constraint job_sync_records_availability_status_check
  check (availability_status is null or availability_status in ('valid', 'closed', 'blocked', 'timeout', 'unknown'));

create index if not exists job_sync_records_source_availability_idx
  on public.job_sync_records (source_system, availability_status, availability_checked_at);
create index if not exists job_sync_records_source_link_health_idx
  on public.job_sync_records (source_system, link_health, availability_checked_at);

notify pgrst, 'reload schema';

commit;
