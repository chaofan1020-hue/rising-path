begin;

-- Public jobs list and brand-filter counts must use the same target-region
-- rule. Keep this pattern list in sync with targetRegionIlikePatterns() in
-- src/lib/job-region-scope.ts.

create or replace function public.job_region_matches_target(region text)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select coalesce(region, '') ilike any (array[
    '%North America%',
    '%North-American%',
    '%NorthAmerican%',
    '%Americas%',
    '%United States%',
    '%USA%',
    '%U.S.%',
    '%Canada%',
    '%New York%',
    '%San Francisco%',
    '%Los Angeles%',
    '%Seattle%',
    '%Chicago%',
    '%Boston%',
    '%Austin%',
    '%Dallas%',
    '%Houston%',
    '%Atlanta%',
    '%Denver%',
    '%Miami%',
    '%Philadelphia%',
    '%Washington%',
    '%Jersey City%',
    '%Newark%',
    '%Palo Alto%',
    '%Mountain View%',
    '%Arlington%',
    '%Raleigh%',
    '%Charlotte%',
    '%Tampa%',
    '%Orlando%',
    '%Columbus%',
    '%Wilmington%',
    '%Fort Lauderdale%',
    '%Milwaukee%',
    '%Colorado Springs%',
    '%Baton Rouge%',
    '%Fresno%',
    '%San Antonio%',
    '%Jacksonville%',
    '%San Diego%',
    '%Toronto%',
    '%Vancouver%',
    '%Ottawa%',
    '%Montreal%',
    '%Mississauga%',
    '%Quebec%',
    '%Australia%',
    '%ANZ%',
    '%Sydney%',
    '%Melbourne%',
    '%Brisbane%',
    '%Perth%',
    '%Adelaide%',
    '%Canberra%',
    '%Ballarat%',
    '%Hong Kong%',
    '%Kowloon%',
    '%Hong Kong Island%',
    '%Singapore%',
    '%United Kingdom%',
    '%UK%',
    '%U.K.%',
    '%England%',
    '%Scotland%',
    '%Wales%',
    '%Northern Ireland%',
    '%London%',
    '%Bournemouth%',
    '%Bristol%',
    '%Manchester%',
    '%Edinburgh%',
    '%Glasgow%',
    '%Birmingham%',
    '%Leeds%',
    '%Cardiff%',
    '%Belfast%',
    '%Cambridge%',
    '%Oxford%',
    '%Southampton%',
    '%Reading%',
    '%Guildford%',
    '%Crawley%',
    '%Aberdeen%',
    '%Newcastle%',
    '%Sheffield%',
    '%Liverpool%'
  ]);
$$;

revoke all on function public.job_region_matches_target(text) from public;
grant execute on function public.job_region_matches_target(text) to anon, authenticated, service_role;

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
    (array_agg(jobs.job_url order by jobs.updated_at desc nulls last,
      jobs.created_at desc nulls last, jobs.id desc))[1]::text as job_url,
    count(*)::bigint as job_count,
    coalesce(max(logos.logo_url), max(config.logo_url))::text as logo_url
  from public.jobs
  left join public.company_logos as logos
    on logos.company_name = jobs.company
  left join public.company_config as config
    on config.company_name = jobs.company
   and config.is_active = true
  where jobs.is_active = true
    and nullif(trim(jobs.company), '') is not null
    and public.job_region_matches_target(jobs.region)
  group by jobs.company
  order by count(*) desc, jobs.company asc;
$$;

revoke all on function public.list_active_company_options() from public;
grant execute on function public.list_active_company_options() to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
