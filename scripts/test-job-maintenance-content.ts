import assert from 'node:assert/strict';
import { extractOfficialJobRequirements, looksLikeBlockedPage, usableOfficialContent } from '@/lib/job-maintenance';
import { extractOfficialJobDetails, isJobContentShell } from '@/lib/job-official-detail';
import { parseExperience } from '@/lib/job-connectors/utils';

const page = `
  About the role\n
  Build reliable distributed systems for our customers.\n
  Basic Qualifications:\n
  - 3+ years of professional software development experience\n
  - Experience with TypeScript and SQL\n
  Preferred Qualifications:\n
  - Experience with cloud infrastructure\n
  Benefits: Medical coverage and paid leave.
`;

const content = usableOfficialContent(page);
assert.ok(content);
assert.equal(usableOfficialContent('Career search'), null);
assert.equal(usableOfficialContent('Job title | Company {&#34;themeOptions&#34;: {&#34;customTheme&#34;: {&#34;varTheme&#34;: {}}}} ' + 'x'.repeat(200)), null);
const requirements = extractOfficialJobRequirements(content!);
assert.ok(requirements?.includes('3+ years'));
assert.ok(requirements?.includes('TypeScript'));
assert.equal(requirements?.includes('Benefits'), false);
const experience = parseExperience([content!]);
assert.equal(experience.min, 3);
assert.equal(experience.max, null);

const structured = extractOfficialJobDetails({
  title: 'Intern | Example',
  content: 'Checking your browser',
  url: 'https://example.com/job/1',
  httpStatus: 200,
  metadata: {
    structured_data: [{
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Intern',
      description: 'Responsibilities: Work with the team on customer research and reporting. Qualifications: Current student with strong communication skills and analytical ability.',
      validThrough: '2027-02-21T00:00:00Z',
      jobLocation: { address: { addressLocality: 'Seattle', addressRegion: 'WA', addressCountry: 'US' } },
    }],
  },
});
assert.equal(structured?.source, 'official_structured_data');
assert.ok(structured?.description?.includes('Responsibilities'));
assert.equal(structured?.validThrough, '2027-02-21T00:00:00Z');
assert.equal(structured?.location, 'Seattle, WA, US');
assert.equal(looksLikeBlockedPage('Intern | Example', 'This page includes a recaptcha script'), false);
assert.equal(looksLikeBlockedPage('Access denied', 'Verify you are human'), true);
assert.equal(isJobContentShell('{"widget":"redirect","externalSpa":true}'), true);
assert.equal(isJobContentShell('A real job description'), false);

const deloitteDetails = extractOfficialJobDetails({
  title: 'Lead Data Engineer II',
  content: '<html><body><div class="article__header--locations "><div class="fluid-cols fluid-cols--cols2"><p class="paragraph">Philadelphia, Pennsylvania, United States</p></div></div><p>Qualifications Required: Bachelor\'s degree in Computer Science.</p></body></html>',
  url: 'https://apply.deloitte.com/en_US/careers/JobDetail/Lead-Data-Engineer-II/365629',
  httpStatus: 200,
  metadata: {
    structured_data: [{
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Lead Data Engineer II',
      description: 'Qualifications Required: Bachelor\'s degree in Computer Science, Engineering, Information Systems, or a technical field, or equivalent experience. 6+ years of experience designing, building, and maintaining data pipelines and cloud-based data platforms.',
      jobLocation: { address: { streetAddress: '', addressLocality: '', addressRegion: null, addressCountry: null } },
    }],
  },
});
assert.equal(deloitteDetails?.location, 'Philadelphia, Pennsylvania, United States');

console.log('job maintenance content tests passed');
