import { NextRequest, NextResponse } from 'next/server';
import { getCompanyFaviconUrl, getCompanyLogoUrl } from '@/lib/company-logo';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { sanitizeJobContent } from '@/lib/job-content';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { ExternalFetchError, fetchSafeExternalPage } from '@/lib/safe-external-fetch';
import { looksLikeClosedJobPage } from '@/lib/job-maintenance';
import { nextLinkFailureCount, shouldCloseAfterLinkFailure } from '@/lib/job-link-health';

// 本地 logo 缓存
let localLogosCache: Record<string, string> = {};
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 分钟

// 获取公司 logo URL（优先本地，fallback 到 Iconify Simple Icons）
async function getCompanyLogo(company: string, jobUrl?: string | null): Promise<string | null> {
  // 先检查缓存
  if (localLogosCache[company]) {
    return localLogosCache[company];
  }
  
  // 尝试从数据库获取本地 logo
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('company_logos')
      .select('logo_url')
      .eq('company_name', company)
      .single();
    
    if (data?.logo_url) {
      localLogosCache[company] = data.logo_url;
      return data.logo_url;
    }
  } catch (error) {
    // Ignore lookup failures and use the deterministic remote fallback.
  }
  
  return getCompanyLogoUrl(company, jobUrl);
}

// 刷新 logo 缓存
async function refreshLogoCache(): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase.from('company_logos').select('company_name, logo_url');
    
    if (data) {
      localLogosCache = {};
      for (const item of data) {
        localLogosCache[item.company_name] = item.logo_url;
      }
      lastCacheTime = Date.now();
    }
  } catch (error) {
    console.error('Error refreshing logo cache:', error);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getSupabaseClient();
    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: '岗位 ID 无效' }, { status: 400 });
    }

    const { data, error } = await client
      .from('jobs')
      .select('*, company_info:company_config(id, company_name, careers_page, logo_url, short_desc, full_desc, headquarters, industry)')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error) {
      return NextResponse.json(
        { error: '岗位不存在' },
        { status: 404 }
      );
    }

    // Feed data can become stale between list render and a user's click.
    // Recheck old links at the detail boundary before allowing auto-apply.
    let linkCheck: { status: number | null; checkedAt: string; stale: boolean } | null = null;
    if (data.source_system === 'collector_feed' && data.job_url) {
      const { data: syncRecord } = await client
        .from('job_sync_records')
        .select('last_link_checked_at,last_link_status,link_check_failures,availability_status,link_health')
        .eq('job_id', Number(id))
        .maybeSingle();
      const maxAgeHours = Math.min(Math.max(Number(process.env.JOBS_DETAIL_LINK_CHECK_MAX_AGE_HOURS) || 6, 1), 168);
      const lastCheckedAt = syncRecord?.last_link_checked_at ? Date.parse(syncRecord.last_link_checked_at) : NaN;
      const stale = !Number.isFinite(lastCheckedAt) || Date.now() - lastCheckedAt >= maxAgeHours * 3_600_000;
      if (stale) {
        const checkedAt = new Date().toISOString();
        try {
          const page = await fetchSafeExternalPage(data.job_url);
          if (looksLikeClosedJobPage(page.title, page.content)) {
            throw new ExternalFetchError('目标页面显示岗位已关闭', 422, 410);
          }
          await client
            .from('job_sync_records')
            .update({
              last_link_checked_at: checkedAt,
              last_link_status: page.httpStatus,
              last_link_http_status: page.httpStatus,
              link_check_failures: 0,
              last_link_error: null,
              availability_status: 'valid',
              link_health: 'healthy',
              availability_checked_at: checkedAt,
              updated_at: checkedAt,
            })
            .eq('job_id', Number(id));
          linkCheck = { status: page.httpStatus, checkedAt, stale: false };
        } catch (linkError) {
          const upstreamStatus = linkError instanceof ExternalFetchError ? linkError.upstreamStatus : undefined;
          const failures = nextLinkFailureCount(upstreamStatus, syncRecord?.link_check_failures);
          const isClosed = shouldCloseAfterLinkFailure({
            httpStatus: upstreamStatus,
            previousFailures: syncRecord?.link_check_failures,
          });
          const blocked = upstreamStatus === 401 || upstreamStatus === 403 || upstreamStatus === 429;
          const timeout = upstreamStatus === 408 || upstreamStatus === 524;
          await client
            .from('job_sync_records')
            .update({
              last_link_checked_at: checkedAt,
              last_link_status: upstreamStatus || null,
              last_link_http_status: upstreamStatus || null,
              link_check_failures: failures,
              last_link_error: linkError instanceof Error ? linkError.message.slice(0, 2_000) : String(linkError).slice(0, 2_000),
              availability_status: isClosed ? 'closed' : blocked ? 'blocked' : timeout ? 'timeout' : 'unknown',
              link_health: isClosed ? 'closed' : blocked ? 'blocked' : timeout ? 'timeout' : 'unknown',
              availability_checked_at: checkedAt,
              updated_at: checkedAt,
            })
            .eq('job_id', Number(id));
          if (isClosed) {
            await client
              .from('jobs')
              .update({ is_active: false, is_closed: true, updated_at: checkedAt })
              .eq('id', Number(id))
              .eq('is_active', true);
            return NextResponse.json({ error: '该岗位已下架或官网链接已失效', stale: true }, { status: 410 });
          }
          linkCheck = { status: upstreamStatus || null, checkedAt, stale: true };
        }
      }
    }

    // 检查是否需要刷新缓存
    if (Date.now() - lastCacheTime > CACHE_DURATION) {
      await refreshLogoCache();
    }

    // 获取 company logo
    const configuredLogo = data.company_info?.logo_url || null;
    const logo_url = configuredLogo || (data.company ? await getCompanyLogo(data.company, data.job_url) : null);
    const logo_fallback_url = data.company ? getCompanyFaviconUrl(data.company, data.job_url) : null;

    return NextResponse.json({
      job: sanitizeJobContent({
        ...data,
        logo_url,
        logo_fallback_url,
      }),
      linkCheck,
    });
  } catch (error) {
    console.error('Error fetching job:', error);
    return NextResponse.json(
      { error: '获取岗位详情失败' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.jobsWrite);
    if (permissionError) return permissionError;
    const client = getSupabaseClient();
    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: '岗位 ID 无效' }, { status: 400 });
    }
    const body = sanitizeJobContent(await request.json());
    const { data: beforeData } = await client.from('jobs').select('*').eq('id', id).maybeSingle();

    const { data, error } = await client
      .from('jobs')
      .update({
        ...body,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`更新岗位失败: ${error.message}`);
    }

    await recordAdminAuditEvent({
      request,
      action: 'job.update',
      resourceType: 'job',
      resourceId: id,
      beforeData,
      afterData: data,
    });

    return NextResponse.json({ job: data });
  } catch (error) {
    console.error('Error updating job:', error);
    await recordAdminAuditFailure({ request, action: 'job.update', resourceType: 'job', error });
    return NextResponse.json(
      { error: '更新岗位失败' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.jobsWrite);
    if (permissionError) return permissionError;
    const client = getSupabaseClient();
    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: '岗位 ID 无效' }, { status: 400 });
    }

    const { data: beforeData } = await client.from('jobs').select('id,title,company,region,direction,audience,is_active').eq('id', id).maybeSingle();

    // 先删除关联的 ai_matches 记录
    const aiMatchesDelete = await client
      .from('ai_matches')
      .delete()
      .eq('job_id', id);
    if (aiMatchesDelete.error) throw new Error(`删除 AI 匹配记录失败: ${aiMatchesDelete.error.message}`);

    // 先删除关联的 applications 记录
    const applicationsDelete = await client
      .from('applications')
      .delete()
      .eq('job_id', id);
    if (applicationsDelete.error) throw new Error(`删除网申记录失败: ${applicationsDelete.error.message}`);

    // 先删除关联的 application_fields 记录
    const fieldsDelete = await client
      .from('application_fields')
      .delete()
      .eq('job_id', id);
    if (fieldsDelete.error) throw new Error(`删除网申字段失败: ${fieldsDelete.error.message}`);

    // 最后删除岗位
    const { error } = await client
      .from('jobs')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`删除岗位失败: ${error.message}`);
    }

    await recordAdminAuditEvent({
      request,
      action: 'job.delete',
      resourceType: 'job',
      resourceId: id,
      beforeData,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting job:', error);
    await recordAdminAuditFailure({ request, action: 'job.delete', resourceType: 'job', error });
    return NextResponse.json(
      { error: '删除岗位失败' },
      { status: 500 }
    );
  }
}
