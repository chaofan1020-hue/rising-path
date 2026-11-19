import type { MatchJobType, SponsorshipFilter } from '@/lib/ai-match-filters';
import { parseJobIdList } from '@/lib/ai-match-filters';
import type { MatchRunFilters } from '@/lib/ai-match-session';
import { CREDIT_COST_FALLBACKS } from '@/lib/credit-prices';

export const MATCH_REPORT_LIMIT = 8;
export const MATCH_TEASER_SAMPLE_LIMIT = 2;
export const MATCH_RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MATCH_CREDIT_COST_FALLBACK = CREDIT_COST_FALLBACKS.ai_match;

export interface MatchTeaserSample {
  company: string;
  title: string;
  region: string | null;
  direction: string | null;
}

export interface MatchTeaserMixItem {
  label: string;
  count: number;
}

export interface MatchTeaser {
  retrieved_count: number;
  suitable_count: number;
  report_count: number;
  sample_count: number;
  locked_count: number;
  region_mix: MatchTeaserMixItem[];
  samples: MatchTeaserSample[];
}

export interface MatchTeaserJobInput {
  company?: string | null;
  title?: string | null;
  job_title?: string | null;
  region?: string | null;
  direction?: string | null;
}

const TEASER_FORBIDDEN_KEYS = [
  'job_id',
  'id',
  'match_score',
  'job_url',
  'salary_range',
  'eligibility',
  'recommendation_type',
  'sponsorship',
  'experience_min_years',
  'experience_max_years',
  'experience_text',
  'valid_through',
  'feature_score',
  'feature_notes',
  'workplace_type',
] as const;

function compactLabel(value: unknown, maximumLength: number): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text || /\bhttps?:\/\//i.test(text)) return '';
  if (text.length <= maximumLength) return text;
  return `${text.slice(0, maximumLength - 1).trimEnd()}…`;
}

function sampleFromJob(job: MatchTeaserJobInput): MatchTeaserSample | null {
  const title = compactLabel(job.title || job.job_title, 72);
  const company = compactLabel(job.company, 48) || '—';
  if (!title) return null;
  return {
    company,
    title,
    region: compactLabel(job.region, 40) || null,
    direction: compactLabel(job.direction, 32) || null,
  };
}

function regionMixFromJobs(jobs: MatchTeaserJobInput[], limit = 4): MatchTeaserMixItem[] {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const label = compactLabel(job.region, 40) || '';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const ranked = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (ranked.length <= limit) {
    return ranked.map(([label, count]) => ({ label, count }));
  }
  const visible = ranked.slice(0, limit - 1);
  const rest = ranked.slice(limit - 1).reduce((sum, [, count]) => sum + count, 0);
  return [...visible.map(([label, count]) => ({ label, count })), { label: '', count: rest }];
}

export function buildMatchTeaser(input: {
  jobs: MatchTeaserJobInput[];
  retrievedCount: number;
  suitableCount: number;
  reportLimit?: number;
  sampleLimit?: number;
}): MatchTeaser {
  const reportLimit = Math.max(1, input.reportLimit ?? MATCH_REPORT_LIMIT);
  const sampleLimit = Math.max(0, input.sampleLimit ?? MATCH_TEASER_SAMPLE_LIMIT);
  const reportJobs = input.jobs.slice(0, reportLimit);
  const samples = reportJobs
    .map(sampleFromJob)
    .filter((item): item is MatchTeaserSample => Boolean(item))
    .slice(0, sampleLimit);
  const reportCount = reportJobs.length;
  return {
    retrieved_count: Math.max(0, input.retrievedCount),
    suitable_count: Math.max(0, input.suitableCount),
    report_count: reportCount,
    sample_count: samples.length,
    locked_count: Math.max(0, reportCount - samples.length),
    region_mix: regionMixFromJobs(reportJobs),
    samples,
  };
}

export function emptyMatchTeaser(): MatchTeaser {
  return {
    retrieved_count: 0,
    suitable_count: 0,
    report_count: 0,
    sample_count: 0,
    locked_count: 0,
    region_mix: [],
    samples: [],
  };
}

export function sanitizeMatchTeaser(value: unknown): MatchTeaser {
  const teaser = value && typeof value === 'object' ? value as Partial<MatchTeaser> : {};
  const samples = Array.isArray(teaser.samples)
    ? teaser.samples.flatMap((item) => {
      const sample = sampleFromJob(item as MatchTeaserJobInput);
      return sample ? [sample] : [];
    }).slice(0, MATCH_TEASER_SAMPLE_LIMIT)
    : [];
  const regionMix = Array.isArray(teaser.region_mix)
    ? teaser.region_mix.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const count = Number((item as MatchTeaserMixItem).count);
      if (!Number.isInteger(count) || count <= 0) return [];
      return [{ label: compactLabel((item as MatchTeaserMixItem).label, 40), count }];
    }).slice(0, 4)
    : [];
  const reportCount = Math.max(0, Number(teaser.report_count || samples.length) || 0);
  const sanitized: MatchTeaser = {
    retrieved_count: Math.max(0, Number(teaser.retrieved_count) || 0),
    suitable_count: Math.max(0, Number(teaser.suitable_count) || 0),
    report_count: reportCount,
    sample_count: samples.length,
    locked_count: Math.max(0, Number(teaser.locked_count) || Math.max(0, reportCount - samples.length)),
    region_mix: regionMix,
    samples,
  };
  assertTeaserHasNoLeak(sanitized);
  return sanitized;
}

export function assertTeaserHasNoLeak(teaser: MatchTeaser): void {
  const serialized = JSON.stringify(teaser);
  for (const key of TEASER_FORBIDDEN_KEYS) {
    if (serialized.includes(`"${key}"`)) {
      throw new Error(`teaser leaked ${key}`);
    }
  }
  if (/\bhttps?:\/\//i.test(serialized)) {
    throw new Error('teaser leaked url');
  }
}

export function uniqueSortedStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function normalizeMatchRunFilters(filters: MatchRunFilters): MatchRunFilters {
  const jobTypes = uniqueSortedStrings(filters.job_types || []).filter((item): item is MatchJobType => (
    item === '实习' || item === '校招' || item === '社招'
  ));
  const sponsorship: SponsorshipFilter = filters.sponsorship === 'exclude_no' || filters.sponsorship === 'require_yes'
    ? filters.sponsorship
    : 'any';
  return {
    regions: uniqueSortedStrings(filters.regions || []),
    directions: uniqueSortedStrings(filters.directions || []),
    job_types: jobTypes,
    sponsorship,
  };
}

export function sameMatchRunFilters(left: MatchRunFilters, right: MatchRunFilters): boolean {
  return JSON.stringify(normalizeMatchRunFilters(left)) === JSON.stringify(normalizeMatchRunFilters(right));
}

export function parseCsvList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function isWithinRestoreWindow(createdAt: string | null | undefined, now = Date.now()): boolean {
  if (!createdAt) return false;
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return false;
  return now - timestamp <= MATCH_RESTORE_WINDOW_MS;
}

export function jobIdsFromRunRow(row: { job_ids?: unknown; quality?: unknown }, limit = MATCH_REPORT_LIMIT): number[] {
  const fromColumn = parseJobIdList(row.job_ids, limit);
  if (fromColumn.length > 0) return fromColumn;
  const quality = row.quality && typeof row.quality === 'object' ? row.quality as { job_ids?: unknown } : null;
  return parseJobIdList(quality?.job_ids, limit);
}
