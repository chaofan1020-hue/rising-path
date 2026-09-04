import { HIRING_SEASONS, REGION_DNA, type RegionKey } from '@/lib/region-dna';
import type {
  CareerSignals,
  LocalizedPlanText,
  PlanLocale,
  PlanRefinement,
  ResumeProfile,
  UserSegmentation,
  VisaStatusCategory,
} from '@/lib/resume-types';
import { classifyRole } from '@/lib/user-segmentation';
import {
  buildVisaTimeline,
  resolveVisaStatusForRegion,
  type VisaTimeline,
} from '@/lib/visa-timeline';

export type RecruitingWindow =
  | 'preparation'
  | 'main_application'
  | 'spring_apply'
  | 'fulltime_apply'
  | 'experienced';

export type MainRoute =
  | 'return_offer_internship'
  | 'direct_fulltime'
  | 'coop'
  | 'experienced_switch'
  | 'grad_school_backup';

export type RiskLevel = 'high' | 'medium' | 'low';
export type VisaFeasibility = 'likely' | 'conditional' | 'uncertain' | 'blocked' | 'not_applicable';

export interface CareerRisk {
  key: string;
  labelKey: string;
  level: RiskLevel;
}

export interface CareerRouteDiagnosis {
  window: RecruitingWindow;
  windowLabelKey: string;
  mainRoute: MainRoute;
  mainRouteLabelKey: string;
  backupRoute?: {
    route: MainRoute;
    labelKey: string;
    visaViable?: VisaFeasibility;
  };
  mainSeason?: {
    labelKey: string;
    startMonth?: number;
    endMonth?: number;
    noteKey?: string;
  };
  risks: CareerRisk[];
  visaStatus: VisaStatusCategory;
  visaStatusLabelKey?: string;
  requiresSponsorship: boolean;
  visaFeasibility: VisaFeasibility;
  visaNote?: string | LocalizedPlanText;
  visaTimeline?: VisaTimeline;
  lowGradeFocus?: boolean;
  yearsUntilGraduation: number | null;
  programType: 'bachelor' | 'master' | 'phd' | 'mba' | 'unknown';
  programDurationMonths: number | null;
  llmNarrative?: string | LocalizedPlanText;
  llmBackupRoute?: string | LocalizedPlanText;
  verificationNote?: string | LocalizedPlanText;
}

export function getLocalizedText(
  value: string | LocalizedPlanText | undefined,
  locale: PlanLocale,
): string | undefined {
  if (typeof value === 'string') return value;
  if (!value) return undefined;
  return value[locale] ?? value['zh-CN'];
}

export function classifyVisaStatus(
  workAuthorization?: string | null,
  visaStatus?: string | null,
): VisaStatusCategory {
  const text = `${workAuthorization || ''} ${visaStatus || ''}`.trim().toLowerCase();
  const specificCategories: Record<string, VisaStatusCategory> = {
    us_f1_no_opt: 'student',
    us_f1_opt: 'student',
    us_f1_stem_opt: 'student',
    us_h1b: 'work_visa',
    uk_student: 'student',
    uk_psw: 'work_visa',
    uk_skilled_worker: 'work_visa',
    sg_student_pass: 'student',
    sg_ep: 'work_visa',
    ca_study_permit: 'student',
    ca_pgwp: 'work_visa',
    hk_student_visa: 'student',
    hk_iang: 'work_visa',
    hk_dependent: 'work_visa',
    au_student_visa: 'student',
    au_485: 'work_visa',
    us_permanent: 'permanent',
    uk_permanent: 'permanent',
    sg_permanent: 'permanent',
    ca_permanent: 'permanent',
    hk_permanent: 'permanent',
    au_permanent: 'permanent',
    cn_no_visa: 'permanent',
  };
  if (specificCategories[text]) return specificCategories[text];
  if (text === 'permanent' || text.includes('permanent status')) return 'permanent';
  if (text === 'work_visa' || text.includes('work visa status')) return 'work_visa';
  if (text === 'student' || text.includes('student status')) return 'student';
  if (text.trim() === 'none' || text.includes('need employer sponsorship')) return 'none';
  if (
    /citizen|green card|permanent resident|\bpr\b|permanent|\u6c38\u4e45|\u6c38\u5c45|\u65e0\u9700\u5de5\u4f5c\u8bb8\u53ef/.test(text)
  ) {
    return 'permanent';
  }
  if (
    /h1b|h-1b|work visa|\bep\b|tier 2|\bt2\b|iang|work permit|\u5de5\u7b7e|\u5de5\u4f5c\u7b7e\u8bc1/.test(text)
  ) {
    return 'work_visa';
  }
  if (
    /\bopt\b|\bcpt\b|\bf1\b|\bf-1\b|\bpsw\b|\bpgwp\b|student visa|\u5b66\u751f\u7b7e\u8bc1/.test(text)
  ) {
    return 'student';
  }
  if (
    /needs sponsorship|need sponsorship|no work authorization|not authorized|\u9700\u8981\u96c7\u4e3b\u62c5\u4fdd|\u65e0\u5de5\u4f5c\u8bb8\u53ef|\u6ca1\u6709\u5de5\u4f5c\u8bb8\u53ef/.test(text)
  ) {
    return 'none';
  }
  return 'unknown';
}

export function requiresSponsorshipForRegion(
  region: RegionKey,
  visaStatus: VisaStatusCategory,
): boolean {
  if (region === 'cn_t1' || region === 'cn_t2') return false;
  return visaStatus !== 'permanent';
}

export function getVisaFeasibility(
  visaStatus: VisaStatusCategory,
  region: RegionKey,
  visaStatusCode?: string | null,
): VisaFeasibility {
  if (region === 'cn_t1' || region === 'cn_t2') return 'not_applicable';
  if (region === 'hk') {
    if (visaStatus === 'permanent' || visaStatus === 'work_visa') return 'likely';
    return 'conditional';
  }
  if (visaStatusCode && /psw|pgwp|iang|485|_opt|student/.test(visaStatusCode)) return 'conditional';
  if (visaStatus === 'permanent' || visaStatus === 'work_visa') return 'likely';
  if (visaStatus === 'student') return 'conditional';
  if (visaStatus === 'none') return 'blocked';
  return 'uncertain';
}

function getVisaConditionalRiskLabel(visaStatusCode?: string | null): string {
  const labels: Record<string, string> = {
    us_f1_no_opt: 'dashboard.risk.visa_conditional_us_f1_no_opt',
    us_f1_opt: 'dashboard.risk.visa_conditional_us_f1_opt',
    us_f1_stem_opt: 'dashboard.risk.visa_conditional_us_f1_stem_opt',
    uk_student: 'dashboard.risk.visa_conditional_uk_student',
    uk_psw: 'dashboard.risk.visa_conditional_uk_psw',
    sg_student_pass: 'dashboard.risk.visa_conditional_sg_student_pass',
    ca_study_permit: 'dashboard.risk.visa_conditional_ca_study_permit',
    ca_pgwp: 'dashboard.risk.visa_conditional_ca_pgwp',
    hk_student_visa: 'dashboard.risk.visa_conditional_hk_student_visa',
    hk_iang: 'dashboard.risk.visa_conditional_hk_iang',
    au_student_visa: 'dashboard.risk.visa_conditional_au_student_visa',
    au_485: 'dashboard.risk.visa_conditional_au_485',
  };
  return labels[visaStatusCode || ''] || 'dashboard.risk.visa_conditional_unspecified';
}

export interface CareerPlanItem {
  timeframe: 'now' | 'week' | 'month';
  titleKey: string;
  descriptionKey: string;
  descriptionText?: string;
  params?: Record<string, string | number>;
  href?: string;
}

export interface CareerRoutePlan {
  diagnosis: CareerRouteDiagnosis;
  items: CareerPlanItem[];
}

type ProgramType = CareerRouteDiagnosis['programType'];

const WINDOW_LABEL_KEYS: Record<RecruitingWindow, string> = {
  preparation: 'dashboard.window.preparation',
  main_application: 'dashboard.window.main_application',
  spring_apply: 'dashboard.window.spring_apply',
  fulltime_apply: 'dashboard.window.fulltime_apply',
  experienced: 'dashboard.window.experienced',
};

const ROUTE_LABEL_KEYS: Record<MainRoute, string> = {
  return_offer_internship: 'dashboard.route.return_offer_internship',
  direct_fulltime: 'dashboard.route.direct_fulltime',
  coop: 'dashboard.route.coop',
  experienced_switch: 'dashboard.route.experienced_switch',
  grad_school_backup: 'dashboard.route.grad_school_backup',
};

const LOW_GRADE_MAIN_ROUTE_LABEL = 'dashboard.route.lowGradeMain';
const LOW_GRADE_BACKUP_ROUTE_LABEL = 'dashboard.route.lowGradeBackup';

function getProgramType(degree?: string): ProgramType {
  const value = degree?.toLowerCase() || '';
  if (value.includes('phd') || value.includes('doctor')) return 'phd';
  if (value.includes('mba')) return 'mba';
  if (value.includes('master') || value.includes('msc') || value.includes('ma ') || value.includes('硕士')) {
    return 'master';
  }
  if (value.includes('bachelor') || value.includes('ba ') || value.includes('bs ') || value.includes('bsc') || value.includes('本科')) {
    return 'bachelor';
  }
  return 'unknown';
}

function getLatestEducation(profile: ResumeProfile | null | undefined) {
  const entries = profile?.education || [];
  return [...entries].sort((a, b) => (b.endYear || 0) - (a.endYear || 0))[0];
}

function inferProgramDuration(
  education: { startYear?: number | null; endYear?: number | null } | undefined,
  programType: ProgramType,
): number | null {
  if (education?.startYear && education.endYear) {
    return Math.max(1, (education.endYear - education.startYear) * 12);
  }
  if (programType === 'master') return 18;
  if (programType === 'bachelor') return 48;
  if (programType === 'mba') return 24;
  if (programType === 'phd') return 60;
  return null;
}

function inferCareerSignals(profile: ResumeProfile | null | undefined): CareerSignals {
  const skills = profile?.skills || [];
  const roles = [
    ...(profile?.internships || []).map((item) => item.role || ''),
    ...(profile?.workExperience || []).map((item) => item.role || ''),
  ].join(' ').toLowerCase();
  const codeKeywords = ['python', 'javascript', 'typescript', 'java', 'c++', 'sql', 'r ', 'stata', 'tableau', 'power bi', 'django', 'react', 'node'];
  const communicationKeywords = ['consulting', 'sales', 'marketing', 'client', 'pm', 'product', 'ibd', 'equity research', 'investment', 'strategy', '沟通', '咨询', '市场', '产品'];
  const codingPreference = codeKeywords.some((keyword) => skills.some((skill) => skill.toLowerCase().includes(keyword)))
    ? 'likes_coding'
    : 'unknown';
  const communicationPreference = communicationKeywords.some((keyword) => roles.includes(keyword))
    ? 'likes_communication'
    : 'unknown';
  const inferred: CareerSignals = {
    codingPreference,
    communicationPreference,
    targetIndustries: profile?.intention?.industries || [],
    targetSchoolBand: 'unknown',
    coop: undefined,
  };
  return {
    ...inferred,
    ...(profile?.careerSignals || {}),
  };
}

function getRoleLabelKey(profile: ResumeProfile | null | undefined, segmentation?: UserSegmentation | null): string {
  const targetRole = profile?.intention?.roles?.[0]
    || profile?.intention?.roles?.[0]
    || segmentation?.targetRole
    || '';
  const category = classifyRole(targetRole);
  const map: Record<string, string> = {
    finance: 'dashboard.role.finance',
    consulting: 'dashboard.role.consulting',
    tech: 'dashboard.role.tech',
    data: 'dashboard.role.data',
    product: 'dashboard.role.product',
    marketing: 'dashboard.role.marketing',
    operations: 'dashboard.role.operations',
    other: 'dashboard.role.other',
  };
  return map[category] || map.other;
}

function getSchoolBand(segmentation?: UserSegmentation | null): 'target' | 'semi_target' | 'non_target' | 'unknown' {
  if (!segmentation?.schoolTier) return 'unknown';
  if (segmentation.schoolTier === 1) return 'target';
  if (segmentation.schoolTier === 2) return 'semi_target';
  return 'non_target';
}

function isInSeason(region: RegionKey, month: number, kind: 'fall' | 'spring'): boolean {
  const season = HIRING_SEASONS[region];
  if (!season) return false;
  if (kind === 'fall') return month >= season.fallStart && month <= season.fallEnd;
  return month >= season.springStart && month <= season.springEnd;
}

function buildRisks(
  profile: ResumeProfile | null | undefined,
  segmentation: UserSegmentation | null | undefined,
  region: RegionKey,
  window: RecruitingWindow,
  programType: ProgramType,
  programDurationMonths: number | null,
  yearsUntilGraduation: number | null,
): CareerRisk[] {
  const risks: CareerRisk[] = [];
  const targetRole = profile?.intention?.roles?.[0] || segmentation?.targetRole || '';
  if (!targetRole) {
    risks.push({ key: 'missing_direction', labelKey: 'dashboard.risk.missing_direction', level: 'high' });
  }
  if (programType === 'master' && programDurationMonths !== null && programDurationMonths <= 15) {
    risks.push({ key: 'one_year_master', labelKey: 'dashboard.risk.one_year_master', level: 'high' });
  }
  if (window === 'preparation' && yearsUntilGraduation === 1) {
    risks.push({ key: 'missed_main_season', labelKey: 'dashboard.risk.missed_main_season', level: 'high' });
  }
  if (segmentation?.majorMatch === 'related' || segmentation?.majorMatch === 'unrelated') {
    risks.push({ key: 'major_mismatch', labelKey: 'dashboard.risk.major_mismatch', level: 'medium' });
  }
  if ((profile?.internships?.length || 0) === 0) {
    risks.push({ key: 'no_internship', labelKey: 'dashboard.risk.no_internship', level: 'high' });
  }
  const signals = inferCareerSignals(profile);
  const schoolBand = signals.targetSchoolBand !== 'unknown'
    ? signals.targetSchoolBand
    : getSchoolBand(segmentation);
  const roleCategory = classifyRole(targetRole);
  const financeLike = ['finance', 'consulting'].includes(roleCategory);
  if (schoolBand === 'non_target' && financeLike && ['us', 'hk', 'uk', 'ca'].includes(region)) {
    risks.push({ key: 'non_target_finance', labelKey: 'dashboard.risk.non_target_finance', level: 'high' });
  }
  if (schoolBand === 'non_target' && ['tech', 'data'].includes(roleCategory)) {
    risks.push({ key: 'non_target_tech', labelKey: 'dashboard.risk.non_target_tech', level: 'medium' });
  }
  if (segmentation?.experienceQuality?.quantifiedDensity === 'low') {
    risks.push({ key: 'low_evidence', labelKey: 'dashboard.risk.low_evidence', level: 'medium' });
  }
  if (!profile?.education?.some((entry) => entry.gpa)) {
    risks.push({ key: 'gpa_unknown', labelKey: 'dashboard.risk.gpa_unknown', level: 'low' });
  }
  const lowGradeFocus = segmentation?.careerStage === 'junior'
    || (window === 'preparation' && yearsUntilGraduation !== null && yearsUntilGraduation >= 2);
  if (!lowGradeFocus) {
    const regionVisaStatus = resolveVisaStatusForRegion(profile?.intention, region);
    const visaStatus = classifyVisaStatus(
      profile?.intention?.workAuthorization,
      regionVisaStatus,
    );
    const requiresSponsorship = requiresSponsorshipForRegion(region, visaStatus);
    if (requiresSponsorship && visaStatus === 'unknown') {
      risks.push({
        key: 'visa_unknown',
        labelKey: region === 'hk' ? 'dashboard.risk.visa_unknown_hk' : 'dashboard.risk.visa_unknown',
        level: 'high',
      });
    } else if (visaStatus === 'none') {
      risks.push({
        key: 'visa_blocker',
        labelKey: region === 'hk' ? 'dashboard.risk.visa_blocker_hk' : 'dashboard.risk.visa_blocker',
        level: 'high',
      });
    } else if (visaStatus === 'student' && requiresSponsorship) {
      const rawStatusCode = regionVisaStatus;
      const statusCode = rawStatusCode && !['student', 'work_visa', 'permanent', 'none', 'unknown'].includes(rawStatusCode)
        ? rawStatusCode
        : 'unspecified';
      risks.push({
        key: `visa_conditional_${statusCode}`,
        labelKey: getVisaConditionalRiskLabel(regionVisaStatus),
        level: 'medium',
      });
    }
  }
  return risks;
}

function buildMainSeason(
  window: RecruitingWindow,
  mainRoute: MainRoute,
  region: RegionKey,
): CareerRouteDiagnosis['mainSeason'] {
  if (window === 'experienced') return undefined;
  const season = HIRING_SEASONS[region];
  if (mainRoute === 'coop') {
    return {
      labelKey: 'dashboard.mainSeason.coop',
      startMonth: 9,
      endMonth: 3,
      noteKey: 'dashboard.mainSeason.coopNote',
    };
  }
  if (mainRoute === 'direct_fulltime') {
    return {
      labelKey: 'dashboard.mainSeason.fulltime',
      startMonth: season.fallStart,
      endMonth: season.springEnd,
      noteKey: 'dashboard.mainSeason.fulltimeNote',
    };
  }
  return {
    labelKey: 'dashboard.mainSeason.returnOffer',
    startMonth: season.fallStart,
    endMonth: season.fallEnd,
    noteKey: 'dashboard.mainSeason.returnOfferNote',
  };
}

function buildPlanItems(
  profile: ResumeProfile | null | undefined,
  segmentation: UserSegmentation | null | undefined,
  window: RecruitingWindow,
  mainRoute: MainRoute,
  region: RegionKey,
  visaTimeline?: VisaTimeline,
  lowGradeFocus?: boolean,
): CareerPlanItem[] {
  const items: CareerPlanItem[] = [];
  const push = (item: CareerPlanItem) => items.push(item);
  const targetRole = profile?.intention?.roles?.[0] || segmentation?.targetRole || '';
  const roleKey = getRoleLabelKey(profile, segmentation);
  const regionVisaStatus = resolveVisaStatusForRegion(profile?.intention, region);
  const visaStatus = classifyVisaStatus(
    profile?.intention?.workAuthorization,
    regionVisaStatus,
  );
  const requiresSponsorship = requiresSponsorshipForRegion(region, visaStatus);
  const lowGrade = Boolean(lowGradeFocus);
  const regionDna = REGION_DNA[region];

  push({
    timeframe: 'now',
    titleKey: 'dashboard.plan.nowRegionStrategy.title',
    descriptionKey: 'dashboard.plan.nowRegionStrategy.desc',
    descriptionText: `ATS 偏好：${regionDna.atsPreferences.join('；')}。简历写法：${regionDna.resumeStyle.join('；')}。面试节奏：${regionDna.interviewRhythm.join('；')}。关键信号：${regionDna.keySignals.join('、')}。`,
  });

  if (!targetRole) {
    push({
      timeframe: 'now',
      titleKey: 'dashboard.plan.nowDefineDirection.title',
      descriptionKey: 'dashboard.plan.nowDefineDirection.desc',
      href: '/ai-match',
    });
  }

  if (!lowGrade) {
    if (requiresSponsorship && visaStatus === 'unknown') {
      push({
        timeframe: 'now',
        titleKey: region === 'hk' ? 'dashboard.plan.nowConfirmHkVisa.title' : 'dashboard.plan.nowConfirmVisa.title',
        descriptionKey: region === 'hk' ? 'dashboard.plan.nowConfirmHkVisa.desc' : 'dashboard.plan.nowConfirmVisa.desc',
        href: '/resume',
      });
    }

    if (visaTimeline?.entries.some((entry) => entry.risk === 'high')) {
      push({
        timeframe: 'now',
        titleKey: 'dashboard.plan.nowVisaTimeline.title',
        descriptionKey: 'dashboard.plan.nowVisaTimeline.desc',
        href: '/resume',
      });
    }

    if (visaTimeline?.entries.some((entry) =>
      ['opt_application_window', 'h1b_lottery', 'pgwp_application'].includes(entry.key),
    )) {
      push({
        timeframe: 'week',
        titleKey: 'dashboard.plan.weekVisaTimeline.title',
        descriptionKey: 'dashboard.plan.weekVisaTimeline.desc',
        href: '/resume',
      });
    }
  }

  if (window === 'main_application' || window === 'spring_apply') {
    push({
      timeframe: 'now',
      titleKey: 'dashboard.plan.nowMainSeason.title',
      descriptionKey: 'dashboard.plan.nowMainSeason.desc',
      params: { role: roleKey },
      href: '/jobs',
    });
  } else if (window === 'preparation') {
    if (lowGrade) {
      push({
        timeframe: 'now',
        titleKey: 'dashboard.plan.nowBackgroundShaping.title',
        descriptionKey: 'dashboard.plan.nowBackgroundShaping.desc',
      });
    }
    push({
      timeframe: 'now',
      titleKey: 'dashboard.plan.nowIndustryKnowledge.title',
      descriptionKey: 'dashboard.plan.nowIndustryKnowledge.desc',
      params: { role: roleKey },
    });
    push({
      timeframe: 'now',
      titleKey: 'dashboard.plan.nowNetworking.title',
      descriptionKey: 'dashboard.plan.nowNetworking.desc',
      params: { region },
    });
    push({
      timeframe: 'now',
      titleKey: 'dashboard.plan.nowSteppingstone.title',
      descriptionKey: 'dashboard.plan.nowSteppingstone.desc',
      params: { role: roleKey },
      href: '/resume',
    });
  } else if (window === 'experienced') {
    push({
      timeframe: 'now',
      titleKey: 'dashboard.plan.nowPositioning.title',
      descriptionKey: 'dashboard.plan.nowPositioning.desc',
      href: '/jobs',
    });
  }

  if (segmentation?.experienceQuality?.quantifiedDensity === 'low') {
    push({
      timeframe: 'now',
      titleKey: 'dashboard.plan.nowResumeEvidence.title',
      descriptionKey: 'dashboard.plan.nowResumeEvidence.desc',
      href: '/resume',
    });
  }

  if (
    !lowGrade
    &&
    requiresSponsorship
    && (visaStatus === 'none' || visaStatus === 'student' || visaStatus === 'work_visa')
  ) {
    if (region === 'hk') {
      push({
        timeframe: 'week',
        titleKey: 'dashboard.plan.weekHkVisaBackup.title',
        descriptionKey: 'dashboard.plan.weekHkVisaBackup.desc',
        href: '/jobs',
      });
    } else {
      push({
        timeframe: 'week',
        titleKey: 'dashboard.plan.weekSponsorshipBackup.title',
        descriptionKey: 'dashboard.plan.weekSponsorshipBackup.desc',
        href: '/jobs?sponsorship=yes',
      });
    }
  }

  if (window === 'main_application') {
    push({
      timeframe: 'week',
      titleKey: 'dashboard.plan.weekTargetCompanies.title',
      descriptionKey: 'dashboard.plan.weekTargetCompanies.desc',
      params: { count: 10 },
      href: '/jobs',
    });
    push({
      timeframe: 'week',
      titleKey: 'dashboard.plan.weekReferral.title',
      descriptionKey: 'dashboard.plan.weekReferral.desc',
      params: { count: 3 },
    });
  } else if (window === 'preparation') {
    push({
      timeframe: 'week',
      titleKey: 'dashboard.plan.weekLongNetworking.title',
      descriptionKey: 'dashboard.plan.weekLongNetworking.desc',
      params: { count: 2 },
    });
    push({
      timeframe: 'week',
      titleKey: 'dashboard.plan.weekSteppingstone.title',
      descriptionKey: 'dashboard.plan.weekSteppingstone.desc',
      params: { role: roleKey },
      href: '/resume',
    });
    if (lowGrade) {
      push({
        timeframe: 'week',
        titleKey: 'dashboard.plan.weekQuantifiedOutcome.title',
        descriptionKey: 'dashboard.plan.weekQuantifiedOutcome.desc',
        href: '/resume',
      });
    }
  } else if (window === 'experienced') {
    push({
      timeframe: 'week',
      titleKey: 'dashboard.plan.weekTargetCompanyResearch.title',
      descriptionKey: 'dashboard.plan.weekTargetCompanyResearch.desc',
      params: { count: 5 },
      href: '/jobs',
    });
  } else {
    push({
      timeframe: 'week',
      titleKey: 'dashboard.plan.weekApply.title',
      descriptionKey: 'dashboard.plan.weekApply.desc',
      params: { count: 8, region },
      href: '/jobs',
    });
  }

  if (window === 'main_application') {
    push({
      timeframe: 'month',
      titleKey: 'dashboard.plan.monthReturnInternship.title',
      descriptionKey: 'dashboard.plan.monthReturnInternship.desc',
      params: { count: 15 },
      href: '/jobs',
    });
  } else if (window === 'preparation') {
    push({
      timeframe: 'month',
      titleKey: 'dashboard.plan.monthIndustryKnowledge.title',
      descriptionKey: 'dashboard.plan.monthIndustryKnowledge.desc',
      params: { role: roleKey },
    });
    if (lowGrade) {
      push({
        timeframe: 'month',
        titleKey: 'dashboard.plan.monthPortfolio.title',
        descriptionKey: 'dashboard.plan.monthPortfolio.desc',
        href: '/resume',
      });
    }
  } else if (window === 'experienced') {
    push({
      timeframe: 'month',
      titleKey: 'dashboard.plan.monthInterviewStories.title',
      descriptionKey: 'dashboard.plan.monthInterviewStories.desc',
      href: '/mock-interview',
    });
  }

  if (mainRoute === 'coop') {
    push({
      timeframe: 'month',
      titleKey: 'dashboard.plan.monthCoop.title',
      descriptionKey: 'dashboard.plan.monthCoop.desc',
      href: '/resume',
    });
  }

  push({
    timeframe: 'month',
    titleKey: 'dashboard.plan.monthReview.title',
    descriptionKey: 'dashboard.plan.monthReview.desc',
    href: '/dashboard',
  });

  return items;
}

export function buildCareerRoutePlan(
  profile: ResumeProfile | null | undefined,
  segmentation: UserSegmentation | null | undefined,
  region: RegionKey,
  now = new Date(),
  planRefinement?: PlanRefinement | null,
): CareerRoutePlan {
  // Older profiles predate regionKey. They only had one active market, so keep
  // their refinement usable while still isolating newer refinements by region.
  const activePlanRefinement = planRefinement && (
    !planRefinement.regionKey || planRefinement.regionKey === region
  )
    ? planRefinement
    : undefined;
  const latestEducation = getLatestEducation(profile);
  const programType = getProgramType(latestEducation?.degree);
  const programDurationMonths = inferProgramDuration(latestEducation, programType);
  const gradYear = latestEducation?.endYear ?? null;
  const yearsUntilGraduation = gradYear === null ? null : gradYear - now.getFullYear();
  const signals = inferCareerSignals(profile);
  const fulltimeMonths = (profile?.workExperience || [])
    .filter((item) => !item.isInternship)
    .reduce((sum, item) => sum + (item.months || 0), 0);
  const regionVisaStatus = resolveVisaStatusForRegion(profile?.intention, region);
  const visaStatus = classifyVisaStatus(
    profile?.intention?.workAuthorization,
    regionVisaStatus,
  );
  const visaTimeline = buildVisaTimeline({
    region,
    visaStatus: regionVisaStatus,
    visaDates: profile?.intention?.visaDates,
    programEndYear: gradYear,
    now,
  });
  const requiresSponsorship = requiresSponsorshipForRegion(region, visaStatus);
  const visaFeasibility = getVisaFeasibility(
    visaStatus,
    region,
    regionVisaStatus,
  );

  let window: RecruitingWindow = 'preparation';
  const explicitStage = segmentation?.careerStage;
  if (explicitStage === 'experienced') {
    window = 'experienced';
  } else if (!explicitStage && fulltimeMonths >= 12) {
    window = 'experienced';
  } else if (gradYear !== null && yearsUntilGraduation !== null && yearsUntilGraduation <= 0) {
    window = 'fulltime_apply';
  } else if (programType === 'master' && programDurationMonths !== null && programDurationMonths <= 15) {
    window = 'main_application';
  } else if (yearsUntilGraduation === 1) {
    const month = now.getMonth() + 1;
    if (isInSeason(region, month, 'fall')) window = 'main_application';
    else if (isInSeason(region, month, 'spring')) window = 'spring_apply';
    else window = 'preparation';
  }
  const lowGradeFocus = explicitStage === 'junior'
    || (window === 'preparation' && yearsUntilGraduation !== null && yearsUntilGraduation >= 2);

  let mainRoute: MainRoute = 'return_offer_internship';
  if (window === 'experienced') {
    mainRoute = 'experienced_switch';
  } else if (window === 'fulltime_apply' || window === 'spring_apply') {
    mainRoute = 'direct_fulltime';
  } else if (window === 'main_application') {
    if (region === 'ca' && signals.coop) mainRoute = 'coop';
    else if (region === 'au') mainRoute = 'direct_fulltime';
    else if (programType === 'master' && programDurationMonths !== null && programDurationMonths <= 15) mainRoute = 'direct_fulltime';
    else mainRoute = 'return_offer_internship';
  }

  let backupRoute: CareerRouteDiagnosis['backupRoute'];
  if (mainRoute === 'return_offer_internship') {
    backupRoute = {
      route: 'grad_school_backup',
      labelKey: lowGradeFocus ? LOW_GRADE_BACKUP_ROUTE_LABEL : ROUTE_LABEL_KEYS.grad_school_backup,
      visaViable: visaFeasibility,
    };
  } else if (mainRoute === 'direct_fulltime') {
    backupRoute = {
      route: 'return_offer_internship',
      labelKey: lowGradeFocus ? LOW_GRADE_BACKUP_ROUTE_LABEL : ROUTE_LABEL_KEYS.return_offer_internship,
      visaViable: visaFeasibility,
    };
  } else if (mainRoute === 'coop') {
    backupRoute = {
      route: 'direct_fulltime',
      labelKey: lowGradeFocus ? LOW_GRADE_BACKUP_ROUTE_LABEL : ROUTE_LABEL_KEYS.direct_fulltime,
      visaViable: visaFeasibility,
    };
  }

  const diagnosis: CareerRouteDiagnosis = {
    window,
    windowLabelKey: WINDOW_LABEL_KEYS[window],
    mainRoute,
    mainRouteLabelKey: lowGradeFocus ? LOW_GRADE_MAIN_ROUTE_LABEL : ROUTE_LABEL_KEYS[mainRoute],
    backupRoute,
    mainSeason: buildMainSeason(window, mainRoute, region),
    risks: buildRisks(
      profile,
      segmentation,
      region,
      window,
      programType,
      programDurationMonths,
      yearsUntilGraduation,
    ),
    visaStatus,
    visaStatusLabelKey: region === 'hk' && visaStatus === 'none' ? 'dashboard.visaStatus.hk_none' : undefined,
    requiresSponsorship,
    visaFeasibility,
    visaTimeline,
    visaNote: activePlanRefinement?.visaNotes ?? activePlanRefinement?.visaNote ?? REGION_DNA[region].visaNotes,
    lowGradeFocus,
    yearsUntilGraduation,
    programType,
    programDurationMonths,
    llmNarrative: activePlanRefinement?.narratives ?? activePlanRefinement?.narrative,
    llmBackupRoute: activePlanRefinement?.backupRoutes ?? activePlanRefinement?.backupRoute,
    verificationNote: activePlanRefinement?.verificationNotes ?? activePlanRefinement?.verificationNote,
  };

  return {
    diagnosis,
    items: buildPlanItems(profile, segmentation, window, mainRoute, region, visaTimeline, lowGradeFocus),
  };
}
