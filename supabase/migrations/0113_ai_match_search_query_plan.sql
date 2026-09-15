begin;

-- v7 previously ran one indexed scan per resume term and then de-duplicated
-- the results. With a broad region scope this multiplied the work enough to
-- hit Supabase's statement timeout. Build one OR tsquery and let PostgreSQL
-- use the GIN index once, while the compact scope table handles geography.
create or replace function public.search_ai_match_candidates_v7(
  p_terms text[] default array[]::text[],
  p_directions text[] default array[]::text[],
  p_region_scopes text[] default array[]::text[],
  p_limit integer default 200
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
security definer
set search_path to public
as $$
declare
  query_value tsquery := websearch_to_tsquery('simple', array_to_string(coalesce(p_terms, array[]::text[]), ' OR '));
  result_limit integer := greatest(1, least(coalesce(p_limit, 200), 300));
begin
  if query_value = ''::tsquery then
    return query
      select jobs.id, jobs.title::text, jobs.company::text, jobs.region::text,
        jobs.direction::text, jobs.description, jobs.requirements, 0::real,
        jobs.created_at
      from public.job_ai_match_scopes scopes
      join public.jobs jobs on jobs.id = scopes.job_id
      where jobs.is_active = true
        and (cardinality(coalesce(p_region_scopes, array[]::text[])) = 0 or scopes.scope = any(p_region_scopes))
        and (cardinality(coalesce(p_directions, array[]::text[])) = 0 or jobs.direction = any(p_directions))
      order by jobs.created_at desc
      limit result_limit;
  end if;

  return query
    select jobs.id, jobs.title::text, jobs.company::text, jobs.region::text,
      jobs.direction::text, jobs.description, jobs.requirements,
      ts_rank_cd(jobs.ai_match_search, query_value)::real,
      jobs.created_at
    from public.job_ai_match_scopes scopes
    join public.jobs jobs on jobs.id = scopes.job_id
    where jobs.is_active = true
      and jobs.ai_match_search @@ query_value
      and (cardinality(coalesce(p_region_scopes, array[]::text[])) = 0 or scopes.scope = any(p_region_scopes))
      and (cardinality(coalesce(p_directions, array[]::text[])) = 0 or jobs.direction = any(p_directions))
    order by ts_rank_cd(jobs.ai_match_search, query_value) desc, jobs.created_at desc
    limit result_limit;
end;
$$;

revoke all on function public.search_ai_match_candidates_v7(text[], text[], text[], integer) from public;
grant execute on function public.search_ai_match_candidates_v7(text[], text[], text[], integer) to authenticated;

notify pgrst, 'reload schema';
commit;
