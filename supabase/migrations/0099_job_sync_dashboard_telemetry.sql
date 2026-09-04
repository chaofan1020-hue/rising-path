begin;

alter table public.job_company_sources
  add column if not exists upstream_active_jobs integer,
  add column if not exists upstream_last_observed_at timestamptz,
  add column if not exists upstream_last_crawl_at timestamptz,
  add column if not exists upstream_latest_run_status varchar(30),
  add column if not exists upstream_snapshot_error text,
  add column if not exists collector_last_seen_at timestamptz,
  add column if not exists collector_last_cursor text,
  add column if not exists collector_last_attempted_at timestamptz,
  add column if not exists collector_last_success_at timestamptz,
  add column if not exists collector_last_received integer not null default 0,
  add column if not exists collector_last_upserted integer not null default 0,
  add column if not exists collector_last_closed integer not null default 0,
  add column if not exists collector_last_skipped integer not null default 0,
  add column if not exists collector_last_row_failures integer not null default 0,
  add column if not exists collector_last_fatal_failures integer not null default 0,
  add column if not exists collector_last_error text,
  add column if not exists collector_status varchar(30) not null default 'unknown';

create table if not exists public.job_sync_runs (
  id bigserial primary key,
  source_system varchar(80) not null,
  company_name varchar(255),
  company_id text,
  mode varchar(20) not null,
  status varchar(20) not null check (status in ('running', 'success', 'partial', 'failed')),
  cursor_before text,
  cursor_after text,
  pages integer not null default 0,
  received integer not null default 0,
  upserted integer not null default 0,
  closed integer not null default 0,
  skipped integer not null default 0,
  row_failures integer not null default 0,
  fatal_failures integer not null default 0,
  write_batches integer not null default 0,
  write_batch_failures integer not null default 0,
  write_fallback_rows integer not null default 0,
  write_duration_ms integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists job_sync_runs_source_created_idx
  on public.job_sync_runs(source_system, created_at desc);
create index if not exists job_sync_runs_company_created_idx
  on public.job_sync_runs(company_name, created_at desc);
create index if not exists job_company_sources_collector_status_idx
  on public.job_company_sources(is_active, collector_status, collector_last_success_at);
create index if not exists jobs_collector_company_active_idx
  on public.jobs(source_system, company, is_active);
create index if not exists job_sync_failures_company_status_idx
  on public.job_sync_failures(company, status, next_retry_at);

create or replace function public.record_job_company_feed_observations(
  p_observations jsonb,
  p_cursor text,
  p_observed_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_observations, '[]'::jsonb)) <> 'array' then
    raise exception 'p_observations must be a JSON array';
  end if;

  update public.job_company_sources as sources
     set collector_last_seen_at = p_observed_at,
         collector_last_cursor = p_cursor,
         collector_last_attempted_at = p_observed_at,
         collector_last_success_at = p_observed_at,
         collector_last_received = observed.received,
         collector_last_upserted = observed.upserted,
         collector_last_closed = observed.closed,
         collector_last_skipped = observed.skipped,
         collector_last_row_failures = observed.row_failures,
         collector_last_fatal_failures = observed.fatal_failures,
         collector_last_error = null,
         collector_status = 'healthy',
         updated_at = now()
    from jsonb_to_recordset(p_observations) as observed(
      company_name text,
      received integer,
      upserted integer,
      closed integer,
      skipped integer,
      row_failures integer,
      fatal_failures integer
    )
   where sources.company_name = observed.company_name;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

create or replace function public.get_admin_job_sync_company_counts()
returns table(company text, active_jobs bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(company), ''), '未注明公司') as company,
         count(*)::bigint as active_jobs
    from public.jobs
   where source_system = 'collector_feed'
     and is_active = true
   group by coalesce(nullif(btrim(company), ''), '未注明公司');
$$;

create or replace function public.get_admin_job_sync_failure_counts()
returns table(company text, status varchar, count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(company), ''), '未注明公司') as company,
         status,
         count(*)::bigint
    from public.job_sync_failures
   group by coalesce(nullif(btrim(company), ''), '未注明公司'), status;
$$;

alter table public.job_sync_runs enable row level security;
revoke all on table public.job_sync_runs from anon, authenticated;
grant select, insert, update on table public.job_sync_runs to service_role;
revoke all on function public.record_job_company_feed_observations(jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_job_company_feed_observations(jsonb, text, timestamptz) to service_role;
revoke all on function public.get_admin_job_sync_company_counts() from public, anon, authenticated;
grant execute on function public.get_admin_job_sync_company_counts() to service_role;
revoke all on function public.get_admin_job_sync_failure_counts() from public, anon, authenticated;
grant execute on function public.get_admin_job_sync_failure_counts() to service_role;

commit;
