import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getJobFeedState, isJobFeedSyncDisabled, runJobFeedSync, type JobFeedSyncMode } from '@/lib/job-feed-orchestrator';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.jobsWrite);
  if (permissionError) return permissionError;
  if (isJobFeedSyncDisabled()) {
    return NextResponse.json({ error: '岗位同步在当前环境已禁用' }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => ({})) as {
      mode?: JobFeedSyncMode;
      maxPages?: number;
      companyId?: string;
    };
    if (body.mode && body.mode !== 'incremental' && body.mode !== 'reconcile') {
      return NextResponse.json({ error: 'mode 只能是 incremental 或 reconcile' }, { status: 400 });
    }
    if (body.mode === 'reconcile') {
      return NextResponse.json({
        error: '完整对账不能从网站按钮启动。请在维护窗口由运维人员显式启用 JOBS_ALLOW_FULL_RECONCILE 后执行。',
      }, { status: 409 });
    }
    if (body.maxPages !== undefined && (!Number.isInteger(body.maxPages) || body.maxPages < 1 || body.maxPages > 100)) {
      return NextResponse.json({ error: '增量同步 maxPages 必须是 1 到 100 之间的整数' }, { status: 400 });
    }
    if (body.companyId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.companyId)) {
      return NextResponse.json({ error: 'companyId 格式无效' }, { status: 400 });
    }
    if (body.companyId && process.env.JOBS_FEED_COMPANY_FILTER_ENABLED !== 'true') {
      return NextResponse.json({ error: '上游尚未启用按公司安全过滤，不能从网站发起定向同步。' }, { status: 409 });
    }
    const mode = body.mode || 'incremental';
    // Keep manual synchronization bounded. The website endpoint intentionally
    // serves only the low-latency incremental path.
    const maxPages = body.maxPages ?? 10;
    const result = await runJobFeedSync({
      mode,
      maxPages,
      companyId: body.companyId?.trim() || undefined,
    });
    await recordAdminAuditEvent({
      request,
      action: 'job_feed.sync',
      resourceType: 'job_feed',
      metadata: { mode, max_pages: maxPages, company_id: body.companyId?.trim() || null, result },
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
  if (isJobFeedSyncDisabled()) {
    return NextResponse.json({
      configured: false,
      disabled: true,
      state: null,
      healthy: false,
      description: '当前环境已禁用岗位同步。',
    });
  }
  try {
    const state = await getJobFeedState();
    const updatedAt = Date.parse(state.updated_at);
    const catchingUp = Boolean(
      state.cursor
      && !state.last_error
      && Number.isFinite(updatedAt)
      && Date.now() - updatedAt < 20 * 60_000,
    );
    return NextResponse.json({
      configured: Boolean(process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY),
      state,
      catching_up: catchingUp,
      healthy: state.consecutive_failures === 0 && (Boolean(state.last_incremental_success_at) || catchingUp),
      description: catchingUp
        ? '正在从稳定增量游标追平历史变更；已写入的数据会立即可用。'
        : '增量同步用于快速更新和接收上游关闭事件；完整对账只允许在维护窗口人工执行，不会自动下架岗位。',
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '读取同步状态失败',
    }, { status: 500 });
  }
}
