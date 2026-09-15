begin;

-- Widen the first-stage candidate pool without widening the AI prompt. The
-- route performs deterministic suitability ranking before selecting its
-- small deep-match batch. Also handle resumes with no extracted terms by
-- returning fresh jobs in the requested scope instead of an empty result.
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
  query_value tsquery := websearch_to_tsquery('simple', array_to_string(p_terms, ' OR '));
  sql text;
begin
  if cardinality(p_terms) = 0 or query_value = ''::tsquery then
    sql := '
      select jobs.id, jobs.title::text, jobs.company::text, jobs.region::text,
        jobs.direction::text, jobs.description, jobs.requirements, 0::real,
        jobs.created_at
      from public.jobs jobs
      join public.job_ai_match_scopes scopes on scopes.job_id = jobs.id
      where jobs.is_active = true';
    if cardinality(p_region_scopes) > 0 then
      sql := sql || ' and scopes.scope = any($1)';
    end if;
    if cardinality(p_directions) > 0 then
      sql := sql || ' and jobs.direction = any($2)';
    end if;
    sql := sql || ' order by jobs.created_at desc limit $3';
    return query execute sql using p_region_scopes, p_directions, greatest(1, least(coalesce(p_limit, 200), 500));
  end if;

  sql := '
    with input_terms as (
      select distinct btrim(term) as term
      from unnest($1::text[]) as term
      where btrim(term) <> ''''
    ),
    candidate_ids as (
      select distinct candidate.id
      from input_terms
      cross join lateral (
        select jobs.id
        from public.jobs jobs
        join public.job_ai_match_scopes scopes on scopes.job_id = jobs.id
        where jobs.is_active = true
          and jobs.ai_match_search @@ plainto_tsquery(''simple'', input_terms.term)';
  if cardinality(p_region_scopes) > 0 then
    sql := sql || ' and scopes.scope = any($2)';
  end if;
  if cardinality(p_directions) > 0 then
    sql := sql || ' and jobs.direction = any($3)';
  end if;
  sql := sql || '
        order by ts_rank_cd(jobs.ai_match_search, plainto_tsquery(''simple'', input_terms.term)) desc,
          jobs.created_at desc
        limit 64
      ) as candidate
    ),
    ranked as (
      select jobs.id, jobs.title::text as title, jobs.company::text as company,
        jobs.region::text as region, jobs.direction::text as direction,
        jobs.description, jobs.requirements,
        ts_rank_cd(jobs.ai_match_search, $4) as lexical_score,
        jobs.created_at
      from candidate_ids
      join public.jobs jobs on jobs.id = candidate_ids.id
    )
    select id, title, company, region, direction, description, requirements,
      lexical_score::real, created_at
    from ranked
    order by lexical_score desc, created_at desc
    limit $5';

  return query execute sql using p_terms, p_region_scopes, p_directions, query_value, greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

revoke all on function public.search_ai_match_candidates_v7(text[], text[], text[], integer) from public;
grant execute on function public.search_ai_match_candidates_v7(text[], text[], text[], integer) to authenticated;

notify pgrst, 'reload schema';
commit;
