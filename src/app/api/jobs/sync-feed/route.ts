import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getJobFeedState, runJobFeedSync, type JobFeedSyncMode } from '@/lib/job-feed-orchestrator';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.jobsWrite);
  if (permissionError) return permissionError;

  try {
    const body = await request.json().catch(() => ({})) as {
      mode?: JobFeedSyncMode;
      maxPages?: number;
    };
    if (body.mode && body.mode !== 'incremental' && body.mode !== 'reconcile') {
      return NextResponse.json({ error: 'mode 只能是 incremental 或 reconcile' }, { status: 400 });
    }
    if (body.maxPages !== undefined && (!Number.isInteger(body.maxPages) || body.maxPages < 1 || body.maxPages > 1000)) {
      return NextResponse.json({ error: 'maxPages 必须是 1 到 1000 之间的整数' }, { status: 400 });
    }
    const mode = body.mode || 'incremental';
    const maxPages = body.maxPages ?? (mode === 'reconcile' ? 100 : 20);
    const result = await runJobFeedSync({
      mode,
      maxPages,
    });
    await recordAdminAuditEvent({
      request,
      action: 'job_feed.sync',
      resourceType: 'job_feed',
      metadata: { mode, max_pages: maxPages, result },
    });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('Jobs feed sync failed:', error);
    await recordAdminAuditFailure({ request, action: 'job_feed.sync', resourceType: 'job_feed', error });
    return NextResponse.json({
      error: error instanceof Error ? error.message : '招聘数据同步失败',
    }, { status: 502 });
  }
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.jobsWrite);
  if (permissionError) return permissionError;
  try {
    const state = await getJobFeedState();
    return NextResponse.json({
      configured: Boolean(process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY),
      state,
      healthy: state.consecutive_failures === 0 && Boolean(state.last_incremental_success_at),
      description: '增量同步用于快速更新；完整对账用于确认消失或下架岗位。两种任务均逐页保存进度。',
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '读取同步状态失败',
    }, { status: 500 });
  }
}
