import { NextRequest, NextResponse } from 'next/server';
import { resolveRegionKey, type RegionKey, REGION_DNA, shouldBeApplying } from '@/lib/region-dna';
import { getAuthContext, unauthorizedResponse } from '@/lib/auth-server';
import { buildCareerRoutePlan, type CareerRouteDiagnosis } from '@/lib/career-route-planner';
import type { ResumeProfile, UserSegmentation } from '@/lib/resume-types';

type Timeframe = 'now' | 'week' | 'month';
type CareerStage = 'junior' | 'senior' | 'experienced' | 'returning_intern';
type MajorMatch = 'aligned' | 'related' | 'general' | 'unrelated';

interface PlanItem {
  timeframe: Timeframe;
  titleKey: string;
  descriptionKey: string;
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

interface DashboardResume {
  id?: number;
  profile?: {
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

interface FavoriteRow {
  jobs?: Array<{ updated_at?: string | null }> | { updated_at?: string | null } | null;
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

function resolveRegion(resume: DashboardResume | null | undefined): RegionKey | null {
  const manualRegions = resume?.segmentation_overrides?.regions;
  if (manualRegions && manualRegions.length > 0) return manualRegions[0];
  const segRegions = resume?.segmentation?.regions;
  if (segRegions && segRegions.length > 0) return segRegions[0];
  const intentionRegion = resume?.profile?.targetRegion;
  if (intentionRegion) return resolveRegionKey(intentionRegion);
  // 尝试从 intention.locations 中提取
  const locations = resume?.profile?.intention?.locations;
  if (locations && locations.length > 0) {
    for (const loc of locations) {
      const resolved = resolveRegionKey(loc);
      if (resolved) return resolved;
    }
  }
  const inferredRegion = resume?.profile?.inferredRegion;
  if (inferredRegion) return resolveRegionKey(inferredRegion);
  return null;
}

function buildLegacyPlan(resume: DashboardResume | null, regionKey: RegionKey): DashboardPlan {
  const stage: CareerStage = resume?.segmentation?.careerStage ?? 'senior';
  const targetRole: string = resume?.profile?.targetRole ?? resume?.segmentation?.targetRole ?? '';
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
  const targetRole = resume?.profile?.targetRole ?? resume?.segmentation?.targetRole ?? '';
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

  // 最新简历（含画像与分层）
  const [{ data: resumes }, { count: resumeCountResult }] = await Promise.all([
    supabase
      .from('resumes')
      .select('id, created_at, updated_at, file_name, profile, segmentation, segmentation_overrides')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('resumes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.user.id),
  ]);

  const latestResume = (resumes?.[0] as DashboardResume | undefined) ?? null;
  const latestResumeId = latestResume?.id ?? null;
  const resumeCount = resumeCountResult ?? 0;

  // AI 匹配
  const { data: aiMatches } = await supabase
    .from('ai_matches')
    .select('match_score, job_id')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const avgMatchScore = aiMatches?.length
    ? Math.round(aiMatches.reduce((s, m) => s + (m.match_score || 0), 0) / aiMatches.length)
    : 0;

  // 模拟面试
  const [{ data: interviews }, { count: interviewCountResult }] = await Promise.all([
    supabase
      .from('interview_sessions')
      .select('id, status, current_round, total_rounds, updated_at, created_at, target_company, interview_type, overall_score, report_grade, report')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('interview_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.user.id),
  ]);

  const interviewCount = interviewCountResult ?? 0;
  const latestInterview = interviews?.[0] ?? null;

  // 投递记录
  const weekStart = getWeekStart(new Date());
  const [{ data: applications }, { count: applicationCountResult }] = await Promise.all([
    supabase
      .from('applications')
      .select('id, status, created_at, updated_at')
      .eq('user_id', auth.user.id)
      .gte('created_at', weekStart.toISOString()),
    supabase
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.user.id),
  ]);

  const applicationCount = applicationCountResult ?? 0;
  // 本周投递数
  const weeklyApplications = applications?.length ?? 0;

  // 收藏岗位
  const { data: favorites } = await supabase
    .from('favorites')
    .select('id, job_id, created_at, jobs!inner(id, updated_at)')
    .eq('user_id', auth.user.id);

  const favoriteCount = favorites?.length ?? 0;
  const favoriteRows = (favorites ?? []) as FavoriteRow[];
  const recentlyUpdatedFavorites =
    favoriteRows.filter((f) => {
      const job = Array.isArray(f.jobs) ? f.jobs[0] : f.jobs;
      const jobUpdated = new Date(job?.updated_at || 0);
      return Date.now() - jobUpdated.getTime() < 7 * 24 * 60 * 60 * 1000;
    }).length ?? 0;

  const now = Date.now();
  const daysSinceLogin = auth.user.last_sign_in_at
    ? Math.floor((now - new Date(auth.user.last_sign_in_at).getTime()) / 86400000)
    : 0;

  // 地区：用户手动选择优先
  const selectedRegion = resolveRegion(latestResume);
  const regionOptions = (Object.keys(REGION_DNA) as RegionKey[]).map((key) => ({
    value: key,
    labelKey: REGION_LABEL_KEYS[key],
  }));

  // 毕业年份（从简历画像提取）
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
  const actions: { titleKey: string; href: string; priority: 'high' | 'medium' | 'low' }[] = [];
  if (resumeCount === 0) {
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
  if (recentlyUpdatedFavorites > 0) {
    reminders.push({
      type: 'favorite_update',
      titleKey: 'dashboard.reminder.favoriteUpdate.title',
      descriptionKey: 'dashboard.reminder.favoriteUpdate.description',
      descriptionParams: { count: recentlyUpdatedFavorites },
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

  // 面试评估记录（仅 completed 且有分数的）
  const interviewEvaluations = (interviews ?? [])
    .filter((iv) => iv.status === 'completed' && (iv.overall_score != null || iv.report_grade != null))
    .slice(0, 10)
    .map((iv) => ({
      id: iv.id,
      targetCompany: iv.target_company ?? '',
      interviewType: iv.interview_type ?? '',
      overallScore: iv.overall_score,
      reportGrade: iv.report_grade,
      completedAt: iv.updated_at ?? iv.created_at,
      report: iv.report,
    }));

  // 求职规划
  const plan: DashboardPlan | null =
    latestResume && selectedRegion ? buildPlan(latestResume, selectedRegion) : null;

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
    regionOptions,
    latestResumeId,
    actions,
    nextAction,
    reminders,
    story,
    plan,
    diagnosis: plan?.diagnosis ?? null,
    interviewEvaluations,
    counts: {
      resumes: resumeCount,
      matches: aiMatches?.length ?? 0,
      interviews: interviewCount,
      applications: applicationCount,
      favorites: favoriteCount,
    },
  });
}
