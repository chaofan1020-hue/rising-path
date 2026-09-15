import { isTrustedJobFieldSource } from '@/lib/job-field-provenance';
import { resolveRegionKey } from '@/lib/region-dna';
import { classifyVisaStatus, requiresSponsorshipForRegion } from '@/lib/career-route-planner';
import { resolveVisaStatusForRegion } from '@/lib/visa-timeline';
import type { ResumeProfile } from '@/lib/resume-types';
import type { Match, ModelMatch } from '@/lib/ai-match-contract';
import { isClearlyUnavailable } from '@/lib/ai-match-candidate-ranking';

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
  experience_min_years?: number | null;
  experience_max_years?: number | null;
  experience_text?: string | null;
  field_evidence?: Record<string, unknown> | null;
}

export interface MatchCandidateContext {
  profile?: ResumeProfile | null;
  segmentation?: Record<string, unknown> | null;
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
    experience_min_years: job.experience_min_years,
    experience_max_years: job.experience_max_years,
    experience_text: job.experience_text,
  }, { experienceYears, careerStage, targetRoles: [] })) {
    reasons.push(localized(context.locale, {
      'zh-CN': '岗位经验门槛明显高于当前简历经历，暂不建议投入',
      'zh-TW': '職位經驗門檻明顯高於目前履歷經歷，暫不建議投入',
      en: 'The experience bar is clearly above the current resume evidence, so this role is not a priority yet',
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

  const minimumYears = Number(job.experience_min_years);
  if (Number.isFinite(minimumYears) && minimumYears > 0 && profileExperienceYears(context.profile) + 0.25 < minimumYears) {
    reasons.push(localized(context.locale, {
      'zh-CN': `岗位要求至少 ${minimumYears} 年经验，简历中的相关经历可能不足`,
      'zh-TW': `職位要求至少 ${minimumYears} 年經驗，履歷中的相關經歷可能不足`,
      en: `The role asks for at least ${minimumYears} years of experience, which may exceed the resume evidence`,
    }));
  }

  return { status: reasons.length > 0 ? 'uncertain' : 'eligible', reasons };
}

export function finalizeMatch(
  match: ModelMatch,
  job: MatchCandidateJob,
  context: MatchCandidateContext,
): Match {
  const field_quality = buildFieldQuality(job);
  const eligibility = buildEligibility(job, context);
  const breakdown = match.score_breakdown;
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

  return {
    ...match,
    match_score,
    recommendation_type,
    confidence,
    eligibility,
    field_quality,
  };
}
