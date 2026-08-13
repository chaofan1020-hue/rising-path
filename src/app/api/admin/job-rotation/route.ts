import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getJobFeedState } from '@/lib/job-feed-orchestrator';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const SOURCE_SYSTEM = 'collector_feed';
const LOOKBACK_HOURS = 24;
const RUN_SAMPLE_SIZE = 50;
const CLOSED_PAGE_SIZE = 200;
const MAX_CLOSED_PAGES = 10;

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

type SourceDashboard = {
  open_jobs?: number;
  closed_jobs?: number;
  last_crawled_at?: string | null;
  latest_crawl?: { status?: string; completed_at?: string | null } | null;
};

function getSince() {
  return new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
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
    const since = getSince();
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
      },
      changes: {
        runs: sampledRuns.slice(0, 8),
        removed: source.closed.slice(0, 8),
      },
    });
  } catch (error) {
    console.error('[Admin Job Rotation] query failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '读取岗位轮换状态失败' }, { status: 500 });
  }
}
