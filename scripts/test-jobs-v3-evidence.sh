#!/bin/sh
# Fixture tests for scripts/jobs-v3-evidence.sh.
#
# The 24h evidence verdict is a stop line for cutting reads over to jobs_v3, so
# the summarizer itself needs a test: a bug here means "PASS" on dirty data, or
# a WAITING that never clears. This script builds synthetic reconcile logs with
# known timestamps and asserts the verdict, the counters and the exit code.
#
# POSIX sh + awk + GNU date are required, so run it on the Linux host (the
# Windows dev box has no sh/awk):
#   sh scripts/test-jobs-v3-evidence.sh
set -u

EVIDENCE=${1:-$(dirname "$0")/jobs-v3-evidence.sh}
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT
failures=0

ts() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }
now=$(date -u +%s)

clean_line() {
  printf '%s source_active=199211 v3_total=199250 ats=87288 legacy=111962 missing=0 extra=0 bad_ats_key=0 field_mismatches=0 inactive_shadow=39 missing_evidence=0 feed_age_minutes=2 consecutive_failures=0 row_failures=0 read_index_gaps=0\n' "$(ts "$1")"
}

# series <file> <hours_back> <step_minutes> [extra_line_count]
series() {
  file=$1
  hours=$2
  step=$3
  start=$((now - hours * 3600))
  t=$start
  while [ "$t" -le "$now" ]; do
    clean_line "$t" >>"$file"
    t=$((t + step * 60))
  done
}

check() {
  label=$1
  expected_exit=$2
  pattern=$3
  file=$4
  out=$(sh "$EVIDENCE" "$file" 24 2>&1)
  code=$?
  if [ "$code" -ne "$expected_exit" ]; then
    echo "FAIL $label exit=$code want=$expected_exit"
    echo "$out" | sed 's/^/    /'
    failures=$((failures + 1))
  elif ! printf '%s\n' "$out" | grep -q "$pattern"; then
    echo "FAIL $label missing pattern: $pattern"
    echo "$out" | sed 's/^/    /'
    failures=$((failures + 1))
  else
    echo "PASS $label"
  fi
}

# 1) A full clean window passes.
series "$DIR/clean.log" 25 5
check "clean_25h_pass" 0 'verdict=PASS' "$DIR/clean.log"

# 2) 12h of clean samples is not a 24h window.
series "$DIR/short.log" 12 5
check "short_window_waiting" 1 'verdict=WAITING reason=clean_streak_shorter_than_window' "$DIR/short.log"

# 3) One field-drift sample breaks the streak and restarts clean_since after it.
series "$DIR/drift.log" 25 5
mid=$(ts $((now - 20 * 3600)))
drift="$mid source_active=199211 v3_total=199250 ats=87288 legacy=111962 missing=0 extra=0 bad_ats_key=0 field_mismatches=3 inactive_shadow=39 missing_evidence=0 feed_age_minutes=2 consecutive_failures=0 row_failures=0 read_index_gaps=0"
printf '%s\n' "$drift" >>"$DIR/drift.log"
sort "$DIR/drift.log" >"$DIR/drift-sorted.log"
check "field_drift_breaks_streak" 1 'samples_breaking_streak=1' "$DIR/drift-sorted.log"

# 4) A stale feed sample (>15 min) also breaks the streak.
series "$DIR/stale.log" 25 5
stale=$(ts $((now - 22 * 3600)))
printf '%s source_active=199211 v3_total=199250 ats=87288 legacy=111962 missing=0 extra=0 bad_ats_key=0 field_mismatches=0 inactive_shadow=39 missing_evidence=0 feed_age_minutes=42 consecutive_failures=0 row_failures=0 read_index_gaps=0\n' "$stale" >>"$DIR/stale.log"
sort "$DIR/stale.log" >"$DIR/stale-sorted.log"
check "stale_feed_breaks_streak" 1 'max_feed_age_minutes=42.00' "$DIR/stale-sorted.log"

# 5) An ALERT line with clean metrics must fail, not wait.
cp "$DIR/clean.log" "$DIR/alert.log"
printf 'ALERT jobs v3 reconcile: unexpected 500 from postgrest\n' >>"$DIR/alert.log"
check "alert_line_fails" 1 'verdict=FAIL reason=alert_without_metric_break' "$DIR/alert.log"

# 6) No samples at all is NOT_READY with exit 2.
: >"$DIR/empty.log"
check "empty_log_not_ready" 2 'verdict=NOT_READY reason=no_samples_in_window' "$DIR/empty.log"

# 7) A pinned baseline excludes older bad samples: the 26h-old drift line is
#    outside the window, so the 24h-after-baseline series is clean and passes
#    with samples_breaking_streak=0 (that counter is what proves it was ignored).
series "$DIR/pinned.log" 25 5
bad=$(ts $((now - 26 * 3600)))
printf '%s source_active=199211 v3_total=199250 ats=87288 legacy=111962 missing=0 extra=0 bad_ats_key=0 field_mismatches=3 inactive_shadow=39 missing_evidence=0 feed_age_minutes=2 consecutive_failures=0 row_failures=0 read_index_gaps=0\n' "$bad" >>"$DIR/pinned.log"
sort "$DIR/pinned.log" >"$DIR/pinned-sorted.log"
out=$(sh "$EVIDENCE" "$DIR/pinned-sorted.log" 24 "$(ts $((now - 24 * 3600)))" 2>&1)
code=$?
if [ "$code" -ne 0 ] \
  || ! printf '%s\n' "$out" | grep -q 'verdict=PASS' \
  || ! printf '%s\n' "$out" | grep -q 'samples_breaking_streak=0'; then
  echo "FAIL pinned_baseline_ignores_old_bad exit=$code"
  echo "$out" | sed 's/^/    /'
  failures=$((failures + 1))
else
  echo "PASS pinned_baseline_ignores_old_bad"
fi

echo "---"
if [ "$failures" -eq 0 ]; then
  echo "jobs v3 evidence tests passed"
  exit 0
fi
echo "jobs v3 evidence tests FAILED failures=$failures"
exit 1