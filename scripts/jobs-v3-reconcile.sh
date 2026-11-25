#!/bin/sh
# Read-only v3 shadow reconciliation. Runs from a systemd timer on the US host.
# It never writes job data; a mismatch exits non-zero so journald/alerting sees it.
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
    where not is_active and (closure_evidence is null or closure_evidence = '{}'::jsonb));
")"

IFS='|' read -r source_active v3_total ats legacy missing extra bad_ats_key field_mismatches inactive_shadow missing_evidence <<EOF
$row
EOF

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) source_active=$source_active v3_total=$v3_total ats=$ats legacy=$legacy missing=$missing extra=$extra bad_ats_key=$bad_ats_key field_mismatches=$field_mismatches inactive_shadow=$inactive_shadow missing_evidence=$missing_evidence"

if [ "$missing" -ne 0 ] || [ "$extra" -ne 0 ] || [ "$bad_ats_key" -ne 0 ] \
  || [ "$field_mismatches" -ne 0 ] || [ "$missing_evidence" -ne 0 ]; then
  echo "ALERT v3 shadow reconciliation mismatch" >&2
  exit 1
fi