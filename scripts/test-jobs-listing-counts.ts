import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { targetRegionIlikePatterns, targetRegionPostgrestClauses, targetRegionSearchPatterns } from '../src/lib/job-region-scope';

const patterns = targetRegionIlikePatterns();
assert.ok(patterns.length > 80, `expected a full target-region pattern list, got ${patterns.length}`);
assert.deepEqual(targetRegionSearchPatterns(), patterns);

const clauses = targetRegionPostgrestClauses();
assert.equal(clauses.length, patterns.length);
for (const [index, pattern] of patterns.entries()) {
  const keyword = pattern.slice(1, -1).replace(/\\([\\%_])/g, '$1');
  assert.equal(clauses[index], `region.ilike.%${keyword.replace(/[\\%_,()]/g, (character) => `\\${character}`)}%`);
}

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/0126_target_region_company_options.sql'),
  'utf8',
);
assert.match(migration, /job_region_matches_target\(jobs\.region\)/);
assert.match(migration, /create or replace function public\.list_active_company_options\(\)/);

for (const pattern of patterns) {
  const sqlLiteral = `'${pattern.replace(/'/g, "''")}'`;
  assert.ok(migration.includes(sqlLiteral), `migration missing ${sqlLiteral}`);
}

const sqlPatterns = [...migration.matchAll(/'(%[^']+%)'/g)].map((match) => match[1]);
assert.deepEqual([...new Set(sqlPatterns)], patterns);

const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/jobs/route.ts'), 'utf8');
assert.match(route, /count: 'exact'/);
assert.doesNotMatch(route, /count: 'planned'/);
assert.match(route, /total_is_estimate: false/);
assert.match(route, /matches_target_region/);
assert.doesNotMatch(route, /targetRegionPostgrestClauses\(/);
const indexedScope = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/0127_jobs_target_region_index.sql'),
  'utf8',
);
assert.match(indexedScope, /jobs_target_active_feed_idx/);
assert.match(indexedScope, /jobs_sync_matches_target_region/);
assert.match(indexedScope, /jobs\.matches_target_region/);
assert.doesNotMatch(indexedScope, /array_agg\(/);

console.log(`jobs listing count contract ok (${patterns.length} target-region patterns)`);
