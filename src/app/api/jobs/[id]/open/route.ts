import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ExternalFetchError, fetchSafeExternalPage } from '@/lib/safe-external-fetch';
import { looksLikeClosedJobPage } from '@/lib/job-maintenance';
import { nextLinkFailureCount, shouldCloseAfterLinkFailure } from '@/lib/job-link-health';
import { hasMatchingPhenomDetailPayload, isRegisteredPhenomJobUrl } from '@/lib/job-connectors';

const LINK_CHECK_MAX_AGE_MS = 30 * 60 * 1000;

function looksLikeBlockedPage(title: string, content: string): boolean {
  const sample = `${title} ${content.slice(0, 1_500)}`.replace(/\s+/g, ' ').toLowerCase();
  return /access denied|forbidden|captcha|verify you are human|unusual traffic|enable javascript|checking your browser|security verification|cloudflare/i.test(sample);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: '岗位 ID 无效' }, { status: 400 });

  const client = getSupabaseClient();
  const { data: job, error } = await client
    .from('jobs')
    .select('id,company,job_url,source_system,is_active')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: '读取岗位链接失败' }, { status: 500 });
  if (!job?.job_url) return NextResponse.json({ error: '该岗位没有可用官网链接' }, { status: 404 });

  let target: URL;
  try {
    target = new URL(job.job_url);
    if (target.protocol !== 'https:') throw new Error('invalid protocol');
  } catch {
    return NextResponse.json({ error: '岗位官网链接格式无效' }, { status: 422 });
  }

  if (job.source_system === 'collector_feed') {
    const { data: sync } = await client
      .from('job_sync_records')
      .select('last_link_checked_at,last_link_status,link_check_failures,availability_status,link_health')
      .eq('job_id', Number(id))
      .maybeSingle();
    const checkedAt = sync?.last_link_checked_at ? Date.parse(sync.last_link_checked_at) : NaN;
    const fresh = Number.isFinite(checkedAt) && Date.now() - checkedAt < LINK_CHECK_MAX_AGE_MS;
    const knownClosed = sync?.availability_status === 'closed' || sync?.link_health === 'closed';
    if (knownClosed && !job.is_active) {
      return NextResponse.json({ error: '该岗位已确认下架，已阻止打开失效链接' }, { status: 410 });
    }

    if (!fresh) {
      const checked = new Date().toISOString();
      try {
        const page = await fetchSafeExternalPage(target.toString());
        if (looksLikeClosedJobPage(page.title, page.content)
          && !isRegisteredPhenomJobUrl(job.company || '', job.job_url)
          && !hasMatchingPhenomDetailPayload(job.job_url, page.content)) {
          throw new ExternalFetchError('目标页面显示岗位已关闭', 422, 410);
        }
        const blocked = looksLikeBlockedPage(page.title, page.content);
        await client.from('job_sync_records').update({
          last_link_checked_at: checked,
          last_link_status: page.httpStatus,
          last_link_http_status: page.httpStatus,
          link_check_failures: 0,
          last_link_error: blocked ? '目标页面需要浏览器验证，暂不判定岗位状态' : null,
          availability_status: blocked ? 'blocked' : 'valid',
          link_health: blocked ? 'blocked' : 'healthy',
          availability_checked_at: checked,
          updated_at: checked,
        }).eq('job_id', Number(id));
      } catch (linkError) {
        const upstreamStatus = linkError instanceof ExternalFetchError ? linkError.upstreamStatus : undefined;
        const failures = nextLinkFailureCount(upstreamStatus, sync?.link_check_failures);
        const shouldClose = shouldCloseAfterLinkFailure({
          httpStatus: upstreamStatus,
          previousFailures: sync?.link_check_failures,
        });
        const blocked = upstreamStatus === 401 || upstreamStatus === 403 || upstreamStatus === 429;
        await client.from('job_sync_records').update({
          last_link_checked_at: checked,
          last_link_status: upstreamStatus || null,
          last_link_http_status: upstreamStatus || null,
          link_check_failures: failures,
          last_link_error: linkError instanceof Error ? linkError.message.slice(0, 2_000) : String(linkError).slice(0, 2_000),
          availability_status: shouldClose ? 'closed' : blocked ? 'blocked' : 'unknown',
          link_health: shouldClose ? 'closed' : blocked ? 'blocked' : 'unknown',
          availability_checked_at: checked,
          updated_at: checked,
        }).eq('job_id', Number(id));
        if (shouldClose) {
          await client.from('jobs').update({ is_active: false, is_closed: true, updated_at: checked }).eq('id', Number(id)).eq('is_active', true);
          return NextResponse.json({ error: '该岗位官网已确认下架，已阻止打开失效链接' }, { status: 410 });
        }
      }
    }
  }

  return NextResponse.redirect(target, { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
