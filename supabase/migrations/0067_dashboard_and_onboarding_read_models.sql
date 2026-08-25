begin;

-- One database call replaces the dashboard's multiple PostgREST round trips.
-- The function remains security invoker, so the existing RLS policies still
-- constrain every subquery to the authenticated caller's own records.
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
    'resume_count', (select count(*)::integer from public.resumes where user_id = p_user_id),
    'match_count', (select count(*)::integer from public.ai_matches where user_id = p_user_id),
    'avg_match_score', coalesce((select round(avg(match_score))::integer from recent_matches), 0),
    'interview_count', (select count(*)::integer from public.interview_sessions where user_id = p_user_id),
    'weekly_application_count', (select count(*)::integer from public.applications where user_id = p_user_id and created_at >= p_week_start),
    'application_count', (select count(*)::integer from public.applications where user_id = p_user_id)
  );
$$;

-- Homepage only needs the four progression booleans, not full dashboard data.
create or replace function public.get_user_onboarding_state(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  with latest_resume as (
    select segmentation_confirmed, profile
    from public.resumes
    where user_id = p_user_id
    order by created_at desc
    limit 1
  )
  select jsonb_build_object(
    'resumes', exists(select 1 from latest_resume),
    'confirmed', coalesce((select segmentation_confirmed from latest_resume), false),
    'personality', coalesce((select profile ? 'personality' from latest_resume), false),
    'interview', exists(select 1 from public.interview_sessions where user_id = p_user_id)
  );
$$;

revoke all on function public.get_dashboard_overview(uuid, timestamptz) from public, anon;
revoke all on function public.get_user_onboarding_state(uuid) from public, anon;
grant execute on function public.get_dashboard_overview(uuid, timestamptz) to authenticated;
grant execute on function public.get_user_onboarding_state(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
