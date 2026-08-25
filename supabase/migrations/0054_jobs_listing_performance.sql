begin;

-- The public jobs page sorts active rows by the latest feed update and often
-- filters by company or text. These indexes keep those paths bounded as the
-- feed grows.
create index if not exists jobs_active_updated_created_id_idx
  on public.jobs (updated_at desc nulls last, created_at desc, id desc)
  where is_active = true;

create index if not exists jobs_active_company_idx
  on public.jobs (company)
  where is_active = true;

create extension if not exists pg_trgm;

create index if not exists jobs_active_title_trgm_idx
  on public.jobs using gin (title gin_trgm_ops)
  where is_active = true;

create index if not exists jobs_active_company_trgm_idx
  on public.jobs using gin (company gin_trgm_ops)
  where is_active = true;

-- Aggregate the brand filter server-side. The previous endpoint paged through
-- the entire jobs table in 1,000-row chunks before it could render one brand.
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
  group by jobs.company
  order by count(*) desc, jobs.company asc;
$$;

revoke all on function public.list_active_company_options() from public;
grant execute on function public.list_active_company_options() to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
