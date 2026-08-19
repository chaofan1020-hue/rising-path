begin;

alter table public.ai_usage_events
  add column if not exists modality text not null default 'text',
  add column if not exists input_audio_seconds numeric(18, 6),
  add column if not exists output_audio_seconds numeric(18, 6),
  add column if not exists input_audio_bytes bigint,
  add column if not exists output_audio_bytes bigint,
  add column if not exists audio_tokens bigint,
  add column if not exists text_characters bigint,
  add column if not exists billing_unit text,
  add column if not exists billing_units numeric(18, 6),
  add column if not exists measurement_source text not null default 'unknown';

alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_modality_check,
  drop constraint if exists ai_usage_events_audio_metrics_check,
  drop constraint if exists ai_usage_events_measurement_source_check;

alter table public.ai_usage_events
  add constraint ai_usage_events_modality_check
    check (modality in ('text', 'audio')),
  add constraint ai_usage_events_audio_metrics_check
    check (
      (input_audio_seconds is null or input_audio_seconds >= 0)
      and (output_audio_seconds is null or output_audio_seconds >= 0)
      and (input_audio_bytes is null or input_audio_bytes >= 0)
      and (output_audio_bytes is null or output_audio_bytes >= 0)
      and (audio_tokens is null or audio_tokens >= 0)
      and (text_characters is null or text_characters >= 0)
      and (billing_units is null or billing_units >= 0)
    ),
  add constraint ai_usage_events_measurement_source_check
    check (measurement_source in ('provider', 'pcm_exact', 'container_estimated', 'request', 'unknown'));

create index if not exists ai_usage_events_modality_created_idx
  on public.ai_usage_events(modality, created_at desc);

create or replace function public.get_ai_usage_summary_v2(
  p_user_id uuid default null,
  p_feature text default null,
  p_provider text default null,
  p_status text default null,
  p_usage_source text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  call_count bigint,
  successful_calls bigint,
  failed_calls bigint,
  input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  actual_calls bigint,
  estimated_calls bigint,
  unknown_calls bigint,
  audio_calls bigint,
  input_audio_seconds numeric,
  output_audio_seconds numeric,
  input_audio_bytes bigint,
  output_audio_bytes bigint,
  audio_tokens bigint,
  text_characters bigint,
  billing_units numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::bigint,
    count(*) filter (where events.status = 'success')::bigint,
    count(*) filter (where events.status = 'error')::bigint,
    coalesce(sum(events.input_tokens), 0)::bigint,
    coalesce(sum(events.output_tokens), 0)::bigint,
    coalesce(sum(events.total_tokens), 0)::bigint,
    count(*) filter (where events.usage_source = 'actual')::bigint,
    count(*) filter (where events.usage_source = 'estimated')::bigint,
    count(*) filter (where events.usage_source = 'unknown')::bigint,
    count(*) filter (where events.modality = 'audio')::bigint,
    coalesce(sum(events.input_audio_seconds), 0),
    coalesce(sum(events.output_audio_seconds), 0),
    coalesce(sum(events.input_audio_bytes), 0)::bigint,
    coalesce(sum(events.output_audio_bytes), 0)::bigint,
    coalesce(sum(events.audio_tokens), 0)::bigint,
    coalesce(sum(events.text_characters), 0)::bigint,
    coalesce(sum(events.billing_units), 0)
  from public.ai_usage_events events
  where (p_user_id is null or events.user_id = p_user_id)
    and (p_feature is null or events.feature = p_feature)
    and (p_provider is null or events.provider = p_provider)
    and (p_status is null or events.status = p_status)
    and (p_usage_source is null or events.usage_source = p_usage_source)
    and (p_from is null or events.created_at >= p_from)
    and (p_to is null or events.created_at < p_to);
$$;

create or replace function public.get_ai_usage_feature_summary_v2(
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
  unknown_calls bigint,
  audio_calls bigint,
  input_audio_seconds numeric,
  output_audio_seconds numeric,
  audio_tokens bigint,
  text_characters bigint,
  billing_units numeric
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
    count(*) filter (where events.usage_source = 'unknown')::bigint,
    count(*) filter (where events.modality = 'audio')::bigint,
    coalesce(sum(events.input_audio_seconds), 0),
    coalesce(sum(events.output_audio_seconds), 0),
    coalesce(sum(events.audio_tokens), 0)::bigint,
    coalesce(sum(events.text_characters), 0)::bigint,
    coalesce(sum(events.billing_units), 0)
  from public.ai_usage_events events
  where (p_user_id is null or events.user_id = p_user_id)
    and (p_feature is null or events.feature = p_feature)
    and (p_provider is null or events.provider = p_provider)
    and (p_status is null or events.status = p_status)
    and (p_usage_source is null or events.usage_source = p_usage_source)
    and (p_from is null or events.created_at >= p_from)
    and (p_to is null or events.created_at < p_to)
  group by events.feature
  order by coalesce(sum(events.total_tokens), 0) desc, coalesce(sum(events.billing_units), 0) desc, events.feature;
$$;

create or replace function public.get_ai_usage_student_summary_v3(
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
  unknown_calls bigint,
  audio_calls bigint,
  input_audio_seconds numeric,
  output_audio_seconds numeric,
  audio_tokens bigint,
  text_characters bigint,
  billing_units numeric
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
    count(*) filter (where events.usage_source = 'unknown')::bigint,
    count(*) filter (where events.modality = 'audio')::bigint,
    coalesce(sum(events.input_audio_seconds), 0),
    coalesce(sum(events.output_audio_seconds), 0),
    coalesce(sum(events.audio_tokens), 0)::bigint,
    coalesce(sum(events.text_characters), 0)::bigint,
    coalesce(sum(events.billing_units), 0)
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
  order by coalesce(sum(events.total_tokens), 0) desc, coalesce(sum(events.billing_units), 0) desc, events.user_id
  offset greatest(p_page - 1, 0) * least(greatest(p_page_size, 1), 100)
  limit least(greatest(p_page_size, 1), 100);
$$;

revoke all on function public.get_ai_usage_summary_v2(uuid, text, text, text, text, timestamptz, timestamptz) from public;
revoke all on function public.get_ai_usage_feature_summary_v2(uuid, text, text, text, text, timestamptz, timestamptz) from public;
revoke all on function public.get_ai_usage_student_summary_v3(text, text, text, text, timestamptz, timestamptz, integer, integer) from public;
grant execute on function public.get_ai_usage_summary_v2(uuid, text, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.get_ai_usage_feature_summary_v2(uuid, text, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.get_ai_usage_student_summary_v3(text, text, text, text, timestamptz, timestamptz, integer, integer) to service_role;

commit;
