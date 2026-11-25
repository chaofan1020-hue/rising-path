#!/bin/sh
# R19 evidence: summarize the v3 shadow reconciliation log.
#
# The 5-minute timer only proves "it ran". G2 needs proof that a full 24h window
# was clean: no coverage gap, no field drift, no missing closure evidence, no
# feed staleness, no row failures and no consecutive sync failures. This script
# condenses the log into one verdict line plus the worst values seen, and reports
# how long the current clean streak is, so the 24h report is one command.
#
# Usage: jobs-v3-evidence.sh [logfile] [window_hours] [since_utc]
#   since_utc (optional) pins the window start, which is what we use when a
#   monitoring defect invalidated earlier samples and the clean streak has to
#   restart from the fixed watchdog release.
# Exit: 0 = clean streak covers the whole window, 1 = a sample broke the streak,
#       2 = no samples in the window (not ready).
set -u

LOG_FILE=${1:-/var/log/liorvix-jobs-v3-reconcile.log}
WINDOW_HOURS=${2:-24}
SINCE_UTC=${3:-}

if [ ! -r "$LOG_FILE" ]; then
  echo "cannot read $LOG_FILE" >&2
  exit 2
fi

if [ -n "$SINCE_UTC" ]; then
  CUTOFF_UTC=$SINCE_UTC
else
  CUTOFF_UTC=$(date -u -d "-${WINDOW_HOURS} hours" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -v-"${WINDOW_HOURS}"H +%Y-%m-%dT%H:%M:%SZ)
fi

TZ=UTC awk -v cutoff="$CUTOFF_UTC" -v window="$WINDOW_HOURS" '
function field(line, key,   i, parts) {
  i = index(line, key "=")
  if (i == 0) return ""
  line = substr(line, i + length(key) + 1)
  split(line, parts, /[ \t]+/)
  return parts[1]
}
function epoch(ts) {
  return mktime(substr(ts, 1, 4) " " substr(ts, 6, 2) " " substr(ts, 9, 2) " " \
                substr(ts, 12, 2) " " substr(ts, 15, 2) " " substr(ts, 18, 2))
}
/^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z/ {
  ts = $1
  if (ts < cutoff) next
  samples++
  if (!first) { first = ts; streak_start = ts }
  last = ts
  last_epoch = epoch(ts)
  gap = field($0, "missing") + field($0, "extra") + field($0, "bad_ats_key") + field($0, "field_mismatches") + field($0, "missing_evidence")
  rf = field($0, "row_failures") + 0
  cf = field($0, "consecutive_failures") + 0
  age = field($0, "feed_age_minutes") + 0
  if (gap > 0) bad_gap++
  if (age > max_age) { max_age = age; max_age_at = ts }
  if (rf > max_rf) { max_rf = rf; max_rf_at = ts }
  if (cf > max_cf) max_cf = cf
  active = field($0, "source_active") + 0
  if (active > 0) last_active = active
  if (gap > 0 || rf > 0 || cf > 0 || age > 15) {
    broke++
    pending_reset = 1
  } else if (pending_reset) {
    streak_start = ts
    pending_reset = 0
  }
}
/^ALERT / { if (last != "" && last >= cutoff) { alerts++; if (last_epoch > 0) streak_start = last } }
END {
  printf "window_hours=%s samples=%d first=%s last=%s\n", window, samples, first, last
  if (samples == 0) {
    print "verdict=NOT_READY reason=no_samples_in_window"
    exit 2
  }
  clean_hours = (last_epoch - epoch(streak_start)) / 3600.0
  printf "last_source_active=%d max_feed_age_minutes=%.2f(%s) max_row_failures=%d(%s) max_consecutive_failures=%d\n", last_active, max_age, max_age_at, max_rf, max_rf_at, max_cf
  printf "samples_with_coverage_or_field_gap=%d alert_lines=%d samples_breaking_streak=%d\n", bad_gap, alerts, broke
  printf "clean_since=%s clean_hours=%.2f required_hours=%s\n", streak_start, clean_hours, window
  if (alerts > 0 && broke == 0) {
    print "verdict=FAIL reason=alert_without_metric_break"
    exit 1
  }
  if (pending_reset) {
    print "verdict=WAITING reason=last_sample_not_clean"
    exit 1
  }
  if (clean_hours + 0.09 < window + 0) {
    print "verdict=WAITING reason=clean_streak_shorter_than_window"
    exit 1
  }
  print "verdict=PASS"
}' "$LOG_FILE"