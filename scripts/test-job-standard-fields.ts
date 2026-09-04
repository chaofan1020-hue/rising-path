import assert from 'node:assert/strict';
import { normalizeFeedItem } from '../src/lib/jobs-feed';

const evidence = { structured_field_sources: { employment_type: 'official_payload', location: 'official_payload' } };
const base = {
  id: 'standard-test', company_name: 'Example', title: 'Software Engineer',
  source_url: 'https://careers.example.com/jobs/standard-test', location: 'New York, NY', country: 'United States',
  source_evidence: evidence,
};

const experienced = normalizeFeedItem({ ...base, description: 'Bachelor degree and 3+ years of experience building distributed systems.' });
assert.ok(experienced);
assert.equal(experienced.employment_category, '未知');
assert.equal(experienced.experience_min_years, 3);
assert.equal(experienced.experience_max_years, null);

const internship = normalizeFeedItem({ ...base, title: '2027 Summer Analyst Internship', employment_type: 'Internship' });
assert.ok(internship);
assert.equal(internship.employment_category, '实习');

const graduate = normalizeFeedItem({ ...base, title: 'New Graduate Software Engineer', level: 'Entry Level' });
assert.ok(graduate);
assert.equal(graduate.employment_category, '校招');
assert.equal(graduate.experience_min_years, 0);

const analystProgram = normalizeFeedItem({ ...base, title: '2027 Operations Full-time Analyst Program', employment_type: 'Full-Time', level: 'Analyst' });
assert.ok(analystProgram);
assert.equal(analystProgram.employment_category, '校招');

const range = normalizeFeedItem({ ...base, description: 'Requires 2-4 years of relevant experience.' });
assert.ok(range);
assert.equal(range.experience_min_years, 2);
assert.equal(range.experience_max_years, 4);

// "International" and "Internal" must never turn an experienced role into
// an internship merely because they contain the letters "intern".
const internationalManager = normalizeFeedItem({
  ...base,
  title: 'International Private Bank, Vice President',
  description: 'Experienced professional role requiring 5+ years of experience.',
});
assert.ok(internationalManager);
assert.equal(internationalManager.employment_category, '社招');
assert.equal(internationalManager.experience_min_years, 5);

const seniorInternLabel = normalizeFeedItem({
  ...base,
  title: 'Internship Software Engineer',
  description: 'Entry-level opportunity; 3+ years of relevant experience preferred.',
});
assert.ok(seniorInternLabel);
assert.equal(seniorInternLabel.employment_category, '实习');
assert.equal(seniorInternLabel.experience_min_years, 3);

const malformedLargeRequirement = normalizeFeedItem({
  ...base,
  description: '1000 years of experience required.',
});
assert.ok(malformedLargeRequirement);
assert.equal(malformedLargeRequirement.experience_min_years, null);
assert.equal(malformedLargeRequirement.experience_max_years, null);

const numericOverflowBoundary = normalizeFeedItem({ ...base, experience_min_years: 999.95 });
assert.ok(numericOverflowBoundary);
assert.equal(numericOverflowBoundary.experience_min_years, null);

console.log('job standard fields tests passed');
