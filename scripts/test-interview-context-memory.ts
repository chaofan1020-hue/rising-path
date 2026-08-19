import assert from 'node:assert/strict';
import {
  advanceInterviewFactLedger,
  buildInterviewContextDigest,
  buildInterviewMemoryPrompt,
  emptyInterviewFactLedger,
  parseInterviewContextDigest,
  parseInterviewFactLedger,
} from '../src/lib/interview-context-memory';

const digest = buildInterviewContextDigest({
  language: 'en',
  company: 'Example Corp',
  title: 'Data Analyst Intern',
  direction: 'Analytics',
  jobDescription: 'Own experiment analysis, dashboards, and stakeholder decisions.',
  jobRequirements: 'SQL, Python, causal analysis, and clear communication.',
  profile: {
    internships: [{
      company: 'Northwind',
      role: 'Analytics Intern',
      highlights: ['Built a retention dashboard for 120,000 users', 'Ran an A/B experiment that improved activation by 8%'],
    }],
    projects: [{
      name: 'Pricing model',
      outcomes: ['Designed a Python model and reduced manual work by 30%'],
    }],
    skills: ['SQL', 'Python', 'Experimentation'],
  },
  resumeText: 'Northwind Analytics Intern\nBuilt retention dashboards and analyzed A/B experiment results.',
  segmentation: null,
});

assert.equal(digest.version, 1);
assert.equal(digest.role.company, 'Example Corp');
assert.ok(digest.candidate.evidence.some((item) => item.content.includes('120,000')));
assert.ok(digest.candidate.evidence.length <= 16);
assert.deepEqual(parseInterviewContextDigest(digest)?.role, digest.role);

const afterAnswer = advanceInterviewFactLedger(emptyInterviewFactLedger(), {
  answer: 'I owned the experiment design, used SQL to compare the baseline, and improved activation by 8%.',
  answerTurnIndex: 4,
  currentIntent: 'metric_attribution',
});
const ledger = advanceInterviewFactLedger(afterAnswer, {}, {
  question: 'How did you establish causality for the activation improvement?',
  intentKey: 'metric_attribution',
  dimension: 'Data and analysis',
});

assert.ok(ledger.candidateClaims.length > 0);
assert.deepEqual(ledger.coveredIntents, ['metric_attribution']);
assert.deepEqual(parseInterviewFactLedger(ledger).coveredDimensions, ['Data and analysis']);

const prompt = buildInterviewMemoryPrompt({
  digest,
  ledger,
  currentIntent: 'metric_attribution',
  currentAnswer: 'The experiment used a control group and SQL analysis.',
});
assert.ok(prompt.includes('Relevant resume evidence'));
assert.ok(prompt.includes('120,000'));
assert.ok(prompt.length <= 6_000);

console.log('interview context memory checks passed');
