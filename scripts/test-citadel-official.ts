import assert from 'node:assert/strict';

import {
  citadelExternalId,
  citadelLocationFromUrl,
  citadelSlugTitle,
  citadelSlugWithoutGqs,
  isCitadelCareerUrl,
  isCitadelExcludedSlug,
  parseCitadelDetailHtml,
  normalizeCitadelCareerUrl,
} from '@/lib/citadel-official';
import { isCompanyFieldEvidenceTrusted } from '@/lib/job-company-field-rules';

const url = 'https://www.citadel.com/careers/details/Human-Resources-Intern-US';
assert.equal(isCitadelCareerUrl(url), true);
assert.equal(
  normalizeCitadelCareerUrl(url),
  'https://www.citadel.com/careers/details/human-resources-intern-us/',
);
assert.equal(
  normalizeCitadelCareerUrl('https://www.citadel.com/careers/details/human-resources-intern-us/'),
  'https://www.citadel.com/careers/details/human-resources-intern-us/',
);
assert.equal(citadelExternalId(url), 'human-resources-intern-us');
assert.equal(citadelSlugTitle(url), 'Human Resources Intern Us');
assert.equal(isCitadelCareerUrl('https://www.citadel.com/careers/'), false);
assert.equal(isCitadelCareerUrl('https://example.com/careers/details/human-resources-intern-us/'), false);

const officialUrl = 'https://www.citadel.com/careers/details/human-resources-intern-us/';
assert.equal(isCompanyFieldEvidenceTrusted('Citadel', officialUrl, 'official_payload'), true);
assert.equal(isCompanyFieldEvidenceTrusted('Citadel', officialUrl, 'official_detail_page'), true);
assert.equal(isCompanyFieldEvidenceTrusted('Citadel', officialUrl, 'official_browser_detail'), false);
assert.equal(isCompanyFieldEvidenceTrusted('Citadel', 'https://example.com/job/1', 'official_detail_page'), false);

assert.equal(citadelLocationFromUrl(officialUrl), 'United States');
assert.equal(isCitadelExcludedSlug('https://www.citadel.com/careers/details/software-engineer-intern-asia/'), true);
assert.equal(
  citadelSlugWithoutGqs('https://www.citadel.com/careers/details/global-quantitative-strategies-gqs-quantitative-researcher/'),
  'global-quantitative-strategies-quantitative-researcher',
);

const jobHtml = `<html><head><title>Software Engineer Intern (US)</title>
<script type="application/ld+json">{"@type":"JobPosting","title":"Software Engineer Intern (US)","description":"<p>Role Overview</p><p>About Citadel intern program with more than one hundred and sixty characters of official responsibilities, qualifications, and team context so the body is kept.</p>","jobLocation":{"@type":"Place","address":{"addressLocality":"New York","addressCountry":"United States"}}}</script>
</head><body><h1>Software Engineer Intern (US)</h1></body></html>`;
const parsed = parseCitadelDetailHtml(jobHtml);
assert.equal(parsed.blocked, false);
assert.equal(parsed.title, 'Software Engineer Intern (US)');
assert.equal(parsed.location, 'New York, United States');
assert.match(parsed.description || '', /About Citadel intern program/);

const challenge = parseCitadelDetailHtml('<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing citadel.com</body></html>', 'Just a moment...');
assert.equal(challenge.blocked, true);
assert.equal(challenge.blockReason, 'cloudflare_challenge');

console.log('citadel official tests passed');
