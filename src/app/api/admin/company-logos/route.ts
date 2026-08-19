import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { loadStorageSkill } from '@/lib/storage-utils';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { recordAdminAuditEvent, recordAdminAuditFailure } from '@/lib/admin-audit';
import { getCompanyFaviconUrl, getCompanyLogoUrl } from '@/lib/company-logo';

interface CompanyLogoCatalogRow {
  id: number | null;
  company_name: string;
  logo_url: string | null;
  fallback_logo_url: string | null;
  source: 'uploaded' | 'imported' | 'configured' | 'automatic';
  job_count: number;
  updated_at: string | null;
}

let catalogCache: { expiresAt: number; logos: CompanyLogoCatalogRow[] } | null = null;
const CATALOG_CACHE_MS = 30_000;

function invalidateCatalogCache() {
  catalogCache = null;
}

async function loadCompanyLogoCatalog(): Promise<CompanyLogoCatalogRow[]> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.logos;

  const supabase = getSupabaseClient();
  const [{ data: uploadedLogos, error: uploadedError }, { data: configuredCompanies, error: configuredError }] = await Promise.all([
    supabase.from('company_logos').select('id, company_name, logo_url, updated_at').order('company_name'),
    supabase.from('company_config').select('id, company_name, logo_url, updated_at').order('company_name'),
  ]);

  if (uploadedError) throw new Error(`读取已上传 logo 失败: ${uploadedError.message}`);
  if (configuredError) throw new Error(`读取企业配置失败: ${configuredError.message}`);

  const companyJobs = new Map<string, { jobUrl: string | null; jobCount: number }>();
  const pageSize = 1000;
  for (let offset = 0; offset < 50_000; offset += pageSize) {
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select('company, job_url')
      .eq('is_active', true)
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`读取岗位公司失败: ${error.message}`);
    for (const job of jobs || []) {
      const companyName = typeof job.company === 'string' ? job.company.trim() : '';
      if (!companyName) continue;
      const current = companyJobs.get(companyName);
      if (current) {
        current.jobCount += 1;
        if (!current.jobUrl && typeof job.job_url === 'string') current.jobUrl = job.job_url;
      } else {
        companyJobs.set(companyName, {
          jobUrl: typeof job.job_url === 'string' ? job.job_url : null,
          jobCount: 1,
        });
      }
    }
    if (!jobs || jobs.length < pageSize) break;
  }

  const uploadedByCompany = new Map((uploadedLogos || []).map((logo) => [logo.company_name, logo]));
  const configuredByCompany = new Map((configuredCompanies || []).map((company) => [company.company_name, company]));
  const companyNames = new Set([
    ...companyJobs.keys(),
    ...uploadedByCompany.keys(),
    ...configuredByCompany.keys(),
  ]);

  const logos = [...companyNames]
    .sort((a, b) => a.localeCompare(b))
    .map((companyName): CompanyLogoCatalogRow => {
      const uploaded = uploadedByCompany.get(companyName);
      const configured = configuredByCompany.get(companyName);
      const job = companyJobs.get(companyName);
      const configuredLogo = typeof configured?.logo_url === 'string' && configured.logo_url.trim()
        ? configured.logo_url.trim()
        : null;
      const logoUrl = uploaded?.logo_url || configuredLogo || getCompanyLogoUrl(companyName, job?.jobUrl);
      const source: CompanyLogoCatalogRow['source'] = uploaded?.logo_url
        ? uploaded.logo_url.includes('/logos/imported/') ? 'imported' : 'uploaded'
        : configuredLogo
          ? 'configured'
          : 'automatic';

      return {
        id: uploaded?.id || configured?.id || null,
        company_name: companyName,
        logo_url: logoUrl,
        fallback_logo_url: getCompanyFaviconUrl(companyName, job?.jobUrl),
        source,
        job_count: job?.jobCount || 0,
        updated_at: uploaded?.updated_at || configured?.updated_at || null,
      };
    });

  catalogCache = { expiresAt: Date.now() + CATALOG_CACHE_MS, logos };
  return logos;
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.configWrite);
  if (permissionError) return permissionError;

  try {
    const logos = await loadCompanyLogoCatalog();
    return NextResponse.json({ logos, total: logos.length });
  } catch (error) {
    console.error('Error fetching logos:', error);
    return NextResponse.json({ error: '获取 logo 列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.configWrite);
  if (permissionError) return permissionError;

  try {
    const supabase = getSupabaseClient();
    const formData = await request.formData();
    
    const companyName = formData.get('company_name') as string;
    const logoFile = formData.get('logo') as File;
    
    if (!companyName) {
      return NextResponse.json({ error: '公司名称不能为空' }, { status: 400 });
    }
    
    if (!logoFile) {
      return NextResponse.json({ error: '请选择 logo 文件' }, { status: 400 });
    }
    
    // 验证文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (!allowedTypes.includes(logoFile.type)) {
      return NextResponse.json({ error: '只支持 JPG、PNG、GIF、WebP 格式' }, { status: 400 });
    }
    
    // 验证文件大小（最大 500KB）
    if (logoFile.size > 500 * 1024) {
      return NextResponse.json({ error: 'Logo 文件不能超过 500KB' }, { status: 400 });
    }
    
    // 上传到存储
    const storageUtils = await loadStorageSkill();
    const fileName = `logos/${companyName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}.${logoFile.name.split('.').pop()}`;
    const logoUrl = await storageUtils.uploadFile(logoFile, fileName);
    
    if (!logoUrl) {
      return NextResponse.json({ error: '上传失败' }, { status: 500 });
    }
    
    // 保存到数据库
    const { data, error } = await supabase
      .from('company_logos')
      .upsert({
        company_name: companyName,
        logo_url: logoUrl,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    invalidateCatalogCache();

    await recordAdminAuditEvent({
      request,
      action: 'company_logo.upsert',
      resourceType: 'company_logo',
      resourceId: companyName,
      metadata: { company_name: companyName, file_size: logoFile.size, content_type: logoFile.type },
    });
    
    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error uploading logo:', error);
    await recordAdminAuditFailure({ request, action: 'company_logo.upsert', resourceType: 'company_logo', error });
    return NextResponse.json({ error: '上传失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.configWrite);
  if (permissionError) return permissionError;

  try {
    const supabase = getSupabaseClient();
    const searchParams = request.nextUrl.searchParams;
    const companyName = searchParams.get('company_name');
    
    if (!companyName) {
      return NextResponse.json({ error: '公司名称不能为空' }, { status: 400 });
    }
    
    const { error } = await supabase
      .from('company_logos')
      .delete()
      .eq('company_name', companyName);
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    invalidateCatalogCache();

    await recordAdminAuditEvent({
      request,
      action: 'company_logo.delete',
      resourceType: 'company_logo',
      resourceId: companyName,
    });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting logo:', error);
    await recordAdminAuditFailure({ request, action: 'company_logo.delete', resourceType: 'company_logo', error });
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
