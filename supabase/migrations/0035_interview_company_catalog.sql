begin;

-- Keep the company picker fast: returning the distinct company catalog in
-- PostgreSQL avoids paging every matching job through the application server.
create or replace function public.get_interview_company_catalog(
  p_region_patterns text[]
)
returns table (company text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct (btrim(j.company) collate "C") as company
  from public.jobs j
  where j.is_active = true
    and nullif(btrim(j.company), '') is not null
    and j.region ilike any(p_region_patterns)
  order by 1;
$$;

grant execute on function public.get_interview_company_catalog(text[]) to anon, authenticated, service_role;

commit;
