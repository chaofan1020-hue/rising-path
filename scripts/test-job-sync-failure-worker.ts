import assert from 'node:assert/strict';
import { buildJobSyncFailure } from '../src/lib/job-sync';

const base = {
  source_system: 'collector_feed',
  company: 'Intel',
  external_job_id: 'intel-456',
  source_url: 'https://jobs.example.com/intel-456',
  title: 'Platform Engineer',
};

const failure = buildJobSyncFailure(base, 'update', { message: 'temporary database error' });
assert.equal(failure.source_system, 'collector_feed');
assert.equal(failure.operation, 'update');
assert.equal(failure.error_message, 'temporary database error');
assert.match(failure.dedupe_key, /^[a-f0-9]{64}$/u);

const closeFailure = buildJobSyncFailure({ ...base, job_id: 123 }, 'close_sync_record', 'metadata unavailable');
assert.notEqual(closeFailure.dedupe_key, failure.dedupe_key);
assert.equal(closeFailure.payload.job_id, 123);
assert.equal(closeFailure.payload.description, undefined);

console.log('job sync failure worker policy tests passed');
