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
  created_at?: string | null;
  feedback_priority?: number | null;
}

export type CandidateRoleFit = 'direct' | 'adjacent';

export interface CandidateRankProfile {
  experienceYears: number;
  careerStage?: CareerStage | null;
  targetRoles: string[];
}

export interface RankedCandidates<T extends CandidateRankJob> {
  jobs: T[];
  excludedCount: number;
  suitableCount: number;
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

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function isEarlyCareer(profile: CandidateRankProfile): boolean {
  return profile.careerStage === 'junior' || profile.careerStage === 'returning_intern' || profile.experienceYears < 2;
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim() : '';
}

function roleTokens(value: unknown): string[] {
  return normalizedText(value).split(/\s+/).filter((token) => token.length >= 4);
}

export function roleFit(job: CandidateRankJob, targetRoles: string[]): CandidateRoleFit {
  if (targetRoles.length === 0) return 'direct';
  const jobText = normalizedText(`${job.title} ${job.direction || ''}`);
  const direct = targetRoles.some((target) => {
    const targetText = normalizedText(target);
    return targetText.length >= 3 && (jobText.includes(targetText) || roleTokens(target).some((token) => jobText.includes(token)));
  });
  return direct ? 'direct' : 'adjacent';
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
  return families.find(([, pattern]) => pattern.test(text))?.[0] || roleTokens(text).slice(0, 2).join('-') || 'other';
}

function isEntryLevel(job: CandidateRankJob): boolean {
  return ENTRY_LEVEL_PATTERN.test(`${job.title} ${job.job_type || ''} ${job.employment_category || ''} ${job.audience || ''}`);
}

function minimumYears(job: CandidateRankJob): number | null {
  return numberOrNull(job.experience_min_years);
}

export function isClearlyUnavailable(job: CandidateRankJob, profile: CandidateRankProfile): boolean {
  const minimum = minimumYears(job);
  const earlyCareer = isEarlyCareer(profile);
  if (minimum !== null) {
    const tolerance = earlyCareer ? 1 : 1.5;
    if (minimum > profile.experienceYears + tolerance) return true;
  }
  if (earlyCareer && SENIOR_TITLE_PATTERN.test(job.title) && !ENTRY_LEVEL_PATTERN.test(job.title)) return true;
  return false;
}

function suitabilityScore(job: CandidateRankJob, profile: CandidateRankProfile): number {
  let score = Number(job.lexical_score || 0) * 100;
  score += Number(job.feedback_priority || 0);
  const earlyCareer = isEarlyCareer(profile);
  const title = job.title || '';
  const metadata = [job.job_type, job.employment_category, job.audience].filter(Boolean).join(' ');
  if (earlyCareer && ENTRY_LEVEL_PATTERN.test(`${title} ${metadata}`)) score += 35;
  if (earlyCareer && SENIOR_TITLE_PATTERN.test(title)) score -= 35;
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
  const suitable = jobs.filter((job) => !isClearlyUnavailable(job, profile));
  const sort = (left: T, right: T) => {
    const difference = suitabilityScore(right, profile) - suitabilityScore(left, profile);
    if (difference !== 0) return difference;
    return String(right.created_at || '').localeCompare(String(left.created_at || ''));
  };
  const ordered = [...suitable].sort(sort);
  const maxResults = Math.max(1, limit);
  const earlyCareer = isEarlyCareer(profile);
  const entryLevelTarget = earlyCareer ? Math.min(Math.ceil(maxResults * 0.6), ordered.filter(isEntryLevel).length) : 0;
  const companyCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  const selected: T[] = [];
  const deferred: T[] = [];

  const canAdd = (job: T, constraints: { company: boolean; family: boolean }) => {
    const company = normalizedText(job.company) || 'unknown-company';
    const family = roleFamily(job);
    return (!constraints.company || (companyCounts.get(company) || 0) < 2)
      && (!constraints.family || (familyCounts.get(family) || 0) < 3);
  };
  const add = (job: T) => {
    selected.push(job);
    const company = normalizedText(job.company) || 'unknown-company';
    const family = roleFamily(job);
    companyCounts.set(company, (companyCounts.get(company) || 0) + 1);
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
  };

  for (const job of ordered) {
    if (selected.length >= maxResults) break;
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
  };
}
