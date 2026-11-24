import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { configuredRegionListingFilter, targetRegionIlikePatterns, targetRegionPostgrestClauses, targetRegionSearchPatterns } from '../src/lib/job-region-scope';

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
assert.match(route, /count: 'planned'/);
assert.match(route, /total_is_estimate: true/);
assert.match(route, /matches_target_region/);
assert.match(route, /targetRegionPostgrestClauses\(/);
const indexedScope = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/0127_jobs_target_region_index.sql'),
  'utf8',
);
assert.match(indexedScope, /jobs_target_active_feed_idx/);
assert.match(indexedScope, /jobs_sync_matches_target_region/);
assert.match(indexedScope, /jobs\.matches_target_region/);
assert.doesNotMatch(indexedScope, /array_agg\(/);

// Market filters must collapse into one indexed equality predicate instead of
// dozens of region ILIKE clauses that forced a sequential scan + exact count.
assert.deepEqual(configuredRegionListingFilter([]), null);
assert.deepEqual(configuredRegionListingFilter(['北美']), { column: 'region_group', value: 'north_america' });
assert.deepEqual(configuredRegionListingFilter(['美国']), { column: 'region_market', value: 'us' });
assert.deepEqual(configuredRegionListingFilter(['英国']), { column: 'region_market', value: 'uk' });
assert.equal(configuredRegionListingFilter(['北美', '美国']), null, 'mixed columns must fall back to ILIKE');
assert.equal(configuredRegionListingFilter(['自定义地区']), null, 'unknown configuration values must fall back to ILIKE');

const marketFilters = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/0134_jobs_listing_market_filters.sql'),
  'utf8',
);
assert.match(marketFilters, /create or replace view public\.jobs_listing/);
assert.match(marketFilters, /security_invoker = true/);
assert.match(marketFilters, /jobs_active_market_feed_idx/);
assert.match(marketFilters, /jobs_active_region_group_feed_idx/);
assert.match(marketFilters, /jobs_active_job_type_feed_idx/);
assert.match(marketFilters, /jobs_active_sponsorship_feed_idx/);
assert.match(marketFilters, /ai_match_region_scope/);
assert.match(marketFilters, /jobs\.matches_target_region/);
assert.doesNotMatch(marketFilters, /job_region_matches_target\(jobs\.region\)/);
assert.match(route, /jobs_listing/);
assert.match(route, /region_market/);
assert.match(route, /configuredRegionListingFilter/);
assert.match(route, /detectMissingStructure/);
assert.match(route, /retryable: true/);
assert.match(route, /display_status/);
assert.match(route, /\['listed', 'enriched'\]/);
assert.match(
  fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/0141_job_feed_v2_columns.sql'), 'utf8'),
  /jobs_active_display_status_idx/,
);

console.log(`jobs listing count contract ok (${patterns.length} target-region patterns)`);
