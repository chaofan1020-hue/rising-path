begin;

-- PostgREST upsert uses ON CONFLICT (user_id, resume_id, job_id,
-- resume_profile_version). A partial unique index cannot be inferred by that
-- conflict target, so replace the earlier partial index with a full unique
-- index. Nullable legacy rows remain allowed to coexist, while new complete
-- match records get the intended idempotency guarantee.
drop index if exists public.ai_matches_user_resume_job_version_unique_idx;

delete from public.ai_matches older
using public.ai_matches newer
where older.id < newer.id
  and older.user_id is not null
  and older.resume_id is not null
  and older.job_id is not null
  and older.resume_profile_version is not null
  and older.user_id = newer.user_id
  and older.resume_id = newer.resume_id
  and older.job_id = newer.job_id
  and older.resume_profile_version = newer.resume_profile_version;

create unique index if not exists ai_matches_user_resume_job_version_unique_idx
  on public.ai_matches(user_id, resume_id, job_id, resume_profile_version);

-- Region filters are ILIKE patterns (city/country aliases), so trigram lookup
-- prevents the full active jobs table from being scanned for every request.
create extension if not exists pg_trgm;

create index if not exists jobs_active_region_trgm_idx
  on public.jobs using gin (region gin_trgm_ops)
  where is_active = true;

notify pgrst, 'reload schema';

commit;
