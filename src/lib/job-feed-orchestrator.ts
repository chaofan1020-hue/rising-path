import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { JOBS_FEED_SOURCE, syncJobsFeed, type JobsFeedSyncResult } from '@/lib/jobs-feed';
import {
  recordFeedCompanyObservations,
  recordJobSyncRunProgress,
  recordJobSyncRunFinish,
  recordJobSyncRunStart,
  type FeedCompanyObservation,
} from '@/lib/job-sync-dashboard';

export type JobFeedSyncMode = 'incremental' | 'reconcile';

export interface JobFeedState {
  source_system: string;
  cursor: string | null;
  reconcile_cursor: string | null;
  reconcile_started_at: string | null;
  reconcile_pages: number;
  reconcile_open_seen: number;
  last_incremental_success_at: string | null;
  last_reconcile_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  last_attempted_at: string | null;
  last_success_at: string | null;
  next_retry_at: string | null;
  priority: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  updated_at: string;
}

export interface JobFeedRunResult extends JobsFeedSyncResult {
  mode: JobFeedSyncMode;
  completed: boolean;
  duration_ms: number;
  stop_reason: 'page_budget' | 'time_budget' | null;
  reconciliation?: { missing: number; closed: number };
}

export function shouldHoldJobFeedCursor(result: Pick<JobsFeedSyncResult, 'fatal_failures'>): boolean {
  return result.fatal_failures > 0;
}

// A reconciliation cursor is only meaningful while the corresponding upstream
// snapshot is being consumed.  Once it has sat for this long, resuming it
// mixes observations from different crawl generations and turns a small
// recovery job into an expensive historical rescan.
const MAX_RECONCILE_AGE_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_INCREMENTAL_MAX_PAGES = 30;
const MAX_INCREMENTAL_PAGES = 100;
const DEFAULT_INCREMENTAL_MAX_DURATION_MS = 4 * 60 * 1_000;
const MAX_INCREMENTAL_MAX_DURATION_MS = 10 * 60 * 1_000;

function boundedPositiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

const runtimeIncrementalEnv = {
  JOBS_INCREMENTAL_MAX_PAGES: process.env.JOBS_INCREMENTAL_MAX_PAGES,
  JOBS_INCREMENTAL_MAX_DURATION_MS: process.env.JOBS_INCREMENTAL_MAX_DURATION_MS,
};

export function getIncrementalSyncPolicy(env: {
  JOBS_INCREMENTAL_MAX_PAGES?: string;
  JOBS_INCREMENTAL_MAX_DURATION_MS?: string;
} = runtimeIncrementalEnv): {
  maxPages: number;
  maxDurationMs: number;
} {
  return {
    maxPages: boundedPositiveInteger(env.JOBS_INCREMENTAL_MAX_PAGES, DEFAULT_INCREMENTAL_MAX_PAGES, MAX_INCREMENTAL_PAGES),
    maxDurationMs: boundedPositiveInteger(
      env.JOBS_INCREMENTAL_MAX_DURATION_MS,
      DEFAULT_INCREMENTAL_MAX_DURATION_MS,
      MAX_INCREMENTAL_MAX_DURATION_MS,
    ),
  };
}

export function isJobFeedSyncDisabled(): boolean {
  return process.env.JOBS_SYNC_DISABLED === 'true';
}

export function isReconcileStale(state: Pick<JobFeedState, 'reconcile_started_at'>, now = Date.now()): boolean {
  if (!state.reconcile_started_at) return false;
  const startedAt = Date.parse(state.reconcile_started_at);
  return !Number.isFinite(startedAt) || now - startedAt > MAX_RECONCILE_AGE_MS;
}

/**
 * Stop a stale historical reconciliation without changing job availability.
 * Explicit upstream close events and official-link checks remain the only
 * mechanisms that can deactivate a downstream job.
 */
export async function abortStaleJobFeedReconcile(client = getSupabaseClient()): Promise<boolean> {
  const state = await getJobFeedState(client);
  if (!isReconcileStale(state)) return false;
  await updateState(client, {
    reconcile_cursor: null,
    reconcile_started_at: null,
    reconcile_pages: 0,
    reconcile_open_seen: 0,
    last_error: '已中止过期的历史全量对账；岗位状态未作任何变更',
  });
  return true;
}

function subtractMinutes(value: string, minutes: number): string {
  const timestamp = Date.parse(value);
  return new Date((Number.isFinite(timestamp) ? timestamp : Date.now()) - minutes * 60_000).toISOString();
}

async function readLegacyCursor(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client
    .from('job_configs')
    .select('config_value')
    .eq('config_type', 'jobs_feed_cursor')
    .order('id', { ascending: true })
    .limit(1);
  if (error) throw new Error(`读取旧同步进度失败: ${error.message}`);
  return data?.[0]?.config_value || null;
}

export async function getJobFeedState(client = getSupabaseClient(), sourceSystem = JOBS_FEED_SOURCE): Promise<JobFeedState> {
  const { data, error } = await client
    .from('job_sync_state')
    .select('*')
    .eq('source_system', sourceSystem)
    .maybeSingle();
  if (error) throw new Error(`读取岗位同步状态失败: ${error.message}`);
  if (data) return data as JobFeedState;

  const legacyCursor = sourceSystem === JOBS_FEED_SOURCE ? await readLegacyCursor(client) : null;
  const { data: inserted, error: insertError } = await client
    .from('job_sync_state')
    .insert({ source_system: sourceSystem, cursor: legacyCursor })
    .select('*')
    .single();
  if (insertError) {
    // Two workers can discover a new company at the same time. Re-read a row
    // created by the other worker instead of treating that normal race as a
    // synchronization failure.
    if (insertError.code === '23505') {
      const { data: raced, error: raceError } = await client
        .from('job_sync_state')
        .select('*')
        .eq('source_system', sourceSystem)
        .maybeSingle();
      if (!raceError && raced) return raced as JobFeedState;
    }
    throw new Error(`初始化岗位同步状态失败: ${insertError.message}`);
  }
  return inserted as JobFeedState;
}

async function updateState(client: SupabaseClient, patch: Partial<JobFeedState>, sourceSystem = JOBS_FEED_SOURCE) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const { error } = await client
        .from('job_sync_state')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('source_system', sourceSystem);
      if (!error) return;
      lastError = error;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError || '未知数据库错误');
  throw new Error(`保存岗位同步状态失败: ${message}`);
}

async function claimLease(client: SupabaseClient, owner: string, sourceSystem = JOBS_FEED_SOURCE) {
  const { data, error } = await client.rpc('claim_job_sync', {
    p_source_system: sourceSystem,
    p_owner: owner,
    p_ttl_seconds: 900,
  });
  if (error) throw new Error(`申请岗位同步租约失败: ${error.message}`);
  if (data !== true) throw new Error('另一个岗位同步任务正在运行，请稍后再试');
  // Keep the generic attempt timestamp aligned with the lease. The
  // incremental-specific timestamp is updated only after the feed catches up;
  // both are needed by the dashboard and operational checks.
  await updateState(client, { last_attempted_at: new Date().toISOString() }, sourceSystem);
}

async function releaseLease(client: SupabaseClient, owner: string, sourceSystem = JOBS_FEED_SOURCE) {
  const { error } = await client.rpc('release_job_sync', {
    p_source_system: sourceSystem,
    p_owner: owner,
  });
  if (error) console.error(`释放岗位同步租约失败: ${error.message}`);
}

function emptyResult(mode: JobFeedSyncMode): JobFeedRunResult {
  return {
    mode,
    completed: false,
    pages: 0,
    received: 0,
    upserted: 0,
    closed: 0,
    skipped: 0,
    failed: 0,
    row_failures: 0,
    fatal_failures: 0,
    write_batches: 0,
    write_batch_failures: 0,
    write_fallback_rows: 0,
    write_duration_ms: 0,
    duration_ms: 0,
    stop_reason: null,
    next_cursor: null,
    has_more: false,
    open_seen: 0,
    skipped_by_reason: {},
    company_observations: {},
  };
}

export async function runJobFeedSync(options: {
  mode?: JobFeedSyncMode;
  maxPages?: number;
  companyId?: string;
  client?: SupabaseClient;
} = {}): Promise<JobFeedRunResult> {
  if (isJobFeedSyncDisabled()) {
    throw new Error('岗位同步已被 JOBS_SYNC_DISABLED 禁用');
  }
  if (options.companyId && process.env.JOBS_FEED_COMPANY_FILTER_ENABLED !== 'true') {
    throw new Error('上游未声明公司过滤能力，已拒绝定向同步以避免误扫整库');
  }
  const client = options.client || getSupabaseClient();
  const mode = options.mode || 'incremental';
  if (options.companyId && mode === 'reconcile') {
    throw new Error('公司定向同步只允许增量模式；完整对账必须在主服务器侧单独执行');
  }
  if (mode === 'reconcile' && process.env.JOBS_ALLOW_FULL_RECONCILE !== 'true') {
    throw new Error('完整岗位对账默认关闭。它仅用于人工恢复审计，须显式设置 JOBS_ALLOW_FULL_RECONCILE=true');
  }
  const incrementalPolicy = getIncrementalSyncPolicy();
  const maxPages = Math.min(
    Math.max(options.maxPages ?? (mode === 'reconcile' ? 1000 : incrementalPolicy.maxPages), 1),
    mode === 'reconcile' ? 1000 : MAX_INCREMENTAL_PAGES,
  );
  const owner = randomUUID();
  // `job_sync_state.source_system` is varchar(50). Keep company cursors
  // isolated without exceeding that persisted key limit.
  const stateSourceSystem = options.companyId ? `feed:company:${options.companyId}` : JOBS_FEED_SOURCE;
  const state = await getJobFeedState(client, stateSourceSystem);
  await claimLease(client, owner, stateSourceSystem);
  const runId = await recordJobSyncRunStart(client, {
    source_system: stateSourceSystem,
    company_id: options.companyId || null,
    mode,
    cursor_before: state.cursor,
    current_stage: 'fetching',
  });
  const aggregate = emptyResult(mode);
  const startedAt = Date.now();
  let stoppedByTimeBudget = false;
  // A single upstream page can take longer than the normal lease window when
  // it contains a large write batch. Keep the lease and run telemetry alive
  // while that page is being fetched/written so stale-run recovery cannot
  // start a second feed worker against the same cursor.
  const heartbeat = setInterval(() => {
    void claimLease(client, owner, stateSourceSystem).catch((error) => {
      console.error('[Job Feed] heartbeat lease renewal failed:', error instanceof Error ? error.message : error);
    });
    void recordJobSyncRunProgress(client, runId, {
      current_stage: 'fetching',
      current_cursor: cursorForHeartbeat,
      pages: aggregate.pages,
      received: aggregate.received,
      upserted: aggregate.upserted,
      closed: aggregate.closed,
      skipped: aggregate.skipped,
      row_failures: aggregate.row_failures,
      fatal_failures: aggregate.fatal_failures,
    });
  }, 15_000);
  heartbeat.unref?.();

  let cursorForHeartbeat: string | null = state.cursor;

  try {
    let cursor: string | undefined;
    let since: string | undefined;
    let reconcileStartedAt: string | undefined;
    let reconcileNeedsFinalize = false;

    if (mode === 'reconcile') {
      if (isReconcileStale(state)) {
        throw new Error('全量对账进度已过期。请先运行 abort:jobs-reconcile 清除旧进度，再显式开始新的对账');
      }
      reconcileStartedAt = state.reconcile_started_at || new Date().toISOString();
      cursor = state.reconcile_cursor || undefined;
      // A completed feed pass can have its cursor cleared before the final
      // missing-job reconciliation finishes. Resume that finalization without
      // replaying every feed page from the beginning.
      reconcileNeedsFinalize = Boolean(state.reconcile_started_at && !state.reconcile_cursor && state.reconcile_pages > 0);
      if (!state.reconcile_started_at) {
        await updateState(client, {
          reconcile_started_at: reconcileStartedAt,
          reconcile_cursor: null,
          reconcile_pages: 0,
          reconcile_open_seen: 0,
          last_error: null,
        }, stateSourceSystem);
      }
    } else {
      cursor = state.cursor || undefined;
      if (!cursor && state.last_incremental_success_at) {
        const overlapMinutes = Math.min(Math.max(Number(process.env.JOBS_FEED_OVERLAP_MINUTES) || 10, 1), 1440);
        since = subtractMinutes(state.last_incremental_success_at, overlapMinutes);
      }
    }

    for (let pageIndex = 0; pageIndex < maxPages && !reconcileNeedsFinalize; pageIndex += 1) {
      if (mode === 'incremental' && pageIndex > 0 && Date.now() - startedAt >= incrementalPolicy.maxDurationMs) {
        stoppedByTimeBudget = true;
        break;
      }
      await claimLease(client, owner, stateSourceSystem);
      const page = await syncJobsFeed(client, {
        cursor,
        since,
        maxPages: 1,
        verifiedAt: reconcileStartedAt,
        includeClosed: mode !== 'reconcile',
        companyId: options.companyId,
      });
      since = undefined;
      aggregate.pages += page.pages;
      aggregate.received += page.received;
      aggregate.upserted += page.upserted;
      aggregate.closed += page.closed;
      aggregate.skipped += page.skipped;
      aggregate.failed += page.failed;
      aggregate.row_failures += page.row_failures;
      aggregate.fatal_failures += page.fatal_failures;
      aggregate.write_batches += page.write_batches;
      aggregate.write_batch_failures += page.write_batch_failures;
      aggregate.write_fallback_rows += page.write_fallback_rows;
      aggregate.write_duration_ms += page.write_duration_ms;
      aggregate.open_seen += page.open_seen;
      for (const [reason, count] of Object.entries(page.skipped_by_reason)) {
        aggregate.skipped_by_reason[reason] = (aggregate.skipped_by_reason[reason] || 0) + count;
      }
      for (const [company, observation] of Object.entries(page.company_observations)) {
        const current = aggregate.company_observations[company] || {
          received: 0,
          upserted: 0,
          closed: 0,
          skipped: 0,
          row_failures: 0,
          fatal_failures: 0,
        } satisfies FeedCompanyObservation;
        current.received += observation.received;
        current.upserted += observation.upserted;
        current.closed += observation.closed;
        current.skipped += observation.skipped;
        current.row_failures += observation.row_failures;
        current.fatal_failures += observation.fatal_failures;
        aggregate.company_observations[company] = current;
      }
      aggregate.next_cursor = page.next_cursor;
      aggregate.has_more = page.has_more;
      cursor = page.next_cursor || undefined;
      cursorForHeartbeat = page.next_cursor || null;

      await recordJobSyncRunProgress(client, runId, {
        current_stage: 'writing',
        current_company_name: Object.keys(page.company_observations || {})[0] || (options.companyId ? options.companyId : null),
        current_page: aggregate.pages,
        current_cursor: page.next_cursor || null,
        has_more: page.has_more,
        pages: aggregate.pages,
        received: aggregate.received,
        upserted: aggregate.upserted,
        closed: aggregate.closed,
        skipped: aggregate.skipped,
        row_failures: aggregate.row_failures,
        fatal_failures: aggregate.fatal_failures,
        write_batches: aggregate.write_batches,
        write_batch_failures: aggregate.write_batch_failures,
        write_fallback_rows: aggregate.write_fallback_rows,
        write_duration_ms: aggregate.write_duration_ms,
      });

      // Row failures are already isolated in job_sync_failures. Only a page-
      // level failure is allowed to hold the cursor for the next cycle.
      if (shouldHoldJobFeedCursor(page)) {
        throw new Error(`岗位同步第 ${aggregate.pages} 页发生 ${page.fatal_failures} 个页面级失败，已保留游标等待重试`);
      }

      if (mode === 'reconcile') {
        await updateState(client, {
          reconcile_cursor: page.has_more ? page.next_cursor : null,
          reconcile_pages: state.reconcile_pages + aggregate.pages,
          reconcile_open_seen: state.reconcile_open_seen + aggregate.open_seen,
          last_error: null,
          consecutive_failures: 0,
        }, stateSourceSystem);
      } else {
        await updateState(client, {
          cursor: page.has_more ? page.next_cursor : null,
          last_error: null,
          consecutive_failures: 0,
          ...(page.has_more ? {} : { last_incremental_success_at: new Date().toISOString() }),
        }, stateSourceSystem);
      }

      await recordFeedCompanyObservations(client, page.company_observations, page.next_cursor || null);

      console.log(JSON.stringify({ phase: mode, page: aggregate.pages, ...page }));
      if (!page.has_more) {
        aggregate.completed = true;
        break;
      }
    }

    aggregate.duration_ms = Date.now() - startedAt;
    aggregate.stop_reason = stoppedByTimeBudget
      ? 'time_budget'
      : !aggregate.completed && aggregate.has_more && aggregate.pages >= maxPages
        ? 'page_budget'
        : null;

    await recordJobSyncRunProgress(client, runId, {
      current_stage: mode === 'reconcile' && aggregate.completed ? 'finalizing' : 'waiting',
      current_cursor: aggregate.next_cursor,
      has_more: aggregate.has_more,
      pages: aggregate.pages,
      received: aggregate.received,
      upserted: aggregate.upserted,
      closed: aggregate.closed,
      skipped: aggregate.skipped,
      row_failures: aggregate.row_failures,
      fatal_failures: aggregate.fatal_failures,
      stop_reason: aggregate.stop_reason,
    });

    if (mode === 'reconcile' && (aggregate.completed || reconcileNeedsFinalize) && reconcileStartedAt) {
      let done = false;
      let missing = 0;
      let closed = 0;
      // Keep each RPC bounded. The database function returns `done` only after
      // all active records missing from this pass have been marked and any
      // second-miss records have been closed.
      for (let batch = 0; batch < 10_000 && !done; batch += 1) {
        const { data, error } = await client.rpc('finalize_job_feed_reconcile_batch', {
          p_source_system: JOBS_FEED_SOURCE,
          p_started_at: reconcileStartedAt,
          p_batch_size: 1000,
        });
        if (error) throw new Error(`完成岗位全量对账失败: ${error.message}`);
        const result = (data || {}) as { missing?: number; closed?: number; done?: boolean };
        missing += Number(result.missing) || 0;
        closed += Number(result.closed) || 0;
        done = result.done === true;
      }
      if (!done) throw new Error('岗位全量对账批次超过安全上限，已保留进度等待下次继续');
      aggregate.completed = true;
      aggregate.reconciliation = { missing, closed };
      aggregate.closed += closed;
      await updateState(client, {
        // A completed full pass is a new synchronization baseline. Start the
        // next incremental run with its overlap window instead of replaying
        // from an obsolete cursor that predates this reconciliation.
        cursor: null,
        reconcile_cursor: null,
        reconcile_started_at: null,
        reconcile_pages: 0,
        reconcile_open_seen: 0,
        last_incremental_success_at: reconcileStartedAt,
        last_reconcile_success_at: new Date().toISOString(),
        last_error: null,
        consecutive_failures: 0,
      }, stateSourceSystem);
    }

    if (aggregate.completed) {
      await updateState(client, { last_success_at: new Date().toISOString() }, stateSourceSystem);
    }

    aggregate.duration_ms = Date.now() - startedAt;

    await recordJobSyncRunFinish(client, runId, {
      status: aggregate.completed ? 'success' : 'partial',
      cursor_after: aggregate.next_cursor,
      pages: aggregate.pages,
      received: aggregate.received,
      upserted: aggregate.upserted,
      closed: aggregate.closed,
      skipped: aggregate.skipped,
      row_failures: aggregate.row_failures,
      fatal_failures: aggregate.fatal_failures,
      write_batches: aggregate.write_batches,
      write_batch_failures: aggregate.write_batch_failures,
      write_fallback_rows: aggregate.write_fallback_rows,
      write_duration_ms: aggregate.write_duration_ms,
      stop_reason: aggregate.stop_reason,
    });
    return aggregate;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordJobSyncRunFinish(client, runId, {
      status: 'failed',
      cursor_after: state.cursor,
      pages: aggregate.pages,
      received: aggregate.received,
      upserted: aggregate.upserted,
      closed: aggregate.closed,
      skipped: aggregate.skipped,
      row_failures: aggregate.row_failures,
      fatal_failures: aggregate.fatal_failures,
      write_batches: aggregate.write_batches,
      write_batch_failures: aggregate.write_batch_failures,
      write_fallback_rows: aggregate.write_fallback_rows,
      write_duration_ms: aggregate.write_duration_ms,
      error_message: message,
      stop_reason: 'error',
    });
    await updateState(client, {
      last_error: message.slice(0, 2000),
      consecutive_failures: state.consecutive_failures + 1,
    }, stateSourceSystem).catch((stateError) => console.error(stateError));
    throw error;
  } finally {
    clearInterval(heartbeat);
    await releaseLease(client, owner, stateSourceSystem);
  }
}
