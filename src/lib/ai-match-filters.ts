import { classifyVisaStatus, requiresSponsorshipForRegion } from '@/lib/career-route-planner';
import { resolveRegionKey, type RegionKey } from '@/lib/region-dna';
import type { CareerStage, ResumeProfile, UserSegmentation } from '@/lib/resume-types';
import { resolveVisaStatusForRegion } from '@/lib/visa-timeline';

export type SponsorshipFilter = 'any' | 'exclude_no' | 'require_yes';
export type MatchJobType = '实习' | '校招' | '社招';

export interface MatchFilterDefaults {
  regions: string[];
  jobTypes: MatchJobType[];
  sponsorship: SponsorshipFilter;
  fromProfile: boolean;
}

const REGION_KEY_TO_LABELS: Record<RegionKey, string[]> = {
  us: ['美国', '北美'],
  ca: ['加拿大', '北美'],
  uk: ['英国'],
  sg: ['新加坡'],
  hk: ['香港'],
  au: ['澳大利亚'],
  cn_t1: [],
  cn_t2: [],
};

const STAGE_JOB_TYPES: Record<CareerStage, MatchJobType[]> = {
  junior: ['实习'],
  returning_intern: ['实习', '校招'],
  senior: ['校招'],
  experienced: ['社招'],
};

export function labelsForRegionKeys(regionKeys: RegionKey[], availableLabels: string[]): string[] {
  const available = new Set(availableLabels);
  const selected: string[] = [];
  for (const key of regionKeys) {
    const match = (REGION_KEY_TO_LABELS[key] || []).find((label) => available.has(label));
    if (match && !selected.includes(match)) selected.push(match);
  }
  return selected;
}

export function jobTypesForCareerStage(stage?: CareerStage | null, availableTypes: string[] = ['实习', '校招', '社招']): MatchJobType[] {
  const preferred = stage ? STAGE_JOB_TYPES[stage] : [];
  return preferred.filter((value): value is MatchJobType => availableTypes.includes(value));
}

export function userNeedsSponsorship(
  profile?: ResumeProfile | null,
  regions: Array<string | RegionKey> = [],
): boolean {
  const fromInput = regions.map((region) => resolveRegionKey(region)).filter((key): key is RegionKey => !!key);
  const fromIntention = (profile?.intention?.locations || [])
    .map((item) => resolveRegionKey(item))
    .filter((key): key is RegionKey => !!key);
  const targetKeys = [...new Set(fromInput.length > 0 ? fromInput : fromIntention)];
  if (targetKeys.length === 0) return false;
  return targetKeys.some((regionKey) => {
    const statusCode = resolveVisaStatusForRegion(profile?.intention, regionKey);
    const status = classifyVisaStatus(statusCode);
    return requiresSponsorshipForRegion(regionKey, status);
  });
}

export function defaultMatchFilters(input: {
  profile?: ResumeProfile | null;
  segmentation?: Pick<UserSegmentation, 'careerStage' | 'regions'> | UserSegmentation | null;
  regionOptions?: string[];
  jobTypeOptions?: string[];
}): MatchFilterDefaults {
  const regionKeys = input.segmentation?.regions || [];
  const regions = labelsForRegionKeys(regionKeys, input.regionOptions || Object.values(REGION_KEY_TO_LABELS).flat());
  const jobTypes = jobTypesForCareerStage(input.segmentation?.careerStage, input.jobTypeOptions);
  const needsSponsorship = userNeedsSponsorship(input.profile, regionKeys);
  return {
    regions,
    jobTypes,
    sponsorship: needsSponsorship ? 'exclude_no' : 'any',
    fromProfile: regions.length > 0 || jobTypes.length > 0 || needsSponsorship,
  };
}

export function parseJobIdList(value: unknown, limit: number): number[] {
  if (!Array.isArray(value) || limit <= 0) return [];
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    const parsed = typeof item === 'number' ? item : Number(item);
    if (!Number.isInteger(parsed) || parsed <= 0 || seen.has(parsed)) continue;
    seen.add(parsed);
    ids.push(parsed);
    if (ids.length >= limit) break;
  }
  return ids;
}
