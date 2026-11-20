import { getSupabaseClient } from '@/storage/database/supabase-client';

export const ANALYTICS_RANGES = ['7d', '30d', '90d', 'all'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export interface AdminAnalyticsData {
  overview: {
    totalUsers: number;
    recentUsers: number;
    totalResumes: number;
    recentResumes: number;
    totalJobs: number;
    recentJobs: number;
    totalApplications: number;
    recentApplications: number;
    totalAiMatches: number;
    recentAiMatches: number;
    activeUsers: number;
    averageActivityPerActiveUser: number;
  };
  charts: {
    jobsByRegion: Record<string, number>;
    jobsByDirection: Record<string, number>;
    applicationsByStatus: Record<string, number>;
    dailyStats: { date: string; resumes: number; applications: number; aiMatches: number }[];
  };
  userActivity: {
    userId: string;
    userName: string;
    resumes: number;
    applications: number;
    aiMatches: number;
  }[];
}

export interface AdminAnalyticsPayload {
  data: AdminAnalyticsData | null;
  meta: {
    range: AnalyticsRange;
    from: string;
    to: string;
    semantics: {
      recent: string;
      activeUser: string;
      jobInventory: string;
      trend: string;
    };
  };
  error: null;
}

export function isAnalyticsRange(value: string | null): value is AnalyticsRange {
  return ANALYTICS_RANGES.includes(value as AnalyticsRange);
}

export function getRangeBounds(range: AnalyticsRange): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);

  if (range === '7d') from.setUTCDate(from.getUTCDate() - 7);
  if (range === '30d') from.setUTCDate(from.getUTCDate() - 30);
  if (range === '90d') from.setUTCDate(from.getUTCDate() - 90);
  if (range === 'all') from.setTime(0);

  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * The aggregate scans the job table and runs several counts, so it is the most
 * expensive query behind the dashboard. A dashboard does not need sub-minute
 * accuracy, so the payload is cached per range and refreshed in the background
 * once it goes stale: the next caller is served the previous snapshot
 * immediately instead of waiting for the aggregate.
 */
function cacheTtlMs(): number {
  const seconds = Number(process.env.ADMIN_ANALYTICS_CACHE_TTL_SECONDS || 180);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 180) * 1000;
}

const analyticsCache = new Map<string, { expiresAt: number; payload: AdminAnalyticsPayload }>();
const inflight = new Map<string, Promise<AdminAnalyticsPayload>>();

/**
 * The production aggregate takes 2.5-6s (the `jobs` heap is ~390 MB and the
 * database has little spare I/O, so it contends with the job-sync worker).
 * After the first successful fetch, refresh it just before expiry so admins
 * practically never wait for it. Disable with ADMIN_ANALYTICS_REFRESH=false.
 */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSelfRefresh(): void {
  if (process.env.ADMIN_ANALYTICS_REFRESH === 'false') return;
  if (refreshTimer) return;

  const delay = Math.max(60_000, cacheTtlMs() - 20_000);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void startRefresh('7d')
      .catch((error: unknown) => {
        console.error(
          '[Admin Analytics] self refresh failed:',
          error instanceof Error ? error.message : error,
        );
      })
      .finally(() => {
        scheduleSelfRefresh();
      });
  }, delay);
  refreshTimer.unref?.();
}

async function queryAdminAnalytics(range: AnalyticsRange): Promise<AdminAnalyticsPayload> {
  const { from, to } = getRangeBounds(range);
  const { data, error } = await getSupabaseClient().rpc('get_admin_analytics', {
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);

  return {
    data: (data as AdminAnalyticsData | null) || null,
    meta: {
      range,
      from,
      to,
      semantics: {
        recent: 'created_at in [from, to) UTC',
        activeUser:
          'a user with at least one resume, application, or AI match created in the selected range',
        jobInventory: 'all active jobs',
        trend: 'the seven UTC calendar days ending at to',
      },
    },
    error: null,
  };
}

function startRefresh(range: AnalyticsRange): Promise<AdminAnalyticsPayload> {
  const existing = inflight.get(range);
  if (existing) return existing;

  const promise = queryAdminAnalytics(range)
    .then((payload) => {
      analyticsCache.set(range, { expiresAt: Date.now() + cacheTtlMs(), payload });
      scheduleSelfRefresh();
      return payload;
    })
    .finally(() => {
      inflight.delete(range);
    });

  inflight.set(range, promise);
  return promise;
}

export async function getAdminAnalytics(range: AnalyticsRange): Promise<AdminAnalyticsPayload> {
  const cached = analyticsCache.get(range);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;

  if (cached) {
    // Stale: hand back the previous snapshot immediately and refresh behind the
    // request. Nobody waits on a dashboard refresh once the cache is populated.
    void startRefresh(range).catch((error: unknown) => {
      console.error(
        '[Admin Analytics] background refresh failed:',
        error instanceof Error ? error.message : error,
      );
    });
    return cached.payload;
  }

  return startRefresh(range);
}

export function invalidateAdminAnalyticsCache(): void {
  analyticsCache.clear();
  inflight.clear();
}