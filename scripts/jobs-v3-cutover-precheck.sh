#!/bin/sh
# Pre-cutover gate for switching reads from public.jobs to public.jobs_v3.
#
# Runs the T-1 checklist from docs/job-acquisition-v3-cutover-runbook.md and
# prints one PASS/FAIL line per check plus a final verdict. Read-only: it never
# writes to the database, never restarts the service and never flips a flag.
#
# Usage: sudo sh scripts/jobs-v3-cutover-precheck.sh [reconcile-log]
# Exit: 0 = every gate passed; 1 = at least one gate failed (do not cut over).
set -eu

LOG="${1:-/var/log/liorvix-jobs-v3-reconcile.log}"
DB="docker exec liorvix-supabase-db psql -U postgres -d postgres -At -F | -v ON_ERROR_STOP=1"
if [ "$(id -u)" -ne 0 ]; then
  DB="sudo -n $DB"
fi
failures=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; failures=$((failures + 1)); }

# 1) The 5-minute watchdog must report a clean, caught-up shadow table. Its last
#    line is the cheapest summary of counts, gaps, evidence coverage and lag.
line="$(tail -1 "$LOG" 2>/dev/null || true)"
if [ -z "$line" ]; then
  fail "reconcile_log_readable=$LOG"
else
  get() { printf '%s\n' "$line" | tr ' ' '\n' | grep -m1 "^$1=" | cut -d= -f2-; }
  checks="missing extra bad_ats_key field_mismatches missing_evidence consecutive_failures row_failures read_index_gaps"
  bad=""
  for key in $checks; do
    value="$(get "$key")"
    [ "$value" = "0" ] || bad="$bad $key=${value:-absent}"
  done
  if [ -n "$bad" ]; then
    fail "reconcile_invariants:$bad"
  else
    pass "reconcile_invariants all_zero"
  fi
  age="$(get feed_age_minutes)"
  # Cast to int without bc: awk is present everywhere psql is not needed.
  age_ok="$(printf '%s\n' "$age" | awk '{ print ($1 != "" && $1 + 0 < 15) ? "yes" : "no" }')"
  if [ "$age_ok" = "yes" ]; then
    pass "feed_age_minutes=$age"
  else
    fail "feed_age_minutes=${age:-absent}"
  fi
  active="$(get source_active)"
  v3_active="$($DB -c "select count(*) from public.jobs_v3 where is_active" 2>/dev/null || echo '')"
  if [ -n "$active" ] && [ "$active" = "$v3_active" ]; then
    pass "active_rows_match source=$active v3=$v3_active"
  else
    fail "active_rows_mismatch source=${active:-absent} v3=${v3_active:-absent}"
  fi
fi

# 2) Read indexes: without them the cutover is a 12x latency regression.
gaps="$(tail -1 "$LOG" 2>/dev/null | tr ' ' '\n' | grep -m1 '^read_index_gaps=' | cut -d= -f2-)"
[ "$gaps" = "0" ] && pass "read_index_gaps=0" || fail "read_index_gaps=${gaps:-absent}"

# 3) Full-column parity (56 shared columns), which the watchdog only samples.
if sh /opt/liorvix/scripts/jobs-v3-column-audit.sh >/tmp/precheck-audit.out 2>&1; then
  pass "column_audit $(tail -1 /tmp/precheck-audit.out)"
else
  fail "column_audit $(grep -m1 'mismatch' /tmp/precheck-audit.out || echo failed)"
fi

# 4) Write queue must be empty: a pending DLQ row at cutover becomes a write the
#    old table would have absorbed.
pending="$($DB -c "select count(*) from public.job_sync_failures where status='pending'" 2>/dev/null || echo '')"
[ "$pending" = "0" ] && pass "dlq_pending=0" || fail "dlq_pending=${pending:-absent}"

# 5) The 24h clean window must be complete. The evidence script exits 1 while the
#    streak is still shorter than the window, which is the honest pre-cutover state.
#    It is invoked through `sh` and checked with -f: the deployed copy is not +x.
EVIDENCE=/opt/liorvix/scripts/jobs-v3-evidence.sh
if [ -f "$EVIDENCE" ]; then
  if out="$(sh "$EVIDENCE" "$LOG" 24 2>&1)"; then
    pass "evidence_24h $(printf '%s\n' "$out" | grep -m1 '^verdict=')"
  else
    fail "evidence_24h $(printf '%s\n' "$out" | grep -m1 '^verdict=')"
  fi
else
  fail "evidence_script_missing=$EVIDENCE"
fi

echo "---"
if [ "$failures" -eq 0 ]; then
  echo "VERDICT READY_TO_CUT_OVER (reads only; writes still go to public.jobs)"
  exit 0
fi
echo "VERDICT NOT_READY failures=$failures"
exit 1