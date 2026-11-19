import assert from 'node:assert/strict';

import {
  assertLinkedInFeedComplete,
  isLinkedInHiringCompany,
  isLinkedInJobUrl,
  isUsableLinkedInDescription,
  linkedInJobIdFromUrl,
  normalizeLinkedInJobUrl,
  parseLinkedInDetailHtml,
  parseLinkedInJobCardsPayload,
  parseLinkedInJobDescriptionPayload,
  parseLinkedInListHtml,
  parseLinkedInReportedTotal,
} from '@/lib/linkedin-official';

const slug = 'https://www.linkedin.com/jobs/view/director-software-engineering-enterprise-infrastructure-at-linkedin-4476377540?refId=abc';
assert.equal(linkedInJobIdFromUrl(slug), '4476377540');
assert.equal(
  normalizeLinkedInJobUrl(slug),
  'https://www.linkedin.com/jobs/view/director-software-engineering-enterprise-infrastructure-at-linkedin-4476377540',
);
assert.equal(isLinkedInJobUrl('https://www.linkedin.com/jobs/search/?f_C=1337'), false);
assert.equal(isLinkedInJobUrl('https://example.com/jobs/view/4476377540'), false);
assert.equal(isLinkedInHiringCompany('LinkedIn'), true);
assert.equal(isLinkedInHiringCompany('LinkedIn Corporation'), true);
assert.equal(isLinkedInHiringCompany('Talon.One'), false);
assert.equal(isLinkedInHiringCompany('LinkedIn Jobs'), false);
assert.equal(parseLinkedInReportedTotal('415 Jobs jobs in Worldwide'), 415);
assert.equal(parseLinkedInReportedTotal('Jobs Jobs at LinkedIn in United States (197 Open Roles) | LinkedIn'), 197);
assert.equal(parseLinkedInReportedTotal('417 results'), 417);
assert.equal(parseLinkedInReportedTotal('300+ 个结果 417 results'), 417);

const jobCards = parseLinkedInJobCardsPayload({
  data: {
    paging: { total: 417, count: 25, start: 0 },
    metadata: { subtitle: { text: '417 results' } },
  },
  included: [
    {
      $type: 'com.linkedin.voyager.dash.jobs.JobPostingCard',
      entityUrn: 'urn:li:fsd_jobPostingCard:(4476377540,JOBS_SEARCH)',
      jobPostingUrn: 'urn:li:fsd_jobPosting:4476377540',
      jobPostingTitle: 'Director, Software Engineering',
      primaryDescription: { text: 'LinkedIn' },
      secondaryDescription: { text: 'Mountain View, CA (Hybrid)' },
    },
    {
      $type: 'com.linkedin.voyager.dash.jobs.JobPostingCard',
      entityUrn: 'urn:li:fsd_jobPostingCard:(4476377540,JOB_DETAILS)',
      jobPostingUrn: 'urn:li:fsd_jobPosting:4476377540',
      jobPostingTitle: 'Director, Software Engineering',
      primaryDescription: { text: 'LinkedIn' },
    },
    {
      $type: 'com.linkedin.voyager.dash.jobs.JobPostingCard',
      entityUrn: 'urn:li:fsd_jobPostingCard:(111,JOBS_SEARCH)',
      jobPostingUrn: 'urn:li:fsd_jobPosting:111',
      jobPostingTitle: 'Other',
      primaryDescription: { text: 'Talon.One' },
    },
  ],
});
assert.equal(jobCards.total, 417);
assert.equal(jobCards.cards.length, 1);
assert.equal(jobCards.cards[0].id, '4476377540');
assert.equal(jobCards.cards[0].location, 'Mountain View, CA (Hybrid)');

const desc = parseLinkedInJobDescriptionPayload({
  included: [
    {
      $type: 'com.linkedin.voyager.dash.jobs.JobDescription',
      entityUrn: 'urn:li:fsd_jobDescription:4476377540',
      postedOnText: 'Posted on Oct 13, 2026.',
      descriptionText: {
        text: 'Build LinkedIn infrastructure with more than one hundred and sixty characters of official responsibilities, qualifications, and team context so the body is kept for import.',
      },
    },
    {
      $type: 'com.linkedin.voyager.dash.organization.Company',
      name: 'LinkedIn',
    },
  ],
});
assert.equal(desc.id, '4476377540');
assert.equal(desc.company, 'LinkedIn');
assert.equal(isUsableLinkedInDescription(desc.description), true);

const listHtml = `
<li>
  <div class="base-card" data-entity-urn="urn:li:jobPosting:4476377540">
    <a href="https://www.linkedin.com/jobs/view/director-software-engineering-enterprise-infrastructure-at-linkedin-4476377540" class="base-card__full-link"></a>
    <h3 class="base-search-card__title">Director, Software Engineering - Enterprise Infrastructure</h3>
    <h4 class="base-search-card__subtitle">LinkedIn</h4>
    <span class="job-search-card__location">Mountain View, CA</span>
  </div>
</li>
<li>
  <div class="base-card" data-entity-urn="urn:li:jobPosting:111">
    <a href="https://www.linkedin.com/jobs/view/other-at-talon-111" class="base-card__full-link"></a>
    <h3 class="base-search-card__title">Not LinkedIn</h3>
    <h4 class="base-search-card__subtitle">Talon.One</h4>
    <span class="job-search-card__location">Berlin</span>
  </div>
</li>`;
const cards = parseLinkedInListHtml(listHtml);
assert.equal(cards.length, 1);
assert.equal(cards[0].id, '4476377540');
assert.equal(cards[0].location, 'Mountain View, CA');

const detailHtml = `<html><head><title>Director, Software Engineering</title>
<script type="application/ld+json">{"@type":"JobPosting","title":"Director, Software Engineering - Enterprise Infrastructure","description":"<p>Build LinkedIn infrastructure with more than one hundred and sixty characters of official responsibilities, qualifications, and team context so the body is kept for import.</p>","hiringOrganization":{"@type":"Organization","name":"LinkedIn"},"jobLocation":{"@type":"Place","address":{"addressLocality":"Mountain View","addressRegion":"CA","addressCountry":"US"}},"identifier":{"@type":"PropertyValue","value":"4476377540"}}</script>
</head><body>
<h2 class="topcard__title">Director, Software Engineering - Enterprise Infrastructure</h2>
<span class="topcard__flavor--bullet">Mountain View, CA</span>
<div class="show-more-less-html__markup"><p>Build LinkedIn infrastructure with more than one hundred and sixty characters of official responsibilities, qualifications, and team context so the body is kept for import.</p></div>
</body></html>`;
const parsed = parseLinkedInDetailHtml(detailHtml);
assert.equal(parsed.blocked, false);
assert.equal(parsed.id, '4476377540');
assert.equal(parsed.company, 'LinkedIn');
assert.equal(parsed.location, 'Mountain View, CA');
assert.equal(isUsableLinkedInDescription(parsed.description), true);

const challenge = parseLinkedInDetailHtml('<html><head><title>Authwall</title></head><body>checkpoint/challenge unusual traffic</body></html>', 'Authwall');
assert.equal(challenge.blocked, true);

assert.throws(() => assertLinkedInFeedComplete({
  jobs: [],
  reportedTotal: 415,
  listComplete: true,
}));
assert.throws(() => assertLinkedInFeedComplete({
  jobs: [{
    id: '1',
    title: 'Engineer',
    url: 'https://www.linkedin.com/jobs/view/1',
    location: 'CA',
    department: null,
    description: 'x'.repeat(200),
    company: 'LinkedIn',
    captured_at: new Date().toISOString(),
  }],
  reportedTotal: null,
  listComplete: true,
}));
assert.doesNotThrow(() => assertLinkedInFeedComplete({
  jobs: [{
    id: '1',
    title: 'Engineer',
    url: 'https://www.linkedin.com/jobs/view/1',
    location: 'CA',
    department: null,
    description: 'x'.repeat(200),
    company: 'LinkedIn',
    captured_at: new Date().toISOString(),
  }],
  reportedTotal: 1,
  listComplete: true,
}));

console.log('linkedin official tests passed');
