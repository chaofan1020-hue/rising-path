import type { SupabaseClient } from '@supabase/supabase-js';

export const DASHBOARD_FIELDS = [
  'location',
  'workplace_type',
  'employment_category',
  'experience',
  'salary',
  'deadline',
] as const;

export type DashboardField = (typeof DASHBOARD_FIELDS)[number];
export type DashboardStatus = 'healthy' | 'running' | 'attention' | 'failed' | 'retrying' | 'stalled' | 'discovery_required' | 'unknown';

export type FieldCoverage = {
  verified: number;
  pending_recheck: number;
  rejected_legacy: number;
  unavailable_on_official_source: number;
  verified_percent: number;
  pending_recheck_percent: number;
  rejected_legacy_percent: number;
};

export type DashboardState = {
  source_system?: string | null;
  cursor?: string | null;
  last_attempted_at?: string | null;
  last_success_at?: string | null;
  last_incremental_success_at?: string | null;
  next_retry_at?: string | null;
  consecutive_failures?: number | null;
  lease_expires_at?: string | null;
  last_error?: string | null;
};

export type DashboardFailureCounts = {
  pending: number;
  processing: number;
  resolved: number;
  dead: number;
};

export function cursorPreview(cursor: string | null | undefined): string | null {
  if (!cursor) return null;
  const value = cursor.trim();
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isLeaseActive(state: DashboardState, now = Date.now()): boolean {
  const expiresAt = timestampMs(state.lease_expires_at);
  return expiresAt !== null && expiresAt > now;
}

export function isRetryDue(state: DashboardState, now = Date.now()): boolean {
  const retryAt = timestampMs(state.next_retry_at);
  return retryAt !== null && retryAt <= now;
}

export function isStale(value: string | null | undefined, thresholdMs: number, now = Date.now()): boolean {
  const at = timestampMs(value);
  return at === null ? false : now - at > thresholdMs;
}

export function derivePipelineStatus(options: {
  sourceStatus?: string | null;
  state?: DashboardState | null;
  failureCounts?: DashboardFailureCounts;
  stale?: boolean;
  isDue?: boolean;
}): DashboardStatus {
  if (options.sourceStatus === 'discovery_required') return 'discovery_required';
  const state = options.state || {};
  if (isLeaseActive(state)) return 'running';
  if ((Number(state.consecutive_failures) || 0) > 0 || (options.failureCounts?.dead || 0) > 0) return 'failed';
  // `next_retry_at` is also used as the normal completion recheck time.  A
  // future timestamp by itself therefore does not mean the company is
  // backing off or stuck.  Only an actually due retry (or an explicit due
  // signal from the scheduler) should be shown as "待重试".  Failed runs are
  // handled above via consecutive_failures/dead queue counts.
  if (options.isDue || isRetryDue(state)) return 'retrying';
  if (options.stale) return 'stalled';
  if (!state.last_success_at && !state.last_incremental_success_at) return 'unknown';
  return 'healthy';
}

export function deriveCompanyStatus(options: {
  sourceStatus?: string | null;
  feedStatus: DashboardStatus;
  officialStatus: DashboardStatus;
  pendingFields: number;
  rejectedFields: number;
  countMismatch: boolean;
}): DashboardStatus {
  if (options.sourceStatus === 'discovery_required') return 'discovery_required';
  if (options.feedStatus === 'running' || options.officialStatus === 'running') return 'running';
  if (options.feedStatus === 'failed' || options.officialStatus === 'failed') return 'failed';
  if (options.feedStatus === 'retrying' || options.officialStatus === 'retrying') return 'retrying';
  if (options.feedStatus === 'stalled' || options.officialStatus === 'stalled') return 'stalled';
  if (options.countMismatch || options.pendingFields > 0 || options.rejectedFields > 0) return 'attention';
  if (options.feedStatus === 'unknown' || options.officialStatus === 'unknown') return 'unknown';
  return 'healthy';
}

export function normalizeCoverage(value: unknown, total: number): FieldCoverage {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const verified = Number(row.verified) || 0;
  const pending = Number(row.pending_recheck) || 0;
  const rejected = Number(row.rejected_legacy) || 0;
  const unavailable = Number(row.unavailable_on_official_source) || 0;
  const percent = (count: number) => total > 0 ? Number((count / total * 100).toFixed(1)) : 0;
  return {
    verified,
    pending_recheck: pending,
    rejected_legacy: rejected,
    unavailable_on_official_source: unavailable,
    verified_percent: Number(row.verified_percent) || percent(verified),
    pending_recheck_percent: Number(row.pending_recheck_percent) || percent(pending),
    rejected_legacy_percent: Number(row.rejected_legacy_percent) || percent(rejected),
  };
}

export function sanitizeError(value: unknown, max = 240): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().slice(0, max);
}

export type FeedCompanyObservation = {
  received: number;
  upserted: number;
  closed: number;
  skipped: number;
  row_failures: number;
  fatal_failures: number;
};

export async function recordFeedCompanyObservations(
  client: SupabaseClient,
  observations: Record<string, FeedCompanyObservation>,
  cursor: string | null,
  observedAt = new Date().toISOString(),
): Promise<void> {
  const rows = Object.entries(observations).map(([company_name, value]) => ({ company_name, ...value }));
  if (rows.length === 0) return;
  try {
    const { error } = await client.rpc('record_job_company_feed_observations', {
      p_observations: rows,
      p_cursor: cursor,
      p_observed_at: observedAt,
    });
    if (error) console.error('[Job Sync Dashboard] feed observation write failed:', error.message);
  } catch (error) {
    console.error('[Job Sync Dashboard] feed observation write failed:', error);
  }
}

export async function recordJobSyncRunStart(
  client: SupabaseClient,
  values: { source_system: string; company_name?: string | null; company_id?: string | null; mode: string; cursor_before?: string | null; current_stage?: string | null },
): Promise<number | null> {
  try {
    const { data, error } = await client.from('job_sync_runs').insert({
      ...values,
      status: 'running',
      current_stage: values.current_stage || 'claiming',
      last_heartbeat_at: new Date().toISOString(),
    }).select('id').single();
    if (error) {
      console.error('[Job Sync Dashboard] run start write failed:', error.message);
      return null;
    }
    return typeof data?.id === 'number' ? data.id : Number(data?.id) || null;
  } catch (error) {
    console.error('[Job Sync Dashboard] run start write failed:', error);
    return null;
  }
}

export async function recordJobSyncRunProgress(
  client: SupabaseClient,
  runId: number | null,
  values: {
    current_stage?: string | null;
    current_company_name?: string | null;
    current_page?: number;
    current_cursor?: string | null;
    has_more?: boolean;
    total_candidates?: number;
    processed_candidates?: number;
    remaining_candidates?: number;
    pages?: number;
    received?: number;
    upserted?: number;
    closed?: number;
    skipped?: number;
    row_failures?: number;
    fatal_failures?: number;
    write_batches?: number;
    write_batch_failures?: number;
    write_fallback_rows?: number;
    write_duration_ms?: number;
    stop_reason?: string | null;
  },
): Promise<void> {
  if (!runId) return;
  try {
    const { error } = await client.from('job_sync_runs').update({
      ...values,
      last_heartbeat_at: new Date().toISOString(),
    }).eq('id', runId).eq('status', 'running');
    if (error) console.error('[Job Sync Dashboard] run progress write failed:', error.message);
  } catch (error) {
    console.error('[Job Sync Dashboard] run progress write failed:', error);
  }
}

export async function recordJobSyncRunFinish(
  client: SupabaseClient,
  runId: number | null,
  values: {
    status: 'success' | 'partial' | 'failed';
    cursor_after?: string | null;
    total_candidates?: number;
    processed_candidates?: number;
    remaining_candidates?: number;
    pages?: number;
    received?: number;
    upserted?: number;
    closed?: number;
    skipped?: number;
    row_failures?: number;
    fatal_failures?: number;
    write_batches?: number;
    write_batch_failures?: number;
    write_fallback_rows?: number;
    write_duration_ms?: number;
    error_message?: string | null;
    stop_reason?: string | null;
  },
): Promise<void> {
  if (!runId) return;
  try {
    const { error } = await client.from('job_sync_runs').update({ ...values, current_stage: 'finished', completed_at: new Date().toISOString(), last_heartbeat_at: new Date().toISOString() }).eq('id', runId);
    if (error) console.error('[Job Sync Dashboard] run finish write failed:', error.message);
  } catch (error) {
    console.error('[Job Sync Dashboard] run finish write failed:', error);
  }
}

/**
 * Mark run rows abandoned by a crashed/restarted worker. A live worker emits
 * heartbeats every 15 seconds, so a 20-minute gap is conservative while
 * preventing stale rows from being presented as active work on the dashboard.
 * This only changes observability metadata; cursors, jobs and queue rows are
 * intentionally left untouched.
 */
export async function recoverStaleJobSyncRuns(
  client: SupabaseClient,
  now = new Date(),
  staleAfterMs = 20 * 60_000,
): Promise<number> {
  const cutoff = new Date(now.getTime() - staleAfterMs).toISOString();
  const completedAt = now.toISOString();
  try {
    const { data, error } = await client
      .from('job_sync_runs')
      .update({
        status: 'failed',
        current_stage: 'finished',
        completed_at: completedAt,
        last_heartbeat_at: completedAt,
        error_message: '同步进程心跳超时，已自动收口；游标和岗位数据未修改',
        stop_reason: 'worker_heartbeat_timeout',
      })
      .eq('status', 'running')
      .lt('last_heartbeat_at', cutoff)
      .select('id');
    if (error) {
      console.error('[Job Sync Dashboard] stale run recovery failed:', error.message);
      return 0;
    }
    return data?.length || 0;
  } catch (error) {
    console.error('[Job Sync Dashboard] stale run recovery failed:', error);
    return 0;
  }
}
