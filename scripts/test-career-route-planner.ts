import assert from 'node:assert/strict';
import {
  buildCareerRoutePlan,
  classifyVisaStatus,
  getLocalizedText,
  getVisaFeasibility,
  requiresSponsorshipForRegion,
} from '../src/lib/career-route-planner';
import { applyOverrides } from '../src/lib/user-segmentation';
import { isAcademicResearchRole } from '../src/lib/resume-parser';
import type { ResumeProfile, UserSegmentation } from '../src/lib/resume-types';

function segmentation(overrides: Partial<UserSegmentation> = {}): UserSegmentation {
  return {
    careerStage: 'senior',
    careerStageReason: 'test',
    schoolTier: 2,
    schoolTierSource: 'builtin',
    targetSchoolHits: [],
    majorMatch: 'aligned',
    regions: ['us'],
    regionSource: 'intention',
    experienceQuality: {
      internshipCount: 2,
      bigNameCount: 1,
      totalMonths: 6,
      quantifiedDensity: 'high',
    },
    summary: 'test',
    ...overrides,
  };
}

function baseProfile(overrides: Partial<ResumeProfile> = {}): ResumeProfile {
  return {
    education: [],
    internships: [],
    workExperience: [],
    projects: [],
    skills: [],
    certificates: [],
    ...overrides,
  };
}

function now(year: number, month: number, day = 1): Date {
  return new Date(year, month - 1, day);
}

function testUSBachelorMainSeason() {
  const profile = baseProfile({
    education: [{ school: 'University of Michigan', degree: 'Bachelor of Arts', major: 'Economics', startYear: 2023, endYear: 2027, gpa: '3.85' }],
    intention: { roles: ['Investment Banking'], locations: ['United States'], industries: ['Finance'] },
    skills: ['Python', 'Stata'],
  });
  const plan = buildCareerRoutePlan(profile, segmentation(), 'us', now(2026, 8));
  assert.equal(plan.diagnosis.window, 'main_application');
  assert.equal(plan.diagnosis.mainRoute, 'return_offer_internship');
  assert.equal(plan.diagnosis.backupRoute?.route, 'grad_school_backup');
}

function testOneYearMasterUK() {
  const profile = baseProfile({
    education: [{ school: 'LSE', degree: 'Master of Science', major: 'Finance', startYear: 2026, endYear: 2027 }],
    intention: { roles: ['IBD'], locations: ['United Kingdom'], industries: ['Finance'] },
  });
  const plan = buildCareerRoutePlan(profile, segmentation({ regions: ['uk'] }), 'uk', now(2026, 8));
  assert.equal(plan.diagnosis.window, 'main_application');
  assert.equal(plan.diagnosis.mainRoute, 'direct_fulltime');
  assert.equal(plan.diagnosis.backupRoute?.route, 'return_offer_internship');
}

function testTwoYearMasterSingapore() {
  const profile = baseProfile({
    education: [{ school: 'NUS', degree: 'Master', major: 'Business Analytics', startYear: 2025, endYear: 2027 }],
    intention: { roles: ['Data Analyst'], locations: ['Singapore'] },
  });
  const plan = buildCareerRoutePlan(profile, segmentation({ regions: ['sg'] }), 'sg', now(2026, 8));
  assert.equal(plan.diagnosis.window, 'main_application');
  assert.equal(plan.diagnosis.mainRoute, 'return_offer_internship');
}

function testCanadaCoop() {
  const profile = baseProfile({
    education: [{ school: 'University of Toronto', degree: 'Bachelor', major: 'Finance', startYear: 2023, endYear: 2027 }],
    careerSignals: { coop: true },
    intention: { roles: ['Finance'], locations: ['Canada'] },
  });
  const plan = buildCareerRoutePlan(profile, segmentation({ regions: ['ca'] }), 'ca', now(2026, 9));
  assert.equal(plan.diagnosis.window, 'main_application');
  assert.equal(plan.diagnosis.mainRoute, 'coop');
}

function testAustraliaTimeline() {
  const profile = baseProfile({
    education: [{ school: 'University of Sydney', degree: 'Bachelor', major: 'Finance', startYear: 2023, endYear: 2027 }],
    intention: { roles: ['Investment Banking'], locations: ['Australia'] },
  });
  const plan = buildCareerRoutePlan(profile, segmentation({ regions: ['au'] }), 'au', now(2026, 4));
  assert.equal(plan.diagnosis.window, 'main_application');
  assert.equal(plan.diagnosis.mainRoute, 'direct_fulltime');
}

function testHongKongNonTargetFinanceRisk() {
  const profile = baseProfile({
    education: [{ school: 'Example State University', degree: 'Bachelor', major: 'Economics', startYear: 2023, endYear: 2027 }],
    intention: { roles: ['Investment Banking'], locations: ['Hong Kong'], industries: ['Finance'] },
  });
  const plan = buildCareerRoutePlan(
    profile,
    segmentation({ regions: ['hk'], schoolTier: 3, majorMatch: 'unrelated' }),
    'hk',
    now(2026, 7),
  );
  assert.ok(plan.diagnosis.risks.some((risk) => risk.key === 'non_target_finance'));
  assert.ok(plan.diagnosis.risks.some((risk) => risk.key === 'major_mismatch'));
}

function testExperiencedSwitch() {
  const profile = baseProfile({
    workExperience: [{ company: 'Acme', role: 'Analyst', months: 24, isInternship: false }],
  });
  const plan = buildCareerRoutePlan(
    profile,
    segmentation({ careerStage: 'experienced', regions: ['cn_t1'] }),
    'cn_t1',
    now(2026, 8),
  );
  assert.equal(plan.diagnosis.window, 'experienced');
  assert.equal(plan.diagnosis.mainRoute, 'experienced_switch');
}

function testLocalizedTextSelection() {
  assert.equal(
    getLocalizedText({ 'zh-CN': '中文', 'zh-TW': '繁體', en: 'English' }, 'en'),
    'English',
  );
  assert.equal(
    getLocalizedText({ 'zh-CN': '中文' }, 'en'),
    '中文',
  );
  assert.equal(
    getLocalizedText('legacy string', 'en'),
    'legacy string',
  );
  assert.equal(
    getLocalizedText(undefined, 'zh-TW'),
    undefined,
  );
}

function testLocalizedPlanRefinement() {
  const profile = baseProfile({
    education: [{ school: 'University of Michigan', degree: 'Bachelor', major: 'Economics', startYear: 2023, endYear: 2027, gpa: '3.85' }],
    intention: { roles: ['Investment Banking'], locations: ['United States'] },
  });
  const plan = buildCareerRoutePlan(
    profile,
    segmentation(),
    'us',
    now(2026, 8),
    {
      narratives: { 'zh-CN': '中文说明', 'zh-TW': '繁體說明', en: 'English narrative' },
      backupRoutes: { 'zh-CN': '中文备选', en: 'English backup' },
      verificationNotes: { 'zh-CN': '中文核实', en: 'English verification' },
    },
  );
  assert.equal(getLocalizedText(plan.diagnosis.llmNarrative, 'en'), 'English narrative');
  assert.equal(getLocalizedText(plan.diagnosis.llmBackupRoute, 'en'), 'English backup');
  assert.equal(getLocalizedText(plan.diagnosis.verificationNote, 'zh-TW'), '中文核实');
}

function testVisaClassification() {
  assert.equal(classifyVisaStatus('F1 OPT', undefined), 'student');
  assert.equal(classifyVisaStatus('H1B', undefined), 'work_visa');
  assert.equal(classifyVisaStatus('Green Card', undefined), 'permanent');
  assert.equal(classifyVisaStatus('需要雇主担保', undefined), 'none');
  assert.equal(classifyVisaStatus(undefined, undefined), 'unknown');
  assert.equal(getVisaFeasibility('student', 'us'), 'conditional');
  assert.equal(getVisaFeasibility('permanent', 'us'), 'likely');
  assert.equal(requiresSponsorshipForRegion('cn_t1', 'student'), false);
}

function testVisaAwarePlan() {
  const base = {
    education: [{ school: 'University of Michigan', degree: 'Bachelor', major: 'Economics', startYear: 2023, endYear: 2027, gpa: '3.85' }],
    intention: { roles: ['Investment Banking'], locations: ['United States'] },
  };

  const studentPlan = buildCareerRoutePlan(
    baseProfile({ ...base, intention: { ...base.intention, visaStatus: 'student' } }),
    segmentation(),
    'us',
    now(2026, 8),
  );
  assert.equal(studentPlan.diagnosis.visaStatus, 'student');
  assert.equal(studentPlan.diagnosis.visaFeasibility, 'conditional');
  assert.ok(studentPlan.diagnosis.risks.some((risk) => risk.key === 'visa_conditional_unspecified'));

  const h1bPlan = buildCareerRoutePlan(
    baseProfile({ ...base, intention: { ...base.intention, visaStatus: 'work_visa' } }),
    segmentation(),
    'us',
    now(2026, 8),
  );
  assert.equal(h1bPlan.diagnosis.visaFeasibility, 'likely');
  assert.ok(!h1bPlan.diagnosis.risks.some((risk) => risk.key === 'visa_conditional'));

  const nonePlan = buildCareerRoutePlan(
    baseProfile({ ...base, intention: { ...base.intention, workAuthorization: '需要雇主担保' } }),
    segmentation(),
    'us',
    now(2026, 8),
  );
  assert.equal(nonePlan.diagnosis.visaFeasibility, 'blocked');
  assert.ok(nonePlan.diagnosis.risks.some((risk) => risk.key === 'visa_blocker'));
}

function testVisaTimelineInDiagnosis() {
  const profile = baseProfile({
    education: [{ school: 'NYU', degree: 'Master', major: 'Economics', startYear: 2024, endYear: 2026 }],
    intention: {
      roles: ['Data Analyst'],
      locations: ['United States'],
      visaStatus: 'us_f1_opt',
      visaDates: { programEndDate: '2026-05-15' },
    },
  });
  const plan = buildCareerRoutePlan(
    profile,
    segmentation({ careerStage: 'senior', regions: ['us'] }),
    'us',
    now(2026, 2),
  );
  assert.ok(plan.diagnosis.visaTimeline?.entries.some((entry) => entry.key === 'h1b_lottery'));
  assert.equal(plan.diagnosis.visaFeasibility, 'conditional');
  assert.ok(plan.diagnosis.risks.some((risk) => risk.key === 'visa_conditional_us_f1_opt'));
}

function testManualSeniorWinsOverFulltimeMonths() {
  const profile = baseProfile({
    education: [{ school: 'NYU', degree: 'Master', major: 'Economics', startYear: 2024, endYear: 2026 }],
    workExperience: [
      { company: 'NYU Department of Economics', role: 'Research Assistant', months: 12, isInternship: false },
      { company: 'NYU Department of History', role: 'Research Assistant', months: 12, isInternship: false },
    ],
    intention: { roles: ['Data Analyst'], locations: ['United States'] },
  });
  const plan = buildCareerRoutePlan(
    profile,
    segmentation({ careerStage: 'senior', regions: ['us'] }),
    'us',
    now(2026, 8),
  );
  assert.equal(plan.diagnosis.window, 'fulltime_apply');
}

function testLowGradeFocus() {
  const profile = baseProfile({
    education: [{ school: 'University of Michigan', degree: 'Bachelor', major: 'Computer Science', startYear: 2025, endYear: 2029 }],
    intention: { roles: ['Software Engineer'], locations: ['United States'], visaStatus: 'us_f1_opt' },
  });
  const plan = buildCareerRoutePlan(
    profile,
    segmentation({ careerStage: 'junior', regions: ['us'] }),
    'us',
    now(2026, 2),
  );
  assert.equal(plan.diagnosis.lowGradeFocus, true);
  assert.ok(!plan.diagnosis.risks.some((risk) => risk.key.startsWith('visa_')));
  assert.ok(plan.items.some((item) => item.titleKey === 'dashboard.plan.nowBackgroundShaping.title'));
}

function testAcademicResearchHeuristic() {
  assert.equal(isAcademicResearchRole('NYU Department of Economics', 'Research Assistant'), true);
  assert.equal(isAcademicResearchRole('University', 'Teaching Assistant'), true);
  assert.equal(isAcademicResearchRole('Microsoft', 'Strategy Intern'), false);
}

function testReparsePreservesOverrides() {
  const next = applyOverrides(
    segmentation({ careerStage: 'experienced' }),
    { careerStage: 'senior' },
  );
  assert.equal(next.careerStage, 'senior');
}

testUSBachelorMainSeason();
testOneYearMasterUK();
testTwoYearMasterSingapore();
testCanadaCoop();
testAustraliaTimeline();
testHongKongNonTargetFinanceRisk();
testExperiencedSwitch();
testLocalizedTextSelection();
testLocalizedPlanRefinement();
testVisaClassification();
testVisaAwarePlan();
testVisaTimelineInDiagnosis();
testManualSeniorWinsOverFulltimeMonths();
testLowGradeFocus();
testAcademicResearchHeuristic();
testReparsePreservesOverrides();
console.log('career route planner tests passed');
