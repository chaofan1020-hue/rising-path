import { jobExperienceMinYears } from '@/lib/ai-match-experience';
import { classifyJobTrack, isTargetCompany } from '@/lib/ai-match-features';
import type { MatchJobType, SponsorshipFilter } from '@/lib/ai-match-filters';
import { roleMatchLevel } from '@/lib/ai-match-role-aliases';
import type { CareerStage } from '@/lib/resume-types';

export interface CandidateRankJob {
  id: number;
  title: string;
  company?: string | null;
  direction?: string | null;
  lexical_score?: number | null;
  experience_min_years?: number | null;
  experience_max_years?: number | null;
  experience_text?: string | null;
  job_type?: string | null;
  employment_category?: string | null;
  audience?: string | null;
  description?: string | null;
  requirements?: string | null;
  sponsorship?: 'yes' | 'no' | 'unknown' | null;
  created_at?: string | null;
  feedback_priority?: number | null;
  feature_score?: number | null;
}

export type CandidateRoleFit = 'direct' | 'adjacent';

export interface CandidateRankProfile {
  experienceYears: number;
  careerStage?: CareerStage | null;
  targetRoles: string[];
  targetCompanies?: string[];
  needsSponsorship?: boolean;
  sponsorshipFilter?: SponsorshipFilter;
  jobTypes?: MatchJobType[];
}

export type MatchExclusionReason = 'experience' | 'senior_title' | 'sponsorship' | 'job_type';

export interface MatchExclusionCounts {
  experience: number;
  senior_title: number;
  sponsorship: number;
  job_type: number;
  feedback: number;
}

export interface RankedCandidates<T extends CandidateRankJob> {
  jobs: T[];
  excludedCount: number;
  suitableCount: number;
  exclusionCounts: MatchExclusionCounts;
}

export type MatchFeedbackValue = 'interested' | 'not_interested' | 'inaccurate';

export interface MatchFeedbackSignal {
  jobId: number;
  feedback: MatchFeedbackValue;
  company?: string | null;
  direction?: string | null;
}

export interface FeedbackPreferenceResult<T extends CandidateRankJob> {
  jobs: T[];
  excludedCount: number;
}

const SENIOR_TITLE_PATTERN = /\b(senior|sr\.?|lead|staff|principal|manager|director|head|vp|chief)\b|高级|资深|负责人|总监|经理/i;
const ENTRY_LEVEL_PATTERN = /\b(intern|internship|co-?op|new grad|graduate|entry[- ]?level|junior|analyst i|engineer i)\b|实习|校招|应届|初级/i;

function isEarlyCareer(profile: CandidateRankProfile): boolean {
  return profile.careerStage === 'junior' || profile.careerStage === 'returning_intern' || profile.experienceYears < 2;
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim() : '';
}

export function roleFit(job: CandidateRankJob, targetRoles: string[]): CandidateRoleFit {
  return roleMatchLevel(`${job.title} ${job.direction || ''}`, targetRoles) === 'direct' ? 'direct' : 'adjacent';
}

function roleFamily(job: CandidateRankJob): string {
  const text = normalizedText(`${job.title} ${job.direction || ''}`);
  const families: Array<[string, RegExp]> = [
    ['engineering', /engineer|engineering|developer|开发|软件|技术/],
    ['data', /data|analytics|analyst|数据|分析/],
    ['product', /product|产品/],
    ['design', /design|designer|设计/],
    ['marketing', /marketing|growth|市场|营销/],
    ['finance', /finance|financial|accounting|金融|财务/],
    ['consulting', /consult|strategy|咨询|战略/],
    ['sales', /sales|business development|销售|商务/],
    ['operations', /operations|supply chain|运营|供应链/],
    ['research', /research|scientist|研究/],
    ['security', /security|安全/],
  ];
  return families.find(([, pattern]) => pattern.test(text))?.[0] || text.split(/\s+/).filter((token) => token.length >= 4).slice(0, 2).join('-') || 'other';
}

function isEntryLevel(job: CandidateRankJob): boolean {
  return ENTRY_LEVEL_PATTERN.test(`${job.title} ${job.job_type || ''} ${job.employment_category || ''} ${job.audience || ''}`);
}

function isExperiencedHire(job: CandidateRankJob): boolean {
  return classifyJobTrack(job) === 'experienced' && !isEntryLevel(job);
}

function minimumYears(job: CandidateRankJob): number | null {
  return jobExperienceMinYears(job);
}

function experienceTolerance(job: CandidateRankJob, profile: CandidateRankProfile): number {
  const earlyCareer = isEarlyCareer(profile);
  const track = classifyJobTrack(job);
  if (isEntryLevel(job) || track === 'internship' || track === 'campus') {
    return earlyCareer ? 1 : 1.5;
  }
  return earlyCareer ? 0.25 : 1.5;
}

function shouldExcludeExperiencedTrack(job: CandidateRankJob, profile: CandidateRankProfile): boolean {
  if (!isExperiencedHire(job)) return false;
  if (profile.jobTypes?.includes('社招')) return false;
  return isEarlyCareer(profile) || profile.careerStage === 'senior';
}

function jobTypeMatchesFilter(job: CandidateRankJob, jobTypes?: MatchJobType[]): boolean {
  if (!jobTypes || jobTypes.length === 0) return true;
  const track = classifyJobTrack(job);
  if (track === 'unknown') return true;
  const wanted = new Set(jobTypes.map((value) => (
    value === '实习' ? 'internship' : value === '校招' ? 'campus' : 'experienced'
  )));
  return wanted.has(track);
}

function sponsorshipMatchesFilter(job: CandidateRankJob, profile: CandidateRankProfile): boolean {
  if (!profile.needsSponsorship) return true;
  const filter = profile.sponsorshipFilter || 'exclude_no';
  if (filter === 'any') return true;
  if (filter === 'require_yes') return job.sponsorship === 'yes';
  return job.sponsorship !== 'no';
}

export function emptyMatchExclusionCounts(): MatchExclusionCounts {
  return { experience: 0, senior_title: 0, sponsorship: 0, job_type: 0, feedback: 0 };
}

export function matchExclusionReason(job: CandidateRankJob, profile: CandidateRankProfile): MatchExclusionReason | null {
  const minimum = minimumYears(job);
  const earlyCareer = isEarlyCareer(profile);
  if (minimum !== null && minimum > profile.experienceYears + experienceTolerance(job, profile)) {
    return 'experience';
  }
  if (shouldExcludeExperiencedTrack(job, profile)) return 'senior_title';
  if (earlyCareer && SENIOR_TITLE_PATTERN.test(job.title) && !ENTRY_LEVEL_PATTERN.test(job.title)) return 'senior_title';
  if (profile.careerStage === 'senior' && SENIOR_TITLE_PATTERN.test(job.title) && !ENTRY_LEVEL_PATTERN.test(job.title)) {
    return 'senior_title';
  }
  if (!sponsorshipMatchesFilter(job, profile)) return 'sponsorship';
  if (!jobTypeMatchesFilter(job, profile.jobTypes)) return 'job_type';
  return null;
}

export function isClearlyUnavailable(job: CandidateRankJob, profile: CandidateRankProfile): boolean {
  return matchExclusionReason(job, profile) !== null;
}

export function summarizeMatchExclusions<T extends CandidateRankJob>(
  jobs: T[],
  profile: CandidateRankProfile,
  feedbackExcludedCount = 0,
): MatchExclusionCounts {
  const counts = emptyMatchExclusionCounts();
  counts.feedback = Math.max(0, feedbackExcludedCount);
  for (const job of jobs) {
    const reason = matchExclusionReason(job, profile);
    if (reason) counts[reason] += 1;
  }
  return counts;
}

function suitabilityScore(job: CandidateRankJob, profile: CandidateRankProfile): number {
  if (typeof job.feature_score === 'number' && Number.isFinite(job.feature_score)) {
    return job.feature_score + Number(job.feedback_priority || 0);
  }
  let score = Number(job.lexical_score || 0) * 100;
  score += Number(job.feedback_priority || 0);
  const earlyCareer = isEarlyCareer(profile);
  const title = job.title || '';
  const metadata = [job.job_type, job.employment_category, job.audience].filter(Boolean).join(' ');
  if (earlyCareer && ENTRY_LEVEL_PATTERN.test(`${title} ${metadata}`)) score += 35;
  if (earlyCareer && SENIOR_TITLE_PATTERN.test(title)) score -= 35;
  if ((earlyCareer || profile.careerStage === 'senior') && isExperiencedHire(job)) score -= 40;
  const minimum = minimumYears(job);
  if (minimum !== null) {
    const gap = minimum - profile.experienceYears;
    if (gap > 0) score -= gap * 18;
    else score += Math.min(12, Math.abs(gap) * 4);
  } else {
    score += 4;
  }
  return score;
}

/**
 * Apply low-weight preference signals before hard suitability and diversity
 * selection. Exact negative feedback is hidden for the current profile
 * version; broader company/direction signals only nudge ordering.
 */
export function applyMatchFeedbackPreferences<T extends CandidateRankJob>(
  jobs: T[],
  signals: MatchFeedbackSignal[],
): FeedbackPreferenceResult<T> {
  if (signals.length === 0) return { jobs, excludedCount: 0 };
  const exactNegative = new Set(
    signals
      .filter((signal) => signal.feedback === 'not_interested' || signal.feedback === 'inaccurate')
      .map((signal) => signal.jobId),
  );
  const companyScores = new Map<string, number>();
  const directionScores = new Map<string, number>();
  for (const signal of signals) {
    const multiplier = signal.feedback === 'interested'
      ? 1
      : signal.feedback === 'not_interested'
        ? -0.65
        : -0.25;
    const company = normalizedText(signal.company);
    const direction = normalizedText(signal.direction);
    if (company) companyScores.set(company, (companyScores.get(company) || 0) + 12 * multiplier);
    if (direction) directionScores.set(direction, (directionScores.get(direction) || 0) + 5 * multiplier);
  }
  const preferred = jobs
    .filter((job) => !exactNegative.has(job.id))
    .map((job) => {
      const company = normalizedText(job.company);
      const direction = normalizedText(job.direction);
      const priority = (companyScores.get(company) || 0) + (directionScores.get(direction) || 0);
      return priority === 0 ? job : { ...job, feedback_priority: priority };
    });
  return { jobs: preferred, excludedCount: jobs.length - preferred.length };
}

export function selectMatchCandidates<T extends CandidateRankJob>(
  jobs: T[],
  profile: CandidateRankProfile,
  limit: number,
): RankedCandidates<T> {
  const exclusionCounts = summarizeMatchExclusions(jobs, profile);
  const suitable = jobs.filter((job) => !isClearlyUnavailable(job, profile));
  const sort = (left: T, right: T) => {
    const difference = suitabilityScore(right, profile) - suitabilityScore(left, profile);
    if (difference !== 0) return difference;
    return String(right.created_at || '').localeCompare(String(left.created_at || ''));
  };
  const ordered = [...suitable].sort(sort);
  const maxResults = Math.max(1, limit);
  const earlyCareer = isEarlyCareer(profile);
  const entryLevelTarget = earlyCareer ? Math.min(Math.ceil(maxResults * 0.75), ordered.filter(isEntryLevel).length) : 0;
  const companyCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  const selected: T[] = [];
  const deferred: T[] = [];

  const targetCompanies = profile.targetCompanies || [];
  const companyLimit = (job: T) => (isTargetCompany(job, targetCompanies) ? 3 : 2);
  const canAdd = (job: T, constraints: { company: boolean; family: boolean }) => {
    const company = normalizedText(job.company) || 'unknown-company';
    const family = roleFamily(job);
    return (!constraints.company || (companyCounts.get(company) || 0) < companyLimit(job))
      && (!constraints.family || (familyCounts.get(family) || 0) < 3);
  };
  const add = (job: T) => {
    selected.push(job);
    const company = normalizedText(job.company) || 'unknown-company';
    const family = roleFamily(job);
    companyCounts.set(company, (companyCounts.get(company) || 0) + 1);
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
  };

  const targetCompanyJobs = ordered.filter((job) => isTargetCompany(job, targetCompanies));
  for (const job of targetCompanyJobs) {
    if (selected.length >= Math.min(4, maxResults)) break;
    if (selected.includes(job) || !canAdd(job, { company: true, family: true })) continue;
    add(job);
  }
  for (const job of ordered) {
    if (selected.length >= maxResults) break;
    if (selected.includes(job)) continue;
    if (!canAdd(job, { company: true, family: true })) {
      deferred.push(job);
      continue;
    }
    if (entryLevelTarget > 0 && selected.filter(isEntryLevel).length < entryLevelTarget && !isEntryLevel(job)) {
      deferred.push(job);
      continue;
    }
    add(job);
  }
  for (const job of [...deferred, ...ordered]) {
    if (selected.length >= maxResults || selected.includes(job) || !canAdd(job, { company: true, family: true })) continue;
    add(job);
  }
  // If the available library is narrow, relax the role-family cap first so
  // users still receive a useful number of roles without one company taking
  // over the list.
  for (const job of ordered) {
    if (selected.length >= maxResults || selected.includes(job) || !canAdd(job, { company: true, family: false })) continue;
    add(job);
  }
  // Only relax the company cap as a final fallback when the remaining pool
  // cannot satisfy the requested count under the diversity preferences.
  for (const job of ordered) {
    if (selected.length >= maxResults || selected.includes(job) || !canAdd(job, { company: false, family: false })) continue;
    add(job);
  }
  return {
    jobs: selected,
    excludedCount: jobs.length - suitable.length,
    suitableCount: suitable.length,
    exclusionCounts,
  };
}
