import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getAdminAnalytics, isAnalyticsRange } from '@/lib/admin-analytics';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';

export async function GET(request: NextRequest) {
  const permissionError = await requireAdminPermission(request, ADMIN_PERMISSIONS.dashboardRead);
  if (permissionError) return permissionError;

  const rangeParam = request.nextUrl.searchParams.get('range') || '7d';
  if (!isAnalyticsRange(rangeParam)) {
    return NextResponse.json(
      { data: null, error: { code: 'INVALID_RANGE', message: '统计时间范围无效' } },
      { status: 400 },
    );
  }

  try {
    // Shares a 60s per-range cache with the dashboard page, which renders the
    // same payload on the server.
    return NextResponse.json(await getAdminAnalytics(rangeParam));
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