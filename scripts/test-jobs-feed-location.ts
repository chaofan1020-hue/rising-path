import assert from 'node:assert/strict';
import { hasFeedCloseSignal, isClosedItem, normalizeFeedItem, normalizeFeedLocation, parseFeedPostedAt } from '@/lib/jobs-feed';
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
const mckinseyPayload = normalizeFeedItem({
  id: 'mckinsey-gateway-payload',
  external_job_id: '109017',
  company_name: 'McKinsey & Company',
  title: 'Senior Forward Deployed Engineer',
  source_url: 'https://mckinsey.avature.net/careers/ApplicationMethods?folderId=109017',
  location: 'Atlanta; Boston; New York City',
  country: 'United States',
  description: 'A public McKinsey gateway payload with an official job description.',
  employment_type: 'Full-time',
  source_evidence: {
    source_type: 'mckinsey',
    structured_field_sources: { employment_type: 'official_description' },
  },
});
assert.equal(mckinseyPayload?.location_source, 'official_payload');
assert.equal(mckinseyPayload?.employment_type, 'Full-time');
const mckinseyEvidence = mckinseyPayload?.field_evidence as {
  fields?: Record<string, { status?: string }>;
} | undefined;
assert.equal(mckinseyEvidence?.fields?.location?.status, 'verified');
assert.equal(mckinseyEvidence?.fields?.employment_type?.status, 'verified');
const amazonListing = normalizeFeedItem({
  id: 'amazon-listing-location',
  external_job_id: '10458264',
  company_name: 'Amazon',
  title: 'Applied Scientist',
  source_url: 'https://www.amazon.jobs/en/jobs/10458264/applied-scientist-aice-ai-center-of-excellence',
  location: 'CA, BC, Vancouver',
  country: 'Canada',
  source_type: 'amazon',
  source_evidence: { source_type: 'amazon', structured_field_sources: {} },
});
assert.equal(amazonListing?.region, 'CA, BC, Vancouver, Canada');
assert.equal(amazonListing?.location_source, 'official_payload');
const amazonEvidence = amazonListing?.field_evidence as {
  fields?: Record<string, { status?: string; source?: string }>;
} | undefined;
assert.equal(amazonEvidence?.fields?.location?.status, 'verified');
assert.equal(amazonEvidence?.fields?.location?.source, 'official_payload');
const amazonSourceTypeOnly = normalizeFeedItem({
  id: 'amazon-source-type-only',
  external_job_id: '3175108',
  company_name: 'Amazon',
  title: 'Sr Software Development Manager',
  source_url: 'https://www.amazon.jobs/en/jobs/3175108/sr-software-development-manager-compiler-aws-neuron-annapurna-labs',
  location: 'CA, ON, Toronto',
  country: 'Canada',
  source_type: 'amazon',
});
assert.equal(amazonSourceTypeOnly?.location_source, 'official_payload');
const appleListing = normalizeFeedItem({
  id: 'apple-listing-location',
  external_job_id: '200683390',
  company_name: 'Apple',
  title: 'Apple Pay eCommerce Merchant Specialist',
  source_url: 'https://jobs.apple.com/en-us/details/200683390/apple-pay-ecommerce-merchant-specialist',
  location: 'Austin',
  country: 'United States',
  source_type: 'apple',
  source_evidence: { source_type: 'apple', structured_field_sources: {} },
});
assert.equal(appleListing?.region, 'Austin, United States');
assert.equal(appleListing?.location_source, 'official_payload');
const appleEvidence = appleListing?.field_evidence as {
  fields?: Record<string, { status?: string; source?: string }>;
} | undefined;
assert.equal(appleEvidence?.fields?.location?.status, 'verified');
assert.equal(appleEvidence?.fields?.location?.source, 'official_payload');
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

const postedNow = Date.parse('2026-09-14T18:30:26.000Z');
assert.equal(parseFeedPostedAt('Posted Today', postedNow), '2026-09-14T18:30:26.000Z');
assert.equal(parseFeedPostedAt('Posted Yesterday', postedNow), '2026-09-13T18:30:26.000Z');
assert.equal(parseFeedPostedAt('Posted 14 Days Ago', postedNow), '2026-08-31T18:30:26.000Z');
assert.equal(parseFeedPostedAt('Posted more than 1 month ago', postedNow), '2026-08-15T18:30:26.000Z');
assert.equal(parseFeedPostedAt('Posted 1 month ago', postedNow), '2026-08-15T18:30:26.000Z');
assert.equal(parseFeedPostedAt('Wed, 27 Nov 2024 00:00:00 +0000', postedNow), '2024-11-27T00:00:00.000Z');
assert.equal(parseFeedPostedAt('August 17, 2026', postedNow), '2026-08-17T00:00:00.000Z');
assert.equal(parseFeedPostedAt('June  3, 2026', postedNow), '2026-06-03T00:00:00.000Z');
assert.equal(parseFeedPostedAt('2026-6-15', postedNow), '2026-06-15T00:00:00.000Z');
assert.equal(parseFeedPostedAt('17 August 2026', postedNow), '2026-08-17T00:00:00.000Z');
assert.equal(parseFeedPostedAt('Aug 17, 2026', postedNow), '2026-08-17T00:00:00.000Z');
assert.equal(parseFeedPostedAt('Sep 15, 2026', postedNow), '2026-09-15T00:00:00.000Z');
assert.equal(parseFeedPostedAt('2026-09-11T00:00:00.000+0000', postedNow), '2026-09-11T00:00:00.000Z');
assert.equal(parseFeedPostedAt('2026/08/17', postedNow), '2026-08-17T00:00:00.000Z');
assert.equal(parseFeedPostedAt('2026年8月17日', postedNow), '2026-08-17T00:00:00.000Z');
const unixSeconds = Math.floor(Date.parse('2025-08-17T00:00:00.000Z') / 1000);
assert.equal(parseFeedPostedAt(unixSeconds, postedNow), '2025-08-17T00:00:00.000Z');
assert.equal(parseFeedPostedAt(String(unixSeconds * 1000), postedNow), '2025-08-17T00:00:00.000Z');
assert.equal(parseFeedPostedAt('2026-11-21T00:00:00.000Z', postedNow), null);
assert.equal(parseFeedPostedAt('not a date', postedNow), null);
const amazonPosted = normalizeFeedItem({
  id: 'amazon-posted-date',
  external_job_id: 'amazon-posted-date',
  company_name: 'Amazon',
  title: 'Software Development Engineer',
  source_url: 'https://www.amazon.jobs/en/jobs/123',
  location: 'Seattle, WA, United States',
  country: 'United States',
  date_posted: 'August 17, 2026',
  source_type: 'amazon',
});
assert.equal(amazonPosted?.posted_at, '2026-08-17T00:00:00.000Z');
assert.equal(amazonPosted?.feed_has_date_posted, true);
assert.equal(normalizeFeedItem({
  id: 'missing-posted-date',
  external_job_id: 'missing-posted-date',
  company_name: 'Amazon',
  title: 'Software Development Engineer',
  source_url: 'https://www.amazon.jobs/en/jobs/124',
  location: 'Seattle, WA, United States',
  country: 'United States',
  source_type: 'amazon',
})?.feed_has_date_posted, false);
console.log('jobs feed location tests passed');
