-- D4-b: filter facets for the all-region listing.
--
-- The jobs page needs to offer every country, grouped by continent, with a
-- count so an empty market is visible before the user selects it. PostgREST
-- cannot GROUP BY through the table API, so expose one small server-side
-- aggregate instead of paging 300k rows into the app.
--
-- The WHERE clause mirrors the listing query in src/app/api/jobs/route.ts
-- (is_active + display_status in (listed, enriched)); if that filter changes,
-- change it here too or the facet counts will drift from the result count.

create or replace function public.job_country_filter_counts()
returns table (continent text, country_code char(2), country_name text, jobs bigint)
language sql
stable
set search_path = public
as $function$
  select
    v.continent,
    v.country_code,
    coalesce(t.country_name, v.country_code::text) as country_name,
    count(*)::bigint as jobs
  from public.jobs_v3 v
  left join public.job_country_taxonomy t
    on t.kind = 'country_iso'
   and t.token = lower(v.country_code::text)
  where v.is_active
    and v.display_status in ('listed', 'enriched')
    and v.country_code is not null
  group by v.continent, v.country_code, t.country_name
  order by count(*) desc;
$function$;

comment on function public.job_country_filter_counts() is
  'D4-b: active-job counts per continent/country for the listing facet picker';

-- Unplaced rows ("Remote", "Worldwide", street addresses the resolver cannot
-- place) still have to be reachable, so expose their count separately.
create or replace function public.job_unplaced_count()
returns bigint
language sql
stable
set search_path = public
as $function$
  select count(*)::bigint
  from public.jobs_v3 v
  where v.is_active
    and v.display_status in ('listed', 'enriched')
    and v.country_code is null;
$function$;

grant execute on function public.job_country_filter_counts() to anon, authenticated;
grant execute on function public.job_unplaced_count() to anon, authenticated;

notify pgrst, 'reload schema';