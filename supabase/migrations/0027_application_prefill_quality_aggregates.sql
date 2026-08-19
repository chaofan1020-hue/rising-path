begin;

-- Keep prefill quality reporting in PostgreSQL. The function deliberately
-- returns only aggregate mapping metadata, never suggested/final field values
-- or user identities.
create index if not exists prefill_feedback_created_at_idx
  on public.prefill_feedback(created_at desc);
create index if not exists prefill_feedback_quality_idx
  on public.prefill_feedback(created_at desc, action, semantic_key);
create index if not exists form_templates_shared_quality_idx
  on public.form_templates(correction_count desc, usage_count desc)
  where user_id is null and is_active = true;

create or replace function public.get_admin_prefill_quality(
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
  filtered as materialized (
    select action, domain, field_key, semantic_key, user_id, created_at
    from public.prefill_feedback
    where created_at >= p_from and created_at < p_to
  ),
  totals as materialized (
    select
      count(*)::bigint as total_feedback,
      count(*) filter (where action = 'confirmed')::bigint as confirmed,
      count(*) filter (where action = 'edited')::bigint as edited,
      count(*) filter (where action = 'ignored')::bigint as ignored,
      count(distinct user_id)::bigint as contributing_users,
      count(distinct nullif(trim(domain), ''))::bigint as domains
    from filtered
  ),
  trend_days as materialized (
    select day::date as day
    from generate_series(
      date_trunc('day', p_from at time zone 'UTC')::date,
      date_trunc('day', (p_to - interval '1 microsecond') at time zone 'UTC')::date,
      interval '1 day'
    ) as day
  ),
  field_quality as materialized (
    select
      coalesce(nullif(trim(domain), ''), '未标注') as domain,
      coalesce(nullif(trim(semantic_key), ''), nullif(trim(field_key), ''), '未标注') as semantic_key,
      count(*)::bigint as total_feedback,
      count(*) filter (where action = 'confirmed')::bigint as confirmed,
      count(*) filter (where action = 'edited')::bigint as edited,
      count(*) filter (where action = 'ignored')::bigint as ignored
    from filtered
    group by 1, 2
  ),
  template_quality as materialized (
    select
      coalesce(nullif(trim(domain_pattern), ''), '未标注') as domain_pattern,
      coalesce(nullif(trim(ats_type), ''), '未标注') as ats_type,
      coalesce(nullif(trim(semantic_key), ''), '未标注') as semantic_key,
      usage_count::bigint as usage_count,
      correction_count::bigint as correction_count
    from public.form_templates
    where user_id is null
      and is_active = true
      and usage_count > 0
  )
  select jsonb_build_object(
    'overview', (
      select jsonb_build_object(
        'totalFeedback', total_feedback,
        'confirmed', confirmed,
        'edited', edited,
        'ignored', ignored,
        'decided', confirmed + edited,
        'confirmationRate', case
          when confirmed + edited > 0 then round(confirmed::numeric * 100 / (confirmed + edited), 1)
          else 0
        end,
        'correctionRate', case
          when confirmed + edited > 0 then round(edited::numeric * 100 / (confirmed + edited), 1)
          else 0
        end,
        'contributingUsers', contributing_users,
        'domains', domains
      )
      from totals
    ),
    'dailyStats', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', trend.day::text,
          'confirmed', coalesce(day_counts.confirmed, 0),
          'edited', coalesce(day_counts.edited, 0),
          'ignored', coalesce(day_counts.ignored, 0)
        )
        order by trend.day
      )
      from trend_days trend
      left join lateral (
        select
          count(*) filter (where action = 'confirmed')::bigint as confirmed,
          count(*) filter (where action = 'edited')::bigint as edited,
          count(*) filter (where action = 'ignored')::bigint as ignored
        from filtered
        where created_at >= (trend.day::timestamp at time zone 'UTC')
          and created_at < ((trend.day + 1)::timestamp at time zone 'UTC')
      ) day_counts on true
    ), '[]'::jsonb),
    'fieldQuality', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'domain', domain,
          'semanticKey', semantic_key,
          'totalFeedback', total_feedback,
          'confirmed', confirmed,
          'edited', edited,
          'ignored', ignored,
          'correctionRate', case
            when confirmed + edited > 0 then round(edited::numeric * 100 / (confirmed + edited), 1)
            else 0
          end
        )
        order by case when confirmed + edited > 0 then edited::numeric / (confirmed + edited) else 0 end desc,
          edited desc, total_feedback desc, domain, semantic_key
      )
      from (
        select *
        from field_quality
        where total_feedback > 0
        order by case when confirmed + edited > 0 then edited::numeric / (confirmed + edited) else 0 end desc,
          edited desc, total_feedback desc, domain, semantic_key
        limit 12
      ) ranked_fields
    ), '[]'::jsonb),
    'templateQuality', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'domainPattern', domain_pattern,
          'atsType', ats_type,
          'semanticKey', semantic_key,
          'usageCount', usage_count,
          'correctionCount', correction_count,
          'correctionRate', round(correction_count::numeric * 100 / usage_count, 1)
        )
        order by correction_count::numeric / usage_count desc, correction_count desc, usage_count desc,
          domain_pattern, semantic_key
      )
      from (
        select *
        from template_quality
        order by correction_count::numeric / usage_count desc, correction_count desc, usage_count desc,
          domain_pattern, semantic_key
        limit 12
      ) ranked_templates
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_admin_prefill_quality(timestamptz, timestamptz) from public;
grant execute on function public.get_admin_prefill_quality(timestamptz, timestamptz) to service_role;

commit;
