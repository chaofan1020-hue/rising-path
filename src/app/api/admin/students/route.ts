import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { adminMigrationUnavailable } from '@/lib/admin-dependency-status';
import { isValidEmail } from '@/lib/auth-shared';
import { normalizeEmail } from '@/lib/auth-security';
import { studentPublicCode } from '@/lib/admin-student-identity';

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
  const permissionError = await requireAdminPermission(request, ADMIN_PERMISSIONS.usersRead);
  if (permissionError) return permissionError;

  const params = request.nextUrl.searchParams;
  const page = positiveInteger(params.get('page'), 1);
  const pageSize = Math.min(positiveInteger(params.get('pageSize'), 25), MAX_PAGE_SIZE);
  const rawSearch = cleanSearch(params.get('search'));
  const sort = params.get('sort') || 'recent_activity';
  if (!SORT_OPTIONS.includes(sort as typeof SORT_OPTIONS[number])) {
    return NextResponse.json({ data: null, error: { code: 'INVALID_SORT', message: '排序方式无效' } }, { status: 400 });
  }

  try {
    const client = getSupabaseClient();
    let emailUserId: string | null = null;
    let search = rawSearch;
    if (rawSearch && isValidEmail(normalizeEmail(rawSearch))) {
      const { data, error } = await client.rpc('find_auth_user_id_by_email', { p_email: normalizeEmail(rawSearch) });
      if (error) {
        const migrationResponse = adminMigrationUnavailable(error, ['0121_admin_sessions.sql'], '按邮箱搜索依赖数据库迁移，当前环境尚未部署');
        if (migrationResponse) return migrationResponse;
        throw new Error(error.message);
      }
      emailUserId = typeof data === 'string' ? data : null;
      search = null;
      if (!emailUserId) {
        return NextResponse.json({ data: [], meta: { page, pageSize, total: 0 }, error: null });
      }
    }

    const directoryArgs = {
      p_search: search,
      p_sort: sort,
      p_page: page,
      p_page_size: pageSize,
      p_email_user_id: emailUserId,
    };
    let directoryResult = await client.rpc('get_admin_student_directory_v3', directoryArgs);
    let countResult = await client.rpc('get_admin_student_directory_v3_count', {
      p_search: search,
      p_email_user_id: emailUserId,
    });

    if (directoryResult.error || countResult.error) {
      directoryResult = await client.rpc('get_admin_student_directory_v2', directoryArgs);
      countResult = await client.rpc('get_admin_student_directory_v2_count', {
        p_search: search,
        p_email_user_id: emailUserId,
      });
    }

    if (directoryResult.error || countResult.error) {
      directoryResult = await client.rpc('get_admin_student_directory', {
        p_search: search || (emailUserId || null),
        p_sort: sort,
        p_page: page,
        p_page_size: pageSize,
      });
      countResult = await client.rpc('get_admin_student_directory_count', { p_search: search || (emailUserId || null) });
    }

    if (directoryResult.error || countResult.error) {
      throw new Error(directoryResult.error?.message || countResult.error?.message);
    }

    const rows = (directoryResult.data || []).map((row: Record<string, unknown>) => ({
      ...row,
      public_code: row.public_code || (typeof row.user_id === 'string' ? studentPublicCode(row.user_id) : null),
      display_name: row.display_name === '未命名用户' ? '未设置姓名' : row.display_name,
    }));

    return NextResponse.json({
      data: rows,
      meta: { page, pageSize, total: Number(countResult.data || 0) },
      error: null,
    });
  } catch (error) {
    console.error('[Admin Students] directory query failed:', error);
    const migrationResponse = adminMigrationUnavailable(error, ['0034_admin_student_directory.sql', '0122_admin_student_identity.sql', '0123_admin_student_email_identity.sql'], '学生目录依赖数据库迁移，当前环境尚未部署');
    if (migrationResponse) return migrationResponse;
    return NextResponse.json({ data: null, error: { code: 'ADMIN_STUDENT_DIRECTORY_FAILED', message: '获取学生目录失败' } }, { status: 500 });
  }
}
