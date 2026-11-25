import assert from 'node:assert/strict';
import { describeJobFeedFreshness } from '../src/lib/job-feed-freshness';

const now = Date.parse('2026-11-25T04:20:00.000Z');
const state = (success: string | null, updated = '2026-11-25T04:19:00.000Z', failures = 0) => ({
  last_incremental_success_at: success,
  updated_at: updated,
  consecutive_failures: failures,
});

let result = describeJobFeedFreshness(state('2026-11-25T04:15:00.000Z'), now);
assert.equal(result.lag_minutes, 5);
assert.equal(result.stale, false);
assert.equal(result.catching_up, true);
assert.equal(result.healthy, true);

// A live cursor heartbeat must not hide a stale completed round.
result = describeJobFeedFreshness(state('2026-11-24T15:39:44.000Z'), now);
assert.equal(result.lag_minutes, 760.3);
assert.equal(result.stale, true);
assert.equal(result.catching_up, true);
assert.equal(result.healthy, false);

result = describeJobFeedFreshness(state(null), now);
assert.equal(result.lag_minutes, null);
assert.equal(result.stale, true);
assert.equal(result.healthy, false);

result = describeJobFeedFreshness(state('2026-11-25T04:15:00.000Z', '2026-11-25T04:19:00.000Z', 2), now);
assert.equal(result.stale, false);
assert.equal(result.healthy, false);

// A missing/old heartbeat is not catch-up.
result = describeJobFeedFreshness(state('2026-11-25T04:15:00.000Z', '2026-11-25T03:00:00.000Z'), now);
assert.equal(result.catching_up, false);
assert.equal(result.healthy, true);

// `caught_up_at` is the completion proof; `last_page_at` is only liveness.
result = describeJobFeedFreshness({
  last_incremental_success_at: '2026-11-25T04:15:00.000Z',
  caught_up_at: '2026-11-25T03:15:00.000Z',
  last_page_at: '2026-11-25T04:19:00.000Z',
  updated_at: '2026-11-25T03:00:00.000Z',
  consecutive_failures: 0,
}, now);
assert.equal(result.lag_minutes, 65);
assert.equal(result.heartbeat_age_minutes, 1);
assert.equal(result.stale, true);
assert.equal(result.healthy, false);

console.log('job-feed-freshness: ok');