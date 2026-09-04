import assert from 'node:assert/strict';
import {
  deriveCompanyStatus,
  derivePipelineStatus,
  isStale,
  normalizeCoverage,
} from '@/lib/job-sync-dashboard';

assert.equal(derivePipelineStatus({ sourceStatus: 'discovery_required' }), 'discovery_required');
assert.equal(derivePipelineStatus({ state: { lease_expires_at: new Date(Date.now() + 60_000).toISOString() } }), 'running');
assert.equal(derivePipelineStatus({ state: { last_success_at: new Date(Date.now() - 20 * 60_000).toISOString() }, stale: true }), 'stalled');
assert.equal(derivePipelineStatus({ state: { next_retry_at: new Date(Date.now() + 60_000).toISOString(), last_success_at: new Date().toISOString() } }), 'healthy');
assert.equal(derivePipelineStatus({ state: { next_retry_at: new Date(Date.now() - 60_000).toISOString(), last_success_at: new Date().toISOString() } }), 'retrying');
assert.equal(derivePipelineStatus({ state: { cursor: null, last_success_at: new Date().toISOString() } }), 'healthy');
assert.equal(isStale(new Date(Date.now() - 3 * 60 * 60_000).toISOString(), 2 * 60 * 60_000), true);

const coverage = normalizeCoverage({ verified: 4, pending_recheck: 2, rejected_legacy: 1, unavailable_on_official_source: 3 }, 10);
assert.equal(coverage.verified, 4);
assert.equal(coverage.pending_recheck, 2);
assert.equal(coverage.unavailable_on_official_source, 3);
assert.equal(coverage.verified_percent, 40);

assert.equal(deriveCompanyStatus({
  sourceStatus: 'source_family_identified',
  feedStatus: 'healthy',
  officialStatus: 'healthy',
  pendingFields: 0,
  rejectedFields: 0,
  countMismatch: true,
}), 'attention');
assert.equal(deriveCompanyStatus({
  sourceStatus: 'source_family_identified',
  feedStatus: 'healthy',
  officialStatus: 'healthy',
  pendingFields: 0,
  rejectedFields: 0,
  countMismatch: false,
}), 'healthy');

console.log('job sync dashboard tests passed');
