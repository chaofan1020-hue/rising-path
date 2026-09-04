import assert from 'node:assert/strict';
import {
  getOfficialDetailsRetryDelayMs,
  selectFairOfficialDetailsTargets,
  selectOfficialDetailsTargets,
  type OfficialDetailsScheduleState,
  type SourceTarget,
} from '../src/lib/official-details-worker';

const now = Date.parse('2026-08-31T00:00:00.000Z');
const targets: SourceTarget[] = [
  { family: 'workday', company: 'Recently Added', first_seen_id: 1 },
  { family: 'workday', company: 'Oldest Attempt', first_seen_id: 2 },
  { family: 'workday', company: 'High Priority', first_seen_id: 3 },
  { family: 'workday', company: 'Backoff', first_seen_id: 4 },
  { family: 'workday', company: 'Leased', first_seen_id: 5 },
];

function state(target: SourceTarget, patch: Partial<OfficialDetailsScheduleState> = {}): OfficialDetailsScheduleState {
  return {
    source_system: `official:${target.family}:${target.company}`,
    last_attempted_at: null,
    last_success_at: null,
    next_retry_at: null,
    priority: 0,
    lease_expires_at: null,
    consecutive_failures: 0,
    cursor: null,
    ...patch,
  };
}

function source(target: SourceTarget): string {
  return `official:${target.family}:${target.company}`;
}

const states = new Map<string, OfficialDetailsScheduleState>([
  [source(targets[0]), state(targets[0], { last_attempted_at: '2026-08-30T23:59:00.000Z' })],
  [source(targets[1]), state(targets[1], { last_attempted_at: '2026-08-30T23:00:00.000Z' })],
  [source(targets[2]), state(targets[2], { last_attempted_at: '2026-08-30T23:00:00.000Z', priority: 10 })],
  [source(targets[3]), state(targets[3], { next_retry_at: '2026-08-31T00:05:00.000Z', consecutive_failures: 2 })],
  [source(targets[4]), state(targets[4], { lease_expires_at: '2026-08-31T00:05:00.000Z' })],
]);

assert.deepEqual(
  selectFairOfficialDetailsTargets(targets, states, now, 3).map((target) => target.company),
  ['High Priority', 'Oldest Attempt', 'Recently Added'],
);
assert.deepEqual(
  selectFairOfficialDetailsTargets(targets, states, now + 6 * 60_000, 5).map((target) => target.company),
  ['Backoff', 'Leased', 'High Priority', 'Oldest Attempt', 'Recently Added'],
);
assert.equal(getOfficialDetailsRetryDelayMs(1), 60_000);
assert.equal(getOfficialDetailsRetryDelayMs(2), 5 * 60_000);
assert.equal(getOfficialDetailsRetryDelayMs(3), 30 * 60_000);
assert.equal(getOfficialDetailsRetryDelayMs(4), 2 * 60 * 60_000);
assert.equal(getOfficialDetailsRetryDelayMs(99), 2 * 60 * 60_000);

const focusTarget = targets[1];
const focusStates = new Map(states);
focusStates.set(source(focusTarget), state(focusTarget, { cursor: '123' }));
assert.deepEqual(
  selectOfficialDetailsTargets(targets, focusStates, now, 2, focusTarget.company).map((target) => target.company),
  ['Oldest Attempt', 'High Priority'],
);
focusStates.set(source(focusTarget), state(focusTarget, { cursor: null }));
assert.deepEqual(
  selectOfficialDetailsTargets(targets, focusStates, now, 2, focusTarget.company).map((target) => target.company),
  ['Oldest Attempt', 'High Priority'],
);

console.log('official details scheduler tests passed');
