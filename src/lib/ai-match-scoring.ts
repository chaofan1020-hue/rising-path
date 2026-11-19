import { isClearlyUnavailable } from '@/lib/ai-match-candidate-ranking';
import type { Match, ModelMatch } from '@/lib/ai-match-contract';
import { jobExperienceMinYears } from '@/lib/ai-match-experience';
import { buildFeatureExplanation, scoreMatchFeatures } from '@/lib/ai-match-features';
import type { FeatureJob, MatchFeatureScore } from '@/lib/ai-match-features';
import { classifyVisaStatus, requiresSponsorshipForRegion } from '@/lib/career-route-planner';
import { isTrustedJobFieldSource } from '@/lib/job-field-provenance';
import { resolveRegionKey } from '@/lib/region-dna';
import type { ResumeProfile, UserSegmentation } from '@/lib/resume-types';
import { resolveVisaStatusForRegion } from '@/lib/visa-timeline';

export type MatchLocale = 'zh-CN' | 'zh-TW' | 'en';
export type MatchFieldStatus = Match['field_quality'][keyof Match['field_quality']];

export interface MatchCandidateJob {
  title?: string;
  region: string | null;
  salary_range?: string | null;
  sponsorship?: 'yes' | 'no' | 'unknown' | null;
  valid_through?: string | null;
  deadline_source?: string | null;
  salary_source?: string | null;
  location_source?: string | null;
  job_type?: string | null;
  employment_category?: string | null;
  audience?: string | null;
  description?: string | null;
  requirements?: string | null;
  experience_min_years?: number | null;
  experience_max_years?: number | null;
  experience_text?: string | null;
  field_evidence?: Record<string, unknown> | null;
}

export interface MatchCandidateContext {
  profile?: ResumeProfile | null;
  segmentation?: UserSegmentation | Record<string, unknown> | null;
  locale: MatchLocale;
}

function localized(locale: MatchLocale, values: Record<MatchLocale, string>): string {
  return values[locale] || values['en'];
}

function fieldEvidenceStatus(job: MatchCandidateJob, field: string): string | null {
  const fields = job.field_evidence?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const item = (fields as Record<string, unknown>)[field];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const status = (item as Record<string, unknown>).status;
  return typeof status === 'string' ? status : null;
}

export function fieldStatus(
  value: unknown,
  source: string | null | undefined,
  job: MatchCandidateJob,
  field: string,
): MatchFieldStatus {
  if (value == null || String(value).trim() === '') return 'missing';
  const evidenceStatus = fieldEvidenceStatus(job, field);
  if (evidenceStatus === 'rejected_legacy') return 'missing';
  if (evidenceStatus === 'verified') return 'verified';
  if (evidenceStatus === 'derived') return 'derived';
  if (evidenceStatus === 'pending_recheck') return 'pending_recheck';
  if (isTrustedJobFieldSource(source)) return 'verified';
  if (field === 'sponsorship') return 'derived';
  return 'pending_recheck';
}

export function buildFieldQuality(job: MatchCandidateJob): Match['field_quality'] {
  return {
    location: fieldStatus(job.region, job.location_source, job, 'location'),
    salary: fieldStatus(job.salary_range, job.salary_source, job, 'salary'),
    experience: fieldStatus(
      job.experience_min_years ?? job.experience_max_years ?? job.experience_text,
      null,
      job,
      'experience',
    ),
    sponsorship: fieldStatus(job.sponsorship && job.sponsorship !== 'unknown' ? job.sponsorship : null, null, job, 'sponsorship'),
    deadline: fieldStatus(job.valid_through, job.deadline_source, job, 'deadline'),
  };
}

function userNeedsSponsorship(profile: ResumeProfile | null | undefined, region: string | null): boolean | null {
  const regionKey = resolveRegionKey(region);
  if (!regionKey) return null;
  const intention = profile?.intention;
  const statusCode = resolveVisaStatusForRegion(intention, regionKey);
  const status = classifyVisaStatus(statusCode);
  if (status === 'unknown') return null;
  return requiresSponsorshipForRegion(regionKey, status);
}

function profileExperienceYears(profile: ResumeProfile | null | undefined): number {
  const entries = [...(profile?.internships || []), ...(profile?.workExperience || [])];
  const months = entries.reduce((total, entry) => total + (Number(entry.months) || 0), 0);
  return months / 12;
}

const DISCOURAGING_COPY = /不建议考虑|不建议投入|暂不建议|暫不建議|不建议申请|不建议申請|不值得|不适合申请|不適合申請|not worth(?:\s+\w+){0,4}\s+apply|do not apply|don't apply|should not (?:apply|consider)|not recommended to (?:apply|consider)/i;

export function buildEligibility(
  job: MatchCandidateJob,
  context: MatchCandidateContext,
): Match['eligibility'] {
  const reasons: string[] = [];
  const profile = context.profile;
  const experienceYears = profileExperienceYears(profile);
  const segmentation = context.segmentation || {};
  const careerStage = typeof segmentation.careerStage === 'string' ? segmentation.careerStage as 'junior' | 'senior' | 'experienced' | 'returning_intern' : null;
  if (isClearlyUnavailable({
    id: 0,
    title: job.title || '',
    job_type: job.job_type,
    employment_category: job.employment_category,
    audience: job.audience,
    description: job.description,
    requirements: job.requirements,
    experience_min_years: job.experience_min_years,
    experience_max_years: job.experience_max_years,
    experience_text: job.experience_text,
  }, { experienceYears, careerStage, targetRoles: [] })) {
    reasons.push(localized(context.locale, {
      'zh-CN': '岗位经验或职级门槛明显高于当前简历经历，已从推荐名单中排除',
      'zh-TW': '職位經驗或職級門檻明顯高於目前履歷經歷，已從推薦名單中排除',
      en: 'The experience or seniority bar is clearly above the current resume, so this role is excluded from the shortlist',
    }));
    return { status: 'blocked', reasons };
  }
  const needsSponsorship = userNeedsSponsorship(context.profile, job.region);
  const sponsorshipVerified = buildFieldQuality(job).sponsorship === 'verified';

  if (needsSponsorship === true && job.sponsorship === 'no' && sponsorshipVerified) {
    reasons.push(localized(context.locale, {
      'zh-CN': '岗位已明确不提供签证担保',
      'zh-TW': '職位已明確不提供簽證擔保',
      en: 'The job explicitly does not provide visa sponsorship',
    }));
    return { status: 'blocked', reasons };
  }

  if (needsSponsorship === true && (job.sponsorship === 'unknown' || !sponsorshipVerified)) {
    reasons.push(localized(context.locale, {
      'zh-CN': '签证担保信息未被官方明确确认',
      'zh-TW': '簽證擔保資訊未被官方明確確認',
      en: 'Visa sponsorship has not been confirmed from an official source',
    }));
  }

  const minimumYears = jobExperienceMinYears(job);
  if (minimumYears !== null && minimumYears > 0 && profileExperienceYears(context.profile) + 0.25 < minimumYears) {
    reasons.push(localized(context.locale, {
      'zh-CN': `岗位要求至少 ${minimumYears} 年经验，先补一段相关经历再申请会更稳`,
      'zh-TW': `職位要求至少 ${minimumYears} 年經驗，先補一段相關經歷再申請會更穩`,
      en: `The role asks for at least ${minimumYears} years. Strengthen related experience before applying`,
    }));
  }

  return { status: reasons.length > 0 ? 'uncertain' : 'eligible', reasons };
}

function alignedActionCopy(type: Match['recommendation_type'], locale: MatchLocale): string {
  if (type === 'apply_now') {
    return localized(locale, {
      'zh-CN': '可以直接准备申请材料，并针对岗位关键词微调简历。',
      'zh-TW': '可以直接準備申請材料，並針對職位關鍵詞微調履歷。',
      en: 'Prepare the application now and tune the resume toward the posting keywords.',
    });
  }
  return localized(locale, {
    'zh-CN': '这份岗位仍值得准备。先补齐关键差距，再投递会更稳。',
    'zh-TW': '這份職位仍值得準備。先補齊關鍵差距，再投遞會更穩。',
    en: 'This role is still worth pursuing. Close the key gaps first, then apply.',
  });
}

function alignedReasonCopy(type: Match['recommendation_type'], locale: MatchLocale): string {
  if (type === 'apply_now') {
    return localized(locale, {
      'zh-CN': '该岗位与你的方向匹配，可以进入申请准备。',
      'zh-TW': '該職位與你的方向匹配，可以進入申請準備。',
      en: 'This role matches your direction and is ready for application prep.',
    });
  }
  return localized(locale, {
    'zh-CN': '该岗位方向匹配，先补齐关键差距再申请会更稳。',
    'zh-TW': '該職位方向匹配，先補齊關鍵差距再申請會更穩。',
    en: 'This role matches your direction. Strengthen the key gaps, then apply.',
  });
}

export function alignMatchNarrative(match: Match, locale: MatchLocale): Match {
  if (match.recommendation_type === 'low_priority') return match;
  const haystack = `${match.match_reason}\n${match.suggestions}\n${match.key_gaps.join('\n')}`;
  if (!DISCOURAGING_COPY.test(haystack)) return match;
  return {
    ...match,
    match_reason: DISCOURAGING_COPY.test(match.match_reason) ? alignedReasonCopy(match.recommendation_type, locale) : match.match_reason,
    suggestions: DISCOURAGING_COPY.test(match.suggestions) ? alignedActionCopy(match.recommendation_type, locale) : match.suggestions,
    key_gaps: match.key_gaps.filter((item) => !DISCOURAGING_COPY.test(item)).slice(0, 4),
  };
}

export function finalizeMatch(
  match: Pick<ModelMatch, 'job_id' | 'match_reason' | 'evidence' | 'key_gaps' | 'suggestions'> & Partial<Pick<ModelMatch, 'score_breakdown' | 'match_score'>>,
  job: MatchCandidateJob,
  context: MatchCandidateContext,
  features?: MatchFeatureScore,
): Match {
  const field_quality = buildFieldQuality(job);
  const eligibility = buildEligibility(job, context);
  const computed = features || scoreMatchFeatures(job as FeatureJob, {
    profile: context.profile,
    segmentation: context.segmentation as UserSegmentation | null,
    locale: context.locale,
  });
  const breakdown = computed.breakdown;
  const weightedScore = Math.round(
    breakdown.ats * 0.10
    + breakdown.keywords * 0.20
    + breakdown.experience * 0.20
    + breakdown.evidence * 0.10
    + breakdown.region * 0.15
    + breakdown.profile_fit * 0.25,
  );
  const verifiedFields = Object.values(field_quality).filter((status) => status === 'verified').length;
  const knownFields = Object.values(field_quality).filter((status) => status !== 'missing').length;
  const confidence = Math.max(20, Math.min(100, Math.round(45 + verifiedFields * 9 + knownFields * 4 - (eligibility.status === 'uncertain' ? 12 : 0))));
  const match_score = eligibility.status === 'blocked'
    ? Math.min(weightedScore, 39)
    : eligibility.status === 'uncertain'
      ? Math.min(weightedScore, 79)
      : weightedScore;
  const recommendation_type: Match['recommendation_type'] = eligibility.status === 'blocked'
    ? 'low_priority'
    : eligibility.status === 'eligible' && match_score >= 75
      ? 'apply_now'
      : match_score >= 55
        ? 'improve_then_apply'
        : 'low_priority';

  return alignMatchNarrative({
    job_id: match.job_id,
    match_score,
    score_breakdown: breakdown,
    match_reason: match.match_reason,
    evidence: match.evidence,
    key_gaps: match.key_gaps,
    suggestions: match.suggestions,
    recommendation_type,
    confidence,
    eligibility,
    field_quality,
  }, context.locale);
}

export function isReportableMatch(match: Pick<Match, 'recommendation_type' | 'eligibility'>): boolean {
  return match.recommendation_type !== 'low_priority' && match.eligibility.status !== 'blocked';
}

export function buildScoredMatch(
  job: MatchCandidateJob & { id: number },
  context: MatchCandidateContext,
  explanation?: Partial<Pick<ModelMatch, 'match_reason' | 'evidence' | 'key_gaps' | 'suggestions'>>,
  features?: MatchFeatureScore,
): Match {
  const computed = features || scoreMatchFeatures(job as FeatureJob, {
    profile: context.profile,
    segmentation: context.segmentation as UserSegmentation | null,
    locale: context.locale,
  });
  const template = buildFeatureExplanation(job as FeatureJob, computed, context.locale);
  return finalizeMatch({
    job_id: job.id,
    match_reason: explanation?.match_reason || template.match_reason,
    evidence: explanation?.evidence || template.evidence,
    key_gaps: explanation?.key_gaps || template.key_gaps,
    suggestions: explanation?.suggestions || template.suggestions,
  }, job, context, computed);
}
