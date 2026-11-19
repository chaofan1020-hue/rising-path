import assert from 'node:assert/strict';
import { parseExperience } from '../src/lib/job-connectors/utils';

const intern = parseExperience([
  'Engineering Product Management Specialist I (Intern) – United States',
  'Why Cisco? We’ve been innovating fearlessly for 40 years to create solutions.',
]);
assert.equal(intern.min, null);
assert.equal(intern.max, null);

const flattened = parseExperience([
  'Minimum qualifications: currently enrolled student. Preferred: agile methodologies (Scrum, Kanban). Why Cisco? We’ve been innovating fearlessly for 40 years to create solutions. Add to that our worldwide team.',
]);
assert.equal(flattened.min, null);
assert.equal(flattened.max, null);

const historyThenReal = parseExperience([
  'We’ve been innovating fearlessly for 40 years to create solutions. Minimum 5 years of experience selling technical solutions.',
]);
assert.equal(historyThenReal.min, 5);
assert.equal(historyThenReal.max, null);

const degreePlus = parseExperience([
  'Software Engineering Technical Leader',
  'Why Cisco? We’ve been innovating fearlessly for 40 years to create solutions. Minimum Qualifications • Bachelors + 12 years of related experience, or Masters + 8 years of related experience',
]);
assert.equal(degreePlus.min, 12);
assert.equal(degreePlus.max, null);

const internReal = parseExperience([
  'Software Engineer Intern',
  'Minimum 3 years of experience with Python.',
]);
assert.equal(internReal.min, 3);

console.log('cisco experience parser verification passed');
