begin;

-- Repair installations where the early AI-match migrations were recorded but
-- the legacy table was never altered. The API writes all of these fields.
alter table if exists public.ai_matches
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists resume_profile_version integer,
  add column if not exists score_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists evidence jsonb not null default '[]'::jsonb,
  add column if not exists key_gaps jsonb not null default '[]'::jsonb;

update public.ai_matches as matches
set user_id = resumes.user_id
from public.resumes
where matches.resume_id = resumes.id
  and matches.user_id is null;

alter table if exists public.ai_matches
  drop constraint if exists ai_matches_resume_profile_version_check,
  drop constraint if exists ai_matches_score_check,
  drop constraint if exists ai_matches_score_breakdown_object_check,
  drop constraint if exists ai_matches_evidence_array_check,
  drop constraint if exists ai_matches_key_gaps_array_check;

alter table if exists public.ai_matches
  add constraint ai_matches_resume_profile_version_check
    check (resume_profile_version is null or resume_profile_version > 0),
  add constraint ai_matches_score_check
    check (match_score between 0 and 100),
  add constraint ai_matches_score_breakdown_object_check
    check (jsonb_typeof(score_breakdown) = 'object'),
  add constraint ai_matches_evidence_array_check
    check (jsonb_typeof(evidence) = 'array'),
  add constraint ai_matches_key_gaps_array_check
    check (jsonb_typeof(key_gaps) = 'array');

delete from public.ai_matches older
using public.ai_matches newer
where older.id < newer.id
  and older.user_id is not null
  and newer.user_id is not null
  and older.resume_id = newer.resume_id
  and older.job_id = newer.job_id
  and older.resume_profile_version is not null
  and older.resume_profile_version = newer.resume_profile_version;

create unique index if not exists ai_matches_user_resume_job_version_unique_idx
  on public.ai_matches(user_id, resume_id, job_id, resume_profile_version)
  where user_id is not null
    and resume_id is not null
    and job_id is not null
    and resume_profile_version is not null;

create index if not exists ai_matches_resume_version_idx
  on public.ai_matches(resume_id, resume_profile_version);

notify pgrst, 'reload schema';

commit;
