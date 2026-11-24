import assert from 'node:assert/strict';

import { parseMatchExplanations, parseModelMatches, validateMatchSet } from '../src/lib/ai-match-contract';
import { applyMatchFeedbackPreferences, isClearlyUnavailable, matchExclusionReason, roleFit, selectMatchCandidates } from '../src/lib/ai-match-candidate-ranking';
import { buildMatchExplainContext } from '../src/lib/ai-match-explain-context';
import { buildFeatureExplanation, scoreMatchFeatures } from '../src/lib/ai-match-features';
import { defaultMatchFilters, parseJobIdList } from '../src/lib/ai-match-filters';
import { roleMatchLevel } from '../src/lib/ai-match-role-aliases';
import { jobExperienceMinYears } from '../src/lib/ai-match-experience';
import { finalizeMatch, isReportableMatch } from '../src/lib/ai-match-scoring';
import { buildMatchQualityMetrics, buildMatchRunSummary } from '../src/lib/ai-match-session';
import {
  assertTeaserHasNoLeak,
  buildMatchTeaser,
  emptyMatchTeaser,
  isWithinRestoreWindow,
  sanitizeMatchTeaser,
} from '../src/lib/ai-match-teaser';

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

function testRoleAliasesMatchCommonTitles() {
  assert.equal(roleMatchLevel('Software Engineer Intern', ['SWE', 'Software Engineer']), 'direct');
  assert.equal(roleMatchLevel('Backend Engineer', ['软件工程师']), 'direct');
  assert.equal(roleMatchLevel('Data Analyst', ['Software Engineer']), 'unrelated');
  assert.equal(roleFit({ id: 1, title: 'Software Engineer Intern', direction: 'Engineering' }, ['Software Engineer']), 'direct');
  assert.equal(roleFit({ id: 2, title: 'Product Manager', direction: 'Product' }, []), 'adjacent');
}

function testVisaAndJobTypeHardFilters() {
  const profile = {
    experienceYears: 0.6,
    careerStage: 'junior' as const,
    targetRoles: ['Software Engineer'],
    needsSponsorship: true,
    sponsorshipFilter: 'exclude_no' as const,
    jobTypes: ['实习' as const],
  };
  assert.equal(isClearlyUnavailable({ id: 1, title: 'Software Engineer Intern', sponsorship: 'no' }, profile), true);
  assert.equal(isClearlyUnavailable({ id: 2, title: 'Software Engineer Intern', sponsorship: 'yes', job_type: '实习' }, profile), false);
  assert.equal(isClearlyUnavailable({ id: 3, title: 'Staff Software Engineer', sponsorship: 'yes', job_type: '社招' }, profile), true);
}

function testFeatureScoreBeatsModelBreakdown() {
  const job = {
    id: 9,
    title: 'Software Engineer Intern',
    company: 'Acme',
    region: 'United States',
    direction: 'Engineering',
    sponsorship: 'yes' as const,
    requirements: 'Python React intern',
    description: 'New grad friendly intern role using Python',
  };
  const context = {
    profile: {
      skills: ['Python', 'React'],
      internships: [{ company: 'Startup', role: 'Software Engineer Intern', months: 6 }],
      workExperience: [],
      education: [],
      projects: [],
      certificates: [],
      intention: { roles: ['Software Engineer'], locations: ['美国'], visaStatus: 'us_f1_opt' },
    },
    segmentation: { careerStage: 'junior' as const, regions: ['us' as const], majorMatch: 'aligned' as const },
    locale: 'zh-CN' as const,
  };
  const features = scoreMatchFeatures(job, context);
  const finalized = finalizeMatch({
    ...validMatch(9),
    score_breakdown: { ats: 10, keywords: 10, experience: 10, evidence: 10, region: 10, profile_fit: 10 },
    match_score: 10,
  }, job, context, features);
  assert.equal(finalized.score_breakdown.keywords, features.breakdown.keywords);
  assert.ok(finalized.match_score >= 55);
  assert.equal(finalized.recommendation_type === 'apply_now' || finalized.recommendation_type === 'improve_then_apply', true);
}

function testDefaultFiltersFollowProfile() {
  const defaults = defaultMatchFilters({
    profile: {
      education: [],
      internships: [],
      workExperience: [],
      projects: [],
      skills: [],
      certificates: [],
      intention: { locations: ['美国'], visaStatus: 'us_f1_opt' },
    },
    segmentation: { careerStage: 'junior', regions: ['us'] } as never,
    regionOptions: ['美国', '英国', '新加坡'],
    jobTypeOptions: ['实习', '校招', '社招'],
  });
  assert.deepEqual(defaults.regions, ['美国']);
  assert.deepEqual(defaults.jobTypes, ['实习']);
  assert.equal(defaults.sponsorship, 'exclude_no');
}

function testExclusionReasonsAreTransparent() {
  const profile = {
    experienceYears: 0.6,
    careerStage: 'junior' as const,
    targetRoles: ['Software Engineer'],
    needsSponsorship: true,
    sponsorshipFilter: 'exclude_no' as const,
    jobTypes: ['实习' as const],
  };
  assert.equal(matchExclusionReason({ id: 1, title: 'Software Engineer Intern', experience_min_years: 4 }, profile), 'experience');
  assert.equal(matchExclusionReason({ id: 2, title: 'Staff Software Engineer' }, profile), 'senior_title');
  assert.equal(matchExclusionReason({ id: 3, title: 'Software Engineer Intern', sponsorship: 'no', job_type: '实习' }, profile), 'sponsorship');
  assert.equal(matchExclusionReason({ id: 4, title: 'New Grad Software Engineer', sponsorship: 'yes', job_type: '校招' }, profile), 'job_type');
  const selected = selectMatchCandidates([
    { id: 1, title: 'Staff Software Engineer', sponsorship: 'yes' },
    { id: 2, title: 'Software Engineer Intern', sponsorship: 'no', job_type: '实习' },
    { id: 3, title: 'Software Engineer Intern', sponsorship: 'yes', job_type: '实习' },
  ], profile, 4);
  assert.deepEqual(selected.jobs.map((job) => job.id), [3]);
  assert.equal(selected.exclusionCounts.senior_title, 1);
  assert.equal(selected.exclusionCounts.sponsorship, 1);
}

function testMatchSummaryExplainsEmptyBatch() {
  const summary = buildMatchRunSummary({
    retrievedCount: 40,
    suitableCount: 0,
    selectedCount: 0,
    filters: { regions: ['美国'], directions: [], job_types: ['实习'], sponsorship: 'exclude_no' },
    exclusions: { experience: 8, senior_title: 4, sponsorship: 20, job_type: 8, feedback: 0 },
  });
  assert.equal(summary.empty_reason, 'no_suitable');
  assert.equal(summary.exclusions.sponsorship, 20);
  const quality = buildMatchQualityMetrics([
    { role_fit: 'direct', recommendation_type: 'apply_now', sponsorship: 'yes', match_score: 80 },
    { role_fit: 'adjacent', recommendation_type: 'improve_then_apply', sponsorship: 'unknown', match_score: 60 },
  ]);
  assert.equal(quality.direct_count, 1);
  assert.equal(quality.apply_now_count, 1);
  assert.equal(quality.mean_score, 70);
}

function testExplainContextUsesRegionDna() {
  const context = buildMatchExplainContext({
    segmentation: {
      careerStage: 'junior',
      careerStageReason: '大二在读',
      schoolTier: 2,
      schoolTierSource: 'builtin',
      targetSchoolHits: [],
      regions: ['us'],
      regionSource: 'intention',
      experienceQuality: { internshipCount: 1, bigNameCount: 0, totalMonths: 3, quantifiedDensity: 'medium' },
      summary: 'junior us intern',
    },
    jobs: [{ region: 'United States' }],
    locale: 'zh-CN',
  });
  assert.match(context.regionBlock, /美国/);
  assert.match(context.segmentBlock, /junior/);
  const explanation = buildFeatureExplanation({
    title: 'Software Engineer Intern',
    region: 'United States',
  }, {
    score: 78,
    breakdown: { ats: 80, keywords: 76, experience: 75, evidence: 72, region: 85, profile_fit: 80 },
    roleFit: 'direct',
    roleScore: 90,
    skillHits: ['python'],
    skillMisses: [],
    regionMatch: true,
    track: 'internship',
    targetCompany: false,
    needsSponsorship: true,
    experienceYears: 0.5,
    notes: ['target_role'],
  }, 'zh-CN');
  assert.match(explanation.suggestions, /签证状态|LeetCode|美国/);
}

function testExplanationContract() {
  const matches = parseMatchExplanations(JSON.stringify({
    matches: [{
      job_id: 3,
      match_reason: '技能重合明确。',
      evidence: ['Python 项目'],
      key_gaps: ['缺少云经验'],
      suggestions: '先补项目再投。',
    }],
  }));
  assert.equal(matches[0]?.job_id, 3);
}

function testParseJobIdListKeepsOrderAndCaps() {
  assert.deepEqual(parseJobIdList(['12', 12, 0, -3, 'ab', 7, 8], 3), [12, 7, 8]);
  assert.deepEqual(parseJobIdList(null, 8), []);
  assert.deepEqual(parseJobIdList([1, 2], 0), []);
}

function testHighExperienceJobsAreHardFiltered() {
  const profile = { experienceYears: 0.4, careerStage: 'junior' as const, targetRoles: ['Software Engineer'] };
  assert.equal(jobExperienceMinYears({ title: 'Software Engineer', experience_min_years: 5 }), 5);
  assert.equal(jobExperienceMinYears({ title: 'Software Engineer', experience_text: '5+ years of experience' }), 5);
  assert.equal(jobExperienceMinYears({
    title: 'Software Engineer',
    requirements: 'Minimum 4 years of professional experience with Python',
  }), 4);
  assert.equal(matchExclusionReason({ id: 1, title: 'Software Engineer', experience_min_years: 5 }, profile), 'experience');
  assert.equal(matchExclusionReason({ id: 2, title: 'Software Engineer', experience_text: '5+ years of experience' }, profile), 'experience');
  assert.equal(matchExclusionReason({
    id: 3,
    title: 'Software Engineer',
    requirements: 'Minimum 4 years of professional experience',
  }, profile), 'experience');
  assert.equal(matchExclusionReason({ id: 4, title: 'Software Engineer', job_type: '社招' }, profile), 'senior_title');
  assert.equal(matchExclusionReason({ id: 5, title: 'Software Engineer Intern', experience_min_years: 0 }, profile), null);
  const selected = selectMatchCandidates([
    { id: 1, title: 'Software Engineer', experience_min_years: 5, lexical_score: 0.99 },
    { id: 2, title: 'Staff Software Engineer', lexical_score: 0.98 },
    { id: 3, title: 'Software Engineer', job_type: '社招', lexical_score: 0.97 },
    { id: 4, title: 'Software Engineer Intern', experience_min_years: 0, lexical_score: 0.4 },
    { id: 5, title: 'Junior Software Engineer', experience_min_years: 1, lexical_score: 0.35 },
  ], profile, 4);
  assert.deepEqual(selected.jobs.map((job) => job.id), [4, 5]);
  assert.ok(selected.exclusionCounts.experience >= 1);
  assert.ok(selected.exclusionCounts.senior_title >= 1);
}

function testImproveThenApplyCopyDoesNotReject() {
  const internJob = {
    id: 12,
    title: 'Software Engineer Intern',
    region: 'United States',
    job_type: '实习',
    sponsorship: 'yes' as const,
    requirements: 'Python intern',
  };
  const juniorContext = {
    profile: {
      skills: ['Python'],
      internships: [{ company: 'Startup', role: 'Software Engineer Intern', months: 4 }],
      workExperience: [],
      education: [],
      projects: [],
      certificates: [],
      intention: { roles: ['Software Engineer'], locations: ['美国'], visaStatus: 'us_f1_opt' },
    },
    segmentation: { careerStage: 'junior' as const, regions: ['us' as const], majorMatch: 'aligned' as const },
    locale: 'zh-CN' as const,
  };
  const aligned = finalizeMatch({
    ...validMatch(12),
    match_reason: '经验差距过大，不建议考虑这份岗位。',
    suggestions: '暂不建议投入时间申请。',
    key_gaps: ['不建议申请，年限不够'],
  }, internJob, juniorContext);
  assert.equal(aligned.recommendation_type === 'apply_now' || aligned.recommendation_type === 'improve_then_apply', true);
  assert.equal(isReportableMatch(aligned), true);
  assert.doesNotMatch(`${aligned.match_reason}${aligned.suggestions}${aligned.key_gaps.join('')}`, /不建议/);

  const blocked = finalizeMatch(validMatch(13), {
    title: 'Senior Software Engineer',
    region: 'United States',
    job_type: '社招',
    experience_min_years: 5,
  }, juniorContext);
  assert.equal(blocked.recommendation_type, 'low_priority');
  assert.equal(blocked.eligibility.status, 'blocked');
  assert.equal(isReportableMatch(blocked), false);
}

function testTeaserStripsIdsScoresAndUrls() {
  const teaser = buildMatchTeaser({
    jobs: [
      {
        company: 'Google',
        title: 'Software Engineer Intern',
        region: 'United States',
        direction: 'Engineering',
      },
      {
        company: 'Meta',
        job_title: 'Data Scientist Intern',
        region: 'Singapore',
        direction: 'Data',
      },
      {
        company: 'Stripe',
        title: 'Backend Engineer',
        region: 'United Kingdom',
      },
    ],
    retrievedCount: 186,
    suitableCount: 24,
    reportLimit: 8,
    sampleLimit: 2,
  });
  assert.equal(teaser.sample_count, 2);
  assert.equal(teaser.report_count, 3);
  assert.equal(teaser.locked_count, 1);
  assert.equal(teaser.samples[0]?.company, 'Google');
  assert.equal(teaser.samples[1]?.title, 'Data Scientist Intern');
  assertTeaserHasNoLeak(teaser);

  const sanitized = sanitizeMatchTeaser({
    ...teaser,
    samples: [
      {
        company: 'OpenAI',
        title: 'See https://openai.com/careers',
        region: 'United States',
        job_id: 99,
        match_score: 96,
        job_url: 'https://openai.com/careers/99',
      },
      { company: 'Anthropic', title: 'Research Engineer' },
    ],
  });
  assert.equal(sanitized.samples.length, 1);
  assert.equal(sanitized.samples[0]?.company, 'Anthropic');
  assertTeaserHasNoLeak(sanitized);
  assert.doesNotMatch(JSON.stringify(sanitized), /job_id|match_score|https?:\/\//);
  assert.equal(emptyMatchTeaser().sample_count, 0);
  assert.equal(isWithinRestoreWindow(new Date(Date.now() - 60 * 60 * 1000).toISOString()), true);
  assert.equal(isWithinRestoreWindow(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()), false);
}

testValidContract();
testCodeFenceIsOnlyPresentationWrapper();
testStructuredObjectContract();
testMalformedModelOutputFails();
testJobSetMustBeCompleteAndUnique();
testCandidateRankingKeepsEarlyCareerRoles();
testCandidateRankingAddsDiversity();
testCandidateRankingUsesFeedbackWithoutOverfitting();
testRoleAliasesMatchCommonTitles();
testVisaAndJobTypeHardFilters();
testFeatureScoreBeatsModelBreakdown();
testDefaultFiltersFollowProfile();
testExclusionReasonsAreTransparent();
testMatchSummaryExplainsEmptyBatch();
testExplainContextUsesRegionDna();
testExplanationContract();
testParseJobIdListKeepsOrderAndCaps();
testHighExperienceJobsAreHardFiltered();
testImproveThenApplyCopyDoesNotReject();
testTeaserStripsIdsScoresAndUrls();
console.log('phase3 contract tests passed');
