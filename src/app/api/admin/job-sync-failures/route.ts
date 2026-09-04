import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const STATUSES = ['pending', 'processing', 'resolved', 'dead'] as const;
type FailureStatus = (typeof STATUSES)[number];

function isFailureStatus(value: string | null): value is FailureStatus {
  return STATUSES.includes(value as FailureStatus);
}

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.jobsRead);
  if (permissionError) return permissionError;

  const params = request.nextUrl.searchParams;
  const requestedStatus = params.get('status');
  if (requestedStatus && requestedStatus !== 'all' && !isFailureStatus(requestedStatus)) {
    return NextResponse.json({ data: null, error: { code: 'INVALID_STATUS', message: '失败队列状态无效' } }, { status: 400 });
  }
  const status = requestedStatus && requestedStatus !== 'all' ? requestedStatus : null;
  const limit = Math.min(positiveInteger(params.get('limit'), 100), 100);

  try {
    const client = getSupabaseClient();
    let query = client
      .from('job_sync_failures')
      .select('id,source_system,company,external_job_id,source_url,operation,payload,error_message,attempts,status,next_retry_at,first_failed_at,last_failed_at,resolved_at,created_at,updated_at', { count: 'exact' })
      .order('status', { ascending: true })
      .order('next_retry_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit);
    if (status) query = query.eq('status', status);

    const [{ data, error, count }, { data: summaryRows, error: summaryError }] = await Promise.all([
      query,
      client.from('job_sync_failures').select('status'),
    ]);
    if (error) throw new Error(error.message);
    if (summaryError) throw new Error(summaryError.message);

    const summary: Record<FailureStatus, number> = { pending: 0, processing: 0, resolved: 0, dead: 0 };
    for (const row of summaryRows || []) {
      if (isFailureStatus(row.status)) summary[row.status] += 1;
    }
    return NextResponse.json({ data: data || [], meta: { total: count || 0, limit, status: status || 'all' }, summary, error: null });
  } catch (error) {
    console.error('[Admin Job Sync Failures] query failed:', error);
    return NextResponse.json({ data: null, error: { code: 'JOB_SYNC_FAILURES_QUERY_FAILED', message: '获取岗位失败队列失败' } }, { status: 500 });
  }
}

/**
 * Move dead-letter rows back to the retry queue after an operator has fixed
 * the underlying source or database issue. Only dead rows are eligible so a
 * live worker cannot be interrupted by an admin action.
 */
export async function PATCH(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.jobsWrite);
  if (permissionError) return permissionError;

  try {
    const body = await request.json() as { id?: unknown; action?: unknown };
    const ids = Array.isArray(body.id) ? body.id : [body.id];
    const normalizedIds = [...new Set(ids.filter((value): value is number => Number.isInteger(value) && value > 0))];
    if (
      (body.action !== 'retry' && body.action !== 'requeue')
      || normalizedIds.length === 0
      || normalizedIds.length > 100
      || normalizedIds.length !== ids.length
    ) {
      return NextResponse.json({
        data: null,
        error: { code: 'INVALID_RETRY_REQUEST', message: '需要 dead 队列记录 ID 和 retry 操作，最多一次恢复 100 条' },
      }, { status: 400 });
    }

    const client = getSupabaseClient();
    const { data: currentRows, error: readError } = await client
      .from('job_sync_failures')
      .select('id,status')
      .in('id', normalizedIds);
    if (readError) throw new Error(readError.message);

    const deadIds = (currentRows || [])
      .filter((row) => row.status === 'dead')
      .map((row) => row.id as number);
    const skippedBeforeUpdate = normalizedIds.filter((id) => !deadIds.includes(id));

    let requeued: number[] = [];
    if (deadIds.length > 0) {
      const now = new Date().toISOString();
      const { data, error } = await client
        .from('job_sync_failures')
        .update({
          status: 'pending',
          attempts: 0,
          next_retry_at: now,
          processing_owner: null,
          processing_started_at: null,
          resolved_at: null,
          updated_at: now,
        })
        .in('id', deadIds)
        .eq('status', 'dead')
        .select('id');
      if (error) throw new Error(error.message);
      requeued = (data || []).map((row) => row.id as number);
    }
    const skipped = normalizedIds.filter((id) => !requeued.includes(id));

    await recordAdminAuditEvent({
      request,
      action: 'job_sync_failure.requeue',
      resourceType: 'job_sync_failure',
      resourceId: 'batch',
      metadata: { requested_ids: normalizedIds, requeued_ids: requeued, skipped_ids: skipped, skipped_before_update: skippedBeforeUpdate },
    });

    return NextResponse.json({
      data: { requeuedIds: requeued, skippedIds: skipped },
      error: null,
    });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: 'job_sync_failure.requeue', resourceType: 'job_sync_failure', error });
    console.error('[Admin Job Sync Failures] requeue failed:', error);
    return NextResponse.json({
      data: null,
      error: { code: 'JOB_SYNC_FAILURE_REQUEUE_FAILED', message: '恢复岗位失败队列失败' },
    }, { status: 500 });
  }
}
