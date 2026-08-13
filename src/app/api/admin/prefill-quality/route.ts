import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';

const RANGES = ['7d', '30d', '90d'] as const;
type QualityRange = (typeof RANGES)[number];

function isQualityRange(value: string | null): value is QualityRange {
  return RANGES.includes(value as QualityRange);
}

function getRangeBounds(range: QualityRange): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - Number(range.slice(0, -1)));
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.dashboardRead);
  if (permissionError) return permissionError;

  const range = request.nextUrl.searchParams.get('range') || '30d';
  if (!isQualityRange(range)) {
    return NextResponse.json(
      { data: null, error: { code: 'INVALID_RANGE', message: '统计时间范围无效' } },
      { status: 400 },
    );
  }

  const { from, to } = getRangeBounds(range);
  try {
    const { data, error } = await getSupabaseClient().rpc('get_admin_prefill_quality', {
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
          confirmationRate: 'confirmed / (confirmed + edited)',
          correctionRate: 'edited / (confirmed + edited)',
          ignored: 'ignored feedback is reported separately and excluded from the two decision rates',
          templateQuality: 'shared active templates only; historical usage and correction counters are all-time',
        },
      },
      error: null,
    });
  } catch (error) {
    console.error('[Admin Prefill Quality] query failed:', error);
    const migrationResponse = adminMigrationUnavailable(error, ['0027_application_prefill_quality_aggregates.sql'], '网申质量依赖数据库迁移，当前环境尚未部署');
    if (migrationResponse) return migrationResponse;
    return NextResponse.json(
      { data: null, error: { code: 'ADMIN_PREFILL_QUALITY_QUERY_FAILED', message: '获取网申预填质量数据失败' } },
      { status: 500 },
    );
  }
}
