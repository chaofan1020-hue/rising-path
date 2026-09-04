import assert from 'node:assert/strict';
import { buildJobSyncFailure } from '../src/lib/job-sync';
import { isValidFeedPage } from '../src/lib/jobs-feed';
import { shouldHoldJobFeedCursor } from '../src/lib/job-feed-orchestrator';

const identity = {
  source_system: 'collector_feed',
  company: 'Intel',
  external_job_id: 'intel-123',
  source_url: 'https://jobs.example.com/intel-123',
  title: 'Software Engineer',
};

const first = buildJobSyncFailure(identity, 'update', new Error('numeric field overflow'));
const second = buildJobSyncFailure(identity, 'update', new Error('different transient error'));
assert.equal(first.dedupe_key, second.dedupe_key);
assert.equal(first.payload.title, 'Software Engineer');
assert.equal('description' in first.payload, false);
assert.notEqual(
  first.dedupe_key,
  buildJobSyncFailure(identity, 'insert', 'insert failed').dedupe_key,
);

assert.equal(shouldHoldJobFeedCursor({ fatal_failures: 0 }), false);
assert.equal(shouldHoldJobFeedCursor({ fatal_failures: 1 }), true);

assert.equal(isValidFeedPage({ items: [], has_more: false }), true);
assert.equal(isValidFeedPage({ items: [], has_more: true, next_cursor: 'next-1' }), true);
assert.equal(isValidFeedPage({ items: {} }), false);
assert.equal(isValidFeedPage({ items: [], has_more: true }), false);

console.log('job sync failure policy tests passed');
