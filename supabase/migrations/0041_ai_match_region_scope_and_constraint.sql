begin;

-- Make the idempotency contract a real table constraint. PostgREST can then
-- reliably infer the ON CONFLICT target used by the AI-match upsert.
alter table public.ai_matches
  drop constraint if exists ai_matches_user_resume_job_version_unique;

alter table public.ai_matches
  add constraint ai_matches_user_resume_job_version_unique
  unique using index ai_matches_user_resume_job_version_unique_idx;

-- Do not add a stored generated column here: jobs is already 452 MB and the
-- database is near its storage cap. An immutable classifier plus an expression
-- index gives the same lookup path without rewriting the large jobs table.
drop index if exists public.jobs_active_region_trgm_idx;

create or replace function public.ai_match_region_scope(value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select case
    when coalesce(value, '') ~* '(united states|united states of america|(^|[^a-z])(usa|u\\.?s\\.?)([^a-z]|$)|(^|[^a-z])us([^a-z]|$)|new york|san francisco|los angeles|seattle|chicago|boston|austin|dallas|houston|atlanta|denver|miami|philadelphia|washington|jersey city|newark|palo alto|mountain view|arlington|raleigh|charlotte|tampa|orlando|columbus|wilmington|fort lauderdale|milwaukee|colorado springs|baton rouge|fresno|san antonio|jacksonville|san diego|remote - us)' then 'us'
    when coalesce(value, '') ~* '(canada|toronto|vancouver|ottawa|montreal|mississauga|quebec)' then 'canada'
    when coalesce(value, '') ~* '(united kingdom|(^|[^a-z])u\\.?k\\.?([^a-z]|$)|england|scotland|wales|northern ireland|london|bournemouth|bristol|manchester|edinburgh|glasgow|birmingham|leeds|cardiff|belfast|cambridge|oxford|southampton|reading|guildford|crawley|aberdeen|newcastle|sheffield|liverpool|(^|[^a-z])gb([^a-z]|$))' then 'uk'
    when coalesce(value, '') ~* '(australia|sydney|melbourne|brisbane|perth|adelaide|canberra|ballarat|(^|[^a-z])au([^a-z]|$))' then 'australia'
    when coalesce(value, '') ~* '(hong kong|kowloon|hong kong island)' then 'hong_kong'
    when coalesce(value, '') ~* '(singapore)' then 'singapore'
    else null
  end;
$$;

create index if not exists jobs_active_ai_match_scope_direction_idx
  on public.jobs (public.ai_match_region_scope(region), direction, created_at desc)
  where is_active = true;

create or replace function public.search_ai_match_candidates_v2(
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
language sql
stable
security invoker
set search_path = public
as $$
  with query_terms as (
    select websearch_to_tsquery('simple', array_to_string(p_terms, ' ')) as query
  ),
  scoped_jobs as (
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
      and (cardinality(p_region_scopes) = 0 or public.ai_match_region_scope(jobs.region) = any(p_region_scopes))
      and (query_terms.query = ''::tsquery or jobs.ai_match_search @@ query_terms.query)
  )
  select *
  from scoped_jobs
  order by lexical_score desc, created_at desc
  limit greatest(1, least(coalesce(p_limit, 80), 200));
$$;

grant execute on function public.search_ai_match_candidates_v2(text[], text[], text[], integer) to authenticated;
notify pgrst, 'reload schema';

commit;
