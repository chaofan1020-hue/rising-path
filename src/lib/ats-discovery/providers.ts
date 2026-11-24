import { isTargetRegion } from '@/lib/job-region-scope';
import type { RobotsCheck } from './robots';

export type Vendor = 'greenhouse' | 'ashby' | 'lever';

export interface ParsedJob {
  id: string;
  title: string;
  url: string | null;
  location: string | null;
  department: string | null;
  updatedAt: string | null;
  postedAt: string | null;
}

export interface ParsedBoard {
  jobs: ParsedJob[];
  total: number;
}

export type ProbeStatus = 'active' | 'quarantined' | 'error';

export interface ProbeResult {
  vendor: Vendor;
  token: string;
  status: ProbeStatus;
  reason: string;
  httpStatus: number | null;
  postingCount: number;
  postingCountIsLowerBound: boolean;
  sampleCount: number;
  targetCount: number;
  targetRatio: number;
  robots: RobotsCheck | null;
  sample: Array<{ id: string; title: string; url: string | null; location: string | null; targetRegion: boolean }>;
  error: string | null;
  durationMs: number;
  fetchedAt: string;
  listOnly: true;
}

export const VENDOR_RATE_LIMIT_MS: Record<Vendor, number> = {
  greenhouse: 200,
  ashby: 500,
  lever: 1000,
};

export function isVendor(value: string): value is Vendor {
  return value === 'greenhouse' || value === 'ashby' || value === 'lever';
}

export function apiUrlFor(vendor: Vendor, token: string): string {
  if (vendor === 'greenhouse') {
    return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=false&per_page=100`;
  }
  if (vendor === 'ashby') {
    return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`;
  }
  return `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json&limit=25`;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function epochToIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  const text = asString(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? text : new Date(parsed).toISOString();
}

function pickLocation(value: unknown): string | null {
  if (typeof value === 'string') return asString(value);
  const record = asRecord(value);
  if (!record) return null;
  return asString(record.name) ?? asString(record.locationName) ?? asString(record.locationStr) ?? asString(record.city);
}

export function parseProviderPayload(vendor: Vendor, payload: unknown, token: string): ParsedBoard {
  if (vendor === 'greenhouse') {
    const root = asRecord(payload);
    const jobs = root?.jobs;
    if (!Array.isArray(jobs)) throw new Error('greenhouse: jobs is not an array');
    const meta = asRecord(root?.meta);
    return {
      total: typeof meta?.total === 'number' ? meta.total : jobs.length,
      jobs: jobs.map((item) => {
        const job = asRecord(item);
        if (!job) throw new Error('greenhouse: job is not an object');
        const location = asRecord(job.location);
        return {
          id: String(job.id ?? job.absolute_url ?? ''),
          title: asString(job.title) ?? '',
          url: asString(job.absolute_url),
          location: asString(location?.name) ?? pickLocation(job.location),
          department: asString(job.department),
          updatedAt: epochToIso(job.updated_at),
          postedAt: epochToIso(job.updated_at),
        };
      }),
    };
  }

  if (vendor === 'ashby') {
    const root = asRecord(payload);
    const jobs = root?.jobs;
    if (!Array.isArray(jobs)) throw new Error('ashby: jobs is not an array');
    return {
      total: jobs.length,
      jobs: jobs.map((item) => {
        const job = asRecord(item);
        if (!job) throw new Error('ashby: job is not an object');
        return {
          id: String(job.id ?? job.jobUrl ?? ''),
          title: asString(job.title) ?? '',
          url: asString(job.jobUrl) ?? asString(job.applyUrl) ?? `https://jobs.ashbyhq.com/${encodeURIComponent(token)}/${encodeURIComponent(String(job.id ?? ''))}`,
          location: pickLocation(job.location) ?? asString(job.locationName),
          department: asString(job.department) ?? asString(job.team),
          updatedAt: epochToIso(job.updatedAt ?? job.publishedAt),
          postedAt: epochToIso(job.publishedAt),
        };
      }),
    };
  }

  if (!Array.isArray(payload)) throw new Error('lever: payload is not an array');
  return {
    total: payload.length,
    jobs: payload.map((item) => {
      const job = asRecord(item);
      if (!job) throw new Error('lever: posting is not an object');
      const categories = asRecord(job.categories);
      return {
        id: String(job.id ?? job.hostedUrl ?? ''),
        title: asString(job.text) ?? asString(job.title) ?? '',
        url: asString(job.hostedUrl) ?? asString(job.applyUrl),
        location: pickLocation(categories?.location) ?? asString(job.location),
        department: asString(categories?.department) ?? asString(categories?.team),
        updatedAt: epochToIso(job.updatedAt ?? job.createdAt),
        postedAt: epochToIso(job.createdAt),
      };
    }),
  };
}

export function summarizeBoard(
  vendor: Vendor,
  token: string,
  parsed: ParsedBoard,
  httpStatus: number,
  robots: RobotsCheck | null,
): ProbeResult {
  const targetJobs = parsed.jobs.filter((job) => isTargetRegion(job.location));
  const sample = parsed.jobs.slice(0, 5).map((job) => ({
    id: job.id,
    title: job.title.slice(0, 160),
    url: job.url,
    location: job.location,
    targetRegion: isTargetRegion(job.location),
  }));

  let status: ProbeStatus = 'active';
  let reason = 'ok';
  if (parsed.total === 0 || parsed.jobs.length === 0) {
    status = 'quarantined';
    reason = 'empty_board';
  } else if (targetJobs.length === 0) {
    status = 'quarantined';
    reason = 'no_target_region_in_sample';
  }

  return {
    vendor,
    token,
    status,
    reason,
    httpStatus,
    postingCount: parsed.total,
    postingCountIsLowerBound: vendor === 'lever',
    sampleCount: parsed.jobs.length,
    targetCount: targetJobs.length,
    targetRatio: parsed.jobs.length ? Math.round((targetJobs.length / parsed.jobs.length) * 10000) / 10000 : 0,
    robots,
    sample,
    error: null,
    durationMs: 0,
    fetchedAt: new Date().toISOString(),
    listOnly: true,
  };
}