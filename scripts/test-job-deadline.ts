import assert from 'node:assert/strict';
import { getJobDeadlineRemaining, isJobDeadlineExpired, parseJobDeadline, resolveJobDeadline } from '../src/lib/job-deadline';
import { extractPageMetadata } from '../src/lib/safe-external-fetch';

assert.equal(parseJobDeadline('2026-10-15'), '2026-10-15T23:59:59.999Z');
assert.equal(parseJobDeadline('2026年10月15日'), '2026-10-15T23:59:59.999Z');
assert.equal(parseJobDeadline('10/15/2026'), '2026-10-15T23:59:59.999Z');
assert.equal(parseJobDeadline('10/15/26'), '2026-10-15T23:59:59.999Z');
assert.equal(parseJobDeadline('2026.10.15'), '2026-10-15T23:59:59.999Z');
assert.equal(parseJobDeadline('October 15, 2026'), '2026-10-15T23:59:59.999Z');
assert.equal(parseJobDeadline('15 October 2026'), '2026-10-15T23:59:59.999Z');
assert.equal(parseJobDeadline('2026-10-15T05:00:00+00:00'), '2026-10-15T05:00:00.000Z');
assert.equal(parseJobDeadline('1792022400'), '2026-10-15T00:00:00.000Z');
assert.equal(parseJobDeadline('not a date'), null);

assert.deepEqual(resolveJobDeadline({ valid_through: '2026-10-01T00:00:00Z', application_deadline: '2026-10-15' }), {
  value: '2026-10-01T00:00:00.000Z',
  source: 'valid_through',
});
assert.deepEqual(resolveJobDeadline({ application_deadline: '2026-10-15' }), {
  value: '2026-10-15T23:59:59.999Z',
  source: 'application_deadline',
});
assert.deepEqual(resolveJobDeadline({ raw_payload: { applicationClosingDate: '2026-11-03' } }), {
  value: '2026-11-03T23:59:59.999Z',
  source: 'structured_field',
});
assert.deepEqual(resolveJobDeadline({ description: 'Applications close on October 15, 2026.' }), {
  value: '2026-10-15T23:59:59.999Z',
  source: 'description',
});
assert.deepEqual(resolveJobDeadline({ description: 'Applications will close on October 15, 2026.' }), {
  value: '2026-10-15T23:59:59.999Z',
  source: 'description',
});
assert.deepEqual(resolveJobDeadline({ description: 'The deadline to apply is October 15, 2026.' }), {
  value: '2026-10-15T23:59:59.999Z',
  source: 'description',
});
assert.deepEqual(resolveJobDeadline({ description: '申请截止日期：2026年10月15日。' }), {
  value: '2026-10-15T23:59:59.999Z',
  source: 'description',
});
assert.equal(resolveJobDeadline({ description: 'This role has a deadline-driven environment.' }), null);
const pageMetadata = extractPageMetadata('<meta itemprop="validThrough" content="2026-11-09"><time datetime="2026-11-10">Application deadline</time><script type="application/ld+json">{"validThrough":"2026-11-11"}</script>');
assert.equal(resolveJobDeadline({ raw_payload: pageMetadata })?.value, '2026-11-09T23:59:59.999Z');
assert.equal(isJobDeadlineExpired('2026-01-01T00:00:00Z', Date.parse('2026-01-02T00:00:00Z')), true);
assert.equal(isJobDeadlineExpired('2026-01-03T00:00:00Z', Date.parse('2026-01-02T00:00:00Z')), false);
assert.deepEqual(getJobDeadlineRemaining('2026-01-03T12:30:00Z', Date.parse('2026-01-02T10:00:00Z')), {
  totalMinutes: 1590,
  days: 2,
  hours: 2,
  minutes: 30,
  expired: false,
});

console.log('job deadline tests passed');
