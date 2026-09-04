import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;
const MAX_PAGE = 1000;

function positiveInteger(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.dashboardRead);
  if (permissionError) return permissionError;

  try {
    const params = request.nextUrl.searchParams;
    const page = positiveInteger(params.get('page'), 1, MAX_PAGE);
    const pageSize = positiveInteger(params.get('page_size'), PAGE_SIZE, PAGE_SIZE);
    const status = params.get('status')?.trim() || null;
    const sourceType = params.get('source_type')?.trim() || null;
    const search = params.get('search')?.trim() || null;
    const includeInactive = params.get('include_inactive') === 'true';
    let query = getSupabaseClient()
      .from('job_company_sources')
      .select('*', { count: 'exact' })
      .order('active_jobs', { ascending: false })
      .order('company_name', { ascending: true })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (!includeInactive) query = query.eq('is_active', true);
    if (status) query = query.eq('status', status);
    if (sourceType) query = query.eq('source_type', sourceType);
    if (search) query = query.ilike('company_name', `%${search}%`);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);

    const rows = data || [];
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      summary: {
        total: count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
      sources: rows,
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error) {
    console.error('[Admin Job Sources] query failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '读取公司来源台账失败' }, { status: 500 });
  }
}
