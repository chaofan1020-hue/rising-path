import type { SupabaseClient } from '@supabase/supabase-js';
import { getCompanyFaviconUrl, getCompanyLogoUrl } from '@/lib/company-logo';
import {
  DASHBOARD_FIELDS,
  cursorPreview,
  deriveCompanyStatus,
  derivePipelineStatus,
  isLeaseActive,
  isStale,
  normalizeCoverage,
  sanitizeError,
  type DashboardFailureCounts,
  type DashboardStatus,
  type FieldCoverage,
} from '@/lib/job-sync-dashboard';
import { getSupabaseClient } from '@/storage/database/supabase-client';

function minutesEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 24 * 60) : fallback;
}

const FEED_STALE_MS = minutesEnv('JOBS_DASHBOARD_FEED_STALE_MINUTES', 15) * 60_000;
const OFFICIAL_STALE_MS = minutesEnv('JOBS_DASHBOARD_OFFICIAL_STALE_MINUTES', 120) * 60_000;
const UPSTREAM_SNAPSHOT_STALE_MS = minutesEnv('JOBS_DASHBOARD_UPSTREAM_SNAPSHOT_STALE_MINUTES', 120) * 60_000;
const RUN_HEARTBEAT_STALE_MS = minutesEnv('JOBS_DASHBOARD_RUN_HEARTBEAT_STALE_MINUTES', 2) * 60_000;

type SourceRow = {
  company_name: string;
  is_active: boolean;
  upstream_company_id: string | null;
  active_jobs: number;
  official_careers_url: string | null;
  official_hosts: unknown;
  source_type: string;
  source_basis: string;
  external_job_id_field: string | null;
  detail_url_rule: string | null;
  detail_required: boolean | null;
  region_scope: string | null;
  timezone: string | null;
  connector_name: string | null;
  connector_board: string | null;
  field_coverage: unknown;
  last_attempted_at: string | null;
  last_success_at: string | null;
  next_retry_at: string | null;
  consecutive_failures: number;
  priority: number;
  status: string;
  last_error: string | null;
  notes: string | null;
  last_observed_at: string | null;
  upstream_active_jobs: number | null;
  official_expected_jobs: number | null;
  upstream_discovered_jobs: number | null;
  official_count_observed_at: string | null;
  upstream_last_observed_at: string | null;
  upstream_last_crawl_at: string | null;
  upstream_latest_run_status: string | null;
  upstream_snapshot_error: string | null;
  official_count_status: string | null;
  official_count_source: string | null;
  official_count_lower_bound: number | null;
  collector_last_seen_at: string | null;
  collector_last_cursor: string | null;
  collector_last_attempted_at: string | null;
  collector_last_success_at: string | null;
  collector_last_received: number;
  collector_last_upserted: number;
  collector_last_closed: number;
  collector_last_skipped: number;
  collector_last_row_failures: number;
  collector_last_fatal_failures: number;
  collector_last_error: string | null;
  collector_status: string;
};

type SyncState = {
  source_system: string;
  cursor: string | null;
  last_incremental_success_at: string | null;
  last_attempted_at: string | null;
  last_success_at: string | null;
  next_retry_at: string | null;
  consecutive_failures: number;
  lease_expires_at: string | null;
  last_error: string | null;
  updated_at: string;
};

type FailureRow = { company: string | null; status: string };
type LiveRunRow = {
  id: number;
  source_system: string;
  company_name: string | null;
  company_id: string | null;
  mode: string;
  status: string;
  cursor_before: string | null;
  cursor_after: string | null;
  current_stage: string | null;
  current_company_name: string | null;
  current_page: number;
  current_cursor: string | null;
  has_more: boolean;
  total_candidates: number;
  processed_candidates: number;
  remaining_candidates: number;
  last_heartbeat_at: string | null;
  stop_reason: string | null;
  pages: number;
  received: number;
  upserted: number;
  closed: number;
  skipped: number;
  row_failures: number;
  fatal_failures: number;
  started_at: string;
};
type HistoricalReviewRow = {
  company_name: string;
  source_system: string;
  status: string;
  cursor_job_id: number | null;
  total_candidates: number;
  processed_candidates: number;
  remaining_candidates: number;
  updated_jobs: number;
  unavailable_fields: number;
  skipped_jobs: number;
  failed_jobs: number;
  last_error: string | null;
  last_heartbeat_at: string | null;
  next_run_at: string | null;
  lease_expires_at: string | null;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function usableCount(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 && value !== 9999 && value !== 99999 ? value : null;
}

function officialStateKey(source: SourceRow): string | null {
  if (source.status === 'discovery_required') return null;
  if (source.source_type === 'workday') return `official:workday:${source.company_name}`.slice(0, 50);
  if (source.source_type === 'amazon_jobs' || source.source_type === 'apple_official_api' || source.source_type === 'google_careers' || source.source_type === 'microsoft_careers' || source.source_type === 'meta_careers' || source.source_type === 'deloitte_careers' || source.source_type === 'morgan_stanley_eightfold' || source.source_type === 'goldman_sachs_careers') {
    return `official:official_generic:${source.company_name}`.slice(0, 50);
  }
  if (source.connector_name || source.detail_required) return `official:registered_connector:${source.company_name}`.slice(0, 50);
  return null;
}

function emptyFailures(): DashboardFailureCounts {
  return { pending: 0, processing: 0, resolved: 0, dead: 0 };
}

async function loadCounts(client: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await client.rpc('get_admin_job_sync_company_counts');
  if (error) throw new Error(`读取岗位公司数量失败: ${error.message}`);
  return new Map((data || []).map((row: { company?: unknown; active_jobs?: unknown }) => [
    String(row.company || '未注明公司'), Number(row.active_jobs) || 0,
  ]));
}

async function loadFailureCounts(client: SupabaseClient): Promise<{ byCompany: Map<string, DashboardFailureCounts>; total: DashboardFailureCounts }> {
  const { data, error } = await client.rpc('get_admin_job_sync_failure_counts');
  if (error) throw new Error(`读取岗位失败队列统计失败: ${error.message}`);
  const byCompany = new Map<string, DashboardFailureCounts>();
  const total = emptyFailures();
  for (const row of (data || []) as FailureRow[]) {
    const company = row.company || '未注明公司';
    const status = row.status as keyof DashboardFailureCounts;
    if (!(status in total)) continue;
    const current = byCompany.get(company) || emptyFailures();
    current[status] += 1;
    total[status] += 1;
    byCompany.set(company, current);
  }
  return { byCompany, total };
}

async function loadLogos(client: SupabaseClient): Promise<Map<string, { logo_url: string | null; fallback_logo_url: string | null; source: string }>> {
  const [{ data: uploaded, error: uploadedError }, { data: configured, error: configuredError }] = await Promise.all([
    client.from('company_logos').select('company_name,logo_url'),
    client.from('company_config').select('company_name,logo_url'),
  ]);
  if (uploadedError) throw new Error(`读取企业 logo 失败: ${uploadedError.message}`);
  if (configuredError) throw new Error(`读取企业配置 logo 失败: ${configuredError.message}`);
  const uploadedMap = new Map((uploaded || []).map((row) => [row.company_name, row.logo_url]));
  const configuredMap = new Map((configured || []).map((row) => [row.company_name, row.logo_url]));
  return new Map([...new Set([...uploadedMap.keys(), ...configuredMap.keys()])].map((company) => {
    const logo = uploadedMap.get(company) || configuredMap.get(company) || getCompanyLogoUrl(company);
    return [company, {
      logo_url: logo || null,
      fallback_logo_url: getCompanyFaviconUrl(company),
      source: uploadedMap.get(company) ? 'uploaded' : configuredMap.get(company) ? 'configured' : 'automatic',
    }];
  }));
}

function fieldCoverage(source: SourceRow, total: number): Record<string, FieldCoverage> {
  const raw = objectValue(source.field_coverage);
  return Object.fromEntries(DASHBOARD_FIELDS.map((field) => [field, normalizeCoverage(raw[field], total)]));
}

function aggregateFieldCounts(coverage: Record<string, FieldCoverage>) {
  return Object.values(coverage).reduce((result, field) => ({
    verified: result.verified + field.verified,
    pending: result.pending + field.pending_recheck,
    rejected: result.rejected + field.rejected_legacy,
    unavailable: result.unavailable + field.unavailable_on_official_source,
  }), { verified: 0, pending: 0, rejected: 0, unavailable: 0 });
}

function sourceLogo(source: SourceRow, logos: Map<string, { logo_url: string | null; fallback_logo_url: string | null; source: string }>) {
  const current = logos.get(source.company_name);
  return current || {
    logo_url: getCompanyLogoUrl(source.company_name),
    fallback_logo_url: getCompanyFaviconUrl(source.company_name),
    source: 'automatic',
  };
}

function buildCard(source: SourceRow, counts: Map<string, number>, states: Map<string, SyncState>, failures: Map<string, DashboardFailureCounts>, logos: Map<string, { logo_url: string | null; fallback_logo_url: string | null; source: string }>, liveRuns: Map<string, LiveRunRow>, staleRunSources: Set<string>, historicalReviews: Map<string, HistoricalReviewRow>) {
  const localActiveJobs = counts.get(source.company_name) ?? (Number(source.active_jobs) || 0);
  const companyFeedState = source.upstream_company_id ? states.get(`feed:company:${source.upstream_company_id}`) || null : null;
  const globalFeedState = states.get('collector_feed') || null;
  const feedState = companyFeedState || globalFeedState;
  const feedStatusBase = derivePipelineStatus({
    state: feedState,
    stale: Boolean(feedState && isStale(feedState.last_incremental_success_at || feedState.last_success_at, FEED_STALE_MS)),
  });
  const feedStatus = staleRunSources.has(feedState?.source_system || '') ? 'stalled' as const : feedStatusBase;
  const officialKey = officialStateKey(source);
  const officialState = officialKey ? states.get(officialKey) || null : null;
  const officialLiveRunCandidate = officialKey ? liveRuns.get(officialKey) || null : null;
  const officialLiveRun = officialLiveRunCandidate && isLeaseActive(officialState || {}) ? officialLiveRunCandidate : null;
  const coverage = fieldCoverage(source, localActiveJobs);
  const fieldCounts = aggregateFieldCounts(coverage);
  const officialStatusBase = source.status === 'discovery_required'
    ? 'discovery_required' as const
    : source.detail_required || officialKey
      ? derivePipelineStatus({
        state: officialState,
        stale: Boolean(officialState && isStale(officialState.last_success_at || officialState.last_incremental_success_at, OFFICIAL_STALE_MS)),
      })
      : 'healthy' as const;
  const officialStatus = staleRunSources.has(officialKey || '') ? 'stalled' as const : officialStatusBase;
  const failureCounts = failures.get(source.company_name) || emptyFailures();
  const historicalReview = historicalReviews.get(source.company_name) || null;
  const historicalLiveRunCandidate = historicalReview?.source_system ? liveRuns.get(historicalReview.source_system) || null : null;
  const historicalLiveRun = historicalLiveRunCandidate && historicalReview?.status === 'running' ? {
    ...historicalLiveRunCandidate,
    // The child run counters describe only its latest HTTP batch. The queue
    // counters are the durable company-level position and are what operators
    // need to see while several batches run under one lease.
    total_candidates: historicalReview.total_candidates,
    processed_candidates: historicalReview.processed_candidates,
    remaining_candidates: historicalReview.remaining_candidates,
  } : null;
  const upstreamFresh = source.upstream_active_jobs !== null
    && !isStale(source.upstream_last_observed_at, UPSTREAM_SNAPSHOT_STALE_MS);
  // A zero stored before the first successful directory snapshot is only the
  // schema default, not an observed official total. Do not use the upstream
  // open-job snapshot as a stand-in for the official count: these are two
  // different stages and comparing a value with itself hides missing data.
  const hasObservedReconciliation = Boolean(source.official_count_observed_at);
  const officialExpectedCount = usableCount(source.official_expected_jobs);
  const officialCount = hasObservedReconciliation ? officialExpectedCount : null;
  const upstreamDiscoveredCount = hasObservedReconciliation ? usableCount(source.upstream_discovered_jobs) : null;
  const officialCountSource = source.official_count_source || (officialCount !== null ? 'successful_crawl_expected' : 'unknown');
  const countReconciliationFresh = source.official_count_observed_at
    ? !isStale(source.official_count_observed_at, UPSTREAM_SNAPSHOT_STALE_MS)
    : upstreamFresh;
  const countMismatch = countReconciliationFresh
    && officialCount !== null
    && upstreamDiscoveredCount !== null
    && officialCount !== upstreamDiscoveredCount;
  const derivedStatus = deriveCompanyStatus({
    sourceStatus: source.status,
    feedStatus,
    officialStatus,
    pendingFields: fieldCounts.pending,
    rejectedFields: fieldCounts.rejected,
    countMismatch,
  });
  const status = historicalLiveRun ? 'running' as const : derivedStatus;
  const reasons: Array<{ code: string; label: string }> = [];
  if (source.status === 'discovery_required') reasons.push({ code: 'discovery_required', label: '来源待探测' });
  if (feedStatus === 'stalled') reasons.push({ code: 'feed_stalled', label: '主 Feed 游标停滞' });
  if (feedStatus === 'failed') reasons.push({ code: 'feed_failed', label: '主 Feed 同步失败' });
  if (officialStatus === 'stalled') reasons.push({ code: 'official_stalled', label: '官方字段游标停滞' });
  if (officialStatus === 'failed') reasons.push({ code: 'official_failed', label: '官方字段同步失败' });
  if (officialStatus === 'unknown' && source.status !== 'discovery_required') reasons.push({ code: 'official_uninitialized', label: '官方游标未初始化' });
  if (countMismatch) reasons.push({ code: 'count_mismatch', label: '官方与上游岗位数量不一致' });
  if (fieldCounts.pending > 0) {
    reasons.push({
      code: 'pending_fields',
      label: officialLiveRun
        ? `${fieldCounts.pending} 个字段待处理`
        : `历史字段待复核 ${fieldCounts.pending} 条（当前增量已追平）`,
    });
  }
  if (fieldCounts.rejected > 0) reasons.push({ code: 'rejected_fields', label: `${fieldCounts.rejected} 个字段被拒绝` });

  const stateForCard = feedState;
  const liveRunCandidate = liveRuns.get(companyFeedState?.source_system || globalFeedState?.source_system || 'collector_feed') || null;
  const liveRun = liveRunCandidate && isLeaseActive(stateForCard || {}) ? liveRunCandidate : null;
  return {
    companyName: source.company_name,
    upstreamCompanyId: source.upstream_company_id,
    logo: sourceLogo(source, logos),
    source: {
      type: source.source_type,
      basis: source.source_basis,
      status: source.status,
      careersUrl: source.official_careers_url,
      hosts: Array.isArray(source.official_hosts) ? source.official_hosts : [],
      externalJobIdField: source.external_job_id_field,
      detailUrlRule: source.detail_url_rule,
      detailRequired: source.detail_required,
      connector: source.connector_name,
      board: source.connector_board,
      regionScope: source.region_scope,
      timezone: source.timezone,
    },
    status,
    reasons,
    counts: {
      localActiveJobs,
      upstreamActiveJobs: source.upstream_active_jobs,
      delta: source.upstream_active_jobs === null ? null : localActiveJobs - source.upstream_active_jobs,
      officialActiveJobs: officialCount,
      officialCountSource,
      officialCountStatus: source.official_count_status || (officialCount !== null ? 'legacy' : 'unavailable'),
      officialCountLowerBound: usableCount(source.official_count_lower_bound),
      upstreamDiscoveredJobs: upstreamDiscoveredCount,
      officialVsUpstreamDelta: officialCount === null || upstreamDiscoveredCount === null ? null : upstreamDiscoveredCount - officialCount,
      upstreamObservedAt: source.upstream_last_observed_at,
      upstreamFresh,
      countReconciliationFresh,
    },
    feed: {
      mode: companyFeedState ? 'company_cursor' : 'global',
      stateSource: companyFeedState?.source_system || globalFeedState?.source_system || 'collector_feed',
      status: feedStatus,
      cursor: stateForCard?.cursor || source.collector_last_cursor,
      cursorPreview: cursorPreview(stateForCard?.cursor || source.collector_last_cursor),
      hasMore: Boolean(stateForCard?.cursor),
      lastSeenAt: source.collector_last_seen_at,
      lastAttemptedAt: stateForCard?.last_attempted_at || source.collector_last_attempted_at,
      lastSuccessAt: stateForCard?.last_success_at || source.collector_last_success_at,
      nextRetryAt: stateForCard?.next_retry_at || null,
      consecutiveFailures: Number(stateForCard?.consecutive_failures || source.consecutive_failures || 0),
      leaseExpiresAt: stateForCard?.lease_expires_at || null,
      lastError: sanitizeError(stateForCard?.last_error || source.collector_last_error),
      lastReceived: source.collector_last_received,
      lastUpserted: source.collector_last_upserted,
      lastClosed: source.collector_last_closed,
      lastSkipped: source.collector_last_skipped,
      lastRowFailures: source.collector_last_row_failures,
      lastFatalFailures: source.collector_last_fatal_failures,
      liveRun: liveRun ? {
        id: liveRun.id,
        stage: liveRun.current_stage,
        currentCompany: liveRun.current_company_name,
        currentPage: liveRun.current_page,
        currentCursor: liveRun.current_cursor,
        currentCursorPreview: cursorPreview(liveRun.current_cursor),
        hasMore: liveRun.has_more,
        totalCandidates: liveRun.total_candidates,
        processedCandidates: liveRun.processed_candidates,
        remainingCandidates: liveRun.remaining_candidates,
        lastHeartbeatAt: liveRun.last_heartbeat_at,
        pages: liveRun.pages,
        received: liveRun.received,
        upserted: liveRun.upserted,
        rowFailures: liveRun.row_failures,
        fatalFailures: liveRun.fatal_failures,
        startedAt: liveRun.started_at,
      } : null,
    },
    official: {
      stateSource: officialKey,
      status: officialStatus,
      cursor: officialState?.cursor || null,
      cursorPreview: cursorPreview(officialState?.cursor),
      lastAttemptedAt: officialState?.last_attempted_at || source.last_attempted_at,
      lastSuccessAt: officialState?.last_success_at || source.last_success_at,
      nextRetryAt: officialState?.next_retry_at || source.next_retry_at,
      consecutiveFailures: Number(officialState?.consecutive_failures || source.consecutive_failures || 0),
      leaseExpiresAt: officialState?.lease_expires_at || null,
      lastError: sanitizeError(officialState?.last_error || source.last_error),
      fields: coverage,
      fieldTotals: fieldCounts,
      liveRun: officialLiveRun ? {
        id: officialLiveRun.id,
        stage: officialLiveRun.current_stage,
        currentCompany: officialLiveRun.current_company_name,
        currentPage: officialLiveRun.current_page,
        currentCursor: officialLiveRun.current_cursor,
        currentCursorPreview: cursorPreview(officialLiveRun.current_cursor),
        hasMore: officialLiveRun.has_more,
        totalCandidates: officialLiveRun.total_candidates,
        processedCandidates: officialLiveRun.processed_candidates,
        remainingCandidates: officialLiveRun.remaining_candidates,
        lastHeartbeatAt: officialLiveRun.last_heartbeat_at,
        pages: officialLiveRun.pages,
        received: officialLiveRun.received,
        upserted: officialLiveRun.upserted,
        rowFailures: officialLiveRun.row_failures,
        fatalFailures: officialLiveRun.fatal_failures,
        startedAt: officialLiveRun.started_at,
      } : null,
    },
    failures: failureCounts,
    historicalReview: historicalReview ? {
      sourceSystem: historicalReview.source_system,
      status: historicalReview.status,
      cursorJobId: historicalReview.cursor_job_id,
      totalCandidates: historicalReview.total_candidates,
      processedCandidates: historicalReview.processed_candidates,
      remainingCandidates: historicalReview.remaining_candidates,
      updatedJobs: historicalReview.updated_jobs,
      unavailableFields: historicalReview.unavailable_fields,
      skippedJobs: historicalReview.skipped_jobs,
      failedJobs: historicalReview.failed_jobs,
      lastError: sanitizeError(historicalReview.last_error),
      lastHeartbeatAt: historicalReview.last_heartbeat_at,
      nextRunAt: historicalReview.next_run_at,
      leaseExpiresAt: historicalReview.lease_expires_at,
      liveRun: historicalLiveRun ? {
        id: historicalLiveRun.id,
        stage: historicalLiveRun.current_stage,
        currentCompany: historicalLiveRun.current_company_name,
        currentPage: historicalLiveRun.current_page,
        currentCursor: historicalLiveRun.current_cursor,
        currentCursorPreview: cursorPreview(historicalLiveRun.current_cursor),
        hasMore: historicalLiveRun.has_more,
        totalCandidates: historicalLiveRun.total_candidates,
        processedCandidates: historicalLiveRun.processed_candidates,
        remainingCandidates: historicalLiveRun.remaining_candidates,
        lastHeartbeatAt: historicalLiveRun.last_heartbeat_at,
        pages: historicalLiveRun.pages,
        received: historicalLiveRun.received,
        upserted: historicalLiveRun.upserted,
        rowFailures: historicalLiveRun.row_failures,
        fatalFailures: historicalLiveRun.fatal_failures,
        startedAt: historicalLiveRun.started_at,
      } : null,
    } : null,
    observedAt: source.last_observed_at,
  };
}

export async function loadJobSyncDashboard(client = getSupabaseClient()) {
  const [sourceQuery, stateQuery, counts, failureData, logos, liveRunQuery, historicalQuery] = await Promise.all([
    client.from('job_company_sources').select('*').eq('is_active', true).order('active_jobs', { ascending: false }).order('company_name'),
    client.from('job_sync_state').select('source_system,cursor,last_incremental_success_at,last_attempted_at,last_success_at,next_retry_at,consecutive_failures,lease_expires_at,last_error,updated_at'),
    loadCounts(client),
    loadFailureCounts(client),
    loadLogos(client),
    client.from('job_sync_runs').select('id,source_system,company_name,company_id,mode,status,cursor_before,cursor_after,current_stage,current_company_name,current_page,current_cursor,has_more,total_candidates,processed_candidates,remaining_candidates,last_heartbeat_at,stop_reason,pages,received,upserted,closed,skipped,row_failures,fatal_failures,started_at').eq('status', 'running').order('started_at', { ascending: false }).limit(30),
    client.from('job_historical_field_reviews').select('company_name,source_system,status,cursor_job_id,total_candidates,processed_candidates,remaining_candidates,updated_jobs,unavailable_fields,skipped_jobs,failed_jobs,last_error,last_heartbeat_at,next_run_at,lease_expires_at').order('updated_at', { ascending: false }),
  ]);
  if (sourceQuery.error) throw new Error(`读取公司来源台账失败: ${sourceQuery.error.message}`);
  if (stateQuery.error) throw new Error(`读取岗位同步状态失败: ${stateQuery.error.message}`);
  if (liveRunQuery.error) throw new Error(`读取当前同步运行失败: ${liveRunQuery.error.message}`);
  if (historicalQuery.error && historicalQuery.error.code !== '42P01') throw new Error(`读取历史字段复核队列失败: ${historicalQuery.error.message}`);
  const sources = (sourceQuery.data || []) as SourceRow[];
  const historicalReviews = new Map(((historicalQuery.data || []) as HistoricalReviewRow[]).map((row) => [row.company_name, row]));
  const states = new Map(((stateQuery.data || []) as SyncState[]).map((row) => [row.source_system, row]));
  const liveRuns = new Map<string, LiveRunRow>();
  const staleRunSources = new Set<string>();
  // A run row can remain marked `running` after a process crash. Require both
  // an active lease and a recent heartbeat before treating it as live. Stale
  // rows remain available in the detail history, while the company is shown
  // as stalled instead of falsely claiming that work is still progressing.
  for (const row of ((liveRunQuery.data || []) as LiveRunRow[])) {
    const state = states.get(row.source_system) || {};
    const historicalLease = row.source_system.startsWith('historical:')
      ? historicalReviews.get(row.company_name || '')?.lease_expires_at
      : null;
    if (!isLeaseActive(state) && !isLeaseActive({ lease_expires_at: historicalLease })) continue;
    const heartbeatAt = row.last_heartbeat_at ? Date.parse(row.last_heartbeat_at) : NaN;
    if (Number.isFinite(heartbeatAt) && Date.now() - heartbeatAt <= RUN_HEARTBEAT_STALE_MS) {
      if (!liveRuns.has(row.source_system)) liveRuns.set(row.source_system, row);
      // A fresh retry supersedes an older stuck row for the same source.
      staleRunSources.delete(row.source_system);
    } else {
      if (!liveRuns.has(row.source_system)) staleRunSources.add(row.source_system);
    }
  }
  const companies = sources.map((source) => buildCard(source, counts, states, failureData.byCompany, logos, liveRuns, staleRunSources, historicalReviews));
  const globalState = states.get('collector_feed') || null;
  const statuses = companies.reduce((result, company) => {
    result[company.status] += 1;
    return result;
  }, { healthy: 0, running: 0, attention: 0, failed: 0, retrying: 0, stalled: 0, discovery_required: 0, unknown: 0 } as Record<DashboardStatus, number>);
  const localActiveJobs = companies.reduce((sum, company) => sum + company.counts.localActiveJobs, 0);
  const reconciliationKnown = companies.filter((company) => company.counts.officialActiveJobs !== null && company.counts.upstreamDiscoveredJobs !== null && company.counts.countReconciliationFresh);
  const officialActiveJobs = reconciliationKnown.reduce((sum, company) => sum + (company.counts.officialActiveJobs || 0), 0);
  const upstreamDiscoveredJobs = reconciliationKnown.reduce((sum, company) => sum + (company.counts.upstreamDiscoveredJobs || 0), 0);
  const officialDue = companies.filter((company) => company.official.status === 'retrying' || company.official.status === 'stalled').length;
  const activeRuns = [...liveRuns.values()]
    .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))
    .map((run) => {
      const review = run.source_system.startsWith('historical:')
        ? (historicalReviews.get(run.company_name || '') || null)
        : null;
      return {
        id: run.id,
        sourceSystem: run.source_system,
        mode: run.mode,
        company: run.current_company_name || run.company_name,
        stage: run.current_stage,
        currentPage: run.current_page,
        currentCursor: review?.cursor_job_id != null ? String(review.cursor_job_id) : run.current_cursor,
        currentCursorPreview: cursorPreview(review?.cursor_job_id != null ? String(review.cursor_job_id) : run.current_cursor),
        hasMore: run.has_more,
        totalCandidates: review ? review.total_candidates : run.total_candidates,
        processedCandidates: review ? review.processed_candidates : run.processed_candidates,
        remainingCandidates: review ? review.remaining_candidates : run.remaining_candidates,
        lastHeartbeatAt: run.last_heartbeat_at,
        pages: run.pages,
        received: run.received,
        upserted: run.upserted,
        rowFailures: run.row_failures,
        fatalFailures: run.fatal_failures,
        startedAt: run.started_at,
      };
    });
  return {
    generatedAt: new Date().toISOString(),
    freshness: {
      upstreamCompaniesWithFreshSnapshot: companies.filter((company) => company.counts.upstreamActiveJobs !== null && company.counts.upstreamFresh).length,
      upstreamSnapshotStale: companies.filter((company) => company.counts.upstreamActiveJobs !== null && !company.counts.upstreamFresh).length,
      countReconciliationCompanies: reconciliationKnown.length,
      databaseSnapshotAt: sources.reduce<string | null>((latest, source) => !latest || (source.last_observed_at && Date.parse(source.last_observed_at) > Date.parse(latest)) ? source.last_observed_at : latest, null),
    },
    summary: {
      activeCompanies: companies.length,
      healthyCompanies: statuses.healthy,
      attentionCompanies: statuses.attention + statuses.retrying + statuses.stalled + statuses.discovery_required + statuses.unknown,
      failedCompanies: statuses.failed,
      runningCompanies: statuses.running,
      localActiveJobs,
      officialActiveJobs: reconciliationKnown.length > 0 ? officialActiveJobs : null,
      upstreamDiscoveredJobs: reconciliationKnown.length > 0 ? upstreamDiscoveredJobs : null,
      countDelta: reconciliationKnown.length > 0 ? upstreamDiscoveredJobs - officialActiveJobs : null,
      feed: globalState ? {
        status: derivePipelineStatus({ state: globalState, stale: isStale(globalState.last_incremental_success_at || globalState.last_success_at, FEED_STALE_MS) }),
        cursor: globalState.cursor,
        cursorPreview: cursorPreview(globalState.cursor),
        lastSuccessAt: globalState.last_incremental_success_at || globalState.last_success_at,
        lastAttemptedAt: globalState.last_attempted_at,
        leaseExpiresAt: globalState.lease_expires_at,
        consecutiveFailures: globalState.consecutive_failures,
        lastError: sanitizeError(globalState.last_error),
        liveRun: isLeaseActive(globalState) && liveRuns.get('collector_feed') ? {
          id: liveRuns.get('collector_feed')!.id,
          stage: liveRuns.get('collector_feed')!.current_stage,
          currentCompany: liveRuns.get('collector_feed')!.current_company_name,
          currentPage: liveRuns.get('collector_feed')!.current_page,
          currentCursor: liveRuns.get('collector_feed')!.current_cursor,
          currentCursorPreview: cursorPreview(liveRuns.get('collector_feed')!.current_cursor),
          hasMore: liveRuns.get('collector_feed')!.has_more,
          totalCandidates: liveRuns.get('collector_feed')!.total_candidates,
          processedCandidates: liveRuns.get('collector_feed')!.processed_candidates,
          remainingCandidates: liveRuns.get('collector_feed')!.remaining_candidates,
          lastHeartbeatAt: liveRuns.get('collector_feed')!.last_heartbeat_at,
          pages: liveRuns.get('collector_feed')!.pages,
          received: liveRuns.get('collector_feed')!.received,
          upserted: liveRuns.get('collector_feed')!.upserted,
          rowFailures: liveRuns.get('collector_feed')!.row_failures,
          fatalFailures: liveRuns.get('collector_feed')!.fatal_failures,
          startedAt: liveRuns.get('collector_feed')!.started_at,
        } : null,
      } : null,
      activeRuns,
      activeRun: activeRuns[0] || null,
      officialDue,
      failures: failureData.total,
      historicalReview: {
        enabled: historicalQuery.error?.code !== '42P01',
        queued: ((historicalQuery.data || []) as HistoricalReviewRow[]).filter((row) => row.status === 'queued').length,
        running: ((historicalQuery.data || []) as HistoricalReviewRow[]).filter((row) => row.status === 'running').length,
        paused: ((historicalQuery.data || []) as HistoricalReviewRow[]).filter((row) => row.status === 'paused').length,
        completed: ((historicalQuery.data || []) as HistoricalReviewRow[]).filter((row) => row.status === 'completed').length,
        failed: ((historicalQuery.data || []) as HistoricalReviewRow[]).filter((row) => row.status === 'failed').length,
      },
    },
    historicalReviews: (historicalQuery.data || []).map((row) => ({
      companyName: row.company_name,
      status: row.status,
      cursorJobId: row.cursor_job_id,
      totalCandidates: row.total_candidates,
      processedCandidates: row.processed_candidates,
      remainingCandidates: row.remaining_candidates,
      updatedJobs: row.updated_jobs,
      unavailableFields: row.unavailable_fields,
      skippedJobs: row.skipped_jobs,
      failedJobs: row.failed_jobs,
      lastError: sanitizeError(row.last_error),
      lastHeartbeatAt: row.last_heartbeat_at,
      nextRunAt: row.next_run_at,
    })),
    companies,
  };
}

export async function loadJobSyncDashboardCompany(companyName: string, client = getSupabaseClient()) {
  const dashboard = await loadJobSyncDashboard(client);
  const company = dashboard.companies.find((entry) => entry.companyName.toLocaleLowerCase() === companyName.trim().toLocaleLowerCase());
  if (!company) return null;
  const sourceSystem = company.upstreamCompanyId ? `feed:company:${company.upstreamCompanyId}` : 'collector_feed';
  const [companyRuns, sourceRuns, failures] = await Promise.all([
    client.from('job_sync_runs').select('id,source_system,company_name,company_id,mode,status,cursor_before,cursor_after,total_candidates,processed_candidates,remaining_candidates,pages,received,upserted,closed,skipped,row_failures,fatal_failures,write_batches,write_batch_failures,write_fallback_rows,write_duration_ms,error_message,started_at,completed_at').eq('company_name', company.companyName).order('started_at', { ascending: false }).limit(20),
    client.from('job_sync_runs').select('id,source_system,company_name,company_id,mode,status,cursor_before,cursor_after,total_candidates,processed_candidates,remaining_candidates,pages,received,upserted,closed,skipped,row_failures,fatal_failures,write_batches,write_batch_failures,write_fallback_rows,write_duration_ms,error_message,started_at,completed_at').eq('source_system', sourceSystem).order('started_at', { ascending: false }).limit(20),
    client.from('job_sync_failures').select('id,source_system,company,external_job_id,source_url,operation,error_message,attempts,status,next_retry_at,first_failed_at,last_failed_at').eq('company', company.companyName).order('updated_at', { ascending: false }).limit(20),
  ]);
  if (companyRuns.error || sourceRuns.error) throw new Error(`读取公司同步运行记录失败: ${companyRuns.error?.message || sourceRuns.error?.message}`);
  if (failures.error) throw new Error(`读取公司失败记录失败: ${failures.error.message}`);
  return {
    ...company,
    runs: [...new Map([...(companyRuns.data || []), ...(sourceRuns.data || [])].map((run) => [run.id, run])).values()].sort((left, right) => Date.parse(String(right.started_at || '')) - Date.parse(String(left.started_at || ''))).slice(0, 20).map((run) => ({ ...run, error_message: sanitizeError(run.error_message, 300) })),
    failureSamples: (failures.data || []).map((failure) => ({ ...failure, error_message: sanitizeError(failure.error_message, 300), source_url: failure.source_url || null })),
  };
}
