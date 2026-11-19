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
  // A due `next_retry_at` is the normal recheck schedule. It must not hide a
  // cursor that has already gone stale, and it is not itself a company outage.
  if (options.stale) return 'stalled';
  if (options.isDue || isRetryDue(state)) return 'retrying';
  if (!state.last_success_at && !state.last_incremental_success_at) return 'unknown';
  return 'healthy';
}

export function deriveCompanyStatus(options: {
  sourceStatus?: string | null;
  feedStatus: DashboardStatus;
  officialStatus: DashboardStatus;
  /** Verified coverage is missing, or a fresh count is short of the official total. */
  coverageAttention?: boolean;
  /** The collector's latest run failed. Ignored while a pipeline is actively running. */
  upstreamRunFailed?: boolean;
  /** Official list is already verified complete, so a discovery ledger flag is not an outage. */
  coverageVerified?: boolean;
}): DashboardStatus {
  if (options.feedStatus === 'running' || options.officialStatus === 'running') return 'running';
  if (options.feedStatus === 'failed' || options.officialStatus === 'failed' || options.upstreamRunFailed) return 'failed';
  if (options.feedStatus === 'stalled' || options.officialStatus === 'stalled') return 'stalled';
  if (options.coverageAttention) return 'attention';
  // Due rechecks stay on the pipeline status. They are not company outages.
  // A discovery ledger flag is only an outage when coverage itself is unverified.
  if (options.sourceStatus === 'discovery_required' && !options.coverageVerified) return 'discovery_required';
  if (options.feedStatus === 'unknown') return 'unknown';
  return 'healthy';
}

/** Statuses that mean the collector proved it captured the official set. */
export const VERIFIED_COVERAGE_STATUSES = new Set([
  'publisher_reported_complete',
  'source_complete',
  'complete',
  'complete_official_list',
]);

/**
 * Live boards move by a few roles between the official total and the snapshot.
 * Oracle-sized complete-list drift stays inside this band. A shortfall above
 * it is a real count break. Incomplete coverage does not use this tolerance.
 */
export const COMPLETE_COUNT_TOLERANCE = 5;

export type OfficialCoverageVerdict = 'complete' | 'incomplete' | 'unknown';

export function officialCoverageVerdict(status: string | null | undefined): OfficialCoverageVerdict {
  const value = (status || '').trim().toLowerCase();
  // `unavailable` means the directory has no official total to judge. That is
  // shown as unknown, not as a coverage ticket. Null or legacy telemetry is
  // the same: missing evidence must not mark every company broken.
  if (!value || value === 'legacy' || value === 'unknown' || value === 'unavailable') return 'unknown';
  if (VERIFIED_COVERAGE_STATUSES.has(value)) return 'complete';
  return 'incomplete';
}

export type CompanySyncReason = { code: string; label: string };

export type CompanySyncReportInput = {
  sourceStatus?: string | null;
  feedStatus: DashboardStatus;
  officialStatus: DashboardStatus;
  pendingFields: number;
  rejectedFields: number;
  officialCount: number | null;
  discoveredCount: number | null;
  upstreamActiveJobs?: number | null;
  countReconciliationFresh: boolean;
  officialCountStatus?: string | null;
  latestRunStatus?: string | null;
  snapshotError?: string | null;
};

export type CompanySyncReport = {
  status: DashboardStatus;
  actionable: boolean;
  reasons: CompanySyncReason[];
  qualityNotes: CompanySyncReason[];
};

const FAILED_RUN_STATUSES = new Set(['failed', 'error', 'failure']);

function cleanReportNote(value: string | null | undefined, max = 160): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function countGapLabel(official: number, discovered: number): string {
  const gap = discovered - official;
  const base = `官方 ${official} / 上游 ${discovered}`;
  if (gap === 0) return base;
  if (gap < 0) return `${base}，少 ${Math.abs(gap)}`;
  return `${base}，多 ${gap}`;
}

export function buildCompanySyncReport(input: CompanySyncReportInput): CompanySyncReport {
  const reasons: CompanySyncReason[] = [];
  const qualityNotes: CompanySyncReason[] = [];
  const verdict = officialCoverageVerdict(input.officialCountStatus);
  const latestRun = (input.latestRunStatus || '').trim().toLowerCase();
  const upstreamRunFailed = FAILED_RUN_STATUSES.has(latestRun);
  const countsKnown = input.countReconciliationFresh && input.officialCount !== null && input.discoveredCount !== null;

  if (input.sourceStatus === 'discovery_required' && verdict !== 'complete') {
    reasons.push({ code: 'discovery_required', label: '来源还没探测，不能判断是否抓全' });
  }
  if (input.feedStatus === 'failed') reasons.push({ code: 'feed_failed', label: '主 Feed 同步失败' });
  if (input.officialStatus === 'failed') reasons.push({ code: 'official_failed', label: '官方字段同步失败' });
  if (input.feedStatus === 'stalled') reasons.push({ code: 'feed_stalled', label: '主 Feed 游标停滞' });
  if (input.officialStatus === 'stalled') reasons.push({ code: 'official_stalled', label: '官方字段游标停滞' });
  if (upstreamRunFailed) {
    const error = cleanReportNote(input.snapshotError);
    reasons.push({
      code: 'upstream_run_failed',
      label: error ? `最近一轮采集失败：${error}` : '最近一轮采集失败',
    });
  }

  if (verdict === 'incomplete') {
    const parts: string[] = [];
    if (latestRun && latestRun !== 'success' && latestRun !== 'completed') parts.push(`最近一轮 ${latestRun}`);
    if (countsKnown) parts.push(countGapLabel(input.officialCount as number, input.discoveredCount as number));
    const countStatus = (input.officialCountStatus || '').trim().toLowerCase();
    if (countStatus === 'capped_unavailable' || countStatus === 'capped') parts.push('官方接口有上限，不能证明抓全');
    else if (countStatus === 'publisher_reported') parts.push('官网总数还没验证抓全');
    else parts.push('覆盖未验证');
    const openGap = input.countReconciliationFresh && input.upstreamActiveJobs != null && input.officialCount != null
      ? input.upstreamActiveJobs - input.officialCount
      : null;
    if (openGap !== null && openGap > COMPLETE_COUNT_TOLERANCE) {
      parts.push(`上游仍开着 ${input.upstreamActiveJobs}，比官方多 ${openGap}，未按这轮关岗`);
    } else if (latestRun === 'partial' || upstreamRunFailed) {
      parts.push('这轮结果不完整，不会关岗');
    }
    if (!upstreamRunFailed) {
      const error = cleanReportNote(input.snapshotError);
      if (error) parts.push(error);
    }
    reasons.push({ code: 'coverage_incomplete', label: parts.join('，') });
  } else if (
    countsKnown
    && (input.discoveredCount as number) < (input.officialCount as number)
    && (input.officialCount as number) - (input.discoveredCount as number) > COMPLETE_COUNT_TOLERANCE
  ) {
    const shortfall = (input.officialCount as number) - (input.discoveredCount as number);
    reasons.push({
      code: 'count_shortfall',
      label: verdict === 'complete'
        ? `${countGapLabel(input.officialCount as number, input.discoveredCount as number)}，状态是已抓全，但少了 ${shortfall}，超过 ${COMPLETE_COUNT_TOLERANCE} 条动态差额`
        : `${countGapLabel(input.officialCount as number, input.discoveredCount as number)}，少了 ${shortfall}，超过 ${COMPLETE_COUNT_TOLERANCE} 条，和官网总数对不上`,
    });
  }

  if (countsKnown && verdict !== 'incomplete') {
    const delta = (input.discoveredCount as number) - (input.officialCount as number);
    if (delta !== 0 && Math.abs(delta) <= COMPLETE_COUNT_TOLERANCE && verdict === 'complete') {
      qualityNotes.push({
        code: 'count_drift',
        label: `${countGapLabel(input.officialCount as number, input.discoveredCount as number)}，已验证抓全，差额在动态范围内，不算故障`,
      });
    } else if (delta > COMPLETE_COUNT_TOLERANCE) {
      qualityNotes.push({
        code: 'extra_listings',
        label: `${countGapLabel(input.officialCount as number, input.discoveredCount as number)}，多出来的是另一来源或列表行，不进覆盖工单`,
      });
    }
  }

  if (latestRun === 'partial' && verdict !== 'incomplete') {
    qualityNotes.push({
      code: 'quality_partial',
      label: verdict === 'complete'
        ? '最近一轮有字段质量缺口，覆盖已齐，不进覆盖工单'
        : '最近一轮是 partial，但没有未验证的官方总数，先不当作覆盖故障',
    });
  }
  if (input.pendingFields > 0) {
    qualityNotes.push({
      code: 'pending_fields',
      label: `历史字段待复核 ${input.pendingFields} 条。这是质量缺口，不是覆盖故障`,
    });
  }
  if (input.rejectedFields > 0) {
    qualityNotes.push({
      code: 'rejected_fields',
      label: `${input.rejectedFields} 个字段被拒绝。没有官方证据，不进覆盖工单`,
    });
  }

  if (input.sourceStatus === 'discovery_required' && verdict === 'complete') {
    qualityNotes.push({
      code: 'detail_source_pending',
      label: '来源台账仍是待探测，官方列表已验证抓全。详情字段不猜测，不进覆盖工单',
    });
  }

  const status = deriveCompanyStatus({
    sourceStatus: input.sourceStatus,
    feedStatus: input.feedStatus,
    officialStatus: input.officialStatus,
    coverageAttention: reasons.some((reason) => reason.code === 'coverage_incomplete' || reason.code === 'count_shortfall'),
    coverageVerified: verdict === 'complete',
    upstreamRunFailed,
  });
  return { status, actionable: reasons.length > 0, reasons, qualityNotes };
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
  const patch = {
    status: 'failed',
    current_stage: 'finished',
    completed_at: completedAt,
    last_heartbeat_at: completedAt,
    error_message: '同步进程心跳超时，已自动收口；游标和岗位数据未修改',
    stop_reason: 'worker_heartbeat_timeout',
  };
  try {
    // A missing heartbeat is stale too. `.lt(last_heartbeat_at)` does not match
    // SQL NULL, which left abandoned official-detail rows "running" forever.
    const [withHeartbeat, withoutHeartbeat] = await Promise.all([
      client.from('job_sync_runs').update(patch).eq('status', 'running').lt('last_heartbeat_at', cutoff).select('id'),
      client.from('job_sync_runs').update(patch).eq('status', 'running').is('last_heartbeat_at', null).lt('started_at', cutoff).select('id'),
    ]);
    if (withHeartbeat.error) {
      console.error('[Job Sync Dashboard] stale run recovery failed:', withHeartbeat.error.message);
    }
    if (withoutHeartbeat.error) {
      console.error('[Job Sync Dashboard] stale run recovery failed:', withoutHeartbeat.error.message);
    }
    if (withHeartbeat.error && withoutHeartbeat.error) return 0;
    return (withHeartbeat.data?.length || 0) + (withoutHeartbeat.data?.length || 0);
  } catch (error) {
    console.error('[Job Sync Dashboard] stale run recovery failed:', error);
    return 0;
  }
}
