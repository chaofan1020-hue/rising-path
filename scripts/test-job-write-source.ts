/**
 * Contract tests for the v3 write switch (plan C3).
 *
 * The read switch already moved the catalogue to `jobs_v3`. This one moves the
 * writes there, and it may only be flipped once *every* job write follows it
 * and nothing writes to the old table behind its back — otherwise the shadow
 * tables diverge and the 7-day rollback promise in the design doc is void.
 *
 * Run: npx tsx scripts/test-job-write-source.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { jobDeleteTables, jobWriteIsV3, jobWriteTable } from '../src/lib/job-write-source';

// 1) Env contract: the default and the rollback both stay on the old table.
assert.equal(jobWriteTable({}), 'jobs');
assert.equal(jobWriteTable({ JOBS_WRITE_SOURCE: '' }), 'jobs');
assert.equal(jobWriteTable({ JOBS_WRITE_SOURCE: 'jobs' }), 'jobs');
assert.equal(jobWriteTable({ JOBS_WRITE_SOURCE: ' Jobs ' }), 'jobs');
assert.equal(jobWriteTable({ JOBS_WRITE_SOURCE: 'v3' }), 'jobs_v3');
assert.equal(jobWriteTable({ JOBS_WRITE_SOURCE: ' JOBS_V3 ' }), 'jobs_v3');
assert.equal(jobWriteIsV3({}), false);
assert.equal(jobWriteIsV3({ JOBS_WRITE_SOURCE: 'v3' }), true);

// The read flag must never influence the write target: they are independent.
assert.equal(jobWriteTable({ JOBS_READ_SOURCE: 'v3' }), 'jobs');

// 2) Deletes. The reverse shadow deliberately does not mirror DELETE, so while
//    both tables exist a delete has to be issued to both.
assert.deepEqual(jobDeleteTables({}), ['jobs']);
assert.deepEqual(jobDeleteTables({ JOBS_WRITE_SOURCE: 'v3' }), ['jobs_v3', 'jobs']);

// 3) Every write site on the job rows must go through jobWriteTable().
const writeSites: Record<string, number> = {
  'src/app/api/jobs/[id]/open/route.ts': 1,
  'src/app/api/jobs/[id]/route.ts': 3,
  'src/app/api/jobs/batch/route.ts': 1,
  'src/app/api/jobs/check-sponsor/route.ts': 1,
  'src/app/api/jobs/fetch-descriptions/route.ts': 1,
  'src/app/api/jobs/generate-descriptions/route.ts': 1,
  'src/app/api/jobs/generate-structured/route.ts': 1,
  'src/app/api/jobs/route.ts': 1,
  'src/app/api/jobs/sync-techmap/route.ts': 1,
  'src/lib/job-maintenance.ts': 3,
  'src/lib/job-sync-failure-worker.ts': 1,
  'src/lib/job-sync.ts': 4,
  'src/lib/job-ttl-worker.ts': 1,
  'src/lib/jobs-feed.ts': 2,
};

const HARDCODED_WRITE = /\.from\(\s*['"]jobs['"]\s*\)\s*\.?\s*\n?\s*\.(insert|update|upsert|delete)\s*\(/;

for (const [rel, expected] of Object.entries(writeSites)) {
  const source = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const routed = source.match(/\.from\(jobWriteTable\(\)\)/g)?.length ?? 0;
  assert.ok(
    routed >= expected,
    `${rel}: expected at least ${expected} write(s) through jobWriteTable(), found ${routed}`,
  );
  assert.ok(
    !HARDCODED_WRITE.test(source),
    `${rel}: a write still names public.jobs directly`,
  );
  assert.ok(
    source.includes("from '@/lib/job-write-source'"),
    `${rel}: must import jobWriteTable from @/lib/job-write-source`,
  );
}

// 4) The two hard-delete paths must use jobDeleteTables(), not a single table.
for (const rel of ['src/app/api/jobs/[id]/route.ts', 'src/app/api/jobs/batch/route.ts']) {
  const source = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  assert.ok(
    source.includes('jobDeleteTables('),
    `${rel}: hard delete must iterate jobDeleteTables() so jobs_v3 and jobs agree`,
  );
}

// 5) Write-path modules must not follow the read switch (a read flip would then
//    silently redirect their upserts into the shadow table).
const writeModules = Object.keys(writeSites).filter((rel) => rel.startsWith('src/lib/'));
for (const rel of writeModules) {
  const source = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  assert.ok(!source.includes('jobReadTable'), `${rel}: writes must not follow JOBS_READ_SOURCE`);
}

// 6) The switch itself must read env lazily, so one restart can flip it.
const helper = fs.readFileSync(path.join(process.cwd(), 'src/lib/job-write-source.ts'), 'utf8');
assert.ok(helper.includes('env.JOBS_WRITE_SOURCE'), 'helper must read JOBS_WRITE_SOURCE per call');
assert.ok(!/const\s+\w+\s*=\s*process\.env\.JOBS_WRITE_SOURCE/.test(helper), 'helper must not capture the flag at module load');

console.log('job write source contract ok');