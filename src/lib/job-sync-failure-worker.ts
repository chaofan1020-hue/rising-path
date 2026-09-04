import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import {
  fetchJobForSyncRetry,
  isClosedItem,
  normalizeFeedItem,
  JOBS_FEED_SOURCE,
  type JobsFeedItem,
} from '@/lib/jobs-feed';
import {
  syncJobRecords,
  type JobSyncRecord,
} from '@/lib/job-sync';

const FAILURE_WORKER_SOURCE = 'job_sync_failures';
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_STALE_SECONDS = 900;
const MAX_ERROR_LENGTH = 2_000;

type FailureRow = {
  id: number;
  source_system: string;
  company: string | null;
  external_job_id: string | null;
  source_url: string | null;
  operation: string;
  payload: Record<string, unknown> | null;
  attempts: number;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function positiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return String(error || '岗位失败重试异常');
}

async function claimBatch(client: SupabaseClient, owner: string, limit: number): Promise<FailureRow[]> {
  const { data, error } = await client.rpc('claim_job_sync_failure_batch', {
    p_owner: owner,
    p_limit: limit,
    p_stale_after_seconds: DEFAULT_STALE_SECONDS,
  });
  if (error) throw new Error(`领取岗位失败队列失败: ${error.message}`);
  return (data || []) as FailureRow[];
}

async function claimLease(client: SupabaseClient, owner: string): Promise<void> {
  const { data, error } = await client.rpc('claim_job_sync', {
    p_source_system: FAILURE_WORKER_SOURCE,
    p_owner: owner,
    p_ttl_seconds: DEFAULT_STALE_SECONDS,
  });
  if (error) throw new Error(`申请岗位失败队列租约失败: ${error.message}`);
  if (data !== true) throw new Error('另一个岗位失败队列 worker 正在运行');
}

async function releaseLease(client: SupabaseClient, owner: string): Promise<void> {
  const { error } = await client.rpc('release_job_sync', {
    p_source_system: FAILURE_WORKER_SOURCE,
    p_owner: owner,
  });
  if (error) console.error('[Job Sync Failure Worker] release lease failed:', error.message);
}

async function resolve(client: SupabaseClient, row: FailureRow, owner: string): Promise<void> {
  const { data, error } = await client.rpc('resolve_job_sync_failure', { p_id: row.id, p_owner: owner });
  if (error) throw new Error(`标记岗位失败已解决失败: ${error.message}`);
  if (data !== true) throw new Error(`岗位失败记录 ${row.id} 已被其他 worker 接管`);
}

async function fail(client: SupabaseClient, row: FailureRow, owner: string, error: unknown): Promise<string | null> {
  const { data, error: rpcError } = await client.rpc('fail_job_sync_failure', {
    p_id: row.id,
    p_owner: owner,
    p_error_message: errorMessage(error).slice(0, MAX_ERROR_LENGTH),
  });
  if (rpcError) throw new Error(`更新岗位失败队列状态失败: ${rpcError.message}`);
  return typeof data === 'string' ? data : null;
}

function payloadValue(row: FailureRow, name: string): string | null {
  const value = row.payload && typeof row.payload[name] === 'string' ? row.payload[name] as string : null;
  return value?.trim() || null;
}

async function closeOne(client: SupabaseClient, row: FailureRow): Promise<void> {
  const externalId = row.external_job_id || payloadValue(row, 'external_job_id');
  const sourceUrl = row.source_url || payloadValue(row, 'source_url');
  const closePayload = {
    is_active: false,
    is_closed: true,
    source_system: JOBS_FEED_SOURCE,
    updated_at: new Date().toISOString(),
  };
  let query = client.from('jobs').update(closePayload).eq('source_system', JOBS_FEED_SOURCE)
    .eq('company', row.company || payloadValue(row, 'company') || '').eq('is_active', true);
  query = externalId ? query.eq('external_job_id', externalId) : query.eq('source_url', sourceUrl || '');
  const { data, error } = await query.select('id');
  if (error) throw new Error(`重试关闭岗位失败: ${error.message}`);
  const ids = ((data || []) as Array<{ id: number }>).map((item) => item.id);
  for (const jobId of ids) {
    const { error: syncError } = await client.from('job_sync_records').update({
      last_verified_at: new Date().toISOString(),
      missing_from_feed_at: null,
      missing_feed_checks: 0,
      availability_status: 'closed',
      link_health: 'closed',
      last_link_error: null,
      last_link_http_status: null,
      availability_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('job_id', jobId);
    if (syncError) throw new Error(`重试关闭岗位同步状态失败: ${syncError.message}`);
  }
}

function jobFromDatabase(row: Record<string, unknown>): JobSyncRecord | null {
  const sponsorship = text(row.sponsorship);
  if (!row.id || !row.title || !row.company) return null;
  return {
    title: text(row.title), company: text(row.company), region: text(row.region),
    direction: text(row.direction), audience: text(row.audience), job_type: text(row.job_type) || null,
    description: text(row.description) || null, overview: text(row.overview) || null,
    responsibilities: text(row.responsibilities) || null, requirements: text(row.requirements) || null,
    nice_to_have: text(row.nice_to_have) || null, salary_range: text(row.salary_range) || null,
    employment_type: text(row.employment_type) || null, employment_category: text(row.employment_category) || null,
    experience_min_years: typeof row.experience_min_years === 'number' ? row.experience_min_years : null,
    experience_max_years: typeof row.experience_max_years === 'number' ? row.experience_max_years : null,
    experience_text: text(row.experience_text) || null, workplace_type: text(row.workplace_type) || null,
    deadline_source: text(row.deadline_source) || null, salary_source: text(row.salary_source) || null,
    location_source: text(row.location_source) || null,
    field_evidence: row.field_evidence && typeof row.field_evidence === 'object' ? row.field_evidence as Record<string, unknown> : {},
    job_url: text(row.job_url) || null, source_url: text(row.source_url) || null,
    sponsorship: sponsorship === 'yes' || sponsorship === 'no' ? sponsorship : 'unknown',
    is_active: row.is_active === true, is_closed: row.is_closed === true,
    source_system: text(row.source_system) || null, external_job_id: text(row.external_job_id) || null,
    valid_through: text(row.valid_through) || null,
  };
}

async function repairSyncRecord(client: SupabaseClient, row: FailureRow): Promise<void> {
  const jobId = Number(row.payload?.job_id);
  if (!Number.isInteger(jobId) || jobId <= 0) throw new Error('失败记录缺少有效 job_id');
  const { data, error } = await client.from('jobs').select('*').eq('id', jobId).maybeSingle();
  if (error) throw new Error(`读取待修复岗位失败: ${error.message}`);
  const job = jobFromDatabase((data || {}) as Record<string, unknown>);
  if (!job) throw new Error(`岗位 ${jobId} 不存在或字段不完整`);
  const result = await syncJobRecords(client, [job], 'sync', {
    verifiedAt: new Date().toISOString(),
    enqueueFailures: false,
  });
  if (result.failed > 0 || result.recoverable_failures > 0) {
    throw new Error(`岗位 ${jobId} 同步状态修复仍失败`);
  }
}

async function retryCollectorRecord(client: SupabaseClient, row: FailureRow): Promise<void> {
  if (row.source_system !== JOBS_FEED_SOURCE) throw new Error(`来源 ${row.source_system} 不支持 collector 重试`);
  const item = await fetchJobForSyncRetry({
    externalJobId: row.external_job_id || payloadValue(row, 'external_job_id'),
    sourceUrl: row.source_url || payloadValue(row, 'source_url'),
    company: row.company || payloadValue(row, 'company'),
  });
  if (!item) throw new Error('上游未返回与失败记录完全匹配的岗位');
  if (isClosedItem(item)) {
    await closeOne(client, { ...row, operation: 'close' });
    return;
  }
  const normalized = normalizeFeedItem(item as JobsFeedItem);
  if (!normalized) throw new Error('上游岗位当前仍无法标准化');
  const result = await syncJobRecords(client, [normalized], 'sync', {
    verifiedAt: new Date().toISOString(),
    enqueueFailures: false,
  });
  if (result.failed > 0 || result.recoverable_failures > 0) throw new Error('岗位重试写入仍失败');
}

async function processRow(client: SupabaseClient, row: FailureRow): Promise<void> {
  if (row.operation === 'close') return closeOne(client, row);
  if (row.operation === 'close_sync_record' || row.operation === 'sync_record') return repairSyncRecord(client, row);
  if (row.operation === 'insert' || row.operation === 'update' || row.operation === 'validate') return retryCollectorRecord(client, row);
  throw new Error(`不支持的失败操作: ${row.operation}`);
}

export interface JobSyncFailureCycleResult {
  enabled: boolean;
  claimed: number;
  resolved: number;
  retried: number;
  dead: number;
}

export async function runJobSyncFailureCycle(options: { client?: SupabaseClient; batchSize?: number } = {}): Promise<JobSyncFailureCycleResult> {
  const enabled = process.env.JOBS_SYNC_FAILURE_AUTO_RETRY !== 'false';
  if (!enabled) return { enabled: false, claimed: 0, resolved: 0, retried: 0, dead: 0 };
  const client = options.client || getSupabaseClient();
  const owner = randomUUID();
  await claimLease(client, owner);
  try {
    const claimed = await claimBatch(client, owner, positiveInteger(process.env.JOBS_SYNC_FAILURE_BATCH_SIZE, options.batchSize || DEFAULT_BATCH_SIZE, 100));
    let resolved = 0;
    let dead = 0;
    for (const row of claimed) {
      try {
        await processRow(client, row);
        await resolve(client, row, owner);
        resolved += 1;
      } catch (error) {
        const status = await fail(client, row, owner, error);
        if (status === 'dead') dead += 1;
        console.error('[Job Sync Failure Worker] retry failed', {
          id: row.id, operation: row.operation, company: row.company, attempts: row.attempts, status,
          error: errorMessage(error).slice(0, MAX_ERROR_LENGTH),
        });
      }
    }
    return { enabled: true, claimed: claimed.length, resolved, retried: claimed.length - resolved - dead, dead };
  } finally {
    await releaseLease(client, owner);
  }
}
