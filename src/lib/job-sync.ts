import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobAvailabilityStatus, JobLinkHealth } from '@/lib/job-link-health';
import { isDisplayableJobDescription } from '@/lib/job-content';

type Sponsorship = 'yes' | 'no' | 'unknown';
const EXISTING_JOB_LOOKUP_BATCH_SIZE = 20;
// UUID lists are serialized into the PostgREST query string. 500 IDs can
// exceed proxy/request-line limits and surface as an opaque `fetch failed`.
const EXISTING_EXTERNAL_ID_LOOKUP_BATCH_SIZE = 100;
const EXISTING_SYNC_RECORD_LOOKUP_BATCH_SIZE = 500;
const DEFAULT_WRITE_BATCH_SIZE = 100;
const MAX_WRITE_BATCH_SIZE = 500;
const DEFAULT_FALLBACK_WRITE_CONCURRENCY = 8;
const MAX_FALLBACK_WRITE_CONCURRENCY = 16;

const runtimeWriteEnv = {
  JOBS_SYNC_WRITE_BATCH_SIZE: process.env.JOBS_SYNC_WRITE_BATCH_SIZE,
  JOBS_SYNC_FALLBACK_WRITE_CONCURRENCY: process.env.JOBS_SYNC_FALLBACK_WRITE_CONCURRENCY,
};

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
  employment_type?: string | null;
  employment_category?: string | null;
  experience_min_years?: number | null;
  experience_max_years?: number | null;
  experience_text?: string | null;
  workplace_type?: string | null;
  deadline_source?: string | null;
  salary_source?: string | null;
  location_source?: string | null;
  field_evidence?: Record<string, unknown>;
  job_url: string | null;
  source_url: string | null;
  sponsorship: Sponsorship;
  is_active: boolean;
  is_closed: boolean;
  source_system?: string | null;
  external_job_id?: string | null;
  valid_through?: string | null;
  posted_at?: string | null;
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

export interface JobSyncFailureInput {
  dedupe_key: string;
  source_system: string;
  company: string | null;
  external_job_id: string | null;
  source_url: string | null;
  operation: string;
  payload: Record<string, unknown>;
  error_message: string;
}

export interface JobSyncFailureIdentity {
  source_system?: string | null;
  company?: string | null;
  external_job_id?: string | null;
  source_url?: string | null;
  title?: string | null;
  job_id?: number | null;
}

export interface JobSyncResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  recoverable_failures: number;
  write_batches: number;
  write_batch_failures: number;
  write_fallback_rows: number;
  write_duration_ms: number;
  invalidJobs: JobSyncRejection[];
}

function positiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export function getJobSyncWritePolicy(env: {
  JOBS_SYNC_WRITE_BATCH_SIZE?: string;
  JOBS_SYNC_FALLBACK_WRITE_CONCURRENCY?: string;
} = runtimeWriteEnv): { batchSize: number; fallbackConcurrency: number } {
  return {
    batchSize: positiveInteger(env.JOBS_SYNC_WRITE_BATCH_SIZE, DEFAULT_WRITE_BATCH_SIZE, MAX_WRITE_BATCH_SIZE),
    fallbackConcurrency: positiveInteger(
      env.JOBS_SYNC_FALLBACK_WRITE_CONCURRENCY,
      DEFAULT_FALLBACK_WRITE_CONCURRENCY,
      MAX_FALLBACK_WRITE_CONCURRENCY,
    ),
  };
}

interface ExistingJob {
  id: number;
  job_url: string | null;
  company: string | null;
  source_system: string | null;
  external_job_id: string | null;
  salary_range?: string | null;
  employment_type?: string | null;
  employment_category?: string | null;
  experience_min_years?: number | null;
  experience_max_years?: number | null;
  experience_text?: string | null;
  workplace_type?: string | null;
  valid_through?: string | null;
  posted_at?: string | null;
  deadline_source?: string | null;
  salary_source?: string | null;
  location_source?: string | null;
  field_evidence?: Record<string, unknown> | null;
  description?: string | null;
  overview?: string | null;
  responsibilities?: string | null;
  requirements?: string | null;
  nice_to_have?: string | null;
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
  existing: ExistingJob;
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
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return String(error || '未知数据库错误');
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function failureDedupeKey(job: JobSyncFailureIdentity, operation: string): string {
  const identity = job.external_job_id
    ? `${job.source_system || 'unknown'}:${job.company || ''}:${job.external_job_id}`
    : job.source_url
      ? `${job.source_system || 'unknown'}:${key(job.source_url) || 'unknown'}`
      : `${job.source_system || 'unknown'}:job:${job.job_id ?? 'unknown'}`;
  return createHash('sha256').update(`${operation}:${identity}`, 'utf8').digest('hex');
}

export function buildJobSyncFailure(
  job: JobSyncFailureIdentity,
  operation: string,
  error: unknown,
): JobSyncFailureInput {
  const payload: Record<string, unknown> = {
    title: job.title || null,
    company: job.company || null,
    external_job_id: job.external_job_id || null,
    source_url: job.source_url || null,
  };
  if (job.job_id != null) payload.job_id = job.job_id;
  return {
    dedupe_key: failureDedupeKey(job, operation),
    source_system: job.source_system || 'unknown',
    company: job.company || null,
    external_job_id: job.external_job_id || null,
    source_url: job.source_url || null,
    operation,
    payload,
    error_message: errorMessage(error).slice(0, 2_000),
  };
}

function failureInput(
  job: Pick<JobSyncRecord, 'source_system' | 'company' | 'external_job_id' | 'job_url' | 'source_url' | 'title'>,
  operation: string,
  error: unknown,
): JobSyncFailureInput {
  return buildJobSyncFailure({
    source_system: job.source_system,
    company: job.company,
    external_job_id: job.external_job_id,
    source_url: job.source_url || job.job_url,
    title: job.title,
  }, operation, error);
}

export async function enqueueJobSyncFailures(client: SupabaseClient, failures: JobSyncFailureInput[]): Promise<void> {
  if (failures.length === 0) return;
  const { error } = await client.rpc('enqueue_job_sync_failures', { p_failures: failures });
  if (error) throw new Error(`保存岗位失败队列失败: ${error.message}`);
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

function hashPart(value: string | number | boolean | null | undefined): string {
  const normalized = value == null ? '' : String(value);
  return `${Buffer.byteLength(normalized, 'utf8')}:${normalized}`;
}

/**
 * This is intentionally a change detector, not a security primitive. The SQL
 * backfill uses the same length-prefixed MD5 input so existing jobs do not get
 * rewritten merely because this storage optimization is deployed.
 */
export function jobContentHash(job: JobSyncRecord): string {
  const overview = job.overview === job.description ? null : job.overview;
  const fields: Array<string | number | boolean | null | undefined> = [
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
    job.employment_type,
    job.employment_category,
    job.experience_min_years,
    job.experience_max_years,
    job.experience_text,
    job.workplace_type,
    job.job_url,
    job.source_url,
    job.sponsorship,
    job.is_active,
    job.is_closed,
    job.source_system,
    job.external_job_id,
    timestampForHash(job.valid_through),
    job.deadline_source,
    job.salary_source,
    job.location_source,
    JSON.stringify(job.field_evidence || {}),
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

function toJobPayload(job: JobSyncRecord, existing?: ExistingJob): Omit<JobSyncRecord, 'availability_status' | 'link_health' | 'last_link_error' | 'last_link_http_status' | 'availability_checked_at'> {
  const {
    availability_status: _availabilityStatus,
    link_health: _linkHealth,
    last_link_error: _lastLinkError,
    last_link_http_status: _lastLinkHttpStatus,
    availability_checked_at: _availabilityCheckedAt,
    ...payload
  } = job;
  // A collector can temporarily omit detail content or send an ATS SPA shell
  // while the official-detail backfill is still pending. Never erase a real
  // candidate-facing body that was already verified from the official page.
  for (const field of ['description', 'overview', 'responsibilities', 'requirements', 'nice_to_have'] as const) {
    const incoming = payload[field];
    const previous = existing?.[field];
    if ((!isDisplayableJobDescription(incoming) || (typeof incoming === 'string' && incoming.trim().length < 40))
      && isDisplayableJobDescription(previous)) {
      (payload as Record<string, unknown>)[field] = previous;
    }
  }
  // A source omitting an optional field is not evidence that it was removed.
  // Retain an existing verified/admin value until a future source explicitly
  // provides a replacement.
  // A missing deadline is an explicit "not verified" result from the feed.
  // Never preserve a stale date or its source across syncs; this prevents old
  // inferred dates from resurfacing after a clean-up migration.
  for (const field of ['salary_range', 'employment_type', 'employment_category', 'experience_min_years', 'experience_max_years', 'experience_text', 'workplace_type', 'salary_source', 'location_source', 'posted_at'] as const) {
    if (payload[field] == null && existing?.[field] != null) {
      (payload as Record<string, unknown>)[field] = existing[field];
    }
  }
  if ((!payload.field_evidence || Object.keys(payload.field_evidence).length === 0) && existing?.field_evidence) {
    payload.field_evidence = existing.field_evidence;
  } else if (payload.field_evidence && existing?.field_evidence) {
    const incomingFields = payload.field_evidence.fields;
    const existingFields = existing.field_evidence.fields;
    if (incomingFields && typeof incomingFields === 'object' && !Array.isArray(incomingFields)
      && existingFields && typeof existingFields === 'object' && !Array.isArray(existingFields)) {
      const mergedFields: Record<string, unknown> = { ...(incomingFields as Record<string, unknown>) };
      for (const [name, oldEvidence] of Object.entries(existingFields as Record<string, unknown>)) {
        const nextEvidence = mergedFields[name];
        if (!oldEvidence || typeof oldEvidence !== 'object' || Array.isArray(oldEvidence)
          || !nextEvidence || typeof nextEvidence !== 'object' || Array.isArray(nextEvidence)) continue;
        const previous = oldEvidence as Record<string, unknown>;
        const next = nextEvidence as Record<string, unknown>;
        // An upstream omission is not a correction. Preserve the forensic
        // record of a quarantined legacy field until a verified source sends a
        // replacement, which makes company-by-company audits reproducible.
        if ((previous.status === 'rejected_legacy' || previous.status === 'verified') && next.status !== 'verified') {
          mergedFields[name] = { ...previous, last_rechecked_at: new Date().toISOString() };
        }
      }
      payload.field_evidence = { ...payload.field_evidence, fields: mergedFields };
    }
  }
  return payload;
}

interface JobSyncWriteMetrics {
  batches: number;
  batchFailures: number;
  fallbackRows: number;
}

async function saveSyncRecords(
  client: SupabaseClient,
  records: PendingSyncRecord[],
  metrics: JobSyncWriteMetrics,
  policy: { batchSize: number; fallbackConcurrency: number },
): Promise<JobSyncFailureInput[]> {
  // Feeds occasionally repeat a job URL in the same page. PostgreSQL rejects
  // an upsert batch that targets the same conflict key twice, so retain the
  // final observation for each job before writing sync metadata.
  const deduplicatedRecords = [...new Map(records.map((record) => [record.job_id, record])).values()];
  const failures: JobSyncFailureInput[] = [];
  for (const batch of chunks(deduplicatedRecords, policy.batchSize)) {
    metrics.batches += 1;
    const { error } = await retryDatabaseOperation(
      () => client.from('job_sync_records').upsert(batch, { onConflict: 'job_id' }),
      '保存岗位同步状态',
    );
    if (!error) continue;

    metrics.batchFailures += 1;
    metrics.fallbackRows += batch.length;

    // Metadata is recoverable per job. The job row has already been written,
    // so retry metadata rows independently and keep the feed cursor moving.
    const rowFailures = await mapWithConcurrency(batch, policy.fallbackConcurrency, async (record) => {
      try {
        const single = await retryDatabaseOperation(
          () => client.from('job_sync_records').upsert(record, { onConflict: 'job_id' }),
          '保存岗位同步状态（单条降级）',
        );
        if (!single.error) return null;
        return buildJobSyncFailure({
          source_system: record.source_system,
          job_id: record.job_id,
        }, 'sync_record', single.error);
      } catch (error) {
        return buildJobSyncFailure({
          source_system: record.source_system,
          job_id: record.job_id,
        }, 'sync_record', error);
      }
    });
    failures.push(...rowFailures.filter((failure): failure is JobSyncFailureInput => failure !== null));
  }
  return failures;
}

export async function syncJobRecords(
  client: SupabaseClient,
  jobs: JobSyncRecord[],
  _mode: 'create' | 'sync' = 'sync',
  options: { verifiedAt?: string; enqueueFailures?: boolean } = {},
): Promise<JobSyncResult> {
  const result: JobSyncResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    recoverable_failures: 0,
    write_batches: 0,
    write_batch_failures: 0,
    write_fallback_rows: 0,
    write_duration_ms: 0,
    invalidJobs: [],
  };
  const failures: JobSyncFailureInput[] = [];
  const writeMetrics: JobSyncWriteMetrics = { batches: 0, batchFailures: 0, fallbackRows: 0 };
  const writeStartedAt = Date.now();
  const writePolicy = getJobSyncWritePolicy();
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
      () => client.from('jobs').select('id, job_url, company, source_system, external_job_id, description, overview, responsibilities, requirements, nice_to_have, salary_range, employment_type, employment_category, experience_min_years, experience_max_years, experience_text, workplace_type, valid_through, posted_at, deadline_source, salary_source, location_source, field_evidence, is_active, is_closed').in('external_job_id', batch),
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
      () => client.from('jobs').select('id, job_url, company, source_system, external_job_id, description, overview, responsibilities, requirements, nice_to_have, salary_range, employment_type, employment_category, experience_min_years, experience_max_years, experience_text, workplace_type, valid_through, posted_at, deadline_source, salary_source, location_source, field_evidence, is_active, is_closed').in('job_url', batch),
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
      failures.push(failureInput(job, 'validate', '岗位缺少必填字段或官网链接'));
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
    updates.push({ id: found.id, job, contentHash, existing: found });
  }

  const savedSyncRecords: PendingSyncRecord[] = [...unchanged];
  for (const batch of chunks(inserts, writePolicy.batchSize)) {
    writeMetrics.batches += 1;
    const { data, error } = await retryDatabaseOperation(
      () => client
        .from('jobs')
        .insert(batch.map(({ job }) => ({ ...toJobPayload(job), last_verified_at: timestamp })))
        .select('id, job_url'),
      '创建岗位',
    );
    if (error || !data) {
      writeMetrics.batchFailures += 1;
      writeMetrics.fallbackRows += batch.length;
      // A single invalid row must not turn a whole page into a retry loop.
      // Retry rows independently so valid records can still advance the feed.
      const rowOutcomes = await mapWithConcurrency(batch, writePolicy.fallbackConcurrency, async (item) => {
        try {
          const single = await retryDatabaseOperation(
            () => client
              .from('jobs')
              .insert({ ...toJobPayload(item.job), last_verified_at: timestamp })
              .select('id, job_url'),
            '创建岗位（单条降级）',
          );
          const row = (single.data as ExistingJob[] | null)?.[0];
          if (single.error || !row?.id) {
            const rowError = single.error || error || new Error('未返回已创建岗位');
            return { item, error: rowError };
          }
          return { item, row };
        } catch (rowError) {
          return { item, error: rowError };
        }
      });
      for (const outcome of rowOutcomes) {
        if ('error' in outcome) {
          result.failed += 1;
          failures.push(failureInput(outcome.item.job, 'insert', outcome.error));
          result.invalidJobs.push({ index: result.invalidJobs.length + 1, reason: `写入岗位失败: ${errorMessage(outcome.error)}`, data: { source_url: outcome.item.job.job_url } });
          continue;
        }
        result.created += 1;
        savedSyncRecords.push(makeSyncRecord(outcome.row.id, outcome.item.job, outcome.item.contentHash, timestamp));
      }
      continue;
    }
    const createdByUrl = new Map((data as ExistingJob[]).map((row) => [key(row.job_url), row.id]));
    for (const item of batch) {
      const jobId = createdByUrl.get(key(item.job.job_url));
      if (!jobId) {
        result.failed += 1;
        failures.push(failureInput(item.job, 'insert', '创建岗位后未返回岗位 ID'));
        result.invalidJobs.push({ index: result.invalidJobs.length + 1, reason: '创建岗位后未返回岗位 ID', data: { job_url: item.job.job_url } });
        continue;
      }
      result.created += 1;
      savedSyncRecords.push(makeSyncRecord(jobId, item.job, item.contentHash, timestamp));
    }
  }

  for (const batch of chunks(updates, writePolicy.batchSize)) {
    writeMetrics.batches += 1;
    const { error } = await retryDatabaseOperation(
      () => client.from('jobs').upsert(
        batch.map((pending) => ({
          id: pending.id,
          ...toJobPayload(pending.job, pending.existing),
          updated_at: timestamp,
        })),
        { onConflict: 'id' },
      ),
      '更新岗位批次',
    );
    if (!error) {
      for (const pending of batch) {
        result.updated += 1;
        savedSyncRecords.push(makeSyncRecord(pending.id, pending.job, pending.contentHash, timestamp, existingSyncRecords.get(pending.id)));
      }
      continue;
    }

    writeMetrics.batchFailures += 1;
    writeMetrics.fallbackRows += batch.length;
    const rowOutcomes = await mapWithConcurrency(batch, writePolicy.fallbackConcurrency, async (pending) => {
      try {
        const single = await retryDatabaseOperation(
          () => client
            .from('jobs')
            .update({ ...toJobPayload(pending.job, pending.existing), updated_at: timestamp })
            .eq('id', pending.id),
          '更新岗位（单条降级）',
        );
        return { pending, error: single.error ? new Error(errorMessage(single.error)) : null };
      } catch (rowError) {
        return { pending, error: new Error(errorMessage(rowError)) };
      }
    });
    for (const { pending, error: rowError } of rowOutcomes) {
      if (rowError) {
        result.failed += 1;
        failures.push(failureInput(pending.job, 'update', rowError));
        result.invalidJobs.push({ index: result.invalidJobs.length + 1, reason: `更新岗位失败: ${rowError.message}`, data: {} });
      } else {
        result.updated += 1;
        savedSyncRecords.push(makeSyncRecord(pending.id, pending.job, pending.contentHash, timestamp, existingSyncRecords.get(pending.id)));
      }
    }
  }

  const syncRecordFailures = await saveSyncRecords(client, savedSyncRecords, writeMetrics, writePolicy);
  failures.push(...syncRecordFailures);
  if (options.enqueueFailures !== false) {
    await enqueueJobSyncFailures(client, failures);
  }
  result.recoverable_failures = failures.length;
  result.write_batches = writeMetrics.batches;
  result.write_batch_failures = writeMetrics.batchFailures;
  result.write_fallback_rows = writeMetrics.fallbackRows;
  result.write_duration_ms = Date.now() - writeStartedAt;
  result.unchanged = unchanged.length;
  return result;
}
