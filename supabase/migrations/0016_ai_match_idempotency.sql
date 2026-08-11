begin;

-- Keep the newest result when older deployments already contain duplicate
-- matches, then make the confirmed-profile match key idempotent.
delete from public.ai_matches older
using public.ai_matches newer
where older.id < newer.id
  and older.user_id is not null
  and newer.user_id is not null
  and older.resume_profile_version is not null
  and newer.resume_profile_version is not null
  and older.user_id = newer.user_id
  and older.resume_id = newer.resume_id
  and older.job_id = newer.job_id
  and older.resume_profile_version = newer.resume_profile_version;

create unique index if not exists ai_matches_user_resume_job_version_unique_idx
  on public.ai_matches(user_id, resume_id, job_id, resume_profile_version)
  where user_id is not null
    and resume_id is not null
    and job_id is not null
    and resume_profile_version is not null;

commit;
