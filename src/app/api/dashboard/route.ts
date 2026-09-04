import { NextRequest, NextResponse } from 'next/server';
import { type RegionKey, REGION_DNA, shouldBeApplying } from '@/lib/region-dna';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { buildCareerRoutePlan, type CareerRouteDiagnosis } from '@/lib/career-route-planner';
import type { ResumeProfile, UserSegmentation } from '@/lib/resume-types';
import { resolveActiveRegion } from '@/lib/user-region';
import { regionRequiresIdentity, resolveVisaStatusForRegion } from '@/lib/visa-timeline';
import {
  buildPersonalityFeasibility,
  computePersonalityAssessment,
  computeSponsorshipStatsByRole,
  type PersonalityAnswer,
} from '@/lib/personality-assessment';

type Timeframe = 'now' | 'week' | 'month';
type CareerStage = 'junior' | 'senior' | 'experienced' | 'returning_intern';
type MajorMatch = 'aligned' | 'related' | 'general' | 'unrelated';

interface PlanItem {
  timeframe: Timeframe;
  titleKey: string;
  descriptionKey: string;
  descriptionText?: string;
  params?: Record<string, string | number>;
  href?: string;
}

interface PlanContext {
  region: string;
  stage: string;
  role: string;
}

interface DashboardPlan {
  context: PlanContext;
  items: PlanItem[];
  diagnosis: CareerRouteDiagnosis | null;
}

interface PlanRegionData {
  region: RegionKey;
  plan: DashboardPlan;
  feasibilityLabelKey: string;
}

interface DashboardResume {
  id?: number;
  segmentation_confirmed?: boolean | null;
  profile?: {
    personality?: {
      dimensions?: Record<string, number>;
      primaryDimension?: string;
      summaryKey?: string;
      recommendations?: Array<{
        roleKey: string;
        labelKey: string;
        score: number;
        personalityFit?: number;
        resumeFit?: number;
        marketScore?: number;
        feasibilityScore?: number;
        feasibilityBlocked?: boolean;
        feasibilityLabelKey?: string;
        fit: string;
        reasons: string[];
        sponsorship?: {
          level: string;
          noteKey?: string;
          sponsorJobCount?: number;
          activeJobCount?: number;
        } | null;
      }>;
      regionKey?: RegionKey | null;
      completedAt?: string;
    } | null;
    targetRegion?: string | null;
    inferredRegion?: string | null;
    targetRole?: string | null;
    intention?: {
      roles?: string[] | null;
      locations?: string[] | null;
      industries?: string[] | null;
      targetCompanies?: string[] | null;
      workAuthorization?: string | null;
      visaStatus?: string | null;
      visaByRegion?: Record<string, string> | null;
      visaDates?: {
        programEndDate?: string | null;
        visaStartDate?: string | null;
        visaEndDate?: string | null;
        stemEligible?: boolean | null;
      } | null;
    } | null;
    education?: Array<{
      school?: string | null;
      degree?: string | null;
      major?: string | null;
      startYear?: number | null;
      endYear?: number | null;
      gpa?: string | null;
      qsEstimate?: number | null;
    }> | null;
    skills?: string[] | null;
    internships?: Array<{
      company?: string | null;
      role?: string | null;
      months?: number | null;
      isInternship?: boolean | null;
    }> | null;
    workExperience?: Array<{
      company?: string | null;
      role?: string | null;
      months?: number | null;
      isInternship?: boolean | null;
    }> | null;
    projects?: Array<{ name?: string | null; role?: string | null }> | null;
    careerSignals?: ResumeProfile['careerSignals'];
    planRefinement?: ResumeProfile['planRefinement'];
  } | null;
  segmentation?: UserSegmentation | null;
  segmentation_overrides?: {
    regions?: RegionKey[] | null;
  } | null;
}

interface DashboardOverview {
  latest_resume: DashboardResume | null;
  preferred_region?: string | null;
  latest_interview: { id: number; status: string; updated_at: string; created_at: string } | null;
  resume_count: number;
  match_count: number;
  avg_match_score: number;
  interview_count: number;
  weekly_application_count: number;
  application_count: number;
}

interface DashboardPersonalization {
  roles: string[];
  locations: string[];
  industries: string[];
  companies: string[];
  education: string[];
  skillCount: number;
  internshipCount: number;
  internshipMonths: number;
  workMonths: number;
  projectCount: number;
  focusAreas: Array<{
    key: string;
    titleKey: string;
    descriptionKey: string;
    descriptionParams: Record<string, string | number>;
    href: string;
  }>;
}

function cleanProfileValues(values?: string[] | null): string[] {
  return [...new Set((values || []).map((value) => value.trim()).filter(Boolean))].slice(0, 12);
}

function buildDashboardPersonalization(resume: DashboardResume | null, regions: RegionKey[] = []): DashboardPersonalization | null {
  const profile = resume?.profile;
  if (!profile) return null;
  const intention = profile.intention;
  const roles = cleanProfileValues(intention?.roles);
  const locations = regions.length > 0
    ? regions.map((region) => `region.${region}`)
    : cleanProfileValues(intention?.locations);
  const industries = cleanProfileValues(intention?.industries);
  const companies = cleanProfileValues(intention?.targetCompanies);
  const latestEducation = (profile.education || [])
    .filter((item) => item.school || item.degree || item.major)
    .sort((left, right) => (right.endYear || 0) - (left.endYear || 0))
    .slice(0, 2)
    .map((item) => [item.school, item.degree, item.major, item.endYear].filter(Boolean).join(' / '));
  const internships = profile.internships || [];
  const workExperience = profile.workExperience || [];
  const focusAreas: DashboardPersonalization['focusAreas'] = [];
  if (roles.length > 0) {
    focusAreas.push({
      key: 'roles',
      titleKey: 'dashboard.personalization.focus.roles.title',
      descriptionKey: 'dashboard.personalization.focus.roles.description',
      descriptionParams: { roles: roles.slice(0, 3).join('、') },
      href: '/optimize',
    });
  } else {
    focusAreas.push({
      key: 'roles_missing',
      titleKey: 'dashboard.personalization.focus.rolesMissing.title',
      descriptionKey: 'dashboard.personalization.focus.rolesMissing.description',
      descriptionParams: {},
      href: '/resume',
    });
  }
  if (companies.length > 0) {
    focusAreas.push({
      key: 'companies',
      titleKey: 'dashboard.personalization.focus.companies.title',
      descriptionKey: 'dashboard.personalization.focus.companies.description',
      descriptionParams: { companies: companies.slice(0, 3).join('、') },
      href: '/jobs',
    });
  }
  if (industries.length > 0) {
    focusAreas.push({
      key: 'industries',
      titleKey: 'dashboard.personalization.focus.industries.title',
      descriptionKey: 'dashboard.personalization.focus.industries.description',
      descriptionParams: { industries: industries.slice(0, 3).join('、') },
      href: '/jobs',
    });
  }
  const quantifiedDensity = resume.segmentation?.experienceQuality?.quantifiedDensity;
  if (internships.length === 0 || quantifiedDensity === 'low') {
    focusAreas.push({
      key: 'evidence',
      titleKey: 'dashboard.personalization.focus.evidence.title',
      descriptionKey: 'dashboard.personalization.focus.evidence.description',
      descriptionParams: { internships: internships.length, projects: profile.projects?.length || 0 },
      href: '/resume',
    });
  } else if ((profile.skills || []).length < 5) {
    focusAreas.push({
      key: 'skills',
      titleKey: 'dashboard.personalization.focus.skills.title',
      descriptionKey: 'dashboard.personalization.focus.skills.description',
      descriptionParams: { count: profile.skills?.length || 0 },
      href: '/resume',
    });
  }
  return {
    roles,
    locations,
    industries,
    companies,
    education: latestEducation,
    skillCount: profile.skills?.length || 0,
    internshipCount: internships.length,
    internshipMonths: internships.reduce((sum, item) => sum + (item.months || 0), 0),
    workMonths: workExperience.reduce((sum, item) => sum + (item.months || 0), 0),
    projectCount: profile.projects?.length || 0,
    focusAreas: focusAreas.slice(0, 4),
  };
}

const REGION_LABEL_KEYS: Record<RegionKey, string> = {
  us: 'region.us',
  uk: 'region.uk',
  sg: 'region.sg',
  cn_t1: 'region.cn_t1',
  cn_t2: 'region.cn_t2',
  ca: 'region.ca',
  hk: 'region.hk',
  au: 'region.au',
};

const STAGE_LABEL_KEYS: Record<CareerStage, string> = {
  junior: 'stage.junior',
  senior: 'stage.senior',
  experienced: 'stage.experienced',
  returning_intern: 'stage.returningIntern',
};

function getRoleCategory(targetRole?: string): string {
  if (!targetRole) return 'dashboard.role.other';
  const lower = targetRole.toLowerCase();
  if (lower.includes('产品')) return 'dashboard.role.product';
  if (lower.includes('数据')) return 'dashboard.role.data';
  if (lower.includes('运营')) return 'dashboard.role.operations';
  if (lower.includes('市场') || lower.includes('营销')) return 'dashboard.role.marketing';
  if (lower.includes('金融') || lower.includes('投行') || lower.includes('投资')) return 'dashboard.role.finance';
  if (lower.includes('咨询')) return 'dashboard.role.consulting';
  if (lower.includes('前端') || lower.includes('后端') || lower.includes('算法') || lower.includes('开发')) return 'dashboard.role.tech';
  if (/engineer|developer|software|sde/i.test(targetRole)) return 'dashboard.role.tech';
  if (/product manager|pm/i.test(targetRole)) return 'dashboard.role.product';
  if (/data|analyst|analytics/i.test(targetRole)) return 'dashboard.role.data';
  if (/finance|investment|banking/i.test(targetRole)) return 'dashboard.role.finance';
  if (/consulting|consultant/i.test(targetRole)) return 'dashboard.role.consulting';
  return 'dashboard.role.other';
}

function buildLegacyPlan(resume: DashboardResume | null, regionKey: RegionKey): DashboardPlan {
  const stage: CareerStage = resume?.segmentation?.careerStage ?? 'senior';
  const targetRole: string = resume?.profile?.intention?.roles?.[0]
    ?? resume?.profile?.targetRole
    ?? resume?.segmentation?.targetRole
    ?? '';
  const roleKey = getRoleCategory(targetRole);
  const majorMatch: MajorMatch = resume?.segmentation?.majorMatch ?? 'aligned';

  const regionLabelKey = REGION_LABEL_KEYS[regionKey];
  const stageLabelKey = STAGE_LABEL_KEYS[stage] ?? STAGE_LABEL_KEYS.senior;

  const context: PlanContext = {
    region: regionLabelKey,
    stage: stageLabelKey,
    role: roleKey,
  };

  const items: PlanItem[] = [];

  // ===== 立即做 =====
  items.push({
    timeframe: 'now',
    titleKey: 'dashboard.plan.nowCompleteResume.title',
    descriptionKey: 'dashboard.plan.nowCompleteResume.desc',
    href: '/resume',
  });

  items.push({
    timeframe: 'now',
    titleKey: 'dashboard.plan.nowTargetRegion.title',
    descriptionKey: 'dashboard.plan.nowTargetRegion.desc',
    params: { region: regionLabelKey },
  });

  if (regionKey === 'us' || regionKey === 'uk' || regionKey === 'sg') {
    items.push({
      timeframe: 'now',
      titleKey: 'dashboard.plan.nowVisa.title',
      descriptionKey: 'dashboard.plan.nowVisa.desc',
      params: { region: regionLabelKey },
    });
  }

  items.push({
    timeframe: 'now',
    titleKey: 'dashboard.plan.nowKeywords.title',
    descriptionKey: 'dashboard.plan.nowKeywords.desc',
    params: { role: roleKey },
    href: '/optimize',
  });

  items.push({
    timeframe: 'now',
    titleKey: 'dashboard.plan.nowMock.title',
    descriptionKey: 'dashboard.plan.nowMock.desc',
    href: '/mock-interview',
  });

  // ===== 本周做 =====
  const weeklyGoal = stage === 'experienced' ? 8 : stage === 'senior' ? 10 : 5;
  items.push({
    timeframe: 'week',
    titleKey: 'dashboard.plan.weekApply.title',
    descriptionKey: 'dashboard.plan.weekApply.desc',
    params: { count: weeklyGoal, region: regionLabelKey },
    href: '/jobs',
  });

  if (majorMatch === 'related' || majorMatch === 'unrelated') {
    items.push({
      timeframe: 'week',
      titleKey: 'dashboard.plan.weekProjects.title',
      descriptionKey: 'dashboard.plan.weekProjects.desc',
      params: { role: roleKey },
      href: '/resume',
    });
  }

  items.push({
    timeframe: 'week',
    titleKey: 'dashboard.plan.weekBehavioral.title',
    descriptionKey: 'dashboard.plan.weekBehavioral.desc',
    href: '/mock-interview',
  });

  // ===== 本月做 =====
  items.push({
    timeframe: 'month',
    titleKey: 'dashboard.plan.monthInterview.title',
    descriptionKey: 'dashboard.plan.monthInterview.desc',
    href: '/mock-interview',
  });

  items.push({
    timeframe: 'month',
    titleKey: 'dashboard.plan.monthRhythm.title',
    descriptionKey: 'dashboard.plan.monthRhythm.desc',
    params: { count: weeklyGoal * 4 },
    href: '/jobs',
  });

  items.push({
    timeframe: 'month',
    titleKey: 'dashboard.plan.monthReview.title',
    descriptionKey: 'dashboard.plan.monthReview.desc',
    href: '/dashboard',
  });

  return { context, items, diagnosis: null };
}

function buildPlan(
  resume: DashboardResume | null,
  regionKey: RegionKey,
  now = new Date(),
): DashboardPlan {
  const routePlan = buildCareerRoutePlan(
    (resume?.profile ?? null) as ResumeProfile | null | undefined,
    resume?.segmentation ?? null,
    regionKey,
    now,
    resume?.profile?.planRefinement,
  );
  const stage: CareerStage = resume?.segmentation?.careerStage ?? 'senior';
  const targetRole = resume?.profile?.intention?.roles?.[0]
    ?? resume?.profile?.targetRole
    ?? resume?.segmentation?.targetRole
    ?? '';
  return {
    context: {
      region: REGION_LABEL_KEYS[regionKey],
      stage: STAGE_LABEL_KEYS[stage] ?? STAGE_LABEL_KEYS.senior,
      role: getRoleCategory(targetRole),
    },
    items: routePlan.items,
    diagnosis: routePlan.diagnosis,
  };
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorizedResponse();
  const supabase = auth.client;
  const weekStart = getWeekStart(new Date());

  // One SQL read model replaces several PostgREST requests on the critical path.
  const { data: overviewData, error: overviewError } = await supabase.rpc('get_dashboard_overview', {
    p_user_id: auth.user.id,
    p_week_start: weekStart.toISOString(),
  });
  if (overviewError || !overviewData) {
    console.error('[Dashboard] Failed to load overview:', overviewError);
    return NextResponse.json({ error: 'Unable to load dashboard overview' }, { status: 500 });
  }
  const overview = overviewData as DashboardOverview;
  const latestResume = overview.latest_resume ?? null;
  const latestResumeId = latestResume?.id ?? null;
  const resumeCount = overview.resume_count ?? 0;
  const avgMatchScore = overview.avg_match_score ?? 0;
  const interviewCount = overview.interview_count ?? 0;
  const latestInterview = overview.latest_interview ?? null;
  const applicationCount = overview.application_count ?? 0;
  const weeklyApplications = overview.weekly_application_count ?? 0;

  const now = Date.now();
  const daysSinceLogin = auth.user.last_sign_in_at
    ? Math.floor((now - new Date(auth.user.last_sign_in_at).getTime()) / 86400000)
    : 0;

  // 地区：账户级目标地区优先，简历画像仅作为兼容回退。
  const fallbackRegion = resolveActiveRegion(overview.preferred_region, latestResume);
  const overrideRegions = latestResume?.segmentation_overrides?.regions ?? [];
  const segmentationRegions = latestResume?.segmentation?.regions ?? [];
  const resumeRegions = [...new Set<RegionKey>([...overrideRegions, ...segmentationRegions])];
  const rawRegions = resumeRegions.length ? resumeRegions : (fallbackRegion ? [fallbackRegion] : []);
  const sortedRegions = rawRegions
    .map((region, index) => ({
      region,
      index,
      feasibility: buildPersonalityFeasibility(
        region,
        (latestResume?.profile?.intention ?? null) as ResumeProfile['intention'] | null,
      ),
    }))
    .sort((left, right) => right.feasibility.score - left.feasibility.score || left.index - right.index);
  const selectedRegions = sortedRegions.map((item) => item.region);
  const selectedRegion = selectedRegions[0] ?? null;
  const regionOptions = (Object.keys(REGION_DNA) as RegionKey[]).map((key) => ({
    value: key,
    labelKey: REGION_LABEL_KEYS[key],
  }));

  // Personality recommendations include sponsor availability, so refresh the
  // cached result when the account's active market changes.
  let personalityProfile = latestResume?.profile?.personality ?? null;
  const needsScoringRefresh = personalityProfile?.recommendations?.some((item) => (
    item.personalityFit === undefined || item.feasibilityScore === undefined || item.feasibilityBlocked === undefined
  ));
  const needsMarketRefresh = selectedRegion
    && personalityProfile?.recommendations?.some((item) => (
      !item.reasons?.includes('personality.reason.market')
      && !item.reasons?.includes('personality.reason.marketLow')
    ));
  if (personalityProfile && selectedRegion && (personalityProfile.regionKey !== selectedRegion || needsMarketRefresh || needsScoringRefresh)) {
    const { data: assessment } = await supabase
      .from('personality_assessments')
      .select('answers')
      .eq('user_id', auth.user.id)
      .maybeSingle();
    const answers = Array.isArray(assessment?.answers)
      ? assessment.answers as PersonalityAnswer[]
      : null;
    if (answers && latestResume?.profile) {
      const { data: jobs } = await supabase
        .from('jobs')
        .select('direction, sponsorship, region')
        .eq('is_active', true);
      const sponsorshipStats = computeSponsorshipStatsByRole(jobs || [], selectedRegion);
      const feasibility = buildPersonalityFeasibility(
        selectedRegion,
        (latestResume.profile?.intention ?? null) as ResumeProfile['intention'] | null,
      );
      const computed = computePersonalityAssessment(
        answers,
        latestResume.profile as ResumeProfile,
        sponsorshipStats,
        selectedRegion,
        feasibility,
      );
      personalityProfile = {
        ...personalityProfile,
        dimensions: computed.result.dimensions,
        primaryDimension: computed.result.primaryDimension,
        summaryKey: computed.result.summaryKey,
        recommendations: computed.recommendations,
        regionKey: selectedRegion,
        completedAt: new Date().toISOString(),
      };
      const nextProfile = {
        ...(latestResume.profile as Record<string, unknown>),
        personality: personalityProfile,
      };
      await supabase
        .from('resumes')
        .update({ profile: nextProfile, updated_at: new Date().toISOString() })
        .eq('id', latestResumeId)
        .eq('user_id', auth.user.id);
    }
  }
  const personality = personalityProfile
    ? {
        hasAssessment: true,
        resumeId: latestResumeId,
        dimensions: personalityProfile.dimensions || {},
        summaryKey: personalityProfile.summaryKey || '',
        recommendations: personalityProfile.recommendations || [],
        updatedAt: personalityProfile.completedAt || '',
      }
    : null;

  // 毕业年份（从简历画像提取）
  const explicitRegion = selectedRegions[0] ?? null;
  const targetRoles = latestResume?.profile?.intention?.roles?.filter(Boolean) || [];
  const identityMissing = Boolean(latestResume && selectedRegions.some((region) => (
    regionRequiresIdentity(region) && !resolveVisaStatusForRegion(latestResume.profile?.intention, region)
  )));
  const profileReady = Boolean(
    latestResume
    && latestResume.segmentation_confirmed === true
    && explicitRegion
    && targetRoles.length > 0
    && !identityMissing,
  );
  const missingSteps: string[] = [];
  if (!latestResume) missingSteps.push('resume');
  else if (latestResume.segmentation_confirmed !== true) missingSteps.push('confirm');
  if (!explicitRegion) missingSteps.push('region');
  if (targetRoles.length === 0) missingSteps.push('role');
  if (identityMissing) {
    missingSteps.push('identity');
  }

  const gradYear = latestResume?.profile?.education?.[0]?.endYear ?? undefined;
  const nowDate = new Date();
  const currentYear = nowDate.getFullYear();
  const currentMonth = nowDate.getMonth() + 1;

  // 招聘时机驱动：判断是否应进入投递期
  // 有毕业年份 → 用招聘窗口判断；无毕业年份 → 回退到投递记录判断
  const isApplyingSeason = gradYear !== undefined
    ? shouldBeApplying(gradYear, selectedRegion, currentYear, currentMonth)
    : applicationCount > 0;

  // 阶段判断
  let phase: string;
  let phaseTitleKey: string;
  let phaseDescriptionKey: string;
  let phaseDescriptionParams: Record<string, string | number> = {};

  if (resumeCount === 0) {
    phase = 'positioning';
    phaseTitleKey = 'dashboard.phase.positioning.title';
    phaseDescriptionKey = 'dashboard.phase.positioning.description';
    phaseDescriptionParams = { count: 3 };
  } else if (isApplyingSeason) {
    phase = 'applying';
    phaseTitleKey = 'dashboard.phase.applying.title';
    phaseDescriptionKey = (gradYear !== undefined && gradYear - currentYear <= 0)
      ? 'dashboard.phase.applying.urgent'
      : 'dashboard.phase.applying.description';
    phaseDescriptionParams = {
      count: applicationCount,
      weekly: weeklyApplications,
      goal: 10,
      region: selectedRegion ? REGION_LABEL_KEYS[selectedRegion] : '',
    };
  } else {
    phase = 'preparation';
    phaseTitleKey = 'dashboard.phase.preparation.title';
    phaseDescriptionKey = 'dashboard.phase.preparation.description';
    phaseDescriptionParams = { score: avgMatchScore, count: interviewCount };
  }

  // 行动建议
  if (!profileReady) {
    phase = 'setup';
    phaseTitleKey = 'dashboard.phase.setup.title';
    phaseDescriptionKey = 'dashboard.phase.setup.description';
    phaseDescriptionParams = {};
  }

  const actions: { titleKey: string; href: string; priority: 'high' | 'medium' | 'low' }[] = [];
  if (!profileReady) {
    actions.push({ titleKey: 'dashboard.action.onboarding', href: '/resume', priority: 'high' });
  } else if (resumeCount === 0) {
    actions.push({ titleKey: 'dashboard.action.uploadResume', href: '/resume', priority: 'high' });
    actions.push({ titleKey: 'dashboard.action.browseJobs', href: '/jobs', priority: 'medium' });
  } else {
    actions.push({
      titleKey: 'dashboard.action.optimizeResume',
      href: '/optimize',
      priority: avgMatchScore < 75 ? 'high' : 'medium',
    });
    actions.push({
      titleKey: 'dashboard.action.mockInterview',
      href: '/mock-interview',
      priority: interviewCount < 3 ? 'high' : 'medium',
    });
    actions.push({ titleKey: 'dashboard.action.viewMatches', href: '/ai-match', priority: 'medium' });
  }
  if (applicationCount < 3) {
    actions.push({ titleKey: 'dashboard.action.startApplying', href: '/jobs', priority: 'low' });
  }

  // 阶段感知的"下一步"主按钮
  const nextAction: { titleKey: string; href: string } = {
    titleKey: 'dashboard.nextAction',
    href: actions[0]?.href || '/resume',
  };
  if (!profileReady) {
    nextAction.titleKey = 'dashboard.nextAction.onboarding';
    nextAction.href = '/resume';
  }
  if (phase === 'positioning') {
    nextAction.titleKey = 'dashboard.nextAction.uploadResume';
    nextAction.href = '/resume';
  } else if (phase === 'preparation') {
    nextAction.titleKey = 'dashboard.nextAction.startSearch';
    nextAction.href = '/jobs';
  } else if (phase === 'applying') {
    nextAction.titleKey = 'dashboard.nextAction.continueApplying';
    nextAction.href = '/jobs';
  }

  // 提醒
  const reminders: {
    type: string;
    titleKey: string;
    descriptionKey: string;
    descriptionParams?: Record<string, string | number>;
  }[] = [];

  if (daysSinceLogin >= 7) {
    reminders.push({
      type: 'stale_login',
      titleKey: 'dashboard.reminder.staleLogin.title',
      descriptionKey: 'dashboard.reminder.staleLogin.description',
      descriptionParams: { days: daysSinceLogin },
    });
  }
  if (
    latestInterview &&
    ['completed', 'ended', 'finished'].includes(latestInterview.status)
  ) {
    const hoursSinceInterview = Math.floor(
      (now - new Date(latestInterview.updated_at).getTime()) / 3600000
    );
    if (hoursSinceInterview >= 24 && hoursSinceInterview <= 72) {
      reminders.push({
        type: 'post_interview_review',
        titleKey: 'dashboard.reminder.review.title',
        descriptionKey: 'dashboard.reminder.review.description',
        descriptionParams: { hours: hoursSinceInterview },
      });
    }
  }

  // 成长故事线
  const story = {
    resumeKey: resumeCount > 0 ? 'dashboard.story.resume' : 'dashboard.story.resumeEmpty',
    resumeParams: { count: resumeCount, score: avgMatchScore },
    interviewKey:
      interviewCount > 0 ? 'dashboard.story.interview' : 'dashboard.story.interviewEmpty',
    interviewParams: { count: interviewCount },
    mindsetKey:
      applicationCount > 0 ? 'dashboard.story.mindset' : 'dashboard.story.mindsetEmpty',
    mindsetParams: { count: applicationCount },
  };

  // 求职规划
  const planRegions: PlanRegionData[] = profileReady && latestResume
    ? selectedRegions.map((region) => {
        const feasibility = sortedRegions.find((item) => item.region === region)?.feasibility;
        return {
          region,
          plan: buildPlan(latestResume, region),
          feasibilityLabelKey: feasibility?.labelKey ?? 'personality.feasibility.unknown',
        };
      })
    : [];
  const plan: DashboardPlan | null = planRegions[0]?.plan ?? null;

  return NextResponse.json({
    phase,
    phaseTitleKey,
    phaseDescriptionKey,
    phaseDescriptionParams,
    metrics: {
      resumeImpact: avgMatchScore,
      interviewStrength: interviewCount,
      applicationHealth:
        (resumeCount > 0 && phase === 'applying' ? Math.round((weeklyApplications / 10) * 100) : 0),
    },
    weeklyApplications,
    weeklyGoal: resumeCount > 0 && phase === 'applying' ? 10 : 0,
    selectedRegion,
    selectedRegions,
    planRegions,
    regionOptions,
    latestResumeId,
    actions,
    nextAction,
    reminders,
    story,
    plan,
    diagnosis: plan?.diagnosis ?? null,
    personality,
    interviewEvaluations: [],
    segmentationConfirmed: latestResume?.segmentation_confirmed === true,
    profileReady,
    missingSteps,
    personalization: buildDashboardPersonalization(latestResume, selectedRegions),
    counts: {
      resumes: resumeCount,
      matches: overview.match_count ?? 0,
      interviews: interviewCount,
      applications: applicationCount,
      favorites: 0,
    },
  });
}
