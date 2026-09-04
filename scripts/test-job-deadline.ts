import assert from 'node:assert/strict';
import { getJobDeadlineRemaining, isDisplayableJobDeadline, isJobDeadlineExpired, parseJobDeadline, resolveJobDeadline } from '../src/lib/job-deadline';
import { extractPageMetadata } from '../src/lib/safe-external-fetch';

assert.equal(parseJobDeadline('2026-10-15'), '2026-10-15T23:59:59.999Z');
assert.equal(parseJobDeadline('2026年10月15日'), '2026-10-15T23:59:59.999Z');
assert.equal(parseJobDeadline('10/15/2026'), '2026-10-15T23:59:59.999Z');
assert.equal(parseJobDeadline('10/15/26'), '2026-10-15T23:59:59.999Z');
assert.equal(parseJobDeadline('2026.10.15'), '2026-10-15T23:59:59.999Z');
assert.equal(parseJobDeadline('October 15, 2026'), '2026-10-15T23:59:59.999Z');
assert.equal(parseJobDeadline('15 October 2026'), '2026-10-15T23:59:59.999Z');
assert.equal(parseJobDeadline('October 14'), null);
assert.equal(parseJobDeadline('2026-10-15T05:00:00+00:00'), '2026-10-15T05:00:00.000Z');
assert.equal(parseJobDeadline('2026-10-15 05:00:00+00:00'), '2026-10-15T05:00:00.000Z');
assert.equal(parseJobDeadline('1792022400'), '2026-10-15T00:00:00.000Z');
assert.equal(parseJobDeadline('not a date'), null);

const officialPayload = { structured_field_sources: { valid_through: 'official_payload', application_deadline: 'official_payload', deadline: 'official_payload', description: 'official_description' } };
assert.deepEqual(resolveJobDeadline({ valid_through: '2026-10-01T00:00:00Z', application_deadline: '2026-10-15', source_evidence: officialPayload }), {
  value: '2026-10-01T00:00:00.000Z',
  source: 'valid_through',
  fieldSource: 'official_payload',
});
assert.deepEqual(resolveJobDeadline({ application_deadline: '2026-10-15', source_evidence: officialPayload }), {
  value: '2026-10-15T23:59:59.999Z',
  source: 'application_deadline',
  fieldSource: 'official_payload',
});
assert.equal(resolveJobDeadline({ valid_through: '1000000000' }), null);
assert.deepEqual(resolveJobDeadline({ valid_through: '1792022400', source_evidence: officialPayload, date_posted: '2026-01-01' }), {
  value: '2026-10-15T00:00:00.000Z',
  source: 'valid_through',
  fieldSource: 'official_payload',
});
assert.equal(resolveJobDeadline({ valid_through: '1000000000', source_evidence: officialPayload, date_posted: '2026-01-01' }), null);
assert.deepEqual(resolveJobDeadline({ raw_payload: { applicationClosingDate: '2026-11-03' }, source_evidence: officialPayload }), {
  value: '2026-11-03T23:59:59.999Z',
  source: 'structured_field',
  fieldSource: 'official_payload',
});
assert.deepEqual(resolveJobDeadline({ description: 'Applications close on October 15, 2026.', source_evidence: officialPayload }), {
  value: '2026-10-15T23:59:59.999Z',
  source: 'description',
  fieldSource: 'official_description',
});
assert.deepEqual(resolveJobDeadline({
  description: 'Application Process and Deadline: Application deadline: Sunday, November 1, 2026 at 23:55 HKT.',
  source_evidence: { structured_field_sources: { application_deadline: 'official_description' } },
}), {
  value: '2026-11-01T23:59:59.999Z',
  source: 'description',
  fieldSource: 'official_description',
});
assert.deepEqual(resolveJobDeadline({ description: 'Applications will close on October 15, 2026.', source_evidence: officialPayload }), {
  value: '2026-10-15T23:59:59.999Z',
  source: 'description',
  fieldSource: 'official_description',
});
assert.deepEqual(resolveJobDeadline({ description: 'The deadline to apply is October 15, 2026.', source_evidence: officialPayload }), {
  value: '2026-10-15T23:59:59.999Z',
  source: 'description',
  fieldSource: 'official_description',
});
assert.equal(resolveJobDeadline({
  description: 'Deadline to Apply: Wednesday, October 14 at 11:59pm ET.',
  date_posted: '2026-08-27',
  source_evidence: officialPayload,
}), null);
assert.deepEqual(resolveJobDeadline({ description: '申请截止日期：2026年10月15日。', source_evidence: officialPayload }), {
  value: '2026-10-15T23:59:59.999Z',
  source: 'description',
  fieldSource: 'official_description',
});
assert.equal(resolveJobDeadline({ description: 'This role has a deadline-driven environment.', source_evidence: officialPayload }), null);
const pageMetadata = extractPageMetadata('<meta itemprop="validThrough" content="2026-11-09"><time datetime="2026-11-10">Application deadline</time><script type="application/ld+json">{"validThrough":"2026-11-11"}</script>');
assert.equal(resolveJobDeadline({ raw_payload: pageMetadata, source_evidence: officialPayload })?.value, '2026-11-09T23:59:59.999Z');
assert.equal(isJobDeadlineExpired('2026-01-01T00:00:00Z', Date.parse('2026-01-02T00:00:00Z')), true);
assert.equal(isJobDeadlineExpired('2026-01-03T00:00:00Z', Date.parse('2026-01-02T00:00:00Z')), false);
assert.equal(isDisplayableJobDeadline('2001-10-13T00:00:00Z', 'official_description'), false);
assert.equal(isDisplayableJobDeadline('2026-10-15T00:00:00Z', 'official_payload', 'public_feed', Date.parse('2026-08-27T00:00:00Z')), false);
assert.equal(isDisplayableJobDeadline('2026-10-15T00:00:00Z', 'official_payload', 'official_ats', Date.parse('2026-08-27T00:00:00Z')), true);
assert.equal(isDisplayableJobDeadline('2026-10-15T00:00:00Z', 'official_link_structured_field', 'official_ats', Date.parse('2026-08-27T00:00:00Z')), true);
assert.equal(isDisplayableJobDeadline('2026-10-15T00:00:00Z', 'official_link_structured_field', 'public_feed', Date.parse('2026-08-27T00:00:00Z')), false);
assert.equal(isDisplayableJobDeadline('2026-10-15T00:00:00Z', 'official_description', null, Date.parse('2026-08-27T00:00:00Z')), true);
assert.deepEqual(getJobDeadlineRemaining('2026-01-03T12:30:00Z', Date.parse('2026-01-02T10:00:00Z')), {
  totalMinutes: 1590,
  days: 2,
  hours: 2,
  minutes: 30,
  expired: false,
});

console.log('job deadline tests passed');
