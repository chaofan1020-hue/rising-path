import type { SupabaseClient } from '@supabase/supabase-js';

type Sponsorship = 'yes' | 'no' | 'unknown';
const EXISTING_JOB_LOOKUP_BATCH_SIZE = 20;

export interface JobSyncRecord {
  title: string;
  company: string;
  region: string;
  direction: string;
  audience: string;
  job_type: string | null;
  description: string | null;
  overview: string | null;
  responsibilities: string | null;
  requirements: string | null;
  nice_to_have: string | null;
  salary_range: string | null;
  job_url: string | null;
  source_url: string | null;
  sponsorship: Sponsorship;
  is_active: boolean;
  is_closed: boolean;
  source_system?: string | null;
  external_job_id?: string | null;
  valid_through?: string | null;
  missing_from_feed_at?: string | null;
  missing_feed_checks?: number;
}

export interface JobSyncRejection {
  index: number;
  reason: string;
  data: Record<string, unknown>;
}

export interface JobSyncResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  invalidJobs: JobSyncRejection[];
}

interface ExistingJob {
  id: number;
  job_url: string | null;
}

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let i = 0; i < values.length; i += size) output.push(values.slice(i, i + size));
  return output;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || '未知数据库错误');
}

async function retryDatabaseOperation<T extends { error: unknown }>(
  operation: () => PromiseLike<T>,
  label: string,
  attempts = 3,
): Promise<T> {
  let lastResult: T | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await operation();
      if (!result.error) return result;
      lastResult = result;
    } catch (error) {
      if (attempt === attempts) {
        throw new Error(`${label}失败: ${errorMessage(error)}`);
      }
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }

  if (lastResult) return lastResult;
  throw new Error(`${label}失败`);
}

function key(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export async function syncJobRecords(
  client: SupabaseClient,
  jobs: JobSyncRecord[],
  _mode: 'create' | 'sync' = 'sync',
  options: { verifiedAt?: string } = {},
): Promise<JobSyncResult> {
  const result: JobSyncResult = { created: 0, updated: 0, skipped: 0, failed: 0, invalidJobs: [] };
  const urls = [...new Set(jobs.map((job) => job.job_url).filter((url): url is string => Boolean(url)))];
  const existing = new Map<string, ExistingJob>();

  // job_url can be very long for ATS portals. Keep each PostgREST `in()`
  // query comfortably below proxy request-line limits instead of sending one
  // oversized URL that surfaces as a generic fetch failure.
  for (const batch of chunks(urls, EXISTING_JOB_LOOKUP_BATCH_SIZE)) {
    const { data, error } = await retryDatabaseOperation(
      () => client.from('jobs').select('id, job_url').in('job_url', batch),
      '查询岗位',
    );
    if (error) throw new Error(`查询岗位失败: ${error.message}`);
    for (const row of (data ?? []) as ExistingJob[]) {
      const normalized = key(row.job_url);
      if (normalized) existing.set(normalized, row);
    }
  }

  const inserts: JobSyncRecord[] = [];
  const updates: Array<{ id: number; job: JobSyncRecord }> = [];
  for (const job of jobs) {
    if (!job.title || !job.company || !job.region || !job.direction || !job.audience || !job.job_url) {
      result.skipped += 1;
      result.invalidJobs.push({ index: result.invalidJobs.length + 1, reason: '岗位缺少必填字段或官网链接', data: job as unknown as Record<string, unknown> });
      continue;
    }
    const found = existing.get(key(job.job_url) || '');
    if (found) updates.push({ id: found.id, job });
    else inserts.push(job);
  }

  const timestamp = options.verifiedAt || new Date().toISOString();
  for (const batch of chunks(inserts, 500)) {
    const { error } = await retryDatabaseOperation(
      () => client.from('jobs').insert(batch.map((job) => ({ ...job, last_verified_at: timestamp }))),
      '创建岗位',
    );
    if (error) {
      result.failed += batch.length;
      result.invalidJobs.push({ index: result.invalidJobs.length + 1, reason: `写入岗位失败: ${error.message}`, data: { count: batch.length } });
    } else {
      result.created += batch.length;
    }
  }

  for (const batch of chunks(updates, 25)) {
    const outcomes = await Promise.all(batch.map(async ({ id, job }) => retryDatabaseOperation(
      () => client
        .from('jobs')
        .update({ ...job, last_verified_at: timestamp, updated_at: timestamp })
        .eq('id', id),
      '更新岗位',
    )));
    for (const outcome of outcomes) {
      if (outcome.error) {
        result.failed += 1;
        result.invalidJobs.push({ index: result.invalidJobs.length + 1, reason: `更新岗位失败: ${outcome.error.message}`, data: {} });
      } else {
        result.updated += 1;
      }
    }
  }

  return result;
}
