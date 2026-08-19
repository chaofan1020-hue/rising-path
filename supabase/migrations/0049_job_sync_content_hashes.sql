begin;

-- `job_sync_state` is the singleton cursor/lease record. Per-job mutable
-- synchronization metadata belongs in a separate skinny table so feed runs do
-- not repeatedly rewrite the large text stored in public.jobs.
create table if not exists public.job_sync_records (
  job_id integer primary key references public.jobs(id) on delete cascade,
  source_system varchar(50) not null,
  content_hash char(32) not null,
  last_verified_at timestamptz,
  missing_from_feed_at timestamptz,
  missing_feed_checks integer not null default 0,
  last_link_checked_at timestamptz,
  last_link_status integer,
  link_check_failures integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_sync_records_source_verified_idx
  on public.job_sync_records (source_system, last_verified_at);
create index if not exists job_sync_records_source_link_check_idx
  on public.job_sync_records (source_system, last_link_checked_at);

-- Match src/lib/job-sync.ts exactly. The hash only detects content changes;
-- it is not used as a security boundary.
insert into public.job_sync_records (
  job_id,
  source_system,
  content_hash,
  last_verified_at,
  missing_from_feed_at,
  missing_feed_checks,
  last_link_checked_at,
  last_link_status,
  link_check_failures
)
select
  jobs.id,
  coalesce(jobs.source_system, 'manual'),
  md5(concat_ws('|',
    format('%s:%s', octet_length(coalesce(jobs.title, '')), coalesce(jobs.title, '')),
    format('%s:%s', octet_length(coalesce(jobs.company, '')), coalesce(jobs.company, '')),
    format('%s:%s', octet_length(coalesce(jobs.region, '')), coalesce(jobs.region, '')),
    format('%s:%s', octet_length(coalesce(jobs.direction, '')), coalesce(jobs.direction, '')),
    format('%s:%s', octet_length(coalesce(jobs.audience, '')), coalesce(jobs.audience, '')),
    format('%s:%s', octet_length(coalesce(jobs.job_type, '')), coalesce(jobs.job_type, '')),
    format('%s:%s', octet_length(coalesce(jobs.description, '')), coalesce(jobs.description, '')),
    format('%s:%s',
      octet_length(coalesce(case when jobs.overview = jobs.description then null else jobs.overview end, '')),
      coalesce(case when jobs.overview = jobs.description then null else jobs.overview end, '')
    ),
    format('%s:%s', octet_length(coalesce(jobs.responsibilities, '')), coalesce(jobs.responsibilities, '')),
    format('%s:%s', octet_length(coalesce(jobs.requirements, '')), coalesce(jobs.requirements, '')),
    format('%s:%s', octet_length(coalesce(jobs.nice_to_have, '')), coalesce(jobs.nice_to_have, '')),
    format('%s:%s', octet_length(coalesce(jobs.salary_range, '')), coalesce(jobs.salary_range, '')),
    format('%s:%s', octet_length(coalesce(jobs.job_url, '')), coalesce(jobs.job_url, '')),
    format('%s:%s', octet_length(coalesce(jobs.source_url, '')), coalesce(jobs.source_url, '')),
    format('%s:%s', octet_length(coalesce(jobs.sponsorship, '')), coalesce(jobs.sponsorship, '')),
    format('%s:%s', octet_length(jobs.is_active::text), jobs.is_active::text),
    format('%s:%s', octet_length(jobs.is_closed::text), jobs.is_closed::text),
    format('%s:%s', octet_length(coalesce(jobs.source_system, '')), coalesce(jobs.source_system, '')),
    format('%s:%s', octet_length(coalesce(jobs.external_job_id, '')), coalesce(jobs.external_job_id, '')),
    format('%s:%s',
      octet_length(coalesce(to_char(jobs.valid_through at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '')),
      coalesce(to_char(jobs.valid_through at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '')
    )
  )),
  jobs.last_verified_at,
  jobs.missing_from_feed_at,
  jobs.missing_feed_checks,
  jobs.last_link_checked_at,
  jobs.last_link_status,
  jobs.link_check_failures
from public.jobs
on conflict (job_id) do nothing;

alter table public.job_sync_records enable row level security;
revoke all on table public.job_sync_records from anon, authenticated;
grant select, insert, update, delete on table public.job_sync_records to service_role;

create or replace function public.finalize_job_feed_reconcile(
  p_source_system text,
  p_started_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  missing_count integer := 0;
  closed_count integer := 0;
begin
  update public.job_sync_records as records
     set missing_from_feed_at = coalesce(records.missing_from_feed_at, now()),
         missing_feed_checks = records.missing_feed_checks + 1,
         updated_at = now()
    from public.jobs
   where jobs.id = records.job_id
     and records.source_system = p_source_system
     and jobs.is_active = true
     and (records.last_verified_at is null or records.last_verified_at < p_started_at);
  get diagnostics missing_count = row_count;

  update public.jobs as jobs
     set is_active = false,
         is_closed = true,
         updated_at = now()
    from public.job_sync_records as records
   where records.job_id = jobs.id
     and records.source_system = p_source_system
     and jobs.is_active = true
     and records.missing_feed_checks >= 2;
  get diagnostics closed_count = row_count;

  return jsonb_build_object('missing', missing_count, 'closed', closed_count);
end;
$$;

notify pgrst, 'reload schema';

commit;
