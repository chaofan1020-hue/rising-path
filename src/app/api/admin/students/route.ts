import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';

const MAX_PAGE_SIZE = 100;
const SORT_OPTIONS = ['recent_activity', 'ai_usage', 'resumes', 'interviews'] as const;

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanSearch(value: string | null): string | null {
  const cleaned = value?.trim().replace(/[%_]/g, ' ').slice(0, 100).trim();
  return cleaned || null;
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.usersRead);
  if (permissionError) return permissionError;

  const params = request.nextUrl.searchParams;
  const page = positiveInteger(params.get('page'), 1);
  const pageSize = Math.min(positiveInteger(params.get('pageSize'), 25), MAX_PAGE_SIZE);
  const search = cleanSearch(params.get('search'));
  const sort = params.get('sort') || 'recent_activity';
  if (!SORT_OPTIONS.includes(sort as typeof SORT_OPTIONS[number])) {
    return NextResponse.json({ data: null, error: { code: 'INVALID_SORT', message: '排序方式无效' } }, { status: 400 });
  }

  try {
    const client = getSupabaseClient();
    const [directoryResult, countResult] = await Promise.all([
      client.rpc('get_admin_student_directory', { p_search: search, p_sort: sort, p_page: page, p_page_size: pageSize }),
      client.rpc('get_admin_student_directory_count', { p_search: search }),
    ]);
    if (directoryResult.error || countResult.error) {
      throw new Error(directoryResult.error?.message || countResult.error?.message);
    }
    return NextResponse.json({
      data: directoryResult.data || [],
      meta: { page, pageSize, total: Number(countResult.data || 0) },
      error: null,
    });
  } catch (error) {
    console.error('[Admin Students] directory query failed:', error);
    const migrationResponse = adminMigrationUnavailable(error, ['0034_admin_student_directory.sql'], '学生目录依赖数据库迁移，当前环境尚未部署');
    if (migrationResponse) return migrationResponse;
    return NextResponse.json({ data: null, error: { code: 'ADMIN_STUDENT_DIRECTORY_FAILED', message: '获取学生目录失败' } }, { status: 500 });
  }
}
