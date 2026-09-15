import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAGE_SIZE = 50;

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const permissionError = await requireAdminPermission(request, ADMIN_PERMISSIONS.usersRead);
  if (permissionError) return permissionError;

  const { id: userId } = await params;
  if (!UUID_PATTERN.test(userId)) {
    return NextResponse.json({ data: null, error: { code: 'INVALID_STUDENT_ID', message: '学生 ID 无效' } }, { status: 400 });
  }

  const page = positiveInteger(request.nextUrl.searchParams.get('page'), 1);
  const pageSize = Math.min(positiveInteger(request.nextUrl.searchParams.get('pageSize'), 20), MAX_PAGE_SIZE);

  try {
    const { data, error, count } = await getSupabaseClient()
      .from('interview_sessions')
      .select('id, interview_type, target_company, mode, total_rounds, current_round, status, report_grade, overall_score, created_at, updated_at', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (error) throw new Error(error.message);

    return NextResponse.json({
      data: data || [],
      meta: { page, pageSize, total: count || 0 },
      error: null,
    });
  } catch (error) {
    console.error('[Admin Student Interviews] query failed:', error);
    return NextResponse.json(
      { data: null, error: { code: 'ADMIN_STUDENT_INTERVIEWS_FAILED', message: '获取学员面试记录失败' } },
      { status: 500 },
    );
  }
}
