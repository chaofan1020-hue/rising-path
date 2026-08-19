import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const MAX_PAGE_SIZE = 100;
const RESERVED_CONFIG_TYPE = 'admin_password_hash';

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanSearch(value: string | null): string | null {
  const cleaned = value?.trim().replace(/[,*()\\]/g, ' ').slice(0, 100).trim();
  return cleaned || null;
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.configWrite);
  if (permissionError) return permissionError;

  const params = request.nextUrl.searchParams;
  const page = positiveInteger(params.get('page'), 1);
  const pageSize = Math.min(positiveInteger(params.get('pageSize'), 100), MAX_PAGE_SIZE);
  const type = params.get('type')?.trim() || null;
  const search = cleanSearch(params.get('search'));

  try {
    const client = getSupabaseClient();
    let query = client
      .from('job_configs')
      .select('id, config_type, config_value, sort_order, is_active, created_at, updated_at', { count: 'exact' })
      .neq('config_type', RESERVED_CONFIG_TYPE)
      .order('config_type', { ascending: true })
      .order('sort_order', { ascending: true })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (type) query = query.eq('config_type', type);
    if (search) query = query.or(`config_type.ilike.*${search}*,config_value.ilike.*${search}*`);

    const summaryQuery = client
      .from('job_configs')
      .select('config_type, is_active')
      .neq('config_type', RESERVED_CONFIG_TYPE);
    const [{ data, error, count }, { data: summaryRows, error: summaryError }] = await Promise.all([
      query,
      summaryQuery,
    ]);
    if (error) throw new Error(error.message);
    if (summaryError) throw new Error(summaryError.message);

    const byType: Record<string, number> = {};
    for (const row of summaryRows || []) {
      if (typeof row.config_type === 'string') byType[row.config_type] = (byType[row.config_type] || 0) + 1;
    }

    const list = data || [];
    const grouped = list.reduce<Record<string, typeof list>>((acc, item) => {
      (acc[item.config_type] ||= []).push(item);
      return acc;
    }, {});

    return NextResponse.json({
      data: list,
      list,
      configs: grouped,
      meta: { page, pageSize, total: count || 0 },
      summary: { total: summaryRows?.length || 0, byType },
      error: null,
    });
  } catch (error) {
    console.error('[Admin Configs] query failed:', error);
    return NextResponse.json(
      { data: null, error: { code: 'ADMIN_CONFIGS_QUERY_FAILED', message: '获取管理员配置列表失败' } },
      { status: 500 },
    );
  }
}
