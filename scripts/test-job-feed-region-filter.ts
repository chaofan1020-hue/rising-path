/**
 * Contract tests for the region-filter switch (plan v3 / D2).
 *
 * The ATS feed used to discard every record outside the six target markets at
 * ingestion time. Plan v3 flips that off so the catalog can hold every region,
 * but the switch must stay opt-in: the default has to keep the historical
 * behavior so a config mistake can never silently change what is stored.
 *
 * Run: npx tsx scripts/test-job-feed-region-filter.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isTargetRegion,
  regionFilterDisabled,
  regionFilterMode,
} from '../src/lib/job-region-scope';
import { regionFilteredCountryKey } from '../src/lib/jobs-feed';

// 1) Mode parsing: unknown / empty / whitespace all fall back to `target`.
assert.equal(regionFilterMode({}), 'target');
assert.equal(regionFilterMode({ JOBS_FEED_REGION_FILTER: '' }), 'target');
assert.equal(regionFilterMode({ JOBS_FEED_REGION_FILTER: '   ' }), 'target');
assert.equal(regionFilterMode({ JOBS_FEED_REGION_FILTER: 'target' }), 'target');
assert.equal(regionFilterMode({ JOBS_FEED_REGION_FILTER: 'TARGET' }), 'target');
assert.equal(regionFilterMode({ JOBS_FEED_REGION_FILTER: 'all' }), 'all');
assert.equal(regionFilterMode({ JOBS_FEED_REGION_FILTER: ' ALL ' }), 'all');
assert.equal(regionFilterMode({ JOBS_FEED_REGION_FILTER: 'count' }), 'count');
assert.equal(regionFilterMode({ JOBS_FEED_REGION_FILTER: 'nonsense' }), 'target');
assert.equal(regionFilterDisabled({}), false);
assert.equal(regionFilterDisabled({ JOBS_FEED_REGION_FILTER: 'count' }), false);
assert.equal(regionFilterDisabled({ JOBS_FEED_REGION_FILTER: 'all' }), true);

// 2) The gate itself only matters for non-target regions.
assert.equal(isTargetRegion('New York, NY', 'United States'), true);
assert.equal(isTargetRegion('Bangalore', 'India'), false);
assert.equal(isTargetRegion('Paris', 'France'), false);
// Known ambiguity, documented rather than fixed here: the JS twin still reads a
// bare `IN` as Indiana, so "Bangalore, IN" is mis-kept. The SQL classifier in
// migration 0160 already disambiguates it via `([^a-z]|$)` plus the
// city-segment guard; D1's `count` histogram is what surfaces the residual.
assert.equal(isTargetRegion('Bangalore, IN', 'India'), true);

// 3) The ingestion gate must consult the switch in both places. `normalizeFeedItem`
//    drops the record and `normalizeSkipReason` labels it; if only one is guarded
//    the `count` mode histogram and the `all` mode diverge.
const feedSource = fs.readFileSync(path.join(process.cwd(), 'src/lib/jobs-feed.ts'), 'utf8');
assert.ok(
  /if \(!regionFilterDisabled\(\) && !isTargetRegion\(rawLocation, rawCountry\)\) return null;/.test(feedSource),
  'normalizeFeedItem must guard the region drop with regionFilterDisabled()',
);
assert.ok(
  /if \(!regionFilterDisabled\(\) && !isTargetRegion\(/.test(feedSource),
  'normalizeSkipReason must guard the region label with regionFilterDisabled()',
);
assert.ok(
  feedSource.includes('recordRegionFilteredCountry'),
  'count mode must record the discarded-country histogram',
);
assert.ok(
  feedSource.includes("if (skipReason === 'outside_target_region') recordRegionFilteredCountry(result, item);"),
  'the histogram must only be fed from the outside_target_region branch',
);

// 4) The histogram helper must classify by country, falling back to the last
//    location segment because feeds often publish only a city.
const keyOf = (item: Record<string, unknown>) => regionFilteredCountryKey(item as never);
assert.equal(keyOf({ country: 'India', location: 'Bangalore' }), 'india');
assert.equal(keyOf({ country: '', location: 'Paris, France' }), 'france');
assert.equal(keyOf({ country: '', location: 'Berlin' }), 'berlin');
assert.equal(keyOf({ country: '', location: '' }), '(empty)');

// 5) The orchestrator must aggregate the histogram and expose the active mode,
//    otherwise a multi-page reconcile pass loses the measurement.
const orchestrator = fs.readFileSync(path.join(process.cwd(), 'src/lib/job-feed-orchestrator.ts'), 'utf8');
assert.ok(orchestrator.includes('region_filtered_by_country'), 'orchestrator must merge the histogram');
assert.ok(orchestrator.includes('region_filter_mode'), 'orchestrator must carry the active mode');

console.log('region filter contract ok');
