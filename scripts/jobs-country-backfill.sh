#!/usr/bin/env bash
# Drive scripts/jobs-country-backfill.sql in 5,000-row batches (D4).
#
# Usage (on the production host, as the deploy user):
#   ./scripts/jobs-country-backfill.sh            # backfill everything
#   ./scripts/jobs-country-backfill.sh --dry-run  # coverage report only
#
# The SQL file updates `public.jobs_v3` in place, so this is safe to stop and
# re-run at any time; already-resolved rows are skipped.
set -euo pipefail

CONTAINER="${CONTAINER:-liorvix-supabase-db}"
DB="${DB:-postgres}"
SQL_FILE="${SQL_FILE:-$(dirname "$0")/jobs-country-backfill.sql}"
BATCHES_PER_CALL=1

psql_run() {
  sudo -n docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -X -v ON_ERROR_STOP=1 -v last_id="$1" -f - < "$SQL_FILE"
}

if [[ "${1:-}" == "--dry-run" ]]; then
  sudo -n docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -X -v ON_ERROR_STOP=1 \
    -c "select count(*) as active_total, count(country_code) as resolved, round(100.0*count(country_code)/nullif(count(*),0),2) as pct from public.jobs_v3 where is_active"
  exit 0
fi

last_id=0
total=0
round=0
while :; do
  round=$((round + 1))
  out=$(psql_run "$last_id")
  # The driver statement prints one row: "  last_id | updated"
  new_id=$(echo "$out" | awk -F'|' '/^ *[0-9]+ \|/ {gsub(/ /,"",$1); print $1}' | tail -1)
  updated=$(echo "$out" | awk -F'|' '/^ *[0-9]+ \|/ {gsub(/ /,"",$2); print $2}' | tail -1)
  if [[ -z "${new_id:-}" || -z "${updated:-}" ]]; then
    echo "could not parse batch output (round $round):" >&2
    echo "$out" >&2
    exit 1
  fi
  total=$((total + updated))
  if (( updated == 0 )); then
    echo "backfill complete after $round rounds, $total rows scanned"
    break
  fi
  if (( new_id <= last_id )); then
    echo "high-water mark did not advance ($last_id -> $new_id), stopping" >&2
    exit 1
  fi
  last_id=$new_id
  printf 'round %d: +%d rows (last_id=%d)\n' "$round" "$updated" "$last_id"
done

# Final coverage + unresolved report (the tail of the SQL file).
sudo -n docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -X -v ON_ERROR_STOP=1 \
  -v last_id="$last_id" -f - < "$SQL_FILE" >/dev/null
echo "coverage:"
sudo -n docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -X -v ON_ERROR_STOP=1 \
  -c "select count(*) as active_total, count(country_code) as resolved, round(100.0*count(country_code)/nullif(count(*),0),2) as pct from public.jobs_v3 where is_active"
