import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The v3 watchdog is the only automated proof that the shadow lane stays
 * consistent, so it must measure the right runs.
 *
 * `job_sync_runs` holds the ATS feed, per-company feed runs and the official
 * detail cycles. Official and per-company runs routinely report a skipped row
 * as a row failure; reading "the latest run of any kind" therefore raised
 * `latest_run_row_failures_1` alerts while the ATS feed itself was clean
 * (2026-11-25 06:30 and 07:05 UTC). Feed health must come from a
 * `collector_feed` run only.
 */
const reconcile = fs.readFileSync(path.join(process.cwd(), 'scripts/jobs-v3-reconcile.sh'), 'utf8');

const latestRunQuery = /select coalesce\(r?\.?row_failures, 0\)([\s\S]{0,200}?)order by r?\.?id desc limit 1/;
const match = reconcile.match(latestRunQuery);
assert.ok(match, 'watchdog must still read a latest run row_failures value');
assert.match(match[0], /where r\.source_system = 'collector_feed'/, 'row_failures must be scoped to collector_feed');
assert.ok(
  !/from public\.job_sync_runs order by id desc limit 1/.test(reconcile),
  'unscoped latest-run lookup must not come back',
);

/** Coverage and evidence thresholds drive the exit code, so keep them exact. */
assert.match(reconcile, /missing.*-ne 0/);
assert.match(reconcile, /field_mismatches.*-ne 0/);
assert.match(reconcile, /missing_evidence.*-ne 0/);
assert.match(reconcile, /JOBS_FEED_ALERT_MAX_AGE_MINUTES/);

/** The evidence summarizer must flag a short clean streak instead of passing. */
const evidence = fs.readFileSync(path.join(process.cwd(), 'scripts/jobs-v3-evidence.sh'), 'utf8');
assert.match(evidence, /verdict=WAITING/);
assert.match(evidence, /clean_since=/);
assert.match(evidence, /verdict=PASS/);

console.log('jobs v3 watchdog tests passed');
