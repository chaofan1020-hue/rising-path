begin;

create or replace function public.get_ai_usage_feature_summary(
  p_user_id uuid default null,
  p_feature text default null,
  p_provider text default null,
  p_status text default null,
  p_usage_source text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  feature text,
  call_count bigint,
  successful_calls bigint,
  failed_calls bigint,
  input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  actual_calls bigint,
  estimated_calls bigint,
  unknown_calls bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    events.feature,
    count(*)::bigint,
    count(*) filter (where events.status = 'success')::bigint,
    count(*) filter (where events.status = 'error')::bigint,
    coalesce(sum(events.input_tokens), 0)::bigint,
    coalesce(sum(events.output_tokens), 0)::bigint,
    coalesce(sum(events.total_tokens), 0)::bigint,
    count(*) filter (where events.usage_source = 'actual')::bigint,
    count(*) filter (where events.usage_source = 'estimated')::bigint,
    count(*) filter (where events.usage_source = 'unknown')::bigint
  from public.ai_usage_events events
  where (p_user_id is null or events.user_id = p_user_id)
    and (p_feature is null or events.feature = p_feature)
    and (p_provider is null or events.provider = p_provider)
    and (p_status is null or events.status = p_status)
    and (p_usage_source is null or events.usage_source = p_usage_source)
    and (p_from is null or events.created_at >= p_from)
    and (p_to is null or events.created_at < p_to)
  group by events.feature
  order by coalesce(sum(events.total_tokens), 0) desc, events.feature;
$$;

create or replace function public.get_ai_usage_student_count(
  p_feature text default null,
  p_provider text default null,
  p_status text default null,
  p_usage_source text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint
  from (
    select events.user_id
    from public.ai_usage_events events
    where events.user_id is not null
      and (p_feature is null or events.feature = p_feature)
      and (p_provider is null or events.provider = p_provider)
      and (p_status is null or events.status = p_status)
      and (p_usage_source is null or events.usage_source = p_usage_source)
      and (p_from is null or events.created_at >= p_from)
      and (p_to is null or events.created_at < p_to)
    group by events.user_id
  ) grouped_students;
$$;

create or replace function public.get_ai_usage_student_summary_v2(
  p_feature text default null,
  p_provider text default null,
  p_status text default null,
  p_usage_source text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  user_id uuid,
  display_name text,
  call_count bigint,
  successful_calls bigint,
  failed_calls bigint,
  input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  actual_calls bigint,
  estimated_calls bigint,
  unknown_calls bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    events.user_id,
    coalesce(nullif(profiles.display_name, ''), '未命名用户')::text,
    count(*)::bigint,
    count(*) filter (where events.status = 'success')::bigint,
    count(*) filter (where events.status = 'error')::bigint,
    coalesce(sum(events.input_tokens), 0)::bigint,
    coalesce(sum(events.output_tokens), 0)::bigint,
    coalesce(sum(events.total_tokens), 0)::bigint,
    count(*) filter (where events.usage_source = 'actual')::bigint,
    count(*) filter (where events.usage_source = 'estimated')::bigint,
    count(*) filter (where events.usage_source = 'unknown')::bigint
  from public.ai_usage_events events
  left join public.profiles profiles on profiles.id = events.user_id
  where events.user_id is not null
    and (p_feature is null or events.feature = p_feature)
    and (p_provider is null or events.provider = p_provider)
    and (p_status is null or events.status = p_status)
    and (p_usage_source is null or events.usage_source = p_usage_source)
    and (p_from is null or events.created_at >= p_from)
    and (p_to is null or events.created_at < p_to)
  group by events.user_id, profiles.display_name
  order by coalesce(sum(events.total_tokens), 0) desc, events.user_id
  offset greatest(p_page - 1, 0) * least(greatest(p_page_size, 1), 100)
  limit least(greatest(p_page_size, 1), 100);
$$;

revoke all on function public.get_ai_usage_feature_summary(uuid, text, text, text, text, timestamptz, timestamptz) from public;
revoke all on function public.get_ai_usage_student_count(text, text, text, text, timestamptz, timestamptz) from public;
revoke all on function public.get_ai_usage_student_summary_v2(text, text, text, text, timestamptz, timestamptz, integer, integer) from public;
grant execute on function public.get_ai_usage_feature_summary(uuid, text, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.get_ai_usage_student_count(text, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.get_ai_usage_student_summary_v2(text, text, text, text, timestamptz, timestamptz, integer, integer) to service_role;

commit;
