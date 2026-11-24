begin;

-- The v7 retrieval shipped in 0113 planned a GIN bitmap scan over ~100k matching
-- rows plus a ts_rank_cd sort over all of them. Measured on production: 60-70 s,
-- i.e. every AI-match request blew the 8 s statement timeout and fell back to the
-- stale scope table, which handed back 2 candidates instead of 240.
--
-- Measured root causes:
--   1. `jobs` is 4.0 GB, of which 2.7 GB is out-of-line TOAST (ai_match_search +
--      description/requirements). A bitmap scan turns into tens of thousands of
--      random TOAST page reads; a backward btree scan of the same rows is ~100x
--      cheaper because recent rows are physically clustered.
--   2. ts_rank_cd over the whole match set forces a full sort of ~100k rows.
--   3. The geography join against job_ai_match_scopes is not index-ordered, so it
--      sorts 179k rows before LIMIT can apply.
--   4. A hard `direction` equality is a selectivity trap: for a narrow direction
--      (Legal = 0.7 % of active jobs) the scan has to walk ~34k rows before it can
--      satisfy LIMIT 240, which is how the 20 s case shows up.
--
-- This version bounds every step:
--   * candidate pool is read newest-first through jobs_active_market_created_idx
--     (scope expression) / jobs_active_created_at_idx (no scope), both of which
--     already provide the ORDER BY order, so the scan stops at the limit
--     (verified plan: Nested Loop -> Limit -> Index Scan, no Sort);
--   * multi-scope requests fan out with LATERAL per scope, so every branch stays
--     index-ordered and limited instead of sorting the union;
--   * ranking happens after the pool is materialised, over pool_limit rows only;
--   * `direction` becomes a ranking preference instead of a hard filter, which
--     keeps the request bounded and guarantees a non-empty candidate set;
--   * pool rows that do not match the keywords act as a recency fill (score 0),
--     so rare keywords no longer produce an empty result.
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
  term_list text[] := coalesce(p_terms, array[]::text[]);
  scope_list text[] := coalesce(p_region_scopes, array[]::text[]);
  direction_list text[] := coalesce(p_directions, array[]::text[]);
  query_value tsquery := websearch_to_tsquery('simple', array_to_string(term_list, ' OR '));
  result_limit integer := greatest(1, least(coalesce(p_limit, 200), 300));
  pool_limit integer := greatest(result_limit * 5, 1200);
  -- Keep the total pool ≈ pool_limit regardless of how many scopes were requested:
  -- each LATERAL branch must still be able to fill result_limit on its own, but the
  -- union of branches must not multiply the TOAST reads by the scope count.
  per_scope_limit integer := greatest(result_limit, pool_limit / greatest(cardinality(scope_list), 1));
begin
  if cardinality(scope_list) = 0 then
    return query
    with pool as materialized (
      select j.id, j.ai_match_search, j.direction, j.created_at
      from public.jobs j
      where j.is_active = true
      order by j.created_at desc
      limit pool_limit
    ),
    scored as (
      select p.id,
             p.created_at,
             case when cardinality(direction_list) = 0 or p.direction = any(direction_list)
                  then 0 else 1 end as direction_rank,
             case when query_value = ''::tsquery then 0::real
                  else ts_rank_cd(p.ai_match_search, query_value)::real
             end as score
      from pool p
    ),
    chosen as (
      select s.id, s.score, s.created_at
      from scored s
      order by s.direction_rank, s.score desc, s.created_at desc
      limit result_limit
    )
    select jobs.id, jobs.title::text, jobs.company::text, jobs.region::text,
           jobs.direction::text, jobs.description, jobs.requirements,
           c.score, jobs.created_at
    from chosen c
    join public.jobs jobs on jobs.id = c.id
    order by c.score desc, c.created_at desc;
    return;
  end if;

  return query
  with pool as materialized (
    select j.id, j.ai_match_search, j.direction, j.created_at
    from unnest(scope_list) as sc(scope)
    cross join lateral (
      select jobs.id, jobs.ai_match_search, jobs.direction, jobs.created_at
      from public.jobs as jobs
      where jobs.is_active = true
        and public.ai_match_region_scope(jobs.region::text) = sc.scope
      order by jobs.created_at desc
      limit per_scope_limit
    ) as j
  ),
  scored as (
    select p.id,
           p.created_at,
           case when cardinality(direction_list) = 0 or p.direction = any(direction_list)
                then 0 else 1 end as direction_rank,
           case when query_value = ''::tsquery then 0::real
                else ts_rank_cd(p.ai_match_search, query_value)::real
           end as score
    from pool p
  ),
  chosen as (
    select s.id, s.score, s.created_at
    from scored s
    order by s.direction_rank, s.score desc, s.created_at desc
    limit result_limit
  )
  select jobs.id, jobs.title::text, jobs.company::text, jobs.region::text,
         jobs.direction::text, jobs.description, jobs.requirements,
         c.score, jobs.created_at
  from chosen c
  join public.jobs jobs on jobs.id = c.id
  order by c.score desc, c.created_at desc;
end;
$$;

revoke all on function public.search_ai_match_candidates_v7(text[], text[], text[], integer) from public;
revoke all on function public.search_ai_match_candidates_v7(text[], text[], text[], integer) from anon;
grant execute on function public.search_ai_match_candidates_v7(text[], text[], text[], integer) to authenticated;
grant execute on function public.search_ai_match_candidates_v7(text[], text[], text[], integer) to service_role;

notify pgrst, 'reload schema';

commit;