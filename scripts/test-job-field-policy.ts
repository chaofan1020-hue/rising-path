import assert from 'node:assert/strict';
import { normalizeFeedItem } from '../src/lib/jobs-feed';

const officialEvidence = {
  source_type: 'public_feed',
  structured_field_sources: {
    valid_through: 'official_payload',
    salary_range: 'official_payload',
    location: 'official_payload',
    official_location: 'official_payload',
    country: 'official_payload',
  },
};

const baseline = {
  id: 'test-role',
  external_job_id: 'test-role',
  company_name: 'Example Bank',
  title: 'Software Engineer',
  source_url: 'https://careers.example.com/jobs/test-role',
  location: 'New York, NY',
  country: 'United States',
  source_evidence: officialEvidence,
};

const valid = normalizeFeedItem({
  ...baseline,
  valid_through: '1792022400',
  salary_range: '$120,000 - $150,000 per year',
});
assert.ok(valid);
assert.equal(valid.valid_through, null);
assert.equal(valid.salary_range, '$120,000 - $150,000 per year');
assert.equal(valid.deadline_source, null);

const falseTimestamp = normalizeFeedItem({ ...baseline, valid_through: '1000000000' });
assert.ok(falseTimestamp);
assert.equal(falseTimestamp.valid_through, null);

const officialAtsDeadline = normalizeFeedItem({
  ...baseline,
  company_name: 'Robinhood',
  source_url: 'https://boards.greenhouse.io/robinhood/jobs/1234567',
  valid_through: '2026-09-12T14:29:37-04:00',
  source_evidence: {
    source_type: 'official_ats',
    structured_field_sources: { valid_through: 'official_payload' },
  },
});
assert.ok(officialAtsDeadline);
assert.equal(officialAtsDeadline.valid_through, '2026-09-12T18:29:37.000Z');
assert.equal(officialAtsDeadline.deadline_source, 'official_payload');

const invalidSalary = normalizeFeedItem({ ...baseline, salary_range: '0' });
assert.ok(invalidSalary);
assert.equal(invalidSalary.salary_range, null);

const currencyFreeSalary = normalizeFeedItem({ ...baseline, salary_range: '120000 per year' });
assert.ok(currencyFreeSalary);
assert.equal(currencyFreeSalary.salary_range, null);

const morganUntrustedHost = normalizeFeedItem({
  ...baseline,
  company_name: 'Morgan Stanley',
  source_url: 'https://example.com/job/20958',
  valid_through: '1792022400',
  salary_range: '$120,000 - $150,000 per year',
});
assert.ok(morganUntrustedHost);
assert.equal(morganUntrustedHost.valid_through, null);
assert.equal(morganUntrustedHost.salary_range, null);

const morganTalentGateway = normalizeFeedItem({
  ...baseline,
  company_name: 'Morgan Stanley',
  source_url: 'https://morganstanley.tal.net/vx/candidate/so/pm/1/pl/1/opp/20958',
  valid_through: '1792022400',
  salary_range: '$120,000 - $150,000 per year',
});
assert.ok(morganTalentGateway);
assert.equal(morganTalentGateway.valid_through, null);
assert.equal(morganTalentGateway.salary_range, '$120,000 - $150,000 per year');

const morganLocationFallback = normalizeFeedItem({
  ...baseline,
  company_name: 'Morgan Stanley',
  source_url: 'https://morganstanley.tal.net/vx/candidate/so/pm/1/pl/1/opp/20958',
  source_evidence: { source_type: 'public_feed', structured_field_sources: {} },
});
assert.ok(morganLocationFallback);
assert.equal(morganLocationFallback.location_source, 'official_payload');

console.log('job field policy tests passed');
