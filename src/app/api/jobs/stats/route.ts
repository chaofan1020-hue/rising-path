import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { targetRegionPostgrestClauses } from '@/lib/job-region-scope';

// GET /api/jobs/stats - 获取岗位统计数据
//
// The previous implementation ran four exact COUNT(*) queries, each OR-ed over
// dozens of `region ilike` clauses. Every call took longer than Supabase's
// statement timeout and returned 500. Planner estimates are enough for a
// "today / this week / this month" widget and never scan the table.

const STATS_CACHE_MS = 60 * 1000;
type JobStats = {
  today: number;
  thisWeek: number;
  thisMonth: number;
  total: number;
  regionBreakdown: Record<string, number>;
  date: string;
  estimated: boolean;
};
let statsCache: { expiresAt: number; value: JobStats } | null = null;

function startOfDay(date: Date): string {
  return date.toISOString().split('T')[0];
}

async function countJobs(
  client: ReturnType<typeof getSupabaseClient>,
  options: { targetIndex: boolean; since?: string },
): Promise<number> {
  let query = client
    .from('jobs')
    .select('id', { count: 'planned', head: true })
    .eq('is_active', true);
  query = options.targetIndex
    ? query.eq('matches_target_region', true)
    : query.or(targetRegionPostgrestClauses().join(','));
  if (options.since) query = query.gte('created_at', options.since);
  const { count, error } = await query;
  if (error) throw new Error(error.message || '统计岗位失败');
  return count ?? 0;
}

export async function GET() {
  try {
    if (statsCache && statsCache.expiresAt > Date.now()) {
      return NextResponse.json(statsCache.value, {
        headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      });
    }

    const client = getSupabaseClient();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = startOfDay(today);

    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - weekStart.getDay());
    const weekStartStr = startOfDay(weekStart);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthStartStr = startOfDay(monthStart);

    // Probe once: with migration 0127 applied this is an indexed boolean; the
    // fallback keeps older deployments working during a rolling release.
    let targetIndex = true;
    const total = await countJobs(client, { targetIndex }).catch(async () => {
      targetIndex = false;
      return countJobs(client, { targetIndex });
    });
    const [todayCount, weekCount, monthCount] = await Promise.all([
      countJobs(client, { targetIndex, since: todayStr }),
      countJobs(client, { targetIndex, since: weekStartStr }),
      countJobs(client, { targetIndex, since: monthStartStr }),
    ]);

    const value: JobStats = {
      today: todayCount,
      thisWeek: weekCount,
      thisMonth: monthCount,
      total,
      regionBreakdown: {},
      date: todayStr,
      estimated: true,
    };
    statsCache = { expiresAt: Date.now() + STATS_CACHE_MS, value };

    return NextResponse.json(value, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Error fetching job stats:', error);
    return NextResponse.json(
      { error: '获取岗位统计数据失败', today: 0, thisWeek: 0, thisMonth: 0, total: 0 },
      { status: 503 }
    );
  }
}
