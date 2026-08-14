import assert from 'node:assert/strict';
import {
  PERSONALITY_QUESTION_BANK,
  computePersonalityRecommendations,
  computePersonalityResult,
  computeSponsorshipStatsByRole,
  getRandomPersonalityQuestions,
  validatePersonalityAnswers,
  type PersonalityAnswer,
} from '../src/lib/personality-assessment';
import type { ResumeProfile } from '../src/lib/resume-types';

function answersWithScore(score: PersonalityAnswer['score']): PersonalityAnswer[] {
  return getRandomPersonalityQuestions().map((question) => ({
    questionId: question.id,
    score,
  }));
}

function testRandomQuestionsRespectQuotas() {
  const questions = getRandomPersonalityQuestions();
  assert.equal(questions.length, 12);
  const counts = {
    analytical: questions.filter((question) => question.dimension === 'analytical').length,
    creative: questions.filter((question) => question.dimension === 'creative').length,
    people: questions.filter((question) => question.dimension === 'people').length,
    execution: questions.filter((question) => question.dimension === 'execution').length,
    risk: questions.filter((question) => question.dimension === 'risk').length,
  };
  assert.deepEqual(counts, { analytical: 3, creative: 2, people: 3, execution: 2, risk: 2 });
}

function testValidationRejectsIncompleteAndInvalidScores() {
  assert.throws(() => validatePersonalityAnswers([]));
  assert.throws(() => validatePersonalityAnswers([
    ...getRandomPersonalityQuestions().slice(0, -1).map((question) => ({
      questionId: question.id,
      score: 3 as const,
    })),
  ]));
  const badAnswers = answersWithScore(3);
  assert.throws(() => validatePersonalityAnswers([
    ...badAnswers.slice(1),
    { questionId: badAnswers[0].questionId, score: 6 as PersonalityAnswer['score'] },
  ]));
  assert.throws(() => validatePersonalityAnswers([
    ...getRandomPersonalityQuestions().map((question, index) => ({
      questionId: index === 0 ? 'not-a-question' : question.id,
      score: 3 as const,
    })),
  ]));
}

function testDimensionScoringNormalizesToZeroAndHundred() {
  const low = computePersonalityResult(answersWithScore(1));
  const high = computePersonalityResult(answersWithScore(5));
  Object.values(low.dimensions).forEach((value) => assert.equal(value, 0));
  Object.values(high.dimensions).forEach((value) => assert.equal(value, 100));
}

function testRecommendationsReturnFiveWithSponsorship() {
  const recommendations = computePersonalityRecommendations(answersWithScore(5));
  assert.equal(recommendations.length, 5);
  for (let index = 1; index < recommendations.length; index += 1) {
    assert.ok(recommendations[index - 1].score >= recommendations[index].score);
  }
  recommendations.forEach((recommendation) => {
    assert.ok(recommendation.sponsorship);
  });
}

function testResumeProfileLiftsMatchingRole() {
  const answers = answersWithScore(5);
  const withoutResume = computePersonalityRecommendations(answers);
  const withResume = computePersonalityRecommendations(answers, {
    education: [{ school: 'Test University', degree: 'Bachelor', major: 'Computer Science', endYear: 2026 }],
    internships: [{ company: 'Acme', role: 'Software Engineer', months: 6, isInternship: true }],
    workExperience: [],
    projects: [],
    skills: ['Python', 'SQL', 'React'],
    certificates: [],
  });

  assert.equal(withoutResume.length, 5);
  assert.ok(withResume.some((item) => item.roleKey === 'sde'));
  assert.ok(withResume.some((item) => ['sde', 'fullstack', 'backend'].includes(item.roleKey)));
}

function testDataProfileRanksSpecificDataRoles() {
  const recommendations = computePersonalityRecommendations(answersWithScore(5), {
    education: [{ school: 'Test University', degree: 'Bachelor', major: 'Statistics', endYear: 2026 }],
    internships: [{ company: 'Acme', role: 'Data Analyst', months: 6, isInternship: true }],
    workExperience: [],
    projects: [],
    skills: ['Python', 'SQL', 'Machine Learning', 'Tableau'],
    certificates: [],
  });
  const topKeys = recommendations.map((item) => item.roleKey);
  const dataRoleCount = topKeys.filter((key) => (
    ['ds', 'mle', 'da', 'data_engineer', 'bi'].includes(key)
  )).length;
  assert.ok(dataRoleCount >= 2, JSON.stringify(topKeys));
}

function testSponsorshipAlternativesAreSelected() {
  const highStats = {
    sde: { activeJobCount: 100, sponsorJobCount: 80, nonSponsorJobCount: 20, unknownJobCount: 0 },
    backend: { activeJobCount: 80, sponsorJobCount: 60, nonSponsorJobCount: 20, unknownJobCount: 0 },
    fullstack: { activeJobCount: 80, sponsorJobCount: 55, nonSponsorJobCount: 25, unknownJobCount: 0 },
    data_engineer: { activeJobCount: 60, sponsorJobCount: 45, nonSponsorJobCount: 15, unknownJobCount: 0 },
    ds: { activeJobCount: 60, sponsorJobCount: 40, nonSponsorJobCount: 20, unknownJobCount: 0 },
    mle: { activeJobCount: 50, sponsorJobCount: 35, nonSponsorJobCount: 15, unknownJobCount: 0 },
    da: { activeJobCount: 70, sponsorJobCount: 50, nonSponsorJobCount: 20, unknownJobCount: 0 },
    ba: { activeJobCount: 70, sponsorJobCount: 45, nonSponsorJobCount: 25, unknownJobCount: 0 },
  };
  const recommendations = computePersonalityRecommendations(answersWithScore(5), null, highStats);
  assert.equal(recommendations.length, 5);
  assert.ok(recommendations.slice(3).some((item) => (
    item.sponsorship?.level === 'high' || item.sponsorship?.level === 'medium'
  )));
}

function testSponsorshipStatsByRoleFiltersRegion() {
  const stats = computeSponsorshipStatsByRole([
    { direction: 'SDE', sponsorship: 'yes', region: 'New York, NY, United States' },
    { direction: 'SDE', sponsorship: 'no', region: 'Singapore' },
    { direction: 'Data', sponsorship: 'unknown', region: 'Singapore' },
  ], 'us');
  assert.equal(stats.sde?.sponsorJobCount, 1);
  assert.equal(stats.sde?.activeJobCount, 1);
  assert.equal(stats.da, undefined);
}

function testPersonalityProfileShape() {
  const result = computePersonalityResult(answersWithScore(4));
  const recommendations = computePersonalityRecommendations(answersWithScore(4));
  const profile: ResumeProfile = {
    education: [],
    internships: [],
    workExperience: [],
    projects: [],
    skills: [],
    certificates: [],
    personality: {
      model: 'career_fit',
      dimensions: result.dimensions,
      primaryDimension: result.primaryDimension,
      summaryKey: result.summaryKey,
      recommendations,
      completedAt: new Date().toISOString(),
    },
  };
  assert.equal(profile.personality?.model, 'career_fit');
  assert.equal(profile.personality?.recommendations.length, 5);
}

testValidationRejectsIncompleteAndInvalidScores();
testRandomQuestionsRespectQuotas();
testDimensionScoringNormalizesToZeroAndHundred();
testRecommendationsReturnFiveWithSponsorship();
testResumeProfileLiftsMatchingRole();
testDataProfileRanksSpecificDataRoles();
testSponsorshipAlternativesAreSelected();
testSponsorshipStatsByRoleFiltersRegion();
testPersonalityProfileShape();

console.log('personality assessment tests passed');
