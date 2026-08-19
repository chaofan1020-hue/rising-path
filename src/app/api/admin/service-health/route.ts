import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';

const RANGES = ['24h', '7d', '30d'] as const;
type HealthRange = (typeof RANGES)[number];

function isHealthRange(value: string | null): value is HealthRange {
  return RANGES.includes(value as HealthRange);
}

function getRangeBounds(range: HealthRange): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  if (range === '24h') from.setUTCHours(from.getUTCHours() - 24);
  if (range === '7d') from.setUTCDate(from.getUTCDate() - 7);
  if (range === '30d') from.setUTCDate(from.getUTCDate() - 30);
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.dashboardRead);
  if (permissionError) return permissionError;

  const range = request.nextUrl.searchParams.get('range') || '24h';
  if (!isHealthRange(range)) {
    return NextResponse.json(
      { data: null, error: { code: 'INVALID_RANGE', message: '统计时间范围无效' } },
      { status: 400 },
    );
  }

  const { from, to } = getRangeBounds(range);
  try {
    const { data, error } = await getSupabaseClient().rpc('get_admin_service_health', {
      p_from: from,
      p_to: to,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({
      data: data || null,
      meta: {
        range,
        from,
        to,
        semantics: {
          providerHealth: 'derived from recorded AI usage events in the selected range; no provider probe is performed',
          degradedProvider: 'failure rate is at least 20%',
          staleJobSync: 'latest incremental success is more than 24 hours old',
        },
      },
      error: null,
    });
  } catch (error) {
    console.error('[Admin Service Health] query failed:', error);
    const migrationResponse = adminMigrationUnavailable(error, ['0028_admin_service_health_aggregates.sql'], '服务健康依赖数据库迁移，当前环境尚未部署');
    if (migrationResponse) return migrationResponse;
    return NextResponse.json(
      { data: null, error: { code: 'ADMIN_SERVICE_HEALTH_QUERY_FAILED', message: '获取服务健康数据失败' } },
      { status: 500 },
    );
  }
}
