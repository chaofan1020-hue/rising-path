import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobAvailabilityStatus, JobLinkHealth } from '@/lib/job-link-health';

type Sponsorship = 'yes' | 'no' | 'unknown';
const EXISTING_JOB_LOOKUP_BATCH_SIZE = 20;
// UUID lists are serialized into the PostgREST query string. 500 IDs can
// exceed proxy/request-line limits and surface as an opaque `fetch failed`.
const EXISTING_EXTERNAL_ID_LOOKUP_BATCH_SIZE = 100;
const EXISTING_SYNC_RECORD_LOOKUP_BATCH_SIZE = 500;
const WRITE_BATCH_SIZE = 500;

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
  availability_status?: JobAvailabilityStatus | null;
  link_health?: JobLinkHealth | null;
  last_link_error?: string | null;
  last_link_http_status?: number | null;
  availability_checked_at?: string | null;
}

export interface JobSyncRejection {
  index: number;
  reason: string;
  data: Record<string, unknown>;
}

export interface JobSyncResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  invalidJobs: JobSyncRejection[];
}

interface ExistingJob {
  id: number;
  job_url: string | null;
  company: string | null;
  source_system: string | null;
  external_job_id: string | null;
  is_active: boolean;
  is_closed: boolean;
}

interface ExistingJobSyncRecord {
  job_id: number;
  content_hash: string;
  availability_status: JobAvailabilityStatus | null;
  link_health: JobLinkHealth | null;
  last_link_error: string | null;
  last_link_http_status: number | null;
  availability_checked_at: string | null;
}

interface PendingJobWrite {
  id: number;
  job: JobSyncRecord;
  contentHash: string;
}

interface PendingSyncRecord {
  job_id: number;
  source_system: string;
  content_hash: string;
  last_verified_at: string;
  missing_from_feed_at: null;
  missing_feed_checks: number;
  availability_status: JobAvailabilityStatus | null;
  link_health: JobLinkHealth | null;
  last_link_error: string | null;
  last_link_http_status: number | null;
  availability_checked_at: string | null;
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
  attempts = 4,
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

function identityPart(value: string | null | undefined): string {
  return (value || '').trim().toLocaleLowerCase();
}

function externalIdentity(sourceSystem: string | null | undefined, company: string | null | undefined, externalId: string | null | undefined): string | null {
  if (!sourceSystem || !company || !externalId) return null;
  return `${identityPart(sourceSystem)}:${identityPart(company)}:${identityPart(externalId)}`;
}

function timestampForHash(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function hashPart(value: string | boolean | null | undefined): string {
  const normalized = typeof value === 'boolean' ? String(value) : value || '';
  return `${Buffer.byteLength(normalized, 'utf8')}:${normalized}`;
}

/**
 * This is intentionally a change detector, not a security primitive. The SQL
 * backfill uses the same length-prefixed MD5 input so existing jobs do not get
 * rewritten merely because this storage optimization is deployed.
 */
export function jobContentHash(job: JobSyncRecord): string {
  const overview = job.overview === job.description ? null : job.overview;
  const fields: Array<string | boolean | null | undefined> = [
    job.title,
    job.company,
    job.region,
    job.direction,
    job.audience,
    job.job_type,
    job.description,
    overview,
    job.responsibilities,
    job.requirements,
    job.nice_to_have,
    job.salary_range,
    job.job_url,
    job.source_url,
    job.sponsorship,
    job.is_active,
    job.is_closed,
    job.source_system,
    job.external_job_id,
    timestampForHash(job.valid_through),
  ];
  return createHash('md5').update(fields.map(hashPart).join('|'), 'utf8').digest('hex');
}

function makeSyncRecord(
  jobId: number,
  job: JobSyncRecord,
  contentHash: string,
  verifiedAt: string,
  previous?: ExistingJobSyncRecord,
): PendingSyncRecord {
  return {
    job_id: jobId,
    source_system: job.source_system || 'manual',
    content_hash: contentHash,
    last_verified_at: verifiedAt,
    missing_from_feed_at: null,
    missing_feed_checks: 0,
    availability_status: job.availability_status ?? previous?.availability_status ?? null,
    link_health: job.link_health ?? previous?.link_health ?? null,
    last_link_error: job.last_link_error ?? previous?.last_link_error ?? null,
    last_link_http_status: job.last_link_http_status ?? previous?.last_link_http_status ?? null,
    availability_checked_at: job.availability_checked_at ?? previous?.availability_checked_at ?? verifiedAt,
  };
}

function toJobPayload(job: JobSyncRecord): Omit<JobSyncRecord, 'availability_status' | 'link_health' | 'last_link_error' | 'last_link_http_status' | 'availability_checked_at'> {
  const {
    availability_status: _availabilityStatus,
    link_health: _linkHealth,
    last_link_error: _lastLinkError,
    last_link_http_status: _lastLinkHttpStatus,
    availability_checked_at: _availabilityCheckedAt,
    ...payload
  } = job;
  return payload;
}

async function saveSyncRecords(client: SupabaseClient, records: PendingSyncRecord[]): Promise<void> {
  // Feeds occasionally repeat a job URL in the same page. PostgreSQL rejects
  // an upsert batch that targets the same conflict key twice, so retain the
  // final observation for each job before writing sync metadata.
  const deduplicatedRecords = [...new Map(records.map((record) => [record.job_id, record])).values()];
  for (const batch of chunks(deduplicatedRecords, WRITE_BATCH_SIZE)) {
    const { error } = await retryDatabaseOperation(
      () => client.from('job_sync_records').upsert(batch, { onConflict: 'job_id' }),
      '保存岗位同步状态',
    );
    if (error) throw new Error(`保存岗位同步状态失败: ${error.message}`);
  }
}

export async function syncJobRecords(
  client: SupabaseClient,
  jobs: JobSyncRecord[],
  _mode: 'create' | 'sync' = 'sync',
  options: { verifiedAt?: string } = {},
): Promise<JobSyncResult> {
  const result: JobSyncResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    invalidJobs: [],
  };
  const distinctJobs = new Map<string, JobSyncRecord>();
  for (const job of jobs) {
    // Invalid records remain independent so the validation branch can report
    // them. Prefer the upstream source/id pair when available because ATS URLs
    // can change without representing a new job.
    const externalKey = externalIdentity(job.source_system, job.company, job.external_job_id);
    const jobKey = externalKey || key(job.job_url) || `invalid-${distinctJobs.size}`;
    distinctJobs.set(jobKey, job);
  }
  const jobsToSync = [...distinctJobs.values()];
  const externalIds = [...new Set(
    jobsToSync
      .filter((job) => job.source_system && job.external_job_id)
      .map((job) => job.external_job_id as string),
  )];
  const existingByUrl = new Map<string, ExistingJob>();
  const existingByExternalId = new Map<string, ExistingJob>();

  // The upstream can replace an ATS URL while retaining its external ID. Match
  // that record before inserting so the unique source/id index remains useful.
  for (const batch of chunks(externalIds, EXISTING_EXTERNAL_ID_LOOKUP_BATCH_SIZE)) {
    const { data, error } = await retryDatabaseOperation(
      () => client.from('jobs').select('id, job_url, company, source_system, external_job_id, is_active, is_closed').in('external_job_id', batch),
      '查询岗位外部 ID',
    );
    if (error) throw new Error(`查询岗位外部 ID 失败: ${error.message}`);
    for (const row of (data ?? []) as ExistingJob[]) {
      const identity = externalIdentity(row.source_system, row.company, row.external_job_id);
      if (identity) {
        existingByExternalId.set(identity, row);
      }
      const normalized = key(row.job_url);
      if (normalized) existingByUrl.set(normalized, row);
    }
  }

  // Most collector records have a stable external ID. Only fall back to URL
  // lookup when that ID is absent or did not find an existing row, otherwise a
  // 500-row page needlessly becomes dozens of long PostgREST URL requests.
  const urls = [...new Set(jobsToSync
    .filter((job) => !job.source_system || !job.external_job_id
      || !existingByExternalId.has(externalIdentity(job.source_system, job.company, job.external_job_id) || ''))
    .map((job) => job.job_url)
    .filter((url): url is string => Boolean(url)))];
  // job_url can be very long for ATS portals. Keep each PostgREST `in()`
  // query comfortably below proxy request-line limits instead of sending one
  // oversized URL that surfaces as a generic fetch failure.
  for (const batch of chunks(urls, EXISTING_JOB_LOOKUP_BATCH_SIZE)) {
    const { data, error } = await retryDatabaseOperation(
      () => client.from('jobs').select('id, job_url, company, source_system, external_job_id, is_active, is_closed').in('job_url', batch),
      '查询岗位',
    );
    if (error) throw new Error(`查询岗位失败: ${error.message}`);
    for (const row of (data ?? []) as ExistingJob[]) {
      const normalized = key(row.job_url);
      if (normalized) existingByUrl.set(normalized, row);
      const identity = externalIdentity(row.source_system, row.company, row.external_job_id);
      if (identity) {
        existingByExternalId.set(identity, row);
      }
    }
  }

  const existingSyncRecords = new Map<number, ExistingJobSyncRecord>();
  const existingIds = [...new Set([...existingByUrl.values(), ...existingByExternalId.values()].map((job) => job.id))];
  for (const batch of chunks(existingIds, EXISTING_SYNC_RECORD_LOOKUP_BATCH_SIZE)) {
    const { data, error } = await retryDatabaseOperation(
      () => client
        .from('job_sync_records')
        .select('job_id, content_hash, availability_status, link_health, last_link_error, last_link_http_status, availability_checked_at')
        .in('job_id', batch),
      '查询岗位同步状态',
    );
    if (error) throw new Error(`查询岗位同步状态失败: ${error.message}`);
    for (const row of (data ?? []) as ExistingJobSyncRecord[]) {
      existingSyncRecords.set(row.job_id, row);
    }
  }

  const inserts: Array<{ job: JobSyncRecord; contentHash: string }> = [];
  const updates: PendingJobWrite[] = [];
  const unchanged: PendingSyncRecord[] = [];
  const timestamp = options.verifiedAt || new Date().toISOString();

  for (const job of jobsToSync) {
    if (!job.title || !job.company || !job.region || !job.direction || !job.audience || !job.job_url) {
      result.skipped += 1;
      result.invalidJobs.push({ index: result.invalidJobs.length + 1, reason: '岗位缺少必填字段或官网链接', data: job as unknown as Record<string, unknown> });
      continue;
    }
    const contentHash = jobContentHash(job);
    // External IDs are stable across ATS URL rotations. Prefer that identity
    // before the URL so a refreshed link updates the existing row instead of
    // colliding with its unique source/external-id index.
    const found = (job.source_system && job.external_job_id
      ? existingByExternalId.get(externalIdentity(job.source_system, job.company, job.external_job_id) || '')
      : undefined)
      || existingByUrl.get(key(job.job_url) || '');
    if (!found) {
      inserts.push({ job, contentHash });
      continue;
    }
    const lifecycleChanged = found.is_active !== job.is_active || found.is_closed !== job.is_closed;
    if (existingSyncRecords.get(found.id)?.content_hash === contentHash && !lifecycleChanged) {
      unchanged.push(makeSyncRecord(found.id, job, contentHash, timestamp, existingSyncRecords.get(found.id)));
      continue;
    }
    updates.push({ id: found.id, job, contentHash });
  }

  const savedSyncRecords: PendingSyncRecord[] = [...unchanged];
  for (const batch of chunks(inserts, WRITE_BATCH_SIZE)) {
    const { data, error } = await retryDatabaseOperation(
      () => client
        .from('jobs')
        .insert(batch.map(({ job }) => ({ ...toJobPayload(job), last_verified_at: timestamp })))
        .select('id, job_url'),
      '创建岗位',
    );
    if (error || !data) {
      result.failed += batch.length;
      result.invalidJobs.push({ index: result.invalidJobs.length + 1, reason: `写入岗位失败: ${error?.message || '未返回已创建岗位'}`, data: { count: batch.length } });
      continue;
    }
    const createdByUrl = new Map((data as ExistingJob[]).map((row) => [key(row.job_url), row.id]));
    for (const item of batch) {
      const jobId = createdByUrl.get(key(item.job.job_url));
      if (!jobId) {
        result.failed += 1;
        result.invalidJobs.push({ index: result.invalidJobs.length + 1, reason: '创建岗位后未返回岗位 ID', data: { job_url: item.job.job_url } });
        continue;
      }
      result.created += 1;
      savedSyncRecords.push(makeSyncRecord(jobId, item.job, item.contentHash, timestamp));
    }
  }

  for (const batch of chunks(updates, 25)) {
    const outcomes = await Promise.all(batch.map(async (pending) => ({
      pending,
      outcome: await retryDatabaseOperation(
        () => client
          .from('jobs')
          .update({ ...toJobPayload(pending.job), updated_at: timestamp })
          .eq('id', pending.id),
        '更新岗位',
      ),
    })));
    for (const { pending, outcome } of outcomes) {
      if (outcome.error) {
        result.failed += 1;
        result.invalidJobs.push({ index: result.invalidJobs.length + 1, reason: `更新岗位失败: ${outcome.error.message}`, data: {} });
      } else {
        result.updated += 1;
        savedSyncRecords.push(makeSyncRecord(pending.id, pending.job, pending.contentHash, timestamp, existingSyncRecords.get(pending.id)));
      }
    }
  }

  await saveSyncRecords(client, savedSyncRecords);
  result.unchanged = unchanged.length;
  return result;
}
