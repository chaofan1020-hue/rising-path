import assert from 'node:assert/strict';
import { jobListingReadTable, jobReadTable } from '../src/lib/job-read-source';

assert.equal(jobReadTable({}), 'jobs');
assert.equal(jobReadTable({ JOBS_READ_SOURCE: '' }), 'jobs');
assert.equal(jobReadTable({ JOBS_READ_SOURCE: 'v3' }), 'jobs_v3');
assert.equal(jobReadTable({ JOBS_READ_SOURCE: 'JOBS_V3' }), 'jobs_v3');
assert.equal(jobReadTable({ JOBS_READ_SOURCE: 'all' }), 'jobs');
assert.equal(jobListingReadTable({}), 'jobs_listing');
assert.equal(jobListingReadTable({ JOBS_READ_SOURCE: 'v3' }), 'jobs_listing_v3');

console.log('job-read-source: ok');