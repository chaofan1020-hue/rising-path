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

/**
 * Read-path index parity: jobs_v3 must keep the expression indexes the listing
 * query needs. Missing them made a filtered listing 12x slower (930ms vs 75ms),
 * so a restore or rebuild that drops them has to raise an alert before anyone
 * flips JOBS_READ_SOURCE=v3.
 */
assert.match(reconcile, /read_index_gaps/, 'watchdog must report v3 read index gaps');
assert.match(reconcile, /jobs_v3_active_market_created_idx/, 'watchdog must check the market index');
assert.match(reconcile, /jobs_v3_active_title_trgm_idx/, 'watchdog must check the trgm search index');
assert.match(reconcile, /v3_read_index_gaps_/, 'missing read indexes must produce an alert reason');

const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/0157_jobs_v3_read_indexes.sql'), 'utf8');
for (const name of [
  'jobs_v3_active_market_created_idx',
  'jobs_v3_active_market_feed_idx',
  'jobs_v3_active_region_group_created_idx',
  'jobs_v3_active_region_group_feed_idx',
  'jobs_v3_active_updated_created_id_idx',
  'jobs_v3_active_created_idx',
  'jobs_v3_target_active_created_idx',
  'jobs_v3_target_active_feed_idx',
  'jobs_v3_active_job_type_feed_idx',
  'jobs_v3_active_title_trgm_idx',
  'jobs_v3_active_company_trgm_idx',
]) {
  assert.ok(reconcile.includes(name), `watchdog must list ${name}`);
  assert.ok(migration.includes(name), `0157 must create ${name}`);
}

/** The evidence summarizer must flag a short clean streak instead of passing. */
const evidence = fs.readFileSync(path.join(process.cwd(), 'scripts/jobs-v3-evidence.sh'), 'utf8');
assert.match(evidence, /verdict=WAITING/);
assert.match(evidence, /clean_since=/);
assert.match(evidence, /verdict=PASS/);

/** The full-column audit must actually compare every shared column, not a sample. */
const audit = fs.readFileSync(path.join(process.cwd(), 'scripts/jobs-v3-column-audit.sh'), 'utf8');
assert.match(audit, /information_schema\.columns/, 'audit must enumerate shared columns');
assert.match(audit, /table_name = 'jobs_v3'/, 'audit must target the shadow table');
assert.match(audit, /is distinct from/, 'audit must compare with is distinct from');
assert.match(audit, /raise exception 'jobs_v3 column mismatch/, 'audit must fail loudly on mismatch');
assert.match(audit, /docker exec -i /, 'audit feeds SQL through stdin, so docker exec needs -i');
assert.ok(
  !/DB="docker exec liorvix-supabase-db/.test(audit),
  'docker exec without -i swallows the SQL and reports a false OK',
);

/** The pre-cutover gate must cover every T-1 check and must never write. */
const precheck = fs.readFileSync(path.join(process.cwd(), 'scripts/jobs-v3-cutover-precheck.sh'), 'utf8');
for (const needle of [
  'missing_evidence',
  'read_index_gaps',
  'jobs-v3-column-audit.sh',
  'job_sync_failures',
  'jobs-v3-evidence.sh',
  'VERDICT READY_TO_CUT_OVER',
  'VERDICT NOT_READY',
]) {
  assert.ok(precheck.includes(needle), `precheck must check ${needle}`);
}
assert.ok(!/\b(update|insert|delete|alter|drop)\b/i.test(precheck.replace(/^#.*$/gm, '')), 'precheck must stay read-only');

console.log('jobs v3 watchdog tests passed');
