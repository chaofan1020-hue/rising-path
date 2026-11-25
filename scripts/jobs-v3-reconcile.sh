#!/bin/sh
# Read-only v3 shadow reconciliation and feed freshness watchdog.
# Runs from a systemd timer on the US host. It never writes job data.
# A mismatch/stale feed exits non-zero and, when JOBS_ALERT_WEBHOOK_URL is set,
# posts a generic JSON alert to that webhook.
set -eu

DB="docker exec liorvix-supabase-db psql -U postgres -d postgres -At -F | -v ON_ERROR_STOP=1"
if [ "$(id -u)" -ne 0 ]; then
  DB="sudo -n $DB"
fi

row="$($DB -c "
select
  (select count(*) from public.jobs where is_active),
  (select count(*) from public.jobs_v3),
  (select count(*) from public.jobs_v3 where lane = 'ats'),
  (select count(*) from public.jobs_v3 where lane = 'legacy'),
  (select count(*) from public.jobs j left join public.jobs_v3 v on v.id = j.id
    where j.is_active and v.id is null),
  (select count(*) from public.jobs_v3 v left join public.jobs j on j.id = v.id
    where v.is_active and j.id is null),
  (select count(*) from public.jobs_v3
    where lane = 'ats' and (source_key is null or external_job_id is null)),
  (select count(*) from public.jobs j join public.jobs_v3 v using(id)
    where j.is_active and (
      j.title is distinct from v.title or j.company is distinct from v.company
      or j.region is distinct from v.region or j.display_status is distinct from v.display_status
      or j.source_key is distinct from v.source_key or j.job_url is distinct from v.job_url
      or j.apply_url is distinct from v.apply_url or j.is_active is distinct from v.is_active
    )),
  (select count(*) from public.jobs_v3 where not is_active),
  (select count(*) from public.jobs_v3
    where not is_active and (closure_evidence is null or closure_evidence = '{}'::jsonb)),
  (select coalesce(extract(epoch from now() - last_incremental_success_at) / 60, 9999)
    from public.job_sync_state where source_system = 'collector_feed'),
  (select coalesce(consecutive_failures, 0)
    from public.job_sync_state where source_system = 'collector_feed'),
  -- Only the collector feed run describes feed health. Official-detail and
  -- per-company enrichment runs share the table but routinely report a skipped
  -- row, and counting those here produced false ALERTs (2026-11-25).
  (select coalesce(r.row_failures, 0)
    from public.job_sync_runs r
    where r.source_system = 'collector_feed'
    order by r.id desc limit 1),
  -- Read-path index parity. jobs carried 39 read indexes while jobs_v3 had 7,
  -- and a filtered listing was 12x slower on the shadow table (930ms vs 75ms).
  -- 0157 mirrors them; this counts the critical ones so a restore or a future
  -- table rebuild cannot quietly lose them before JOBS_READ_SOURCE=v3.
  (select count(*) from (values
      ('jobs_v3_active_market_created_idx'),
      ('jobs_v3_active_market_feed_idx'),
      ('jobs_v3_active_region_group_created_idx'),
      ('jobs_v3_active_region_group_feed_idx'),
      ('jobs_v3_active_updated_created_id_idx'),
      ('jobs_v3_active_created_idx'),
      ('jobs_v3_target_active_created_idx'),
      ('jobs_v3_target_active_feed_idx'),
      ('jobs_v3_active_job_type_feed_idx'),
      ('jobs_v3_active_title_trgm_idx'),
      ('jobs_v3_active_company_trgm_idx')
    ) as req(name)
    where not exists (
      select 1 from pg_indexes i
      where i.schemaname = 'public' and i.tablename = 'jobs_v3' and i.indexname = req.name))
")"

IFS='|' read -r source_active v3_total ats legacy missing extra bad_ats_key field_mismatches inactive_shadow missing_evidence feed_age_minutes consecutive_failures row_failures read_index_gaps <<EOF
$row
EOF

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) source_active=$source_active v3_total=$v3_total ats=$ats legacy=$legacy missing=$missing extra=$extra bad_ats_key=$bad_ats_key field_mismatches=$field_mismatches inactive_shadow=$inactive_shadow missing_evidence=$missing_evidence feed_age_minutes=$feed_age_minutes consecutive_failures=$consecutive_failures row_failures=$row_failures read_index_gaps=$read_index_gaps"

reasons=""
if [ "$missing" -ne 0 ] || [ "$extra" -ne 0 ] || [ "$bad_ats_key" -ne 0 ] \
  || [ "$field_mismatches" -ne 0 ] || [ "$missing_evidence" -ne 0 ]; then
  reasons="$reasons v3_shadow_reconciliation_mismatch"
fi
max_age="${JOBS_FEED_ALERT_MAX_AGE_MINUTES:-15}"
if awk -v age="$feed_age_minutes" -v max="$max_age" 'BEGIN { exit !(age > max) }'; then
  reasons="$reasons feed_stale_${feed_age_minutes}_minutes"
fi
if [ "$consecutive_failures" -ne 0 ]; then
  reasons="$reasons feed_consecutive_failures_${consecutive_failures}"
fi
if [ "$row_failures" -ne 0 ]; then
  reasons="$reasons latest_run_row_failures_${row_failures}"
fi
if [ "$read_index_gaps" -ne 0 ]; then
  reasons="$reasons v3_read_index_gaps_${read_index_gaps}"
fi

if [ -n "$reasons" ]; then
  echo "ALERT$reasons" >&2
  payload="$(printf '{"event":"liorvix_jobs_v3_alert","reasons":"%s","source_active":%s,"v3_total":%s,"missing":%s,"extra":%s,"field_mismatches":%s,"feed_age_minutes":%s,"consecutive_failures":%s,"row_failures":%s}' \
    "$reasons" "$source_active" "$v3_total" "$missing" "$extra" "$field_mismatches" "$feed_age_minutes" "$consecutive_failures" "$row_failures")"
  if [ -n "${JOBS_ALERT_WEBHOOK_URL:-}" ] && command -v curl >/dev/null 2>&1; then
    if ! curl -fsS --max-time 10 -H 'Content-Type: application/json' -d "$payload" "$JOBS_ALERT_WEBHOOK_URL" >/dev/null; then
      echo "ALERT webhook delivery failed" >&2
    fi
  fi
  exit 1
fi