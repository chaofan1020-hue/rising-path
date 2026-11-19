import assert from 'node:assert/strict';
import { hasFeedCloseSignal, isClosedItem, normalizeFeedItem, normalizeFeedLocation, parseFeedPostedAt } from '@/lib/jobs-feed';
import { isDisplayableJobDescription } from '@/lib/job-content';
import { isTargetRegion } from '@/lib/job-region-scope';

assert.equal(normalizeFeedLocation({ city: 'San Francisco', state: 'CA', country: 'US' }), 'San Francisco, CA, US');
assert.equal(normalizeFeedLocation([{ city: 'London' }, { city: 'New York' }]), 'London, New York');
assert.equal(isTargetRegion('Singapore', 'Singapore'), true);
assert.equal(isTargetRegion('Americas', null), true);
assert.equal(isTargetRegion('ANZ', null), true);
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
const shopifyListing = normalizeFeedItem({
  id: 'bb323341-092c-4be6-b5f4-608fe66af833',
  external_job_id: 'bb323341-092c-4be6-b5f4-608fe66af833',
  company_name: 'Shopify',
  title: 'Account Executive, Existing Business',
  source_url: 'https://www.shopify.com/careers/account-executive-existing-business_bb323341-092c-4be6-b5f4-608fe66af833',
  location: 'Americas',
  description: 'A Shopify official careers description with more than three hundred characters of real role detail so the body is kept.',
  employment_type: 'FullTime',
  workplace_type: 'Remote',
  date_posted: '2026-09-08',
  source_type: 'shopify',
  source_evidence: {
    source_type: 'shopify',
    structured_field_sources: {
      location: 'official_payload',
      employment_type: 'official_payload',
      workplace_type: 'official_payload',
      date_posted: 'official_payload',
    },
  },
});
assert.equal(shopifyListing?.region, 'Americas');
assert.equal(shopifyListing?.location_source, 'official_payload');
assert.equal(shopifyListing?.employment_type, 'FullTime');
assert.equal(shopifyListing?.workplace_type, 'Remote');
assert.equal(shopifyListing?.posted_at, '2026-09-08T00:00:00.000Z');
const shopifyEvidence = shopifyListing?.field_evidence as {
  fields?: Record<string, { status?: string; source?: string }>;
} | undefined;
assert.equal(shopifyEvidence?.fields?.location?.status, 'verified');
assert.equal(shopifyEvidence?.fields?.workplace_type?.status, 'verified');
const airbnbListing = normalizeFeedItem({
  id: '8184174',
  external_job_id: '8184174',
  company_name: 'Airbnb',
  title: 'Account Manager',
  source_url: 'https://careers.airbnb.com/positions/8184174?gh_jid=8184174',
  location: 'London, United Kingdom',
  country: 'United Kingdom',
  description: 'An Airbnb official Greenhouse description with more than three hundred characters of real role detail so the body is kept for the public catalog.',
  workplace_type: 'Hybrid',
  date_posted: '2026-09-09T04:35:19-04:00',
  source_type: 'greenhouse',
  source_evidence: {
    source_type: 'official_ats',
    structured_field_sources: {
      location: 'official_payload',
      workplace_type: 'official_payload',
      date_posted: 'official_payload',
    },
  },
});
assert.equal(airbnbListing?.region, 'London, United Kingdom');
assert.equal(airbnbListing?.location_source, 'official_payload');
assert.equal(airbnbListing?.workplace_type, 'Hybrid');
assert.equal(airbnbListing?.posted_at, '2026-09-09T08:35:19.000Z');
const airbnbEvidence = airbnbListing?.field_evidence as {
  fields?: Record<string, { status?: string; source?: string }>;
} | undefined;
assert.equal(airbnbEvidence?.fields?.location?.status, 'verified');
assert.equal(airbnbEvidence?.fields?.workplace_type?.status, 'verified');
assert.equal(airbnbListing?.valid_through, null);
const lyftListing = normalizeFeedItem({
  id: '8792050002',
  external_job_id: '8792050002',
  company_name: 'Lyft',
  title: 'Account Manager, Automotive Vertical',
  source_url: 'https://app.careerpuck.com/job-board/lyft/job/8792050002?gh_jid=8792050002',
  location: 'New York, NY',
  country: 'United States',
  description: 'A Lyft official Greenhouse description with more than three hundred characters of real role detail so the body is kept for the public catalog.',
  date_posted: '2026-09-10T10:47:35-04:00',
  source_type: 'greenhouse',
  source_evidence: {
    source_type: 'official_ats',
    structured_field_sources: {
      location: 'official_payload',
      date_posted: 'official_payload',
    },
  },
});
assert.equal(lyftListing?.region, 'New York, NY, United States');
assert.equal(lyftListing?.location_source, 'official_payload');
assert.equal(lyftListing?.workplace_type, null);
assert.equal(lyftListing?.valid_through, null);
assert.equal(lyftListing?.posted_at, '2026-09-10T14:47:35.000Z');
const lyftEvidence = lyftListing?.field_evidence as {
  fields?: Record<string, { status?: string; source?: string }>;
} | undefined;
assert.equal(lyftEvidence?.fields?.location?.status, 'verified');
const uberListing = normalizeFeedItem({
  id: '149940',
  external_job_id: '149940',
  company_name: 'Uber',
  title: 'Engineering Manager - Inventory Prediction & Availability',
  source_url: 'https://iaziqy.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/UberCareers/job/149940',
  location: 'San Francisco, CA, United States',
  country: 'United States',
  description: 'An Uber official Oracle description with more than three hundred characters of real role detail so the body is kept for the public catalog.',
  employment_type: 'Full time',
  date_posted: '2026-09-15',
  source_type: 'oracle_hcm',
  source_evidence: {
    source_type: 'official_ats',
    structured_field_sources: {
      location: 'official_payload',
      employment_type: 'official_payload',
      date_posted: 'official_payload',
    },
  },
});
assert.equal(uberListing?.region, 'San Francisco, CA, United States');
assert.equal(uberListing?.location_source, 'official_payload');
assert.equal(uberListing?.employment_type, 'Full time');
assert.equal(uberListing?.workplace_type, null);
assert.equal(uberListing?.valid_through, null);
const uberEvidence = uberListing?.field_evidence as {
  fields?: Record<string, { status?: string; source?: string }>;
} | undefined;
assert.equal(uberEvidence?.fields?.location?.status, 'verified');
const ciscoListing = normalizeFeedItem({
  id: 'CISCISGLOBAL2016926EXTERNALENGLOBAL',
  external_job_id: 'CISCISGLOBAL2016926EXTERNALENGLOBAL',
  company_name: 'Cisco',
  title: 'Product Lifecycle Supply Chain Program Manager',
  source_url: 'https://careers.cisco.com/global/en/job/CISCISGLOBAL2016926EXTERNALENGLOBAL',
  location: 'San Jose, California, United States of America',
  country: 'United States of America',
  description: 'A Cisco official Phenom description with more than three hundred characters of real role detail so the body is kept for the public catalog. The application window is expected to close on: 10/15/2026 Job posting may be removed earlier if the position is filled.',
  employment_type: 'Full time',
  workplace_type: 'Hybrid',
  date_posted: '2026-09-01T00:00:00.000+0000',
  source_type: 'phenom',
  source_evidence: {
    source_type: 'official_ats',
    structured_field_sources: {
      location: 'official_payload',
      employment_type: 'official_payload',
      workplace_type: 'official_payload',
      date_posted: 'official_payload',
    },
  },
});
assert.equal(ciscoListing?.region, 'San Jose, California, United States of America');
assert.equal(ciscoListing?.location_source, 'official_payload');
assert.equal(ciscoListing?.employment_type, 'Full time');
assert.equal(ciscoListing?.workplace_type, 'Hybrid');
assert.equal(ciscoListing?.valid_through, '2026-10-15T23:59:59.999Z');
const ciscoEvidence = ciscoListing?.field_evidence as {
  fields?: Record<string, { status?: string; source?: string }>;
} | undefined;
assert.equal(ciscoEvidence?.fields?.location?.status, 'verified');
assert.equal(ciscoEvidence?.fields?.workplace_type?.status, 'verified');
assert.equal(ciscoEvidence?.fields?.deadline?.status, 'verified');
assert.equal(ciscoEvidence?.fields?.deadline?.source, 'official_description');
const qualcommListing = normalizeFeedItem({
  id: '3094633',
  external_job_id: '3094633',
  company_name: 'Qualcomm',
  title: 'Data Engineer, Staff (Semiconductor Engineering)',
  source_url: 'https://careers.qualcomm.com/careers/job/446721048564',
  location: 'San Diego, California, United States of America',
  country: 'United States of America',
  description: 'A Qualcomm official Eightfold description with more than three hundred characters of real role detail so the body is kept for the public catalog.',
  workplace_type: 'onsite',
  date_posted: '2026-09-15',
  source_type: 'eightfold',
  source_evidence: {
    source_type: 'official_ats',
    structured_field_sources: {
      location: 'official_payload',
      workplace_type: 'official_payload',
      date_posted: 'official_payload',
    },
  },
});
assert.equal(qualcommListing?.region, 'San Diego, California, United States of America');
assert.equal(qualcommListing?.location_source, 'official_payload');
assert.equal(qualcommListing?.workplace_type, 'onsite');
assert.equal(qualcommListing?.valid_through, null);
const qualcommEvidence = qualcommListing?.field_evidence as {
  fields?: Record<string, { status?: string; source?: string }>;
} | undefined;
assert.equal(qualcommEvidence?.fields?.location?.status, 'verified');
assert.equal(qualcommEvidence?.fields?.workplace_type?.status, 'verified');
assert.equal(qualcommEvidence?.fields?.deadline?.status, 'pending_recheck');
const amdListing = normalizeFeedItem({
  id: '85884',
  external_job_id: '85884',
  company_name: 'AMD',
  title: 'AI Data Center System Architect',
  source_url: 'https://careers.amd.com/careers-home/jobs/85884',
  location: 'Santa Clara, California, United States',
  country: 'United States',
  description: 'A AMD official Jibe description with more than three hundred characters of real role detail so the body is kept for the public catalog. Compensation is USD $229,600.00 to USD $344,400.00 per year.',
  employment_type: 'FULL_TIME',
  date_posted: '2026-09-15T07:00:00+0000',
  source_type: 'jibe',
  source_evidence: {
    source_type: 'official_ats',
    structured_field_sources: {
      location: 'official_payload',
      employment_type: 'official_payload',
      date_posted: 'official_payload',
    },
  },
});
assert.equal(amdListing?.region, 'Santa Clara, California, United States');
assert.equal(amdListing?.location_source, 'official_payload');
assert.equal(amdListing?.employment_type, 'FULL_TIME');
assert.equal(amdListing?.workplace_type, null);
assert.equal(amdListing?.valid_through, null);
const amdEvidence = amdListing?.field_evidence as {
  fields?: Record<string, { status?: string; source?: string }>;
} | undefined;
assert.equal(amdEvidence?.fields?.location?.status, 'verified');
assert.equal(amdEvidence?.fields?.employment_type?.status, 'verified');
assert.equal(amdEvidence?.fields?.deadline?.status, 'pending_recheck');
const dellListing = normalizeFeedItem({
  id: '293104',
  external_job_id: '293104',
  company_name: 'Dell Technologies',
  title: 'Consultant Machine Learning & Knowledge Graph Engineer',
  source_url: 'https://iawmqy.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/careers/job/293104',
  location: 'Round Rock, TX, United States',
  country: 'United States',
  description: 'A Dell Technologies official Oracle description with more than three hundred characters of real role detail so the body is kept for the public catalog.',
  employment_type: 'Full time',
  workplace_type: 'On-site',
  date_posted: '2026-09-15',
  valid_through: '2026-10-31T04:00:00+00:00',
  source_type: 'oracle_hcm',
  source_evidence: {
    source_type: 'official_ats',
    structured_field_sources: {
      location: 'official_payload',
      employment_type: 'official_payload',
      workplace_type: 'official_payload',
      date_posted: 'official_payload',
      valid_through: 'official_payload',
    },
  },
});
assert.equal(dellListing?.region, 'Round Rock, TX, United States');
assert.equal(dellListing?.location_source, 'official_payload');
assert.equal(dellListing?.employment_type, 'Full time');
assert.equal(dellListing?.workplace_type, 'On-site');
assert.equal(dellListing?.valid_through, '2026-10-31T04:00:00.000Z');
const dellEvidence = dellListing?.field_evidence as {
  fields?: Record<string, { status?: string; source?: string }>;
} | undefined;
assert.equal(dellEvidence?.fields?.location?.status, 'verified');
assert.equal(dellEvidence?.fields?.workplace_type?.status, 'verified');
assert.equal(dellEvidence?.fields?.deadline?.status, 'verified');
const broadcomListing = normalizeFeedItem({
  id: 'R026486',
  external_job_id: '/job/USA-CA-San-Jose-Innovation-Drive/Digital-Design-Verification-Engineer_R026486',
  company_name: 'Broadcom',
  title: 'Digital Design Verification Engineer',
  source_url: 'https://broadcom.wd1.myworkdayjobs.com/External_Career/job/USA-CA-San-Jose-Innovation-Drive/Digital-Design-Verification-Engineer_R026486',
  location: 'USA-CA San Jose Innovation Drive',
  country: 'United States',
  description: 'A Broadcom official Workday description with more than three hundred characters of real role detail so the body is kept for the public catalog.',
  source_type: 'workday',
  source_evidence: {
    source_type: 'official_ats',
    structured_field_sources: {
      location: 'official_payload',
    },
  },
});
assert.equal(broadcomListing?.region, 'USA-CA San Jose Innovation Drive, United States');
assert.equal(broadcomListing?.location_source, 'official_payload');
assert.equal(broadcomListing?.valid_through, null);
const broadcomEvidence = broadcomListing?.field_evidence as {
  fields?: Record<string, { status?: string; source?: string }>;
} | undefined;
assert.equal(broadcomEvidence?.fields?.location?.status, 'verified');
assert.equal(broadcomEvidence?.fields?.deadline?.status, 'pending_recheck');
const servicenowListing = normalizeFeedItem({
  id: '744000149968139',
  external_job_id: '744000149968139',
  company_name: 'ServiceNow',
  title: 'Principal Platform Architect',
  source_url: 'https://jobs.smartrecruiters.com/ServiceNow/744000149968139',
  location: 'Sydney, NSW, Australia',
  country: 'Australia',
  description: 'A ServiceNow official SmartRecruiters description with more than three hundred characters of real role detail so the body is kept for the public catalog.',
  source_type: 'smartrecruiters',
  source_evidence: {
    source_type: 'official_ats',
    structured_field_sources: {
      location: 'official_payload',
    },
  },
});
assert.equal(servicenowListing?.region, 'Sydney, NSW, Australia');
assert.equal(servicenowListing?.location_source, 'official_payload');
assert.equal(servicenowListing?.valid_through, null);
const servicenowEvidence = servicenowListing?.field_evidence as {
  fields?: Record<string, { status?: string; source?: string }>;
} | undefined;
assert.equal(servicenowEvidence?.fields?.location?.status, 'verified');
assert.equal(servicenowEvidence?.fields?.deadline?.status, 'pending_recheck');

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
const citadelSitemap = normalizeFeedItem({
  id: 'software-engineer-intern-us',
  external_job_id: 'software-engineer-intern-us',
  company_name: 'Citadel',
  title: 'Software Engineer Intern Us',
  source_url: 'https://www.citadel.com/careers/details/software-engineer-intern-us/',
  location: 'United States',
  country: 'United States',
  source_type: 'sitemap',
  source_evidence: {
    source_type: 'sitemap',
    structured_field_sources: { location: 'official_payload' },
  },
});
assert.equal(citadelSitemap?.region, 'United States');
assert.equal(citadelSitemap?.location_source, 'official_payload');
assert.equal(normalizeFeedItem({
  id: 'global-quantitative-strategies-gqs-quantitative-researcher',
  external_job_id: 'global-quantitative-strategies-gqs-quantitative-researcher',
  company_name: 'Citadel',
  title: 'Global Quantitative Strategies Gqs Quantitative Researcher',
  source_url: 'https://www.citadel.com/careers/details/global-quantitative-strategies-gqs-quantitative-researcher/',
  source_type: 'sitemap',
  source_evidence: { source_type: 'sitemap' },
}), null);
const citadelBrowser = normalizeFeedItem({
  id: 'equities-citadel-associate-program-summer-internship-2028',
  external_job_id: 'equities-citadel-associate-program-summer-internship-2028',
  company_name: 'Citadel',
  title: 'Equities Citadel Associate Program Summer Internship 2028',
  source_url: 'https://www.citadel.com/careers/details/equities-citadel-associate-program-summer-internship-2028/',
  location: 'New York',
  description: 'A Citadel official careers description with more than three hundred characters of real role detail so the imported body is kept for the public catalog and AI matching.',
  source_evidence: {
    source_type: 'official_browser_detail',
    structured_field_sources: { location: 'official_detail_page', description: 'official_detail_page' },
  },
});
assert.equal(citadelBrowser?.region, 'New York');
assert.equal(citadelBrowser?.location_source, 'official_detail_page');
console.log('jobs feed location tests passed');
