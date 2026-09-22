begin;

-- Default jobs listing and the brand filter both counted active target-region
-- rows by evaluating ~100 ILIKE patterns per row. That exact count took about
-- four seconds. Store the boolean once and keep it current on region writes.

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

update public.jobs
set matches_target_region = public.job_region_matches_target(region)
where matches_target_region is null;

create index if not exists jobs_target_active_feed_idx
  on public.jobs (updated_at desc nulls last, created_at desc, id desc)
  where is_active = true and matches_target_region;

create index if not exists jobs_target_active_created_idx
  on public.jobs (created_at desc, id desc)
  where is_active = true and matches_target_region;

create index if not exists jobs_target_active_company_idx
  on public.jobs (company)
  where is_active = true and matches_target_region;

-- One representative URL is enough for logo fallback. array_agg sorted every
-- active job URL and dominated the cold brand-filter query.
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

revoke all on function public.jobs_sync_matches_target_region() from public;
grant execute on function public.jobs_sync_matches_target_region() to anon, authenticated, service_role;

revoke all on function public.list_active_company_options() from public;
grant execute on function public.list_active_company_options() to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;

-- Catch rows inserted while the column was being added.
update public.jobs
set matches_target_region = public.job_region_matches_target(region)
where matches_target_region is null;

notify pgrst, 'reload schema';
