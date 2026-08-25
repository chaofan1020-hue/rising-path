begin;

alter table public.profiles
  add column if not exists preferred_region text;

alter table public.profiles
  drop constraint if exists profiles_preferred_region_check;

alter table public.profiles
  add constraint profiles_preferred_region_check
  check (preferred_region is null or preferred_region in ('us', 'uk', 'sg', 'cn_t1', 'cn_t2', 'ca', 'hk', 'au'));

-- Preserve the current dashboard choice for existing users on first deploy.
update public.profiles p
set preferred_region = source.region
from (
  select distinct on (user_id)
    user_id,
    segmentation_overrides->'regions'->>0 as region
  from public.resumes
  where segmentation_overrides->'regions'->>0 is not null
  order by user_id, created_at desc
) source
where p.id = source.user_id
  and p.preferred_region is null
  and source.region in ('us', 'uk', 'sg', 'cn_t1', 'cn_t2', 'ca', 'hk', 'au');

create or replace function public.get_dashboard_overview(
  p_user_id uuid,
  p_week_start timestamptz
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with latest_resume as (
    select id, created_at, updated_at, file_name, profile, segmentation,
      segmentation_overrides, segmentation_confirmed
    from public.resumes
    where user_id = p_user_id
    order by created_at desc
    limit 1
  ),
  latest_interview as (
    select id, status, updated_at, created_at
    from public.interview_sessions
    where user_id = p_user_id
    order by created_at desc
    limit 1
  ),
  recent_matches as (
    select match_score
    from public.ai_matches
    where user_id = p_user_id
    order by created_at desc
    limit 50
  )
  select jsonb_build_object(
    'latest_resume', coalesce((select to_jsonb(latest_resume) from latest_resume), 'null'::jsonb),
    'latest_interview', coalesce((select to_jsonb(latest_interview) from latest_interview), 'null'::jsonb),
    'preferred_region', (select preferred_region from public.profiles where id = p_user_id),
    'resume_count', (select count(*)::integer from public.resumes where user_id = p_user_id),
    'match_count', (select count(*)::integer from public.ai_matches where user_id = p_user_id),
    'avg_match_score', coalesce((select round(avg(match_score))::integer from recent_matches), 0),
    'interview_count', (select count(*)::integer from public.interview_sessions where user_id = p_user_id),
    'weekly_application_count', (select count(*)::integer from public.applications where user_id = p_user_id and created_at >= p_week_start),
    'application_count', (select count(*)::integer from public.applications where user_id = p_user_id)
  );
$$;

notify pgrst, 'reload schema';

commit;
