import assert from 'node:assert/strict';

import {
  optimizedResumeSchema,
  parseOptimizedResume,
} from '../src/lib/optimized-resume-contract';
import { parseOptimizationScoreComparison } from '../src/lib/optimization-score-contract';
import { applyOptimizationChangeReview } from '../src/lib/optimized-resume-review';

const minimalResume = {
  name: 'Alex Chen',
  contact: { email: 'alex@example.com' },
  summary: 'Product analyst with measurable project experience.',
  skills: ['SQL', 'Python'],
  experience: [],
  education: [],
  projects: [],
  certifications: [],
};

function testDefaultsNormalizeOptionalFields() {
  const result = optimizedResumeSchema.parse(minimalResume);
  assert.equal(result.contact.phone, '');
  assert.equal(result.contact.linkedin, '');
  assert.deepEqual(result.experience, []);
}

function testCodeFenceOutput() {
  const result = parseOptimizedResume(`\n\`\`\`json\n${JSON.stringify(minimalResume)}\n\`\`\`\n`);
  assert.equal(result.name, 'Alex Chen');
  assert.equal(result.skills[0], 'SQL');
}

function testInvalidOutputFails() {
  assert.throws(() => parseOptimizedResume('not-json'));
  assert.throws(() => parseOptimizedResume(JSON.stringify({ name: 123 })));
}

function testScoreComparisonContract() {
  const evaluation = {
    match_score: 70,
    score_breakdown: {
      ats: 70,
      keywords: 65,
      experience: 72,
      evidence: 68,
      region: 74,
      profile_fit: 71,
    },
  };
  const result = parseOptimizationScoreComparison(JSON.stringify({
    original: evaluation,
    optimized: { ...evaluation, match_score: 82 },
    summary: '优化后关键词和证据表达更贴近岗位要求。',
    key_changes: ['补充了岗位要求中的真实关键词'],
  }));
  assert.equal(result.optimized.match_score, 82);
  assert.throws(() => parseOptimizationScoreComparison('{"original": {}}'));
}

function testChangeReviewAppliesRejectionAndSupportsUndo() {
  const base = optimizedResumeSchema.parse({
    ...minimalResume,
    summary: 'Experienced analyst with measurable outcomes.',
  });
  const change = {
    id: 'change-summary',
    section: 'summary',
    title: '岗位定向简介',
    before: 'Experienced analyst with measurable outcomes.',
    after: 'Product analyst focused on marketplace growth and experimentation.',
    rationale: '突出目标岗位相关方向。',
  };

  const rejected = applyOptimizationChangeReview(
    { ...base, summary: change.after },
    [{ ...change, status: 'rejected' }],
  );
  assert.equal(rejected.summary, change.before);

  const accepted = applyOptimizationChangeReview(
    { ...base, summary: change.after },
    [{ ...change, status: 'accepted' }],
  );
  assert.equal(accepted.summary, change.after);
}

testDefaultsNormalizeOptionalFields();
testCodeFenceOutput();
testInvalidOutputFails();
testScoreComparisonContract();
testChangeReviewAppliesRejectionAndSupportsUndo();
console.log('phase4 optimization contract tests passed');
