import { randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCompanySourceProfile } from '@/lib/job-connectors/company-profiles';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { recordJobSyncRunFinish, recordJobSyncRunProgress, recordJobSyncRunStart } from '@/lib/job-sync-dashboard';

const execFile = promisify(execFileCallback);
const SOURCE_PREFIX = 'historical:';
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_COMPANIES_PER_CYCLE = 2;
// Keep a claimed company until its current candidate list is exhausted. Two
// companies still run in parallel via COMPANIES_PER_CYCLE, but a healthy
// company is no longer rotated away after an arbitrary eight batches.
const DEFAULT_BATCHES_PER_COMPANY = 1_000;
// A company may spend several minutes fetching a bounded sequence of official
// pages. Keep the live lease below the database maximum and extend it on every
// 15-second heartbeat; the orphan check below still makes a crashed process
// claimable after one minute instead of waiting for the full lease duration.
const DEFAULT_LEASE_SECONDS = 900;
// A process restart can leave a database lease alive even though its child
// process is gone. Heartbeats are emitted every 15 seconds, so anything older
// than this is considered orphaned and made claimable immediately.
const ORPHAN_HEARTBEAT_MS = 60_000;
const COMPLETION_RECHECK_MS = 24 * 60 * 60_000;
const RETRY_MS = 5 * 60_000;
const GENERIC_OFFICIAL_SOURCE_TYPES = new Set(['amazon_jobs', 'apple_official_api', 'google_careers', 'microsoft_careers', 'meta_careers', 'deloitte_careers', 'morgan_stanley_eightfold', 'goldman_sachs_careers']);
// Companies whose official detail pages are handled by
// scripts/backfill-official-job-details.ts (APPROVED_GENERIC_HOSTS keys).
// The historical worker routes these to the official detail script even when
// the source matrix records a connector_name that has no Phase 2 profile.
const OFFICIAL_DETAIL_COMPANIES = new Set([
  'Amazon', 'Apple', 'Google', 'Microsoft', 'Meta', 'Deloitte',
  'Morgan Stanley', 'Goldman Sachs', 'BlackRock', 'Millennium Management',
  'Deutsche Bank', 'Bain & Company', 'Two Sigma', 'Evercore', 'Jefferies', 'Accenture',
]);

function officialDetailCompany(company: string): boolean {
  return OFFICIAL_DETAIL_COMPANIES.has(company.trim());
}
const GENERIC_OFFICIAL_COMPANIES_ENV = 'JOBS_GENERIC_OFFICIAL_BACKFILL_COMPANIES';

function genericOfficialWriteEnabled(company: string): boolean {
  if (process.env.JOBS_GENERIC_OFFICIAL_BACKFILL_WRITE_ENABLED !== 'true') return false;
  const configured = (process.env[GENERIC_OFFICIAL_COMPANIES_ENV] || '').split(',').map((value) => value.trim().toLocaleLowerCase()).filter(Boolean);
  return configured.length === 0 || configured.includes(company.trim().toLocaleLowerCase());
}

function genericOfficialAllowedCompanies(): string[] {
  return (process.env[GENERIC_OFFICIAL_COMPANIES_ENV] || '').split(',').map((value) => value.trim()).filter(Boolean);
}

type QueueRow = {
  id: number;
  company_name: string;
  source_system: string;
  source_family: 'workday' | 'registered_connector' | 'official_generic' | 'discovery_required';
  status: string;
  cursor_job_id: number | null;
  attempts: number;
  total_candidates: number;
  processed_candidates: number;
  remaining_candidates: number;
  updated_jobs: number;
  unavailable_fields: number;
  skipped_jobs: number;
  failed_jobs: number;
};

type BackfillOutput = {
  candidate_jobs?: number;
  selected_candidate_jobs?: number;
  updated?: number;
  skipped?: number;
  failed?: number;
  unavailable_fields?: number;
  last_processed_job_id?: number | null;
};

function positiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function sourceKey(sourceFamily: string, company: string): string {
  return `${SOURCE_PREFIX}${sourceFamily}:${company}`.slice(0, 80);
}

function parseOutput(stdout: string): BackfillOutput {
  const start = Math.max(stdout.lastIndexOf('\n{'), stdout.startsWith('{') ? 0 : -1);
  if (start < 0) throw new Error('历史字段任务没有返回 JSON 结果');
  const value = JSON.parse(stdout.slice(start === 0 ? 0 : start + 1)) as BackfillOutput;
  if (!value || typeof value !== 'object') throw new Error('历史字段任务返回格式无效');
  return value;
}

async function ensureQueue(client: SupabaseClient): Promise<void> {
  const { data, error } = await client.from('job_company_sources')
    .select('company_name,source_type,connector_name,status,is_active')
    .eq('is_active', true);
  if (error) throw new Error(`读取历史字段复核公司失败: ${error.message}`);
  const rows = (data || []).flatMap((row) => {
    const company = typeof row.company_name === 'string' ? row.company_name.trim() : '';
    const sourceType = String(row.source_type || '').toLowerCase();
    const family = sourceType === 'workday' ? 'workday' : GENERIC_OFFICIAL_SOURCE_TYPES.has(sourceType) ? 'official_generic' : getCompanySourceProfile(company) ? 'registered_connector' : officialDetailCompany(company) ? 'official_generic' : 'discovery_required';
    if (!company) return [];
    // A source family that has not been identified is not safe to probe from
    // the historical worker. Keep it visible, but do not let it consume a
    // worker slot while it waits for the source matrix.
    const discoveryRequired = family === 'discovery_required' || row.status === 'discovery_required';
    const connectorPaused = (family === 'registered_connector' && process.env.JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED !== 'true')
      || (family === 'official_generic' && !genericOfficialWriteEnabled(company));
    return [{
      company_name: company,
      source_system: sourceKey(family, company),
      source_family: family,
      status: discoveryRequired || connectorPaused ? 'paused' : 'queued',
      next_run_at: new Date().toISOString(),
      last_error: discoveryRequired ? '来源待探测' : connectorPaused ? (family === 'registered_connector' ? '连接器历史复核未启用写入开关' : '官方详情复核未启用写入开关') : null,
    }];
  });
  if (!rows.length) return;
  const { error: insertError } = await client.from('job_historical_field_reviews').upsert(rows, { onConflict: 'company_name', ignoreDuplicates: true });
  if (insertError) throw new Error(`初始化历史字段复核队列失败: ${insertError.message}`);

  // The source matrix is authoritative. Older queue rows may still carry the
  // discovery_required family after a company was promoted to a configured
  // connector. Reconcile only that stale metadata (and rows paused for the
  // old discovery reason); never reset a cursor or completed counters.
  const { data: existingRows, error: existingError } = await client
    .from('job_historical_field_reviews')
    .select('id,company_name,source_family,source_system,status,last_error')
    .in('company_name', rows.map((row) => row.company_name));
  if (existingError) throw new Error(`读取历史字段复核状态失败: ${existingError.message}`);
  const desiredByCompany = new Map(rows.map((row) => [row.company_name, row]));
  for (const existing of existingRows || []) {
    const desired = desiredByCompany.get(existing.company_name);
    if (!desired) continue;
    const metadataChanged = existing.source_family !== desired.source_family || existing.source_system !== desired.source_system;
    const discoveryStale = existing.last_error === '来源待探测';
    if (!metadataChanged && !discoveryStale) continue;

    const patch: Record<string, unknown> = {
      source_family: desired.source_family,
      source_system: desired.source_system,
      updated_at: new Date().toISOString(),
    };
    if (discoveryStale || existing.source_family === 'discovery_required') {
      patch.status = desired.status;
      patch.last_error = desired.last_error;
      patch.lease_owner = null;
      patch.lease_expires_at = null;
      if (desired.status === 'queued') patch.next_run_at = new Date().toISOString();
    }
    const { error: reconcileError } = await client
      .from('job_historical_field_reviews')
      .update(patch)
      .eq('id', existing.id);
    if (reconcileError) throw new Error(`同步历史字段来源状态失败: ${reconcileError.message}`);
  }

  await recoverOrphanedHistoricalReviews(client);

  // Discovery-required companies remain visible in the queue without being
  // claimable. When their source matrix entry is completed, release only the
  // rows that were paused for discovery; a manually paused task stays paused.
  const discoveryCompanies = rows.filter((row) => row.source_family === 'discovery_required').map((row) => row.company_name);
  if (discoveryCompanies.length) {
    const { error: discoveryError } = await client.from('job_historical_field_reviews')
      .update({ status: 'paused', last_error: '来源待探测', lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() })
      .in('company_name', discoveryCompanies)
      .eq('source_family', 'discovery_required')
      .in('status', ['queued', 'running']);
    if (discoveryError) throw new Error(`更新待探测历史字段任务失败: ${discoveryError.message}`);
  }
  const readyRows = rows.filter((row) => row.status === 'queued');
  for (const readyRow of readyRows) {
    const { error: readyError } = await client.from('job_historical_field_reviews')
      .update({ status: 'queued', source_family: readyRow.source_family, source_system: readyRow.source_system, last_error: null, next_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('company_name', readyRow.company_name)
      .eq('status', 'paused')
      .eq('last_error', '来源待探测');
    if (readyError) throw new Error(`恢复已完成探测的历史字段任务失败: ${readyError.message}`);
  }
  const { error: seedError } = await client.rpc('seed_job_historical_field_review_totals');
  if (seedError && seedError.code !== '42883') {
    console.error('[Historical Field Review] seed totals failed:', seedError.message);
  }
  if (process.env.JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED !== 'true') {
    await client.from('job_historical_field_reviews')
      .update({ status: 'paused', last_error: '连接器历史复核未启用写入开关', lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() })
      .eq('source_family', 'registered_connector').in('status', ['queued', 'running']);
  } else {
    await client.from('job_historical_field_reviews')
      .update({ status: 'queued', last_error: null, next_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('source_family', 'registered_connector').eq('status', 'paused').eq('last_error', '连接器历史复核未启用写入开关');
  }
  if (process.env.JOBS_GENERIC_OFFICIAL_BACKFILL_WRITE_ENABLED === 'true') {
    let readyGeneric = client.from('job_historical_field_reviews')
      .update({ status: 'queued', last_error: null, next_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('source_family', 'official_generic').eq('status', 'paused').eq('last_error', '官方详情复核未启用写入开关');
    const allowedGenericCompanies = genericOfficialAllowedCompanies();
    if (allowedGenericCompanies.length > 0) readyGeneric = readyGeneric.in('company_name', allowedGenericCompanies);
    await readyGeneric;
  } else {
    await client.from('job_historical_field_reviews')
      .update({ status: 'paused', last_error: '官方详情复核未启用写入开关', lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() })
      .eq('source_family', 'official_generic').in('status', ['queued', 'running']);
  }
}

/** Release rows whose worker heartbeat disappeared during a restart or crash. */
async function recoverOrphanedHistoricalReviews(client: SupabaseClient): Promise<void> {
  const orphanedBefore = new Date(Date.now() - ORPHAN_HEARTBEAT_MS).toISOString();
  const { data: orphanedRows, error: orphanError } = await client
    .from('job_historical_field_reviews')
    .select('id,company_name,source_system')
    .eq('status', 'running')
    .lt('last_heartbeat_at', orphanedBefore);
  if (orphanError) throw new Error(`恢复中断的历史字段任务失败: ${orphanError.message}`);
  if (!orphanedRows?.length) return;
  const now = new Date().toISOString();
  const { error: recoverError } = await client.from('job_historical_field_reviews')
    .update({
      status: 'queued',
      next_run_at: now,
      lease_owner: null,
      lease_expires_at: null,
      last_error: '上次进程中断，已自动恢复',
      updated_at: now,
    })
    .in('id', orphanedRows.map((row) => row.id))
    .eq('status', 'running');
  if (recoverError) throw new Error(`恢复中断的历史字段任务失败: ${recoverError.message}`);
  const runSources = orphanedRows.map((row) => row.source_system).filter(Boolean);
  if (runSources.length) {
    const { error: runError } = await client.from('job_sync_runs').update({
      status: 'failed',
      current_stage: 'finished',
      completed_at: now,
      last_heartbeat_at: now,
      error_message: '历史字段复核进程中断，任务已自动恢复',
      stop_reason: 'worker_restart',
    }).eq('status', 'running').eq('mode', 'hist_field_review').in('source_system', runSources).lt('last_heartbeat_at', orphanedBefore);
    if (runError) console.error('[Historical Field Review] stale run recovery failed:', runError.message);
  }
}

export async function queueHistoricalFieldReview(companyName: string, options: { client?: SupabaseClient; reset?: boolean } = {}): Promise<void> {
  const client = options.client || getSupabaseClient();
  await ensureQueue(client);
  const company = companyName.trim();
  if (!company) throw new Error('历史字段复核需要公司名称');
  const patch: Record<string, unknown> = { status: 'queued', next_run_at: new Date().toISOString(), last_error: null, lease_owner: null, lease_expires_at: null };
  if (options.reset !== false) {
    Object.assign(patch, { cursor_job_id: null, total_candidates: 0, processed_candidates: 0, remaining_candidates: 0, updated_jobs: 0, verified_fields: 0, unavailable_fields: 0, skipped_jobs: 0, failed_jobs: 0, completed_at: null });
  }
  const { data, error } = await client.from('job_historical_field_reviews').update(patch).eq('company_name', company).select('id').maybeSingle();
  if (error) throw new Error(`排队历史字段复核失败: ${error.message}`);
  if (!data) throw new Error(`公司 ${company} 没有可用的历史字段复核来源`);
}

export async function pauseHistoricalFieldReview(companyName: string, client = getSupabaseClient()): Promise<void> {
  const { error } = await client.from('job_historical_field_reviews').update({ status: 'paused', lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq('company_name', companyName.trim());
  if (error) throw new Error(`暂停历史字段复核失败: ${error.message}`);
}

async function claim(client: SupabaseClient, owner: string): Promise<QueueRow | null> {
  const { data, error } = await client.rpc('claim_job_historical_field_review', { p_owner: owner, p_lease_seconds: DEFAULT_LEASE_SECONDS });
  if (error) throw new Error(`领取历史字段复核任务失败: ${error.message}`);
  return ((data || [])[0] as QueueRow | undefined) || null;
}

async function processClaimedRow(
  client: SupabaseClient,
  row: QueueRow,
  owner: string,
  batchSize: number,
): Promise<{ completed: number; failed: number; updated: number }> {
  // Registered connectors require their own explicit write gate. Keep those
  // tasks visible but paused instead of retrying a disabled write indefinitely.
  if (row.source_family === 'registered_connector' && process.env.JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED !== 'true') {
    await updateQueue(client, row, owner, {
      status: 'paused',
      last_error: '连接器历史复核未启用写入开关',
      lease_owner: null,
      lease_expires_at: null,
    });
    return { completed: 0, failed: 0, updated: 0 };
  }
  if (row.source_family === 'official_generic' && !genericOfficialWriteEnabled(row.company_name)) {
    await updateQueue(client, row, owner, { status: 'paused', last_error: '官方详情复核未启用写入开关', lease_owner: null, lease_expires_at: null });
    return { completed: 0, failed: 0, updated: 0 };
  }
  if (row.source_family === 'discovery_required') {
    await updateQueue(client, row, owner, {
      status: 'paused',
      last_error: '来源待探测',
      lease_owner: null,
      lease_expires_at: null,
    });
    return { completed: 0, failed: 0, updated: 0 };
  }

  let current: QueueRow = { ...row };
  let completed = 0;
  let failedTotal = 0;
  let updatedTotal = 0;
  const maxBatches = positiveInteger(
    process.env.JOBS_HISTORICAL_FIELD_REVIEW_BATCHES_PER_COMPANY,
    DEFAULT_BATCHES_PER_COMPANY,
    2_000,
  );

  // Keep the same company lease while processing several batches. This avoids
  // rotating away after five jobs and makes the cursor move continuously. A
  // bounded batch count still gives other companies a fair turn.
  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    const runId = await recordJobSyncRunStart(client, {
      source_system: current.source_system,
      company_name: current.company_name,
      mode: 'hist_field_review',
      cursor_before: current.cursor_job_id == null ? null : String(current.cursor_job_id),
      current_stage: 'processing_company',
    });
    const heartbeat = setInterval(() => {
      void updateQueue(client, current, owner, {}).catch((error) => {
        console.error('[Historical Field Review] heartbeat update failed:', error instanceof Error ? error.message : error);
      });
      void recordJobSyncRunProgress(client, runId, {
        current_stage: 'processing_company',
        current_company_name: current.company_name,
        current_cursor: current.cursor_job_id == null ? null : String(current.cursor_job_id),
        total_candidates: current.total_candidates,
        processed_candidates: current.processed_candidates,
        remaining_candidates: current.remaining_candidates,
      });
    }, 15_000);
    try {
      const tsxPath = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
      const script = current.source_family === 'registered_connector' ? 'scripts/backfill-connector-fields.ts' : 'scripts/backfill-official-job-details.ts';
      const args = [tsxPath, script, `--company=${current.company_name}`, `--limit=${batchSize}`, '--write', '--review-missing-fields'];
      if (current.cursor_job_id != null) args.push(`--after-id=${current.cursor_job_id}`);
      if (runId) args.push(`--run-id=${runId}`);
      const { stdout, stderr } = await execFile(process.execPath, args, {
        cwd: process.cwd(),
        env: { ...process.env, JOB_BACKFILL_CONCURRENCY: '1' },
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      });
      const result = parseOutput(stdout);
      const candidateCount = Number(result.candidate_jobs) || 0;
      const selected = Number(result.selected_candidate_jobs) || 0;
      const failed = Number(result.failed) || 0;
      const updated = Number(result.updated) || 0;
      const nextCursor = Number.isInteger(result.last_processed_job_id) ? Number(result.last_processed_job_id) : current.cursor_job_id;
      const exhausted = candidateCount === 0 || (selected === 0 && nextCursor == null);
      // The active feed can add eligible jobs while a long company pass is in
      // progress. Grow the denominator to the largest observed position so
      // the dashboard never shows processed > total.
      const totalCandidates = Math.max(
        current.total_candidates,
        candidateCount + current.processed_candidates,
        current.processed_candidates + selected,
      );
      const processedCandidates = current.processed_candidates + selected;
      // candidateCount is the number visible after the current cursor, not a
      // stable denominator. Use the durable company totals so the dashboard
      // never jumps back to a batch-local number between child processes.
      const remainingCandidates = exhausted
        ? 0
        : Math.max(0, totalCandidates - processedCandidates);
      failedTotal += failed;
      updatedTotal += updated;

      // Only an entirely failed batch is considered stuck. Row-level failures
      // are already isolated by the child script, so a mixed batch advances the
      // cursor and continues with the next jobs.
      const batchStuck = failed > 0 && selected > 0 && failed >= selected;
      if (batchStuck) {
        const message = `本批 ${failed} 条岗位全部失败，已保留游标等待重试`;
        await updateQueue(client, current, owner, {
          status: 'queued',
          next_run_at: new Date(Date.now() + RETRY_MS).toISOString(),
          last_error: message,
          failed_jobs: current.failed_jobs + failed,
          lease_owner: null,
          lease_expires_at: null,
        });
        await recordJobSyncRunFinish(client, runId, {
          status: 'partial',
          cursor_after: current.cursor_job_id == null ? null : String(current.cursor_job_id),
          total_candidates: totalCandidates,
          processed_candidates: current.processed_candidates,
          remaining_candidates: Math.max(0, totalCandidates - current.processed_candidates),
          upserted: updated,
          row_failures: failed,
          error_message: message,
          stop_reason: 'row_failures',
        });
        return { completed, failed: failedTotal, updated: updatedTotal };
      }

      const release = exhausted || batchIndex + 1 >= maxBatches;
      const nextPatch = {
        // Keep the lease row in running state between batches. If it were
        // changed to queued while retaining the lease, another worker could
        // claim the same company concurrently and duplicate field writes.
        status: exhausted ? 'completed' : release ? 'queued' : 'running',
        cursor_job_id: nextCursor,
        total_candidates: totalCandidates,
        processed_candidates: processedCandidates,
        remaining_candidates: remainingCandidates,
        updated_jobs: current.updated_jobs + updated,
        unavailable_fields: current.unavailable_fields + (Number(result.unavailable_fields) || 0),
        skipped_jobs: current.skipped_jobs + (Number(result.skipped) || 0),
        failed_jobs: current.failed_jobs + failed,
        next_run_at: exhausted ? new Date(Date.now() + COMPLETION_RECHECK_MS).toISOString() : new Date().toISOString(),
        completed_at: exhausted ? new Date().toISOString() : null,
        last_error: failed > 0 ? `本批跳过 ${failed} 条失败岗位，继续后续岗位` : null,
        ...(release ? { lease_owner: null, lease_expires_at: null } : {}),
      };
      await updateQueue(client, current, owner, nextPatch);
      await recordJobSyncRunFinish(client, runId, {
        status: failed > 0 ? 'partial' : 'success',
        cursor_after: nextCursor == null ? null : String(nextCursor),
        total_candidates: totalCandidates,
        processed_candidates: selected,
        remaining_candidates: remainingCandidates,
        upserted: updated,
        skipped: Number(result.skipped) || 0,
        row_failures: failed,
        error_message: failed > 0 ? `本批跳过 ${failed} 条失败岗位，继续后续岗位` : null,
        stop_reason: failed > 0 ? 'row_failures' : null,
      });
      if (stderr.trim()) console.info('[Historical Field Review] child stderr', stderr.trim().slice(-500));
      if (exhausted) completed += 1;
      if (exhausted || release) return { completed, failed: failedTotal, updated: updatedTotal };
      current = {
        ...current,
        cursor_job_id: nextCursor,
        total_candidates: totalCandidates,
        processed_candidates: processedCandidates,
        remaining_candidates: remainingCandidates,
        updated_jobs: current.updated_jobs + updated,
        unavailable_fields: current.unavailable_fields + (Number(result.unavailable_fields) || 0),
        skipped_jobs: current.skipped_jobs + (Number(result.skipped) || 0),
        failed_jobs: current.failed_jobs + failed,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateQueue(client, current, owner, {
        status: 'queued',
        next_run_at: new Date(Date.now() + RETRY_MS).toISOString(),
        last_error: message.slice(0, 2_000),
        lease_owner: null,
        lease_expires_at: null,
      }).catch(() => undefined);
      await recordJobSyncRunFinish(client, runId, {
        status: 'failed',
        cursor_after: current.cursor_job_id == null ? null : String(current.cursor_job_id),
        error_message: message,
        stop_reason: 'error',
      });
      return { completed, failed: failedTotal + 1, updated: updatedTotal };
    } finally {
      clearInterval(heartbeat);
    }
  }
  return { completed, failed: failedTotal, updated: updatedTotal };
}

async function updateQueue(client: SupabaseClient, row: QueueRow, owner: string, patch: Record<string, unknown>): Promise<void> {
  const now = Date.now();
  const releasing = patch.lease_owner === null || patch.status === 'completed' || patch.status === 'queued' || patch.status === 'paused';
  const { error } = await client.from('job_historical_field_reviews').update({
    ...patch,
    // Extend the lease on every heartbeat. A long company pass must not be
    // reclaimed by another process while its child is still making progress.
    lease_expires_at: releasing ? null : new Date(now + DEFAULT_LEASE_SECONDS * 1_000).toISOString(),
    last_heartbeat_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  })
    .eq('id', row.id).eq('lease_owner', owner).eq('status', 'running');
  if (error) throw new Error(`更新历史字段复核进度失败: ${error.message}`);
}

export interface HistoricalFieldReviewCycleResult {
  enabled: boolean;
  claimed: number;
  completed: number;
  failed: number;
  updated: number;
}

export async function runHistoricalFieldReviewCycle(options: { client?: SupabaseClient; batchSize?: number; companiesPerCycle?: number } = {}): Promise<HistoricalFieldReviewCycleResult> {
  const enabled = process.env.JOBS_HISTORICAL_FIELD_REVIEW_ENABLED === 'true';
  if (!enabled) return { enabled: false, claimed: 0, completed: 0, failed: 0, updated: 0 };
  const client = options.client || getSupabaseClient();
  // The queue writes only field evidence and has its own leases. It can run
  // beside the primary feed without touching job lifecycle flags. Operators
  // may opt into pausing during a feed lease if a host is resource constrained.
  if (process.env.JOBS_HISTORICAL_FIELD_REVIEW_PAUSE_DURING_FEED === 'true') {
    const { data: feedState } = await client.from('job_sync_state').select('lease_expires_at').eq('source_system', 'collector_feed').maybeSingle();
    if (feedState?.lease_expires_at && Date.parse(feedState.lease_expires_at) > Date.now()) {
      return { enabled: true, claimed: 0, completed: 0, failed: 0, updated: 0 };
    }
  }
  await ensureQueue(client);
  // A company can keep the cycle open for several minutes while it processes
  // multiple official-page batches. Keep recovering restart leftovers during
  // that window instead of waiting for the next cycle to begin.
  const orphanWatchdog = setInterval(() => {
    void recoverOrphanedHistoricalReviews(client).catch((error) => {
      console.error('[Historical Field Review] orphan watchdog failed:', error instanceof Error ? error.message : error);
    });
  }, 30_000);
  const batchSize = positiveInteger(process.env.JOBS_HISTORICAL_FIELD_REVIEW_BATCH_SIZE, options.batchSize || DEFAULT_BATCH_SIZE, 50);
  const companiesPerCycle = positiveInteger(
    process.env.JOBS_HISTORICAL_FIELD_REVIEW_COMPANIES_PER_CYCLE,
    options.companiesPerCycle || DEFAULT_COMPANIES_PER_CYCLE,
    2,
  );
  try {
    const tasks: Array<Promise<{ completed: number; failed: number; updated: number }>> = [];
    let claimed = 0;
    for (let index = 0; index < companiesPerCycle; index += 1) {
      const owner = randomUUID();
      const row = await claim(client, owner);
      if (!row) break;
      claimed += 1;
      tasks.push(processClaimedRow(client, row, owner, batchSize));
    }
    if (!tasks.length) return { enabled: true, claimed: 0, completed: 0, failed: 0, updated: 0 };
    const results = await Promise.all(tasks);
    return {
      enabled: true,
      claimed,
      completed: results.reduce((sum, result) => sum + result.completed, 0),
      failed: results.reduce((sum, result) => sum + result.failed, 0),
      updated: results.reduce((sum, result) => sum + result.updated, 0),
    };
  } finally {
    clearInterval(orphanWatchdog);
  }
}
