import assert from 'node:assert/strict';
import { getIncrementalSyncPolicy } from '../src/lib/job-feed-orchestrator';
import { getJobSyncWritePolicy } from '../src/lib/job-sync';

assert.deepEqual(getIncrementalSyncPolicy({}), {
  maxPages: 30,
  maxDurationMs: 240_000,
});

assert.deepEqual(getIncrementalSyncPolicy({
  JOBS_INCREMENTAL_MAX_PAGES: '45',
  JOBS_INCREMENTAL_MAX_DURATION_MS: '300000',
}), {
  maxPages: 45,
  maxDurationMs: 300_000,
});

assert.deepEqual(getJobSyncWritePolicy({}), {
  batchSize: 100,
  fallbackConcurrency: 8,
});

assert.deepEqual(getJobSyncWritePolicy({
  JOBS_SYNC_WRITE_BATCH_SIZE: '250',
  JOBS_SYNC_FALLBACK_WRITE_CONCURRENCY: '12',
}), {
  batchSize: 250,
  fallbackConcurrency: 12,
});

assert.deepEqual(getJobSyncWritePolicy({
  JOBS_SYNC_WRITE_BATCH_SIZE: '1000',
  JOBS_SYNC_FALLBACK_WRITE_CONCURRENCY: '99',
}), {
  batchSize: 500,
  fallbackConcurrency: 16,
});

assert.deepEqual(getIncrementalSyncPolicy({
  JOBS_INCREMENTAL_MAX_PAGES: '1000',
  JOBS_INCREMENTAL_MAX_DURATION_MS: '9999999',
}), {
  maxPages: 100,
  maxDurationMs: 600_000,
});

assert.deepEqual(getIncrementalSyncPolicy({
  JOBS_INCREMENTAL_MAX_PAGES: '0',
  JOBS_INCREMENTAL_MAX_DURATION_MS: '-1',
}), {
  maxPages: 30,
  maxDurationMs: 240_000,
});

console.log('job sync performance policy tests passed');
