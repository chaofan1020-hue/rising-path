import assert from 'node:assert/strict';
import { hasFeedCloseSignal, isClosedItem, normalizeFeedItem, normalizeFeedLocation } from '@/lib/jobs-feed';
import { isTargetRegion } from '@/lib/job-region-scope';

assert.equal(normalizeFeedLocation({ city: 'San Francisco', state: 'CA', country: 'US' }), 'San Francisco, CA, US');
assert.equal(normalizeFeedLocation([{ city: 'London' }, { city: 'New York' }]), 'London, New York');
assert.equal(isTargetRegion('Singapore', 'Singapore'), true);
assert.equal(isTargetRegion('Berlin', 'Germany'), false);
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
})?.region, 'Remote, United States, Remote');
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
})?.region, 'Distributed; Hybrid, Toronto, Toronto, Ontario, Canada, Distributed');
assert.equal(normalizeFeedItem({
  id: 'generic-or-location',
  external_job_id: 'generic-or-location',
  company_name: 'Example',
  title: 'Product Designer',
  source_url: 'https://boards.greenhouse.io/example/jobs/333',
  location: 'Hybrid or Remote',
  country: 'Hybrid or Remote',
  offices: [{ name: 'Toronto', location: 'Toronto, Ontario, Canada' }],
})?.region, 'Hybrid or Remote, Toronto, Toronto, Ontario, Canada, Hybrid or Remote');
console.log('jobs feed location tests passed');
