import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { extractOfficialJobDetails } from '@/lib/job-official-detail';

const fixturePath = process.argv.find((value) => value.startsWith('--fixture='))?.slice('--fixture='.length)
  || `${process.env.TEMP || ''}/google-job.html`;
const html = readFileSync(fixturePath, 'utf8');
const details = extractOfficialJobDetails({
  title: 'Google Careers fixture',
  content: html,
  url: 'https://www.google.com/about/careers/applications/jobs/results/127257437735396038',
  httpStatus: 200,
  metadata: {},
});

assert.ok(details, 'Google fixture should produce official details');
assert.match(details.description || '', /Senior Technical Program Manager/);
assert.equal(details.location, 'Sunnyvale, CA, USA');
assert.match(details.requirements || '', /Bachelor's degree|years of experience/i);
assert.equal(details.workplaceType, null);
assert.equal(details.salaryRange, null);
assert.equal(details.validThrough, null);
console.log('Google official detail extraction passed');
