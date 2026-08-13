import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';

const MAX_PAGE_SIZE = 100;

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.usersRead);
  if (permissionError) return permissionError;

  const searchParams = request.nextUrl.searchParams;
  const page = positiveInteger(searchParams.get('page'), 1);
  const pageSize = Math.min(positiveInteger(searchParams.get('pageSize'), 50), MAX_PAGE_SIZE);
  const feature = searchParams.get('feature')?.trim() || null;
  const provider = searchParams.get('provider')?.trim() || null;
  const status = searchParams.get('status')?.trim() || null;
  const usageSource = searchParams.get('usageSource')?.trim() || null;
  const from = optionalDate(searchParams.get('from'));
  const to = optionalDate(searchParams.get('to'));

  if ((searchParams.has('from') && !from) || (searchParams.has('to') && !to)) {
    return NextResponse.json({ data: null, error: { code: 'INVALID_DATE', message: '日期参数无效' } }, { status: 400 });
  }

  try {
    const client = getSupabaseClient();
    const [studentSummaryQuery, studentCountQuery] = await Promise.all([
      client.rpc('get_ai_usage_student_summary_v4', {
        p_feature: feature,
        p_provider: provider,
        p_status: status,
        p_usage_source: usageSource,
        p_from: from,
        p_to: to,
        p_page: page,
        p_page_size: pageSize,
      }),
      client.rpc('get_ai_usage_student_count', {
        p_feature: feature,
        p_provider: provider,
        p_status: status,
        p_usage_source: usageSource,
        p_from: from,
        p_to: to,
      }),
    ]);
    if (studentSummaryQuery.error) throw new Error(studentSummaryQuery.error.message);
    if (studentCountQuery.error) throw new Error(studentCountQuery.error.message);

    return NextResponse.json({
      data: { students: studentSummaryQuery.data || [] },
      meta: { page, pageSize, total: Number(studentCountQuery.data || 0) },
      error: null,
    });
  } catch (error) {
    console.error('[Admin AI Usage] student summary failed:', error);
    const migrationResponse = adminMigrationUnavailable(error, ['0017_ai_usage_events.sql', '0018_ai_usage_admin_aggregates.sql', '0019_audio_ai_usage_metrics.sql', '0023_ai_model_prices.sql'], '学生 AI 用量依赖数据库迁移，当前环境尚未部署');
    if (migrationResponse) return migrationResponse;
    return NextResponse.json(
      { data: null, error: { code: 'ADMIN_AI_USAGE_STUDENT_QUERY_FAILED', message: '获取学生 AI 用量失败' } },
      { status: 500 },
    );
  }
}
