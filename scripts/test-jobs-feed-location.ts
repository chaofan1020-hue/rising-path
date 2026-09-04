import assert from 'node:assert/strict';
import { hasFeedCloseSignal, isClosedItem, normalizeFeedItem, normalizeFeedLocation } from '@/lib/jobs-feed';
import { isDisplayableJobDescription } from '@/lib/job-content';
import { isTargetRegion } from '@/lib/job-region-scope';

assert.equal(normalizeFeedLocation({ city: 'San Francisco', state: 'CA', country: 'US' }), 'San Francisco, CA, US');
assert.equal(normalizeFeedLocation([{ city: 'London' }, { city: 'New York' }]), 'London, New York');
assert.equal(isTargetRegion('Singapore', 'Singapore'), true);
assert.equal(isTargetRegion('Berlin', 'Germany'), false);
assert.equal(isTargetRegion('Albany, NY', 'NY'), true);
assert.equal(isTargetRegion('Morristown, NJ', 'NJ'), true);
assert.equal(isTargetRegion('Pittsburgh, PA', 'PA'), true);
assert.equal(hasFeedCloseSignal({ id: 'closed-by-action', sync_action: 'close' }), true);
assert.equal(hasFeedCloseSignal({ id: 'closed-by-status', status: 'closed' }), true);
assert.equal(hasFeedCloseSignal({ id: 'closed-at', closed_at: '2026-08-21T00:00:00Z' }), true);
assert.equal(isClosedItem({ id: 'closed-by-action', sync_action: 'close' }), true);
assert.equal(isClosedItem({ id: 'open', status: 'open' }), false);
assert.equal(normalizeFeedItem({
  id: 'global-market-role',
  external_job_id: 'global-market-role',
  company_name: 'Example',
  title: 'Platform Engineer',
  source_url: 'https://jobs.example.com/global-market-role',
  location: 'Berlin',
  country: 'Germany',
}), null);
assert.equal(normalizeFeedItem({
  id: 'generic-greenhouse-location',
  external_job_id: 'generic-greenhouse-location',
  company_name: 'Example',
  title: 'Platform Engineer',
  source_url: 'https://boards.greenhouse.io/example/jobs/123',
  location: { name: 'Hybrid' },
  offices: [{ name: 'New York, NY', location: 'New York, New York, United States' }],
})?.region, 'Hybrid, New York, NY, New York, New York, United States');
assert.equal(normalizeFeedItem({
  id: 'generic-ashby-location',
  external_job_id: 'generic-ashby-location',
  company_name: 'Example',
  title: 'Product Designer',
  source_url: 'https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000000',
  location: 'Remote',
  country: 'Remote',
  official_location: [{ country: 'United States' }],
})?.region, 'Remote, United States');
assert.equal(normalizeFeedItem({
  id: 'generic-ashby-non-target-location',
  external_job_id: 'generic-ashby-non-target-location',
  company_name: 'Example',
  title: 'Product Designer',
  source_url: 'https://jobs.ashbyhq.com/example/11111111-1111-1111-1111-111111111111',
  location: 'Remote',
  country: 'Remote',
  official_location: [{ country: 'Germany' }],
}), null);
assert.equal(normalizeFeedItem({
  id: 'generic-distributed-location',
  external_job_id: 'generic-distributed-location',
  company_name: 'Example',
  title: 'Product Designer',
  source_url: 'https://boards.greenhouse.io/example/jobs/222',
  location: 'Distributed; Hybrid',
  country: 'Distributed',
  offices: [{ name: 'Toronto', location: 'Toronto, Ontario, Canada' }],
})?.region, 'Distributed; Hybrid, Toronto, Toronto, Ontario, Canada');
assert.equal(normalizeFeedItem({
  id: 'generic-or-location',
  external_job_id: 'generic-or-location',
  company_name: 'Example',
  title: 'Product Designer',
  source_url: 'https://boards.greenhouse.io/example/jobs/333',
  location: 'Hybrid or Remote',
  country: 'Hybrid or Remote',
  offices: [{ name: 'Toronto', location: 'Toronto, Ontario, Canada' }],
})?.region, 'Hybrid or Remote, Toronto, Toronto, Ontario, Canada');
const verifiedFields = normalizeFeedItem({
  id: 'verified-fields',
  external_job_id: 'verified-fields',
  company_name: 'Example',
  title: 'Software Engineer',
  source_url: 'https://jobs.example.com/verified-fields',
  location: 'Toronto, Canada',
  country: 'Canada',
  salary_range: '$120,000 - $160,000 CAD',
  valid_through: '2026-10-31',
  employment_type: 'FullTime',
  workplace_type: 'Hybrid',
  source_evidence: {
    structured_field_sources: {
      salary_range: 'official_payload',
      valid_through: 'official_description',
      employment_type: 'official_payload',
      workplace_type: 'official_payload',
    },
  },
});
assert.equal(verifiedFields?.salary_range, '$120,000 - $160,000 CAD');
assert.equal(verifiedFields?.valid_through, '2026-10-31T23:59:59.999Z');
assert.equal(verifiedFields?.employment_type, 'FullTime');
assert.equal(verifiedFields?.region, 'Toronto, Canada');
assert.equal(isDisplayableJobDescription('A real job description with {context}.'), true);
assert.equal(isDisplayableJobDescription('{"source_type":"public_feed","structured_field_sources":{}}'), false);
assert.equal(normalizeFeedItem({
  id: 'evidence-only-description',
  external_job_id: 'evidence-only-description',
  company_name: 'Example',
  title: 'Software Engineer',
  source_url: 'https://jobs.example.com/evidence-only-description',
  location: 'Toronto, Canada',
  country: 'Canada',
  description: null,
  source_evidence: { source_type: 'public_feed', structured_field_sources: {} },
})?.description, null);
console.log('jobs feed location tests passed');
