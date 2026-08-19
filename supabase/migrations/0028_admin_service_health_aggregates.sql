begin;

-- Service health is derived from recorded calls and synchronization state.
-- It does not make network probes or expose request contents/error messages.
create index if not exists ai_usage_events_health_idx
  on public.ai_usage_events(created_at desc, provider, feature, status);

create or replace function public.get_admin_service_health(
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
  filtered_events as materialized (
    select provider, feature, status, duration_ms, created_at
    from public.ai_usage_events
    where created_at >= p_from and created_at < p_to
  ),
  provider_health as materialized (
    select
      provider,
      count(*)::bigint as call_count,
      count(*) filter (where status = 'success')::bigint as successful_calls,
      count(*) filter (where status = 'error')::bigint as failed_calls,
      round(avg(duration_ms) filter (where duration_ms is not null), 0)::bigint as average_duration_ms,
      max(created_at) as last_call_at
    from filtered_events
    group by provider
  ),
  feature_failures as materialized (
    select
      provider,
      feature,
      count(*) filter (where status = 'error')::bigint as failed_calls,
      count(*)::bigint as call_count,
      max(created_at) as last_call_at
    from filtered_events
    group by provider, feature
  )
  select jsonb_build_object(
    'overview', jsonb_build_object(
      'callCount', (select count(*)::bigint from filtered_events),
      'successfulCalls', (select count(*) filter (where status = 'success')::bigint from filtered_events),
      'failedCalls', (select count(*) filter (where status = 'error')::bigint from filtered_events),
      'providersWithCalls', (select count(*)::bigint from provider_health),
      'lastCallAt', (select max(created_at) from filtered_events)
    ),
    'providers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'provider', provider,
          'callCount', call_count,
          'successfulCalls', successful_calls,
          'failedCalls', failed_calls,
          'successRate', case when call_count > 0 then round(successful_calls::numeric * 100 / call_count, 1) else 0 end,
          'averageDurationMs', average_duration_ms,
          'lastCallAt', last_call_at,
          'status', case
            when call_count = 0 then 'unknown'
            when failed_calls::numeric / call_count >= 0.2 then 'degraded'
            when failed_calls > 0 then 'warning'
            else 'healthy'
          end
        )
        order by failed_calls desc, call_count desc, provider
      )
      from provider_health
    ), '[]'::jsonb),
    'failureHotspots', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'provider', provider,
          'feature', feature,
          'failedCalls', failed_calls,
          'callCount', call_count,
          'failureRate', case when call_count > 0 then round(failed_calls::numeric * 100 / call_count, 1) else 0 end,
          'lastCallAt', last_call_at
        )
        order by failed_calls desc, call_count desc, provider, feature
      )
      from (
        select *
        from feature_failures
        where failed_calls > 0
        order by failed_calls desc, call_count desc, provider, feature
        limit 12
      ) ranked_failures
    ), '[]'::jsonb),
    'jobSync', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'sourceSystem', source_system,
          'lastIncrementalSuccessAt', last_incremental_success_at,
          'lastReconcileSuccessAt', last_reconcile_success_at,
          'lastErrorAt', case when last_error is null then null else updated_at end,
          'consecutiveFailures', consecutive_failures,
          'syncInProgress', lease_expires_at is not null and lease_expires_at > now(),
          'updatedAt', updated_at,
          'status', case
            when lease_expires_at is not null and lease_expires_at > now() then 'running'
            when consecutive_failures > 0 then 'degraded'
            when last_incremental_success_at is null then 'unknown'
            when last_incremental_success_at < now() - interval '24 hours' then 'stale'
            else 'healthy'
          end
        )
        order by source_system
      )
      from public.job_sync_state
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_admin_service_health(timestamptz, timestamptz) from public;
grant execute on function public.get_admin_service_health(timestamptz, timestamptz) to service_role;

commit;
