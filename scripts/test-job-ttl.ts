import assert from 'node:assert/strict';
import { shouldMarkStale, type TtlCandidate } from '@/lib/job-ttl-worker';

const now = Date.parse('2026-11-24T12:00:00Z');

function candidate(overrides: Partial<TtlCandidate> = {}): TtlCandidate {
  return {
    id: 1,
    last_seen_at: '2026-11-24T11:00:00Z',
    source_tier: 'S',
    display_status: 'listed',
    valid_through: null,
    is_active: true,
    is_closed: false,
    ...overrides,
  };
}

async function main() {
  assert.equal(shouldMarkStale(candidate({ last_seen_at: '2026-11-23T13:00:00Z' }), now), false, 'S 23h listed');
  assert.equal(shouldMarkStale(candidate({ last_seen_at: '2026-11-23T11:00:00Z' }), now), true, 'S 25h stale');
  assert.equal(shouldMarkStale(candidate({ source_tier: 'B', last_seen_at: '2026-11-17T13:00:00Z' }), now), false, 'B 7d-1h');
  assert.equal(shouldMarkStale(candidate({ source_tier: 'B', last_seen_at: '2026-11-16T11:00:00Z' }), now), true, 'B 8d stale');
  assert.equal(shouldMarkStale(candidate({ display_status: 'manual_hold', last_seen_at: '2020-01-01T00:00:00Z' }), now), false, 'manual hold');
  assert.equal(shouldMarkStale(candidate({ valid_through: '2027-01-01T00:00:00Z', last_seen_at: '2020-01-01T00:00:00Z' }), now), false, 'valid through');
  assert.equal(shouldMarkStale(candidate({ is_closed: true, last_seen_at: '2020-01-01T00:00:00Z' }), now), false, 'closed untouched');
  console.log('job-ttl: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});