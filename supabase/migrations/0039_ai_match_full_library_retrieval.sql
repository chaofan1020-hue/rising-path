begin;

-- Full-library retrieval for AI matching. The generated vector keeps the
-- first-stage search in PostgreSQL instead of loading every job into Node.
alter table public.jobs
  add column if not exists ai_match_search tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(direction, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(requirements, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C')
  ) stored;

create index if not exists jobs_ai_match_search_idx
  on public.jobs using gin (ai_match_search)
  where is_active = true;

create or replace function public.search_ai_match_candidates(
  p_terms text[] default array[]::text[],
  p_directions text[] default array[]::text[],
  p_region_patterns text[] default array[]::text[],
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
language sql
stable
security invoker
set search_path = public
as $$
  with query_terms as (
    select websearch_to_tsquery('simple', array_to_string(p_terms, ' ')) as query
  )
  select
    jobs.id,
    jobs.title::text,
    jobs.company::text,
    jobs.region::text,
    jobs.direction::text,
    jobs.description,
    jobs.requirements,
    case
      when query_terms.query = ''::tsquery then 0::real
      else ts_rank_cd(jobs.ai_match_search, query_terms.query)
    end as lexical_score,
    jobs.created_at
  from public.jobs as jobs
  cross join query_terms
  where jobs.is_active = true
    and (cardinality(p_directions) = 0 or jobs.direction = any(p_directions))
    and (cardinality(p_region_patterns) = 0 or jobs.region ilike any(p_region_patterns))
  order by
    case when query_terms.query = ''::tsquery then 0::real else ts_rank_cd(jobs.ai_match_search, query_terms.query) end desc,
    jobs.created_at desc
  limit greatest(1, least(coalesce(p_limit, 80), 200));
$$;

grant execute on function public.search_ai_match_candidates(text[], text[], text[], integer) to authenticated;

notify pgrst, 'reload schema';

commit;
