begin;

-- Keep region classification out of the 452 MB jobs table. This compact lookup
-- table gives authenticated AI-match requests an ordinary indexed scope join
-- instead of re-running the region regex for every term.
create table if not exists public.job_ai_match_scopes (
  job_id integer primary key references public.jobs(id) on delete cascade,
  scope text not null check (scope in ('us', 'canada', 'uk', 'australia', 'hong_kong', 'singapore')),
  updated_at timestamptz not null default now()
);

insert into public.job_ai_match_scopes (job_id, scope)
select jobs.id, public.ai_match_region_scope(jobs.region)
from public.jobs as jobs
where public.ai_match_region_scope(jobs.region) is not null
on conflict (job_id) do update
set scope = excluded.scope,
    updated_at = now();

create index if not exists job_ai_match_scopes_scope_job_idx
  on public.job_ai_match_scopes (scope, job_id);

create or replace function public.sync_job_ai_match_scope()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
declare
  next_scope text := public.ai_match_region_scope(new.region);
begin
  if next_scope is null then
    delete from public.job_ai_match_scopes where job_id = new.id;
  else
    insert into public.job_ai_match_scopes (job_id, scope, updated_at)
    values (new.id, next_scope, now())
    on conflict (job_id) do update
      set scope = excluded.scope, updated_at = excluded.updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_sync_ai_match_scope on public.jobs;
create trigger jobs_sync_ai_match_scope
after insert or update of region on public.jobs
for each row execute function public.sync_job_ai_match_scope();

create or replace function public.search_ai_match_candidates_v7(
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
security definer
set search_path to public
as $$
declare
  query_value tsquery := websearch_to_tsquery('simple', array_to_string(p_terms, ' OR '));
  sql text;
begin
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
        limit 24
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

  return query execute sql using p_terms, p_region_scopes, p_directions, query_value, greatest(1, least(coalesce(p_limit, 80), 200));
end;
$$;

revoke all on function public.search_ai_match_candidates_v7(text[], text[], text[], integer) from public;
grant execute on function public.search_ai_match_candidates_v7(text[], text[], text[], integer) to authenticated;

notify pgrst, 'reload schema';

commit;
