import assert from 'node:assert/strict';
import {
  buildCompanySyncReport,
  deriveCompanyStatus,
  derivePipelineStatus,
  isStale,
  normalizeCoverage,
  type CompanySyncReportInput,
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

function report(overrides: Partial<CompanySyncReportInput>) {
  return buildCompanySyncReport({
    sourceStatus: 'configured_connector',
    feedStatus: 'healthy',
    officialStatus: 'healthy',
    pendingFields: 0,
    rejectedFields: 0,
    officialCount: 100,
    discoveredCount: 100,
    upstreamActiveJobs: 100,
    countReconciliationFresh: true,
    officialCountStatus: 'publisher_reported_complete',
    latestRunStatus: 'success',
    snapshotError: null,
    ...overrides,
  });
}

function codes(items: Array<{ code: string }>) {
  return items.map((item) => item.code);
}

assert.equal(deriveCompanyStatus({
  feedStatus: 'healthy',
  officialStatus: 'unknown',
}), 'healthy');
assert.equal(deriveCompanyStatus({
  feedStatus: 'healthy',
  officialStatus: 'healthy',
  coverageAttention: true,
}), 'attention');
assert.equal(deriveCompanyStatus({
  feedStatus: 'healthy',
  officialStatus: 'healthy',
  upstreamRunFailed: true,
}), 'failed');
assert.equal(deriveCompanyStatus({
  feedStatus: 'running',
  officialStatus: 'healthy',
  coverageAttention: true,
}), 'running');

const wells = report({
  officialCount: 1756,
  discoveredCount: 1754,
  upstreamActiveJobs: 1831,
  officialCountStatus: 'publisher_reported',
  latestRunStatus: 'partial',
  pendingFields: 12,
});
assert.equal(wells.actionable, true);
assert.equal(wells.status, 'attention');
assert.ok(codes(wells.reasons).includes('coverage_incomplete'));
assert.equal(codes(wells.reasons).includes('pending_fields'), false);
assert.ok(codes(wells.qualityNotes).includes('pending_fields'));
assert.match(wells.reasons[0].label, /1756/);
assert.match(wells.reasons[0].label, /未按这轮关岗/);

const fieldsOnly = report({ pendingFields: 40, rejectedFields: 2 });
assert.equal(fieldsOnly.actionable, false);
assert.equal(fieldsOnly.status, 'healthy');
assert.deepEqual(codes(fieldsOnly.qualityNotes), ['pending_fields', 'rejected_fields']);

const oracle = report({ officialCount: 2248, discoveredCount: 2245, upstreamActiveJobs: 2245 });
assert.equal(oracle.actionable, false);
assert.equal(oracle.status, 'healthy');
assert.deepEqual(codes(oracle.qualityNotes), ['count_drift']);

const unverifiedGap = report({
  officialCountStatus: 'publisher_reported',
  officialCount: 110,
  discoveredCount: 100,
  upstreamActiveJobs: 100,
});
assert.equal(unverifiedGap.actionable, true);
assert.ok(codes(unverifiedGap.reasons).includes('coverage_incomplete'));

const failedRun = report({ latestRunStatus: 'failed', snapshotError: 'directory timeout' });
assert.equal(failedRun.status, 'failed');
assert.equal(failedRun.actionable, true);
assert.deepEqual(codes(failedRun.reasons), ['upstream_run_failed']);
assert.match(failedRun.reasons[0].label, /directory timeout/);

const extraListings = report({ officialCount: 1323, discoveredCount: 1447, upstreamActiveJobs: 1447 });
assert.equal(extraListings.actionable, false);
assert.deepEqual(codes(extraListings.qualityNotes), ['extra_listings']);

const unavailable = report({
  officialCountStatus: 'unavailable',
  officialCount: null,
  discoveredCount: null,
  upstreamActiveJobs: null,
  pendingFields: 0,
});
assert.equal(unavailable.actionable, false);
assert.equal(unavailable.status, 'healthy');
assert.deepEqual(unavailable.reasons, []);

const uninitialized = report({ officialStatus: 'unknown' });
assert.equal(uninitialized.actionable, false);
assert.equal(uninitialized.status, 'healthy');
assert.equal(codes(uninitialized.reasons).includes('official_uninitialized'), false);

const shortfall = report({ officialCount: 100, discoveredCount: 90, upstreamActiveJobs: 90 });
assert.equal(shortfall.actionable, true);
assert.equal(shortfall.status, 'attention');
assert.deepEqual(codes(shortfall.reasons), ['count_shortfall']);

const legacyFields = report({
  officialCountStatus: 'legacy',
  pendingFields: 3,
  officialCount: 10,
  discoveredCount: 10,
  upstreamActiveJobs: 10,
});
assert.equal(legacyFields.actionable, false);
assert.deepEqual(codes(legacyFields.qualityNotes), ['pending_fields']);

const retrying = report({ feedStatus: 'retrying' });
assert.equal(retrying.actionable, false);
assert.equal(retrying.status, 'healthy');

assert.equal(derivePipelineStatus({
  state: { next_retry_at: new Date(Date.now() - 60_000).toISOString(), last_success_at: new Date(Date.now() - 3 * 60 * 60_000).toISOString() },
  stale: true,
}), 'stalled');

const discoveredComplete = report({
  sourceStatus: 'discovery_required',
  officialCountStatus: 'complete_official_list',
  officialCount: 590,
  discoveredCount: 590,
  upstreamActiveJobs: 590,
});
assert.equal(discoveredComplete.actionable, false);
assert.equal(discoveredComplete.status, 'healthy');
assert.deepEqual(codes(discoveredComplete.reasons), []);
assert.ok(codes(discoveredComplete.qualityNotes).includes('detail_source_pending'));

const discoveredOpen = report({
  sourceStatus: 'discovery_required',
  officialCountStatus: 'unavailable',
  officialCount: null,
  discoveredCount: null,
  upstreamActiveJobs: null,
});
assert.equal(discoveredOpen.actionable, true);
assert.equal(discoveredOpen.status, 'discovery_required');
assert.deepEqual(codes(discoveredOpen.reasons), ['discovery_required']);

const capped = report({
  officialCountStatus: 'capped_unavailable',
  officialCount: null,
  discoveredCount: null,
  upstreamActiveJobs: null,
});
assert.equal(capped.actionable, true);
assert.match(capped.reasons.map((reason) => reason.label).join(' '), /上限/);

console.log('job sync dashboard tests passed');
