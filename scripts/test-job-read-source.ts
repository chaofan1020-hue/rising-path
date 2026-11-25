/**
 * Contract tests for the v3 read switch (plan R23 / 方案 A only).
 *
 * Cutting reads over to `jobs_v3` is only coherent if *every* user-facing read
 * goes through `jobReadTable()` and *no* write/worker path does. Otherwise the
 * flag moves the catalog to v3 while favorites, interviews or the AI matcher
 * keep reading `jobs` — and any shadow lag turns into two different answers.
 *
 * Run: npx tsx scripts/test-job-read-source.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { jobListingReadTable, jobReadTable } from '../src/lib/job-read-source';

// 1) Env contract: default and rollback both stay on the old tables.
assert.equal(jobReadTable({}), 'jobs');
assert.equal(jobReadTable({ JOBS_READ_SOURCE: '' }), 'jobs');
assert.equal(jobReadTable({ JOBS_READ_SOURCE: 'jobs' }), 'jobs');
assert.equal(jobReadTable({ JOBS_READ_SOURCE: 'v3' }), 'jobs_v3');
assert.equal(jobReadTable({ JOBS_READ_SOURCE: ' JOBS_V3 ' }), 'jobs_v3');
assert.equal(jobReadTable({ JOBS_READ_SOURCE: 'jobs_listing' }), 'jobs');
assert.equal(jobListingReadTable({}), 'jobs_listing');
assert.equal(jobListingReadTable({ JOBS_READ_SOURCE: 'v3' }), 'jobs_listing_v3');

// 2) User-facing reads must follow the switch.
const mustFollowSwitch = [
  'src/app/api/jobs/route.ts',
  'src/app/api/jobs/[id]/route.ts',
  'src/app/api/jobs/stats/route.ts',
  'src/app/api/jobs/companies/route.ts',
  'src/app/api/jobs/search-jd/route.ts',
  'src/app/api/favorites/route.ts',
  'src/app/api/applications/route.ts',
  'src/app/api/dashboard/route.ts',
  'src/app/api/personality/assessment/route.ts',
  'src/app/api/application/prefill/route.ts',
  'src/app/api/application/prefill-feedback/route.ts',
  'src/app/api/ai/match/route.ts',
  'src/app/api/ai/match/feedback/route.ts',
  'src/app/api/ai/optimize/route.ts',
  'src/app/api/ai/optimize/score/route.ts',
  'src/app/api/interview/chat/route.ts',
  'src/app/api/interview/jobs/route.ts',
  'src/app/api/interview/asr/route.ts',
  'src/lib/interview-asr-ws-server.ts',
  'src/lib/interview-tts-ws-server.ts',
];
for (const rel of mustFollowSwitch) {
  const source = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  assert.ok(
    source.includes('.from(jobReadTable())') || source.includes('from(jobListingReadTable())') || source.includes(': jobReadTable()'),
    `${rel} must read through jobReadTable() so the read switch is complete`,
  );
}

// 3) Writes and lifecycle workers must never follow the read switch: flipping
//    JOBS_READ_SOURCE=v3 must not redirect an upsert/update into the shadow table.
const mustStayOnWriteTable = [
  'src/lib/job-sync.ts',
  'src/lib/jobs-feed.ts',
  'src/lib/job-sync-failure-worker.ts',
  'src/lib/job-ttl-worker.ts',
  'src/lib/job-maintenance.ts',
  'src/lib/official-details-worker.ts',
  'src/lib/job-connectors/sync.ts',
  'src/app/api/jobs/batch/route.ts',
];
for (const rel of mustStayOnWriteTable) {
  const source = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  assert.ok(
    !source.includes('jobReadTable'),
    `${rel} writes or runs lifecycle maintenance; it must stay on public.jobs`,
  );
}

// The open/close route is mixed on purpose: it reads the job through the
// switch, but its close write must keep hitting public.jobs.
const openRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/jobs/[id]/open/route.ts'), 'utf8');
assert.ok(openRoute.includes('.from(jobReadTable())'), 'open route read must follow the switch');
assert.ok(/\.from\('jobs'\)\.update\(/.test(openRoute), 'open route close write must stay on public.jobs');

// 4) The switch itself must read env lazily, so one restart can flip it.
const helper = fs.readFileSync(path.join(process.cwd(), 'src/lib/job-read-source.ts'), 'utf8');
assert.ok(helper.includes("env.JOBS_READ_SOURCE"), 'helper must read JOBS_READ_SOURCE per call');
assert.ok(!/const\s+\w+\s*=\s*process\.env\.JOBS_READ_SOURCE/.test(helper), 'helper must not capture the flag at module load');

console.log('job read source contract ok');