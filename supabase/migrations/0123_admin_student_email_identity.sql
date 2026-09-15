begin;

create or replace function public.get_auth_user_email_parts(p_user_id uuid)
returns table (
  email_local text,
  email_domain text
)
language sql
stable
security definer
set search_path = auth, public
as $$
  select
    nullif(split_part(coalesce(auth.users.email, ''), '@', 1), '') as email_local,
    nullif(split_part(coalesce(auth.users.email, ''), '@', 2), '') as email_domain
  from auth.users
  where auth.users.id = p_user_id
  limit 1;
$$;

drop function if exists public.get_admin_student_directory_v3(text, text, integer, integer, uuid);
drop function if exists public.get_admin_student_directory_v3_count(text, uuid);

create function public.get_admin_student_directory_v3(
  p_search text default null,
  p_sort text default 'recent_activity',
  p_page integer default 1,
  p_page_size integer default 25,
  p_email_user_id uuid default null
)
returns table (
  user_id uuid,
  public_code text,
  display_name text,
  resume_name text,
  email_local text,
  email_domain text,
  avatar_url text,
  school_name text,
  preferred_region text,
  career_stage text,
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
set search_path = auth, public
as $$
  with latest_resume as (
    select distinct on (resumes.user_id)
      resumes.user_id,
      nullif(trim(resumes.profile -> 'education' -> 0 ->> 'school'), '') as school_name,
      nullif(trim(resumes.segmentation ->> 'careerStage'), '') as career_stage,
      nullif(trim(resumes.user_info ->> 'name'), '') as resume_name
    from public.resumes
    where resumes.user_id is not null
    order by resumes.user_id, resumes.updated_at desc nulls last, resumes.id desc
  ),
  filtered_profiles as materialized (
    select
      profiles.id,
      public.admin_student_public_code(profiles.id) as public_code,
      coalesce(nullif(trim(profiles.display_name), ''), '未设置姓名')::text as display_name,
      latest_resume.resume_name,
      nullif(split_part(coalesce(auth_users.email, ''), '@', 1), '') as email_local,
      nullif(split_part(coalesce(auth_users.email, ''), '@', 2), '') as email_domain,
      profiles.avatar_url,
      profiles.preferred_region,
      profiles.created_at,
      latest_resume.school_name,
      latest_resume.career_stage
    from public.profiles
    left join latest_resume on latest_resume.user_id = profiles.id
    left join auth.users auth_users on auth_users.id = profiles.id
    where
      (
        p_email_user_id is not null and profiles.id = p_email_user_id
      )
      or (
        p_email_user_id is null and (
          p_search is null
          or profiles.id::text ilike '%' || p_search || '%'
          or public.admin_student_public_code(profiles.id) ilike '%' || replace(upper(p_search), ' ', '') || '%'
          or coalesce(profiles.display_name, '') ilike '%' || p_search || '%'
          or coalesce(latest_resume.school_name, '') ilike '%' || p_search || '%'
          or coalesce(latest_resume.resume_name, '') ilike '%' || p_search || '%'
          or coalesce(auth_users.email, '') ilike '%' || p_search || '%'
          or split_part(coalesce(auth_users.email, ''), '@', 1) ilike '%' || p_search || '%'
        )
      )
  ),
  aggregated as materialized (
    select
      profiles.id as user_id,
      profiles.public_code,
      profiles.display_name,
      profiles.resume_name,
      profiles.email_local,
      profiles.email_domain,
      profiles.avatar_url,
      profiles.school_name,
      profiles.preferred_region,
      profiles.career_stage,
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

create function public.get_admin_student_directory_v3_count(
  p_search text default null,
  p_email_user_id uuid default null
)
returns bigint
language sql
stable
security definer
set search_path = auth, public
as $$
  with latest_resume as (
    select distinct on (resumes.user_id)
      resumes.user_id,
      nullif(trim(resumes.profile -> 'education' -> 0 ->> 'school'), '') as school_name,
      nullif(trim(resumes.user_info ->> 'name'), '') as resume_name
    from public.resumes
    where resumes.user_id is not null
    order by resumes.user_id, resumes.updated_at desc nulls last, resumes.id desc
  )
  select count(*)::bigint
  from public.profiles
  left join latest_resume on latest_resume.user_id = profiles.id
  left join auth.users auth_users on auth_users.id = profiles.id
  where
    (p_email_user_id is not null and profiles.id = p_email_user_id)
    or (
      p_email_user_id is null and (
        p_search is null
        or profiles.id::text ilike '%' || p_search || '%'
        or public.admin_student_public_code(profiles.id) ilike '%' || replace(upper(p_search), ' ', '') || '%'
        or coalesce(profiles.display_name, '') ilike '%' || p_search || '%'
        or coalesce(latest_resume.school_name, '') ilike '%' || p_search || '%'
        or coalesce(latest_resume.resume_name, '') ilike '%' || p_search || '%'
        or coalesce(auth_users.email, '') ilike '%' || p_search || '%'
        or split_part(coalesce(auth_users.email, ''), '@', 1) ilike '%' || p_search || '%'
      )
    );
$$;

revoke all on function public.get_auth_user_email_parts(uuid) from public, anon, authenticated;
revoke all on function public.get_admin_student_directory_v3(text, text, integer, integer, uuid) from public, anon, authenticated;
revoke all on function public.get_admin_student_directory_v3_count(text, uuid) from public, anon, authenticated;
grant execute on function public.get_auth_user_email_parts(uuid) to service_role;
grant execute on function public.get_admin_student_directory_v3(text, text, integer, integer, uuid) to service_role;
grant execute on function public.get_admin_student_directory_v3_count(text, uuid) to service_role;

commit;
