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