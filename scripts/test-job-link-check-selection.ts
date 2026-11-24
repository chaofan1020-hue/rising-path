import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Regression guard for the link-check starvation bug.
 *
 * `job_sync_records` keeps a row for every retired job, and most of those rows
 * have a NULL `last_link_checked_at`. Selecting "the oldest unchecked rows"
 * without restricting them to active jobs therefore always returned the same
 * closed records, and the follow-up `jobs ... is_active=true` join produced an
 * empty candidate list: the routine reported `links_checked: 0` while dead
 * listings piled up. The selection must join `jobs` and filter `is_active` in
 * the same query that orders by `last_link_checked_at`.
 */
const maintenance = fs.readFileSync(path.join(process.cwd(), 'src/lib/job-maintenance.ts'), 'utf8');
assert.match(maintenance, /\.from\('job_sync_records'\)/);
assert.match(maintenance, /jobs!inner\(id\)/);
assert.match(maintenance, /\.eq\('jobs\.is_active', true\)/);
assert.match(maintenance, /\.order\('last_link_checked_at', \{ ascending: true, nullsFirst: true \}\)/);
assert.ok(
  maintenance.indexOf('.eq(\'jobs.is_active\', true)') < maintenance.indexOf('.limit(batchSize)'),
  'active-job filter must run before the batch limit',
);

/**
 * A 404 closes only on its second observation. The priority queue must select
 * active jobs whose last HTTP status was 404 and whose record is older than the
 * retry interval, so confirmations do not wait for a full scan cycle.
 */
assert.match(maintenance, /\.eq\('last_link_http_status', 404\)/);
assert.match(maintenance, /JOBS_LINK_CHECK_RETRY_MINUTES/);
assert.match(maintenance, /JOBS_LINK_CHECK_RETRY_BATCH/);
assert.ok(
  maintenance.indexOf('.eq(\'last_link_http_status\', 404)') > maintenance.indexOf('.limit(batchSize)'),
  'retry queue must be selected after the primary page',
);

/**
 * Ashby private boards return 404 for every posting HTML URL while the official
 * posting API still lists the job (verified 2026-11-24 with Saronic/Cursor,
 * where a 404-based sweep falsely closed 373 live jobs). A 404/410 from that
 * host must be classified as unverifiable, never as a close signal; lifecycle
 * follows upstream official close events instead.
 */
const linkHealth = fs.readFileSync(path.join(process.cwd(), 'src/lib/job-link-health.ts'), 'utf8');
assert.match(linkHealth, /JOBS_ASHBY_HTML_HOST|jobs\.ashbyhq\.com/);
assert.match(linkHealth, /export function isAshbyJobUrl/);
assert.match(maintenance, /isAshbyJobUrl\(job\.job_url\)/);
assert.match(maintenance, /ashbyHtmlUnverifiable \? false : shouldCloseAfterLinkFailure/);
assert.match(maintenance, /last_link_http_status: ashbyHtmlUnverifiable \? null/);

/**
 * jobs.apple.com serves the same client-side shell for live and removed roles,
 * so the page HTML can never be used as a closed signal. The official
 * jobDetails API is the only authoritative answer and its 404/410 must reach
 * the lifecycle classifier as a definitive removal instead of being swallowed
 * by the optional structured-data fallback.
 */
const externalFetch = fs.readFileSync(path.join(process.cwd(), 'src/lib/safe-external-fetch.ts'), 'utf8');
assert.match(externalFetch, /response\.statusCode === 404 \|\| response\.statusCode === 410/);
assert.match(externalFetch, /new ExternalFetchError\('Apple 官方岗位接口确认岗位已下架', 422, 410\)/);
assert.match(externalFetch, /if \(error instanceof ExternalFetchError && error\.upstreamStatus === 410\) throw error;/);

console.log('job link-check selection tests passed');