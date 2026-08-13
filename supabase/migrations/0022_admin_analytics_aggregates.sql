begin;

-- Dashboard analytics stays in PostgreSQL and returns only fixed-size aggregates.
-- It never returns resume/profile JSON, email addresses, or interview content.
create index if not exists profiles_created_at_idx
  on public.profiles(created_at desc);
create index if not exists resumes_user_created_at_idx
  on public.resumes(user_id, created_at desc);
create index if not exists applications_user_created_at_idx
  on public.applications(user_id, created_at desc);
create index if not exists ai_matches_user_created_at_idx
  on public.ai_matches(user_id, created_at desc);
create index if not exists ai_matches_created_at_idx
  on public.ai_matches(created_at desc);
create index if not exists jobs_active_created_at_idx
  on public.jobs(created_at desc)
  where is_active = true;

create or replace function public.get_admin_analytics(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with
  active_jobs as materialized (
    select created_at, region, direction
    from public.jobs
    where is_active = true
  ),
  range_activity as materialized (
    select user_id, 'resume'::text as activity_type
    from public.resumes
    where created_at >= p_from and created_at < p_to
    union all
    select user_id, 'application'::text as activity_type
    from public.applications
    where created_at >= p_from and created_at < p_to
    union all
    select user_id, 'ai_match'::text as activity_type
    from public.ai_matches
    where created_at >= p_from and created_at < p_to
  ),
  user_activity as materialized (
    select
      activity.user_id,
      count(*) filter (where activity.activity_type = 'resume')::bigint as resumes,
      count(*) filter (where activity.activity_type = 'application')::bigint as applications,
      count(*) filter (where activity.activity_type = 'ai_match')::bigint as ai_matches
    from range_activity activity
    where activity.user_id is not null
    group by activity.user_id
  ),
  trend_days as materialized (
    select day::date as day
    from generate_series(
      date_trunc('day', p_to at time zone 'UTC')::date - 6,
      date_trunc('day', p_to at time zone 'UTC')::date,
      interval '1 day'
    ) as day
  ),
  overview as materialized (
    select
      (select count(*)::bigint from public.profiles) as total_users,
      (select count(*)::bigint from public.profiles where created_at >= p_from and created_at < p_to) as recent_users,
      (select count(*)::bigint from public.resumes) as total_resumes,
      (select count(*)::bigint from public.resumes where created_at >= p_from and created_at < p_to) as recent_resumes,
      (select count(*)::bigint from active_jobs) as total_jobs,
      (select count(*)::bigint from active_jobs where created_at >= p_from and created_at < p_to) as recent_jobs,
      (select count(*)::bigint from public.applications) as total_applications,
      (select count(*)::bigint from public.applications where created_at >= p_from and created_at < p_to) as recent_applications,
      (select count(*)::bigint from public.ai_matches) as total_ai_matches,
      (select count(*)::bigint from public.ai_matches where created_at >= p_from and created_at < p_to) as recent_ai_matches,
      (select count(*)::bigint from user_activity) as active_users,
      (select count(*)::bigint from range_activity) as total_activity_events
  )
  select jsonb_build_object(
    'overview', (
      select jsonb_build_object(
        'totalUsers', total_users,
        'recentUsers', recent_users,
        'totalResumes', total_resumes,
        'recentResumes', recent_resumes,
        'totalJobs', total_jobs,
        'recentJobs', recent_jobs,
        'totalApplications', total_applications,
        'recentApplications', recent_applications,
        'totalAiMatches', total_ai_matches,
        'recentAiMatches', recent_ai_matches,
        'activeUsers', active_users,
        'totalActivityEvents', total_activity_events,
        'averageActivityPerActiveUser', case
          when active_users > 0 then round(total_activity_events::numeric / active_users, 1)
          else 0
        end
      )
      from overview
    ),
    'charts', jsonb_build_object(
      'jobsByRegion', coalesce((
        select jsonb_object_agg(grouped.region, grouped.count order by grouped.count desc, grouped.region)
        from (
          select coalesce(nullif(trim(region), ''), '未标注') as region, count(*)::bigint as count
          from active_jobs
          group by 1
          order by count(*) desc, region
          limit 12
        ) grouped
      ), '{}'::jsonb),
      'jobsByDirection', coalesce((
        select jsonb_object_agg(grouped.direction, grouped.count order by grouped.count desc, grouped.direction)
        from (
          select coalesce(nullif(trim(direction), ''), '未标注') as direction, count(*)::bigint as count
          from active_jobs
          group by 1
          order by count(*) desc, direction
          limit 12
        ) grouped
      ), '{}'::jsonb),
      'applicationsByStatus', (
        select jsonb_build_object(
          'pending', count(*) filter (where status = 'pending'),
          'filling', count(*) filter (where status = 'filling'),
          'submitted', count(*) filter (where status in ('submitted', 'interview')),
          'closed', count(*) filter (where status is null or status not in ('pending', 'filling', 'submitted', 'interview'))
        )
        from public.applications
        where created_at >= p_from and created_at < p_to
      ),
      'dailyStats', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'date', trend.day::text,
            'resumes', coalesce(resume_counts.count, 0),
            'applications', coalesce(application_counts.count, 0),
            'aiMatches', coalesce(ai_match_counts.count, 0)
          )
          order by trend.day
        )
        from trend_days trend
        left join lateral (
          select count(*)::bigint as count
          from public.resumes
          where created_at >= (trend.day::timestamp at time zone 'UTC')
            and created_at < ((trend.day + 1)::timestamp at time zone 'UTC')
            and created_at < p_to
        ) resume_counts on true
        left join lateral (
          select count(*)::bigint as count
          from public.applications
          where created_at >= (trend.day::timestamp at time zone 'UTC')
            and created_at < ((trend.day + 1)::timestamp at time zone 'UTC')
            and created_at < p_to
        ) application_counts on true
        left join lateral (
          select count(*)::bigint as count
          from public.ai_matches
          where created_at >= (trend.day::timestamp at time zone 'UTC')
            and created_at < ((trend.day + 1)::timestamp at time zone 'UTC')
            and created_at < p_to
        ) ai_match_counts on true
      ), '[]'::jsonb)
    ),
    'userActivity', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'userId', ranked.user_id,
          'userName', coalesce(nullif(profiles.display_name, ''), '未命名用户'),
          'resumes', ranked.resumes,
          'applications', ranked.applications,
          'aiMatches', ranked.ai_matches
        )
        order by (ranked.resumes + ranked.applications + ranked.ai_matches) desc, ranked.user_id
      )
      from (
        select *
        from user_activity
        order by (resumes + applications + ai_matches) desc, user_id
        limit 10
      ) ranked
      left join public.profiles on profiles.id = ranked.user_id
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_admin_analytics(timestamptz, timestamptz) from public;
grant execute on function public.get_admin_analytics(timestamptz, timestamptz) to service_role;

commit;
