import assert from 'node:assert/strict';

import { parseModelMatches, validateMatchSet } from '../src/lib/ai-match-contract';
import { applyMatchFeedbackPreferences, isClearlyUnavailable, roleFit, selectMatchCandidates } from '../src/lib/ai-match-candidate-ranking';

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

function testCandidateRankingKeepsEarlyCareerRoles() {
  const profile = { experienceYears: 0.5, careerStage: 'junior' as const, targetRoles: ['Software Engineer'] };
  assert.equal(isClearlyUnavailable({ id: 1, title: 'Senior Software Engineer', experience_min_years: 5 }, profile), true);
  assert.equal(isClearlyUnavailable({ id: 2, title: 'Software Engineer Intern', experience_min_years: 0 }, profile), false);
  const selected = selectMatchCandidates([
    { id: 1, title: 'Senior Software Engineer', experience_min_years: 5, lexical_score: 0.99 },
    { id: 2, title: 'Software Engineer Intern', experience_min_years: 0, lexical_score: 0.55 },
    { id: 3, title: 'Junior Software Engineer', experience_min_years: 1, lexical_score: 0.45 },
  ], profile, 2);
  assert.deepEqual(selected.jobs.map((job) => job.id), [2, 3]);
  assert.equal(selected.excludedCount, 1);
}

function testCandidateRankingAddsDiversity() {
  const profile = { experienceYears: 1, careerStage: 'junior' as const, targetRoles: ['Software Engineer'] };
  const jobs = [
    { id: 1, title: 'Software Engineer', company: 'Acme', direction: 'Engineering', lexical_score: 0.99 },
    { id: 2, title: 'Frontend Engineer', company: 'Acme', direction: 'Engineering', lexical_score: 0.98 },
    { id: 3, title: 'Backend Engineer', company: 'Acme', direction: 'Engineering', lexical_score: 0.97 },
    { id: 4, title: 'Platform Engineer', company: 'Other', direction: 'Engineering', lexical_score: 0.96 },
    { id: 5, title: 'Data Analyst', company: 'Data Co', direction: 'Data', lexical_score: 0.70 },
    { id: 6, title: 'Product Analyst', company: 'Product Co', direction: 'Product', lexical_score: 0.69 },
    { id: 7, title: 'Growth Marketing Associate', company: 'Growth Co', direction: 'Marketing', lexical_score: 0.68 },
  ];
  const selected = selectMatchCandidates(jobs, profile, 6);
  assert.equal(selected.jobs.filter((job) => job.company === 'Acme').length, 2);
  assert.equal(selected.jobs.filter((job) => /engineer/i.test(job.title)).length, 3);
  assert.equal(selected.jobs.some((job) => job.title === 'Data Analyst'), true);
  assert.equal(roleFit(jobs[0], profile.targetRoles), 'direct');
  assert.equal(roleFit(jobs[4], profile.targetRoles), 'adjacent');
}

function testCandidateRankingUsesFeedbackWithoutOverfitting() {
  const jobs = [
    { id: 1, title: 'Software Engineer', company: 'Acme', direction: 'Engineering', lexical_score: 0.8, feedback_priority: null },
    { id: 2, title: 'Frontend Engineer', company: 'Acme', direction: 'Engineering', lexical_score: 0.7, feedback_priority: null },
    { id: 3, title: 'Data Analyst', company: 'Data Co', direction: 'Data', lexical_score: 0.75, feedback_priority: null },
  ];
  const applied = applyMatchFeedbackPreferences(jobs, [
    { jobId: 1, feedback: 'not_interested', company: 'Acme', direction: 'Engineering' },
    { jobId: 3, feedback: 'interested', company: 'Data Co', direction: 'Data' },
  ]);
  assert.deepEqual(applied.jobs.map((job) => job.id), [2, 3]);
  assert.equal(applied.excludedCount, 1);
  assert.ok((applied.jobs.find((job) => job.id === 3)?.feedback_priority || 0) > 0);
}

testValidContract();
testCodeFenceIsOnlyPresentationWrapper();
testStructuredObjectContract();
testMalformedModelOutputFails();
testJobSetMustBeCompleteAndUnique();
testCandidateRankingKeepsEarlyCareerRoles();
testCandidateRankingAddsDiversity();
testCandidateRankingUsesFeedbackWithoutOverfitting();
console.log('phase3 contract tests passed');
