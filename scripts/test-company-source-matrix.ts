import assert from 'node:assert/strict';

function sourceStatus(sourceFamily: string, basis: string): string {
  if (basis === 'discovery_required') return 'discovery_required';
  if (basis === 'connector_registry') return 'configured_connector';
  return sourceFamily === 'missing_source_url' ? 'discovery_required' : 'source_family_identified';
}

assert.equal(sourceStatus('greenhouse', 'connector_registry'), 'configured_connector');
assert.equal(sourceStatus('workday', 'observed_official_host'), 'source_family_identified');
assert.equal(sourceStatus('official_custom_or_unclassified', 'discovery_required'), 'discovery_required');
assert.equal(sourceStatus('missing_source_url', 'discovery_required'), 'discovery_required');

const activeCompanies = ['Amazon', 'Intel', 'Intel'];
assert.deepEqual([...new Set(activeCompanies)], ['Amazon', 'Intel']);

console.log('company source matrix tests passed');
