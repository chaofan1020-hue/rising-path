begin;

-- Adding the column and trigger takes an exclusive lock. Commit that before
-- rewriting rows so job listing reads are not blocked.

set local statement_timeout = '60s';

alter table public.jobs
  add column if not exists matches_target_region boolean;

create or replace function public.jobs_sync_matches_target_region()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.matches_target_region := public.job_region_matches_target(new.region);
  return new;
end;
$$;

drop trigger if exists jobs_sync_matches_target_region on public.jobs;
create trigger jobs_sync_matches_target_region
  before insert or update of region on public.jobs
  for each row execute function public.jobs_sync_matches_target_region();

revoke all on function public.jobs_sync_matches_target_region() from public;
grant execute on function public.jobs_sync_matches_target_region() to anon, authenticated, service_role;

commit;

-- Role default statement_timeout is 2 minutes. This rewrite can take longer,
-- but it only uses a row lock, so reads continue.
set statement_timeout = '10min';

update public.jobs
set matches_target_region = public.job_region_matches_target(region)
where matches_target_region is null;

set statement_timeout = '5min';

create index if not exists jobs_target_active_feed_idx
  on public.jobs (updated_at desc nulls last, created_at desc, id desc)
  where is_active = true and matches_target_region;

create index if not exists jobs_target_active_created_idx
  on public.jobs (created_at desc, id desc)
  where is_active = true and matches_target_region;

create index if not exists jobs_target_active_company_url_idx
  on public.jobs (company) include (job_url)
  where is_active = true and matches_target_region;
create index if not exists jobs_target_active_company_idx
  on public.jobs (company)
  where is_active = true and matches_target_region;

create or replace function public.list_active_company_options()
returns table (
  company_name text,
  job_url text,
  job_count bigint,
  logo_url text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    counts.company_name,
    counts.job_url,
    counts.job_count,
    coalesce(logos.logo_url, config.logo_url)::text as logo_url
  from (
    select
      jobs.company::text as company_name,
      max(jobs.job_url)::text as job_url,
      count(*)::bigint as job_count
    from public.jobs
    where jobs.is_active = true
      and jobs.matches_target_region
      and nullif(trim(jobs.company), '') is not null
    group by jobs.company
  ) as counts
  left join public.company_logos as logos
    on logos.company_name = counts.company_name
  left join public.company_config as config
    on config.company_name = counts.company_name
   and config.is_active = true
  order by counts.job_count desc, counts.company_name asc;
$$;

revoke all on function public.list_active_company_options() from public;
grant execute on function public.list_active_company_options() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
