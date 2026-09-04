import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { abortStaleJobFeedReconcile, runJobFeedSync } from '@/lib/job-feed-orchestrator';
import { runOfficialDetailsForCompany } from '@/lib/official-details-worker';
import { pauseHistoricalFieldReview, queueHistoricalFieldReview, runHistoricalFieldReviewCycle } from '@/lib/job-historical-field-review-worker';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const maxDuration = 300;

type Action = 'run_incremental' | 'run_company' | 'run_official_company' | 'retry_failures' | 'release_expired_lease' | 'abort_stale_reconcile' | 'start_historical_review' | 'pause_historical_review';

function isAction(value: unknown): value is Action {
  return ['run_incremental', 'run_company', 'run_official_company', 'retry_failures', 'release_expired_lease', 'abort_stale_reconcile', 'start_historical_review', 'pause_historical_review'].includes(String(value));
}

function safeCompany(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 255 ? normalized : null;
}

function boundedPages(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 30 ? parsed : 10;
}

export async function POST(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.jobSyncWrite);
  if (permissionError) return permissionError;

  let body: { action?: unknown; company?: unknown; maxPages?: unknown; ids?: unknown; sourceSystem?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ data: null, error: { code: 'INVALID_ACTION_BODY', message: '操作参数不是有效 JSON' } }, { status: 400 });
  }
  if (!isAction(body.action)) {
    return NextResponse.json({ data: null, error: { code: 'INVALID_ACTION', message: '不支持的同步操作' } }, { status: 400 });
  }

  const action = body.action;
  const company = safeCompany(body.company);
  const client = getSupabaseClient();
  try {
    if (action === 'run_incremental') {
      const maxPages = boundedPages(body.maxPages);
      const result = await runJobFeedSync({ mode: 'incremental', maxPages });
      await recordAdminAuditEvent({ request, action: 'job_sync_dashboard.run_incremental', resourceType: 'job_sync_run', metadata: { max_pages: maxPages, pages: result.pages, received: result.received, upserted: result.upserted, completed: result.completed } });
      return NextResponse.json({ data: { action, result }, error: null });
    }

    if (action === 'run_company') {
      if (!company) return NextResponse.json({ data: null, error: { code: 'COMPANY_REQUIRED', message: '定向同步需要公司名称' } }, { status: 400 });
      const { data: source, error } = await client.from('job_company_sources').select('company_name,upstream_company_id,is_active').ilike('company_name', company).maybeSingle();
      if (error) throw new Error(error.message);
      if (!source?.is_active) return NextResponse.json({ data: null, error: { code: 'COMPANY_NOT_ACTIVE', message: '公司不在活跃来源台账中' } }, { status: 404 });
      if (!source.upstream_company_id) return NextResponse.json({ data: null, error: { code: 'COMPANY_ID_MISSING', message: '该公司没有上游公司 ID，不能安全定向同步' } }, { status: 409 });
      if (process.env.JOBS_FEED_COMPANY_FILTER_ENABLED !== 'true') return NextResponse.json({ data: null, error: { code: 'COMPANY_FILTER_DISABLED', message: '上游未声明按公司过滤能力，已拒绝定向同步' } }, { status: 409 });
      const maxPages = boundedPages(body.maxPages);
      const result = await runJobFeedSync({ mode: 'incremental', maxPages, companyId: source.upstream_company_id });
      await recordAdminAuditEvent({ request, action: 'job_sync_dashboard.run_company', resourceType: 'job_company_source', resourceId: source.company_name, metadata: { company: source.company_name, company_id: source.upstream_company_id, max_pages: maxPages, pages: result.pages, received: result.received, upserted: result.upserted, completed: result.completed } });
      return NextResponse.json({ data: { action, company: source.company_name, result }, error: null });
    }

    if (action === 'run_official_company') {
      if (!company) return NextResponse.json({ data: null, error: { code: 'COMPANY_REQUIRED', message: '官方字段处理需要公司名称' } }, { status: 400 });
      const result = await runOfficialDetailsForCompany(company, { client });
      await recordAdminAuditEvent({ request, action: 'job_sync_dashboard.run_official_company', resourceType: 'job_company_source', resourceId: company, metadata: { company, result: { candidate_jobs: result?.candidate_jobs || 0, fetched: result?.fetched || 0, updated: result?.updated || 0, failed: result?.failed || 0 } } });
      return NextResponse.json({ data: { action, company, result }, error: null });
    }

    if (action === 'start_historical_review') {
      if (!company) return NextResponse.json({ data: null, error: { code: 'COMPANY_REQUIRED', message: '历史字段复核需要公司名称' } }, { status: 400 });
      await queueHistoricalFieldReview(company, { client: client, reset: true });
      const result = await runHistoricalFieldReviewCycle({ client });
      await recordAdminAuditEvent({ request, action: 'job_sync_dashboard.start_historical_review', resourceType: 'job_historical_field_review', resourceId: company, metadata: { company, result } });
      return NextResponse.json({ data: { action, company, result }, error: null });
    }

    if (action === 'pause_historical_review') {
      if (!company) return NextResponse.json({ data: null, error: { code: 'COMPANY_REQUIRED', message: '暂停历史字段复核需要公司名称' } }, { status: 400 });
      await pauseHistoricalFieldReview(company, client);
      await recordAdminAuditEvent({ request, action: 'job_sync_dashboard.pause_historical_review', resourceType: 'job_historical_field_review', resourceId: company, metadata: { company } });
      return NextResponse.json({ data: { action, company, paused: true }, error: null });
    }

    if (action === 'retry_failures') {
      const rawIds = Array.isArray(body.ids) ? body.ids : [];
      const ids = [...new Set(rawIds.filter((value): value is number => Number.isInteger(value) && value > 0))];
      if (!ids.length || ids.length > 100 || ids.length !== rawIds.length) return NextResponse.json({ data: null, error: { code: 'INVALID_FAILURE_IDS', message: '需要 1-100 个有效失败记录 ID' } }, { status: 400 });
      const { data: rows, error: readError } = await client.from('job_sync_failures').select('id,status').in('id', ids);
      if (readError) throw new Error(readError.message);
      const deadIds = (rows || []).filter((row) => row.status === 'dead').map((row) => row.id as number);
      const now = new Date().toISOString();
      const { data: changed, error: updateError } = deadIds.length ? await client.from('job_sync_failures').update({ status: 'pending', attempts: 0, next_retry_at: now, processing_owner: null, processing_started_at: null, resolved_at: null, updated_at: now }).in('id', deadIds).eq('status', 'dead').select('id') : { data: [], error: null };
      if (updateError) throw new Error(updateError.message);
      const requeuedIds = (changed || []).map((row) => row.id as number);
      await recordAdminAuditEvent({ request, action: 'job_sync_dashboard.retry_failures', resourceType: 'job_sync_failure', resourceId: 'batch', metadata: { requested_ids: ids, requeued_ids: requeuedIds } });
      return NextResponse.json({ data: { action, requeuedIds, skippedIds: ids.filter((id) => !requeuedIds.includes(id)) }, error: null });
    }

    if (action === 'release_expired_lease') {
      const sourceSystem = typeof body.sourceSystem === 'string' ? body.sourceSystem.trim() : '';
      if (!sourceSystem || sourceSystem.length > 80) return NextResponse.json({ data: null, error: { code: 'SOURCE_SYSTEM_REQUIRED', message: '需要明确的同步状态键' } }, { status: 400 });
      const { data: state, error: readError } = await client.from('job_sync_state').select('source_system,lease_expires_at,lease_owner').eq('source_system', sourceSystem).maybeSingle();
      if (readError) throw new Error(readError.message);
      if (!state) return NextResponse.json({ data: null, error: { code: 'LEASE_NOT_FOUND', message: '没有找到该同步状态' } }, { status: 404 });
      const expiresAt = state.lease_expires_at ? Date.parse(state.lease_expires_at) : NaN;
      if (Number.isFinite(expiresAt) && expiresAt > Date.now()) return NextResponse.json({ data: null, error: { code: 'LEASE_STILL_ACTIVE', message: '租约仍然有效，不能强制释放' } }, { status: 409 });
      const { error: updateError } = await client.from('job_sync_state').update({ lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq('source_system', sourceSystem).or('lease_expires_at.is.null,lease_expires_at.lte.' + new Date().toISOString());
      if (updateError) throw new Error(updateError.message);
      await recordAdminAuditEvent({ request, action: 'job_sync_dashboard.release_expired_lease', resourceType: 'job_sync_state', resourceId: sourceSystem, metadata: { source_system: sourceSystem, previous_lease_expires_at: state.lease_expires_at } });
      return NextResponse.json({ data: { action, sourceSystem, released: true }, error: null });
    }

    const aborted = await abortStaleJobFeedReconcile(client);
    await recordAdminAuditEvent({ request, action: 'job_sync_dashboard.abort_stale_reconcile', resourceType: 'job_sync_state', resourceId: 'collector_feed', metadata: { aborted } });
    return NextResponse.json({ data: { action, aborted }, error: null });
  } catch (error) {
    await recordAdminAuditFailure({ request, action: `job_sync_dashboard.${String(action)}`, resourceType: company || 'job_sync', resourceId: company, error });
    console.error('[Admin Job Sync Dashboard] action failed:', error);
    return NextResponse.json({ data: null, error: { code: 'JOB_SYNC_ACTION_FAILED', message: error instanceof Error ? error.message : '同步操作失败' } }, { status: 502 });
  }
}
