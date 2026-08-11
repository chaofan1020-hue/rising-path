import type { SupabaseClient } from '@supabase/supabase-js';

type Sponsorship = 'yes' | 'no' | 'unknown';

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
): Promise<JobSyncResult> {
  const result: JobSyncResult = { created: 0, updated: 0, skipped: 0, failed: 0, invalidJobs: [] };
  const urls = [...new Set(jobs.map((job) => job.job_url).filter((url): url is string => Boolean(url)))];
  const existing = new Map<string, ExistingJob>();

  for (const batch of chunks(urls, 100)) {
    const { data, error } = await client.from('jobs').select('id, job_url').in('job_url', batch);
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

  const timestamp = new Date().toISOString();
  for (const batch of chunks(inserts, 500)) {
    const { error } = await client.from('jobs').insert(batch.map((job) => ({ ...job, last_verified_at: timestamp })));
    if (error) {
      result.failed += batch.length;
      result.invalidJobs.push({ index: result.invalidJobs.length + 1, reason: `写入岗位失败: ${error.message}`, data: { count: batch.length } });
    } else {
      result.created += batch.length;
    }
  }

  for (const batch of chunks(updates, 25)) {
    const outcomes = await Promise.all(batch.map(async ({ id, job }) => client
      .from('jobs')
      .update({ ...job, last_verified_at: timestamp, updated_at: timestamp })
      .eq('id', id)));
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

