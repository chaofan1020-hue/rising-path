begin;

-- 0134_jobs_listing_market_filters
--
-- The public job list used to translate every market into dozens of
-- `region ilike '%city%'` clauses. PostgREST then had to run an exact count
-- over a sequential scan, which blew Supabase's 3s (anon) / 8s
-- (authenticated/service) statement timeout, so filtering returned HTTP 500
-- ("canceling statement due to statement timeout") and the list looked empty.
--
-- `ai_match_region_scope()` already classifies a free-form region into a
-- stable market key for AI matching. Expose that classifier through the
-- `jobs_listing` view and index it, so each market filter becomes one indexed
-- equality predicate returning rows already ordered by the feed timestamp.

set local statement_timeout = '300s';
set local lock_timeout = '15s';

create index if not exists jobs_active_market_feed_idx
  on public.jobs (
    public.ai_match_region_scope(region),
    updated_at desc nulls last,
    created_at desc,
    id desc
  )
  where is_active;

create index if not exists jobs_active_region_group_feed_idx
  on public.jobs (
    (
      case
        when public.ai_match_region_scope(region) in ('us', 'canada') then 'north_america'
        else public.ai_match_region_scope(region)
      end
    ),
    updated_at desc nulls last,
    created_at desc,
    id desc
  )
  where is_active;

create index if not exists jobs_active_job_type_feed_idx
  on public.jobs (job_type, updated_at desc nulls last, created_at desc, id desc)
  where is_active;

create index if not exists jobs_active_sponsorship_feed_idx
  on public.jobs (sponsorship, updated_at desc nulls last, created_at desc, id desc)
  where is_active and sponsorship in ('yes', 'no');

create or replace view public.jobs_listing
with (security_invoker = true)
as
  select
    jobs.*,
    public.ai_match_region_scope(jobs.region) as region_market,
    case
      when public.ai_match_region_scope(jobs.region) in ('us', 'canada') then 'north_america'
      else public.ai_match_region_scope(jobs.region)
    end as region_group
  from public.jobs;

revoke all on public.jobs_listing from public;
grant select on public.jobs_listing to anon, authenticated, service_role;

-- The brand filter dialog previously called `job_region_matches_target()` for
-- every active row. Use the indexed boolean instead and keep the aggregate to
-- a single grouped scan.
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
    jobs.company::text as company_name,
    max(jobs.job_url)::text as job_url,
    count(*)::bigint as job_count,
    coalesce(max(logos.logo_url), max(config.logo_url))::text as logo_url
  from public.jobs
  left join public.company_logos as logos
    on logos.company_name = jobs.company
  left join public.company_config as config
    on config.company_name = jobs.company
   and config.is_active = true
  where jobs.is_active = true
    and jobs.matches_target_region
    and nullif(trim(jobs.company), '') is not null
  group by jobs.company
  order by count(*) desc, jobs.company asc;
$$;

revoke all on function public.list_active_company_options() from public;
grant execute on function public.list_active_company_options() to anon, authenticated, service_role;

-- Fresh statistics keep the planner (and PostgREST's planned counts) aligned
-- with the new indexes without rewriting anything.
analyze public.jobs;

notify pgrst, 'reload schema';

commit;
