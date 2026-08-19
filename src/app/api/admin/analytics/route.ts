import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';

const RANGES = ['7d', '30d', '90d', 'all'] as const;
type AnalyticsRange = (typeof RANGES)[number];

function isAnalyticsRange(value: string | null): value is AnalyticsRange {
  return RANGES.includes(value as AnalyticsRange);
}

function getRangeBounds(range: AnalyticsRange): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);

  if (range === '7d') from.setUTCDate(from.getUTCDate() - 7);
  if (range === '30d') from.setUTCDate(from.getUTCDate() - 30);
  if (range === '90d') from.setUTCDate(from.getUTCDate() - 90);
  if (range === 'all') from.setTime(0);

  return { from: from.toISOString(), to: to.toISOString() };
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.dashboardRead);
  if (permissionError) return permissionError;

  const rangeParam = request.nextUrl.searchParams.get('range') || '7d';
  if (!isAnalyticsRange(rangeParam)) {
    return NextResponse.json(
      { data: null, error: { code: 'INVALID_RANGE', message: '统计时间范围无效' } },
      { status: 400 },
    );
  }

  const { from, to } = getRangeBounds(rangeParam);

  try {
    const { data, error } = await getSupabaseClient().rpc('get_admin_analytics', {
      p_from: from,
      p_to: to,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({
      data: data || null,
      meta: {
        range: rangeParam,
        from,
        to,
        semantics: {
          recent: 'created_at in [from, to) UTC',
          activeUser: 'a user with at least one resume, application, or AI match created in the selected range',
          jobInventory: 'all active jobs',
          trend: 'the seven UTC calendar days ending at to',
        },
      },
      error: null,
    });
  } catch (error) {
    console.error('[Admin Analytics] query failed:', error);
    const migrationResponse = adminMigrationUnavailable(error, ['0022_admin_analytics_aggregates.sql'], '管理员统计依赖数据库迁移，当前环境尚未部署');
    if (migrationResponse) return migrationResponse;
    return NextResponse.json(
      { data: null, error: { code: 'ADMIN_ANALYTICS_QUERY_FAILED', message: '获取管理员统计数据失败' } },
      { status: 500 },
    );
  }
}
