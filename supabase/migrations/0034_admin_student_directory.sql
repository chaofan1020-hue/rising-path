begin;

-- The directory is deliberately limited to operational aggregates. It must
-- never return emails, resume/profile JSON, interview messages, or AI input.
create or replace function public.get_admin_student_directory(
  p_search text default null,
  p_sort text default 'recent_activity',
  p_page integer default 1,
  p_page_size integer default 25
)
returns table (
  user_id uuid,
  display_name text,
  created_at timestamptz,
  resume_count bigint,
  application_count bigint,
  interview_count bigint,
  ai_match_count bigint,
  ai_call_count bigint,
  total_tokens bigint,
  last_activity_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with filtered_profiles as materialized (
    select id, coalesce(nullif(display_name, ''), '未命名用户')::text as display_name, created_at
    from public.profiles
    where p_search is null
      or id::text ilike '%' || p_search || '%'
      or coalesce(display_name, '') ilike '%' || p_search || '%'
  ), aggregated as materialized (
    select
      profiles.id as user_id,
      profiles.display_name,
      profiles.created_at,
      coalesce(resumes.count, 0)::bigint as resume_count,
      coalesce(applications.count, 0)::bigint as application_count,
      coalesce(interviews.count, 0)::bigint as interview_count,
      coalesce(matches.count, 0)::bigint as ai_match_count,
      coalesce(usage.call_count, 0)::bigint as ai_call_count,
      coalesce(usage.total_tokens, 0)::bigint as total_tokens,
      greatest(
        profiles.created_at,
        coalesce(resumes.last_activity_at, profiles.created_at),
        coalesce(applications.last_activity_at, profiles.created_at),
        coalesce(interviews.last_activity_at, profiles.created_at),
        coalesce(matches.last_activity_at, profiles.created_at),
        coalesce(usage.last_activity_at, profiles.created_at)
      ) as last_activity_at
    from filtered_profiles profiles
    left join lateral (
      select count(*)::bigint as count, max(updated_at) as last_activity_at
      from public.resumes where user_id = profiles.id
    ) resumes on true
    left join lateral (
      select count(*)::bigint as count, max(updated_at) as last_activity_at
      from public.applications where user_id = profiles.id
    ) applications on true
    left join lateral (
      select count(*)::bigint as count, max(updated_at) as last_activity_at
      from public.interview_sessions where user_id = profiles.id
    ) interviews on true
    left join lateral (
      select count(*)::bigint as count, max(created_at) as last_activity_at
      from public.ai_matches where user_id = profiles.id
    ) matches on true
    left join lateral (
      select count(*)::bigint as call_count, coalesce(sum(total_tokens), 0)::bigint as total_tokens, max(created_at) as last_activity_at
      from public.ai_usage_events where user_id = profiles.id
    ) usage on true
  )
  select *
  from aggregated
  order by
    case when p_sort = 'ai_usage' then total_tokens end desc nulls last,
    case when p_sort = 'resumes' then resume_count end desc nulls last,
    case when p_sort = 'interviews' then interview_count end desc nulls last,
    last_activity_at desc,
    user_id
  offset greatest(p_page - 1, 0) * least(greatest(p_page_size, 1), 100)
  limit least(greatest(p_page_size, 1), 100);
$$;

create or replace function public.get_admin_student_directory_count(p_search text default null)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint
  from public.profiles
  where p_search is null
    or id::text ilike '%' || p_search || '%'
    or coalesce(display_name, '') ilike '%' || p_search || '%';
$$;

revoke all on function public.get_admin_student_directory(text, text, integer, integer) from public;
revoke all on function public.get_admin_student_directory_count(text) from public;
grant execute on function public.get_admin_student_directory(text, text, integer, integer) to service_role;
grant execute on function public.get_admin_student_directory_count(text) to service_role;

commit;
