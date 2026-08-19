import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';

const MAX_PAGE_SIZE = 100;
const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.jobsRead);
  if (permissionError) return permissionError;

  const params = request.nextUrl.searchParams;
  const page = positiveInteger(params.get('page'), 1);
  const pageSize = Math.min(positiveInteger(params.get('pageSize'), 20), MAX_PAGE_SIZE);
  const statusParam = params.get('status') || 'pending';
  const status = statusParam === 'all' ? null : REVIEW_STATUSES.includes(statusParam as typeof REVIEW_STATUSES[number]) ? statusParam : null;
  if (statusParam !== 'all' && !status) {
    return NextResponse.json({ data: null, error: { code: 'INVALID_SUBMISSION_STATUS', message: '投稿状态无效' } }, { status: 400 });
  }

  const search = params.get('search')?.trim().slice(0, 100) || null;
  try {
    const client = getSupabaseClient();
    let query = client
      .from('job_submissions')
      .select('id,title,company,region,direction,job_type,job_url,status,notes,submitted_at,reviewed_at,created_at', { count: 'exact' })
      .order('submitted_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (status) query = query.eq('status', status);
    if (search) query = query.or(`title.ilike.%${search}%,company.ilike.%${search}%`);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data || [], meta: { page, pageSize, total: count || 0 }, error: null });
  } catch (error) {
    console.error('[Admin Job Submissions] query failed:', error);
    return NextResponse.json({ data: null, error: { code: 'ADMIN_JOB_SUBMISSIONS_QUERY_FAILED', message: '获取岗位投稿失败' } }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.jobsWrite);
    if (permissionError) return permissionError;

    const supabase = getSupabaseClient();
    const body = await request.json();
    const { id, action, notes } = body;

    if (!Number.isInteger(id) || id <= 0 || (action !== 'approve' && action !== 'reject')) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const normalizedNotes = typeof notes === 'string' ? notes.trim().slice(0, 2_000) || null : null;
    const { data: reviewResult, error: reviewError } = await supabase.rpc('review_job_submission', {
      p_submission_id: id,
      p_action: action,
      p_notes: normalizedNotes,
    });
    if (reviewError) throw new Error(reviewError.message);
    const result = Array.isArray(reviewResult) ? reviewResult[0] : reviewResult;
    if (!result) throw new Error('岗位投稿审核未返回结果');

    await recordAdminAuditEvent({
      request,
      action: action === 'approve' ? 'job_submission.approve' : 'job_submission.reject',
      resourceType: 'job_submission',
      resourceId: id,
      metadata: { status: result.submission_status, job_id: result.job_id, has_notes: Boolean(normalizedNotes) },
    });

    return NextResponse.json({ 
      success: true, 
      message: action === 'approve' ? '已批准并添加到岗位列表' : '已拒绝',
      jobId: result.job_id,
    });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'job_submission.review', resourceType: 'job_submission', error });
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.jobsWrite);
    if (permissionError) return permissionError;

    const supabase = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const { error: deleteError } = await supabase
      .from('job_submissions')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return NextResponse.json({ error: '删除失败' }, { status: 500 });
    }

    await recordAdminAuditEvent({ request, action: 'job_submission.delete', resourceType: 'job_submission', resourceId: id });

    return NextResponse.json({ success: true });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'job_submission.delete', resourceType: 'job_submission', error });
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
