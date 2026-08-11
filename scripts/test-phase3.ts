import assert from 'node:assert/strict';

import { parseModelMatches, validateMatchSet } from '../src/lib/ai-match-contract';

const validMatch = (jobId: number) => ({
  job_id: jobId,
  match_score: 78,
  score_breakdown: {
    ats: 80,
    keywords: 76,
    experience: 75,
    evidence: 72,
    region: 85,
    profile_fit: 80,
  },
  match_reason: '技能与岗位要求有明确重合。',
  evidence: ['简历中有 Python 项目经验'],
  key_gaps: ['缺少岗位要求的云平台经验'],
  suggestions: '补充与云平台相关的真实项目成果。',
});

function testValidContract() {
  const matches = parseModelMatches(JSON.stringify([validMatch(1), validMatch(2)]));
  validateMatchSet(matches, [1, 2]);
  assert.equal(matches[0]?.match_score, 78);
}

function testCodeFenceIsOnlyPresentationWrapper() {
  const matches = parseModelMatches(`\n\`\`\`json\n${JSON.stringify([validMatch(1)])}\n\`\`\`\n`);
  assert.equal(matches[0]?.job_id, 1);
}

function testStructuredObjectContract() {
  const matches = parseModelMatches(JSON.stringify({ matches: [validMatch(1)] }));
  validateMatchSet(matches, [1]);
  assert.equal(matches[0]?.job_id, 1);
}

function testMalformedModelOutputFails() {
  assert.throws(() => parseModelMatches('{"job_id": 1}'));
  assert.throws(() => parseModelMatches(JSON.stringify([{ ...validMatch(1), match_score: 101 }])));
}

function testJobSetMustBeCompleteAndUnique() {
  const duplicate = parseModelMatches(JSON.stringify([validMatch(1), validMatch(1)]));
  assert.throws(() => validateMatchSet(duplicate, [1, 2]));

  const missing = parseModelMatches(JSON.stringify([validMatch(1)]));
  assert.throws(() => validateMatchSet(missing, [1, 2]));
}

testValidContract();
testCodeFenceIsOnlyPresentationWrapper();
testStructuredObjectContract();
testMalformedModelOutputFails();
testJobSetMustBeCompleteAndUnique();
console.log('phase3 contract tests passed');
