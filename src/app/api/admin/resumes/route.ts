import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const MAX_PAGE_SIZE = 100;
const RESUME_STATUSES = [
  'uploaded',
  'extracting_text',
  'extracting_profile',
  'deriving_segmentation',
  'needs_confirmation',
  'ready',
  'failed',
] as const;

type CountResult = {
  count: number | null;
  error: { message: string } | null;
};

type CountQuery = {
  eq(column: string, value: unknown): CountQuery;
  or(filters: string): CountQuery;
  then<TResult1 = CountResult, TResult2 = never>(
    onfulfilled?: ((value: CountResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
};

type CountClient = {
  from(table: string): {
    select(columns: string, options: { count: 'exact'; head: true }): CountQuery;
  };
};

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanSearch(value: string | null): string | null {
  const cleaned = value?.trim().replace(/[,*()\\]/g, ' ').slice(0, 100).trim();
  return cleaned || null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function applyResumeFilters<T extends {
  eq(column: string, value: unknown): T;
  or(filters: string): T;
}>(query: T, status: string | null, search: string | null): T {
  if (status) query = query.eq('processing_status', status);
  if (!search) return query;

  const clauses = [`file_name.ilike.*${search}*`];
  if (/^\d+$/.test(search)) clauses.push(`id.eq.${search}`);
  if (isUuid(search)) clauses.push(`user_id.eq.${search}`);
  return query.or(clauses.join(','));
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.usersRead);
  if (permissionError) return permissionError;

  const params = request.nextUrl.searchParams;
  const page = positiveInteger(params.get('page'), 1);
  const pageSize = Math.min(positiveInteger(params.get('pageSize'), 20), MAX_PAGE_SIZE);
  const status = params.get('status')?.trim() || null;
  const search = cleanSearch(params.get('search'));

  if (status && !RESUME_STATUSES.includes(status as typeof RESUME_STATUSES[number])) {
    return NextResponse.json(
      { data: null, error: { code: 'INVALID_STATUS', message: '简历处理状态无效' } },
      { status: 400 },
    );
  }

  try {
    const client = getSupabaseClient();
    let query = client
      .from('resumes')
      .select(
        'id, file_name, user_id, created_at, updated_at, processing_status, processing_stage, processing_attempts, profile_version, segmentation_confirmed, profile_confirmed_at',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    query = applyResumeFilters(query, status, search);

    const listResult = await query;
    const countClient = client as unknown as CountClient;
    const totalQuery = applyResumeFilters(
      countClient.from('resumes').select('id', { count: 'exact', head: true }),
      status,
      search,
    );
    const statusQueries = RESUME_STATUSES.map((item) => applyResumeFilters(
      countClient.from('resumes').select('id', { count: 'exact', head: true }),
      item,
      search,
    ));
    const [totalResult, ...statusResults] = await Promise.all([totalQuery, ...statusQueries]);
    const { data, error, count } = listResult;
    if (error) throw new Error(error.message);
    if (totalResult.error) throw new Error(totalResult.error.message);
    const failedStatusQuery = statusResults.find((item) => item.error);
    if (failedStatusQuery?.error) throw new Error(failedStatusQuery.error.message);

    const byStatus = Object.fromEntries(RESUME_STATUSES.map((item) => [item, 0]));
    RESUME_STATUSES.forEach((item, index) => {
      byStatus[item] = statusResults[index]?.count || 0;
    });

    return NextResponse.json({
      data: data || [],
      meta: { page, pageSize, total: count || 0 },
      summary: { total: totalResult.count || 0, byStatus },
      error: null,
    });
  } catch (error) {
    console.error('[Admin Resumes] query failed:', error);
    return NextResponse.json(
      { data: null, error: { code: 'ADMIN_RESUMES_QUERY_FAILED', message: '获取管理员简历列表失败' } },
      { status: 500 },
    );
  }
}
