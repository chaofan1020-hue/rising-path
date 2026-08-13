import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { sanitizeJobContent } from '@/lib/job-content';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';

// 本地 logo 缓存
let localLogosCache: Record<string, string> = {};
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 分钟

// 公司域名映射
const companyDomains: Record<string, string> = {
  'Stripe': 'stripe.com',
  'Airbnb': 'airbnb.com',
  'Uber': 'uber.com',
  'Lyft': 'lyft.com',
  'DoorDash': 'doordash.com',
  'Dropbox': 'dropbox.com',
  'Coinbase': 'coinbase.com',
  'Robinhood': 'robinhood.com',
  'Figma': 'figma.com',
  'Notion': 'notion.so',
  'Palantir': 'palantir.com',
  'Databricks': 'databricks.com',
  'Snowflake': 'snowflake.com',
  'Twilio': 'twilio.com',
  'Zoom': 'zoom.us',
  'Atlassian': 'atlassian.com',
  'Confluent': 'confluent.io',
  'MongoDB': 'mongodb.com',
  'Cloudflare': 'cloudflare.com',
  'Rubrik': 'rubrik.com',
  'Scale AI': 'scale.com',
  'OpenAI': 'openai.com',
  'Anthropic': 'anthropic.com',
  'Instacart': 'instacart.com',
  'Discord': 'discord.com',
  'Plaid': 'plaid.com',
  'Brex': 'brex.com',
  'Datadog': 'datadoghq.com',
  'GitLab': 'gitlab.com',
  'Google': 'google.com',
  'Meta': 'meta.com',
  'Apple': 'apple.com',
  'Microsoft': 'microsoft.com',
  'Amazon': 'amazon.com',
  'Netflix': 'netflix.com',
  'Tesla': 'tesla.com',
  'NVIDIA': 'nvidia.com',
  'Adobe': 'adobe.com',
  'Oracle': 'oracle.com',
  'Salesforce': 'salesforce.com',
  'Snap': 'snap.com',
  'Pinterest': 'pinterest.com',
  'LinkedIn': 'linkedin.com',
};

// 获取公司 logo URL（优先本地，fallback 到 Clearbit）
async function getCompanyLogo(company: string): Promise<string | null> {
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
    // 忽略错误，继续使用 Clearbit
  }
  
  // 使用 Clearbit API
  const domain = companyDomains[company];
  if (domain) {
    return `https://logo.clearbit.com/${domain}`;
  }
  const cleanName = company.toLowerCase().replace(/\s+/g, '');
  return `https://logo.clearbit.com/${cleanName}.com`;
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

    // 检查是否需要刷新缓存
    if (Date.now() - lastCacheTime > CACHE_DURATION) {
      await refreshLogoCache();
    }

    // 获取 company logo
    const logo_url = data.company ? await getCompanyLogo(data.company) : null;

    return NextResponse.json({
      job: sanitizeJobContent({
        ...data,
        logo_url,
      }),
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
