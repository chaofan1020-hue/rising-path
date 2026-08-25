import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getJobFeedState } from '@/lib/job-feed-orchestrator';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const SOURCE_SYSTEM = 'collector_feed';
const LOOKBACK_HOURS = 24;
const RUN_SAMPLE_SIZE = 50;
const CLOSED_PAGE_SIZE = 200;
const MAX_CLOSED_PAGES = 10;
const DEFAULT_CHANGE_PAGE_SIZE = 50;
const MAX_CHANGE_PAGE_SIZE = 100;

type RemoteRun = {
  id: string;
  company: string;
  connector_type: string;
  status: 'success' | 'partial' | 'failed' | string;
  discovered_count: number;
  created_count: number;
  updated_count: number;
  error: string | null;
  started_at: string;
  completed_at: string | null;
};

type RemoteJob = {
  id: string;
  company_name: string;
  title: string;
  location: string | null;
  source_url: string | null;
  closed_at: string | null;
  updated_at: string;
};

type ChangeType = 'all' | 'new' | 'updated' | 'closed';

type LocalJob = {
  id: number;
  title: string;
  company: string;
  region: string;
  direction: string;
  job_type: string | null;
  job_url: string | null;
  source_url: string | null;
  valid_through: string | null;
  is_active: boolean;
  is_closed: boolean;
  created_at: string;
  updated_at: string | null;
};

type LocalSyncRecord = {
  job_id: number;
  last_verified_at: string | null;
  last_link_checked_at: string | null;
  last_link_status: number | null;
  link_check_failures: number;
  missing_feed_checks: number;
  availability_status: 'valid' | 'closed' | 'blocked' | 'timeout' | 'unknown' | null;
  link_health: 'healthy' | 'closed' | 'blocked' | 'timeout' | 'unknown' | null;
  last_link_error: string | null;
  last_link_http_status: number | null;
  availability_checked_at: string | null;
};

type SourceDashboard = {
  open_jobs?: number;
  closed_jobs?: number;
  last_crawled_at?: string | null;
  latest_crawl?: { status?: string; completed_at?: string | null } | null;
};

function getSince(hours = LOOKBACK_HOURS) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function parseLookbackHours(value: string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 168) : LOOKBACK_HOURS;
}

function parsePage(value: string | null): number {
  const parsed = Number.parseInt(value || '1', 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 10_000) : 1;
}

function parsePageSize(value: string | null): number {
  const parsed = Number.parseInt(value || String(DEFAULT_CHANGE_PAGE_SIZE), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 10), MAX_CHANGE_PAGE_SIZE) : DEFAULT_CHANGE_PAGE_SIZE;
}

function parseChangeType(value: string | null): ChangeType {
  return value === 'new' || value === 'updated' || value === 'closed' ? value : 'all';
}

function getSourceBase(url: string) {
  const endpoint = new URL(url);
  endpoint.pathname = endpoint.pathname.replace(/\/integrations\/v1\/jobs\/?$/, '');
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString().replace(/\/$/, '');
}

async function fetchSourceJson<T>(baseUrl: string, apiKey: string, path: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Accept: 'application/json', 'X-Integration-Key': apiKey },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`上游返回 HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function readRecentClosedJobs(baseUrl: string, apiKey: string, since: string) {
  const changes: RemoteJob[] = [];
  let capped = false;
  for (let page = 0; page < MAX_CLOSED_PAGES; page += 1) {
    const offset = page * CLOSED_PAGE_SIZE;
    const jobs = await fetchSourceJson<RemoteJob[]>(baseUrl, apiKey, `/jobs?status=closed&limit=${CLOSED_PAGE_SIZE}&offset=${offset}`);
    const olderEntryIndex = jobs.findIndex((job) => {
      const closedAt = job.closed_at || job.updated_at;
      return !Number.isFinite(Date.parse(closedAt)) || Date.parse(closedAt) < Date.parse(since);
    });
    changes.push(...(olderEntryIndex === -1 ? jobs : jobs.slice(0, olderEntryIndex)));
    if (jobs.length < CLOSED_PAGE_SIZE || olderEntryIndex !== -1) break;
    if (page === MAX_CLOSED_PAGES - 1) capped = true;
  }
  return { changes, capped };
}

async function readSourceActivity(since: string) {
  const url = process.env.JOBS_FEED_URL;
  const apiKey = process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY;
  if (!url || !apiKey) {
    return {
      reachable: false,
      message: '岗位数据源未配置',
      generatedAt: null,
      contractVersion: null,
      dashboard: null,
      runs: [] as RemoteRun[],
      closed: [] as RemoteJob[],
      closedCapped: false,
    };
  }

  try {
    const baseUrl = getSourceBase(url);
    const [probe, dashboard, runs, closed] = await Promise.all([
      fetchSourceJson<{ generated_at?: string; contract_version?: string }>(baseUrl, apiKey, '/integrations/v1/jobs?limit=1&include_closed=true'),
      fetchSourceJson<SourceDashboard>(baseUrl, apiKey, '/dashboard/summary'),
      fetchSourceJson<RemoteRun[]>(baseUrl, apiKey, `/dashboard/recent-runs?limit=${RUN_SAMPLE_SIZE}`),
      readRecentClosedJobs(baseUrl, apiKey, since),
    ]);
    return {
      reachable: true,
      message: '主服务器抓取接口可达',
      generatedAt: probe.generated_at || dashboard.last_crawled_at || null,
      contractVersion: probe.contract_version || null,
      dashboard,
      runs,
      closed: closed.changes,
      closedCapped: closed.capped,
    };
  } catch (error) {
    return {
      reachable: false,
      message: error instanceof Error && error.name === 'AbortError' ? '主服务器请求超时' : error instanceof Error ? error.message : '主服务器暂时不可达',
      generatedAt: null,
      contractVersion: null,
      dashboard: null,
      runs: [] as RemoteRun[],
      closed: [] as RemoteJob[],
      closedCapped: false,
    };
  }
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.dashboardRead);
  if (permissionError) return permissionError;

  try {
    const client = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const lookbackHours = parseLookbackHours(searchParams.get('hours'));
    const since = getSince(lookbackHours);
    const changeType = parseChangeType(searchParams.get('change_type'));
    const page = parsePage(searchParams.get('page'));
    const pageSize = parsePageSize(searchParams.get('page_size'));
    const offset = (page - 1) * pageSize;
    const [state, source, activeCount, feedActiveCount] = await Promise.all([
      getJobFeedState(client),
      readSourceActivity(since),
      client.from('jobs').select('*', { count: 'exact', head: true }).eq('is_active', true),
      client.from('jobs').select('*', { count: 'exact', head: true }).eq('source_system', SOURCE_SYSTEM).eq('is_active', true),
    ]);
    const queryError = activeCount.error || feedActiveCount.error;
    if (queryError) throw new Error(queryError.message);

    const sourceAgeHours = source.generatedAt ? Math.max(0, (Date.now() - Date.parse(source.generatedAt)) / 3_600_000) : null;
    const healthy = source.reachable && (sourceAgeHours === null || sourceAgeHours < 2);
    const sampledRuns = source.runs.slice(0, RUN_SAMPLE_SIZE);
    const createdInSample = sampledRuns.reduce((total, run) => total + (Number(run.created_count) || 0), 0);
    const updatedInSample = sampledRuns.reduce((total, run) => total + (Number(run.updated_count) || 0), 0);
    const failedRuns = sampledRuns.filter((run) => run.status === 'failed').length;

    let changesQuery = client
      .from('jobs')
      .select('id,title,company,region,direction,job_type,job_url,source_url,valid_through,is_active,is_closed,created_at,updated_at', { count: 'exact' })
      .eq('source_system', SOURCE_SYSTEM);
    if (changeType === 'new') {
      changesQuery = changesQuery.gte('created_at', since);
    } else if (changeType === 'updated') {
      changesQuery = changesQuery.gte('updated_at', since).lt('created_at', since);
    } else if (changeType === 'closed') {
      changesQuery = changesQuery.eq('is_active', false).gte('updated_at', since);
    } else {
      changesQuery = changesQuery.or(`created_at.gte.${since},updated_at.gte.${since}`);
    }
    const { data: localRows, error: localError, count: localCount } = await changesQuery
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (localError) throw new Error(`读取岗位轮换明细失败: ${localError.message}`);

    const localJobs = (localRows || []) as LocalJob[];
    const localJobIds = localJobs.map((job) => job.id);
    const { data: syncRows, error: syncError } = localJobIds.length === 0
      ? { data: [], error: null }
      : await client
        .from('job_sync_records')
        .select('job_id,last_verified_at,last_link_checked_at,last_link_status,link_check_failures,missing_feed_checks,availability_status,link_health,last_link_error,last_link_http_status,availability_checked_at')
        .in('job_id', localJobIds);
    if (syncError) throw new Error(`读取岗位核验状态失败: ${syncError.message}`);
    const syncByJobId = new Map((syncRows || []).map((row) => [row.job_id, row as LocalSyncRecord]));
    const localChanges = localJobs.map((job) => {
      const sync = syncByJobId.get(job.id);
      const createdAt = Date.parse(job.created_at);
      return {
        ...job,
        change_type: job.is_active === false ? 'closed' : Number.isFinite(createdAt) && createdAt >= Date.parse(since) ? 'new' : 'updated',
        last_verified_at: sync?.last_verified_at || null,
        last_link_checked_at: sync?.last_link_checked_at || null,
        last_link_status: sync?.last_link_status ?? null,
        link_check_failures: sync?.link_check_failures || 0,
        missing_feed_checks: sync?.missing_feed_checks || 0,
        availability_status: sync?.availability_status || null,
        link_health: sync?.link_health || null,
        last_link_error: sync?.last_link_error || null,
        last_link_http_status: sync?.last_link_http_status ?? null,
        availability_checked_at: sync?.availability_checked_at || null,
      };
    });

    const [newCount, updatedCount, closedCount] = await Promise.all([
      client.from('jobs').select('id', { count: 'exact', head: true }).eq('source_system', SOURCE_SYSTEM).gte('created_at', since),
      client.from('jobs').select('id', { count: 'exact', head: true }).eq('source_system', SOURCE_SYSTEM).gte('updated_at', since).lt('created_at', since),
      client.from('jobs').select('id', { count: 'exact', head: true }).eq('source_system', SOURCE_SYSTEM).eq('is_active', false).gte('updated_at', since),
    ]);
    const countError = newCount.error || updatedCount.error || closedCount.error;
    if (countError) throw new Error(`统计岗位轮换明细失败: ${countError.message}`);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      lookbackHours: LOOKBACK_HOURS,
      healthy,
      sync: {
        sourceSystem: state.source_system,
        lastIncrementalSuccessAt: state.last_incremental_success_at,
        lastReconcileSuccessAt: state.last_reconcile_success_at,
        lastError: state.last_error,
        consecutiveFailures: state.consecutive_failures,
        syncInProgress: Boolean(state.lease_expires_at && Date.parse(state.lease_expires_at) > Date.now()),
        updatedAt: state.updated_at,
      },
      source: {
        reachable: source.reachable,
        generatedAt: source.generatedAt,
        contractVersion: source.contractVersion,
        message: source.message,
        openJobs: source.dashboard?.open_jobs ?? null,
        closedJobs: source.dashboard?.closed_jobs ?? null,
        latestCrawlStatus: source.dashboard?.latest_crawl?.status || null,
        latestCrawlAt: source.dashboard?.latest_crawl?.completed_at || source.dashboard?.last_crawled_at || null,
      },
      summary: {
        platformActiveJobs: activeCount.count || 0,
        platformFeedJobs: feedActiveCount.count || 0,
        createdInRecentRuns: createdInSample,
        updatedInRecentRuns: updatedInSample,
        recentRuns: sampledRuns.length,
        failedRuns,
        closed24h: source.closed.length,
        closedCapped: source.closedCapped,
        lookbackHours,
        localNew: newCount.count || 0,
        localUpdated: updatedCount.count || 0,
        localClosed: closedCount.count || 0,
      },
      changes: {
        runs: sampledRuns.slice(0, 8),
        removed: source.closed.slice(0, 8),
        jobs: localChanges,
        pagination: {
          page,
          pageSize,
          total: localCount || 0,
          totalPages: Math.ceil((localCount || 0) / pageSize),
          changeType,
        },
      },
    });
  } catch (error) {
    console.error('[Admin Job Rotation] query failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '读取岗位轮换状态失败' }, { status: 500 });
  }
}
