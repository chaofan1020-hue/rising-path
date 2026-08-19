begin;

-- Covers the no-direction branch. The existing scope/direction index covers
-- requests with an explicit direction filter.
create index if not exists jobs_active_ai_match_scope_created_idx
  on public.jobs (public.ai_match_region_scope(region), created_at desc)
  where is_active = true;

-- A SQL function with optional-condition OR clauses was planned generically,
-- then scanned and ranked too many rows. Dynamic branches yield a custom plan
-- for each filter shape so the scope expression index and GIN FTS index can be
-- combined by PostgreSQL.
create or replace function public.search_ai_match_candidates_v3(
  p_terms text[] default array[]::text[],
  p_directions text[] default array[]::text[],
  p_region_scopes text[] default array[]::text[],
  p_limit integer default 80
)
returns table (
  id integer,
  title text,
  company text,
  region text,
  direction text,
  description text,
  requirements text,
  lexical_score real,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  query_value tsquery := websearch_to_tsquery('simple', array_to_string(p_terms, ' '));
  sql text;
begin
  sql := '
    select
      jobs.id,
      jobs.title::text,
      jobs.company::text,
      jobs.region::text,
      jobs.direction::text,
      jobs.description,
      jobs.requirements,
      case when $1 = ''''::tsquery then 0::real else ts_rank_cd(jobs.ai_match_search, $1) end::real,
      jobs.created_at
    from public.jobs as jobs
    where jobs.is_active = true';

  if cardinality(p_region_scopes) > 0 then
    sql := sql || ' and public.ai_match_region_scope(jobs.region) = any($2)';
  end if;
  if cardinality(p_directions) > 0 then
    sql := sql || ' and jobs.direction = any($3)';
  end if;
  if query_value <> ''::tsquery then
    sql := sql || ' and jobs.ai_match_search @@ $1';
  end if;
  sql := sql || ' order by case when $1 = ''''::tsquery then 0::real else ts_rank_cd(jobs.ai_match_search, $1) end desc, jobs.created_at desc limit $4';

  return query execute sql using query_value, p_region_scopes, p_directions, greatest(1, least(coalesce(p_limit, 80), 200));
end;
$$;

grant execute on function public.search_ai_match_candidates_v3(text[], text[], text[], integer) to authenticated;
notify pgrst, 'reload schema';

commit;
