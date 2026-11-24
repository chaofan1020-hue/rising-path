import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { resolveDisplayLogoUrls } from '@/lib/company-logo';
import { targetRegionPostgrestClauses } from '@/lib/job-region-scope';
import { requireJobAccess } from '@/lib/job-access';

interface ActiveCompany {
  companyName: string;
  jobUrl: string | null;
  jobCount: number;
}

// Company counts change slowly; the aggregate RPC still scans the target-region
// slice, so keep it cached longer and refresh stale entries in the background
// instead of making the filter dialog wait for it.
let companiesCache: { expiresAt: number; companies: ActiveCompany[] } | null = null;
let companiesRefresh: Promise<ActiveCompany[]> | null = null;
const COMPANIES_CACHE_MS = 15 * 60 * 1000;

async function fetchCompanies(): Promise<ActiveCompany[]> {
  const supabase = getSupabaseClient();
  // Prefer the aggregate RPC. During a rolling deploy the function or its
  // target-region column may not exist yet, so fall back to the base jobs
  // table instead of turning the filter dialog into a 500 response.
  const rpcResult = await supabase.rpc('list_active_company_options');
  let rows: Array<{
    company_name?: unknown;
    job_url?: unknown;
    job_count?: unknown;
  }>;
  if (!rpcResult.error && Array.isArray(rpcResult.data)) {
    rows = rpcResult.data;
  } else {
    const fallbackResult = await supabase
      .from('jobs')
      .select('company,job_url')
      .eq('is_active', true)
      .or(targetRegionPostgrestClauses().join(','))
      .order('company', { ascending: true })
      .limit(10000);
    if (fallbackResult.error) {
      throw new Error(`读取岗位品牌失败: ${rpcResult.error?.message || 'RPC returned no rows'}; fallback: ${fallbackResult.error.message}`);
    }

    const counts = new Map<string, { jobUrl: string | null; count: number }>();
    for (const row of (fallbackResult.data ?? []) as Array<{ company?: unknown; job_url?: unknown }>) {
      const company = typeof row.company === 'string' ? row.company : '';
      if (!company.trim()) continue;
      const current = counts.get(company) || { jobUrl: null, count: 0 };
      current.count += 1;
      if (!current.jobUrl && typeof row.job_url === 'string') current.jobUrl = row.job_url;
      counts.set(company, current);
    }
    rows = [...counts.entries()].map(([company_name, value]) => ({
      company_name,
      job_url: value.jobUrl,
      job_count: value.count,
    }));
  }

  return rows
    .map((row) => ({
      companyName: typeof row.company_name === 'string' ? row.company_name : '',
      jobUrl: typeof row.job_url === 'string' ? row.job_url : null,
      jobCount: Number(row.job_count) || 0,
    }))
    .filter((company) => company.companyName.trim());
}

async function fetchLogoUrls(table: 'company_logos' | 'company_config'): Promise<Map<string, string>> {
  const supabase = getSupabaseClient();
  const logoUrls = new Map<string, string>();
  const pageSize = 500;

  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from(table).select('company_name,logo_url').not('logo_url', 'is', null);
    if (table === 'company_config') query = query.eq('is_active', true);
    const { data, error } = await query.order('id').range(offset, offset + pageSize - 1);
    if (error) throw new Error(`读取企业 Logo 失败 (${table}): ${error.message}`);

    for (const { company_name, logo_url } of data) {
      const logoUrl = typeof logo_url === 'string' ? logo_url.trim() : '';
      if (logoUrl) logoUrls.set(company_name, logoUrl);
    }
    if (data.length < pageSize) return logoUrls;
  }
}

function refreshCompaniesInBackground(): Promise<ActiveCompany[]> {
  if (!companiesRefresh) {
    companiesRefresh = fetchCompanies()
      .then((companies) => {
        companiesCache = { expiresAt: Date.now() + COMPANIES_CACHE_MS, companies };
        return companies;
      })
      .finally(() => {
        companiesRefresh = null;
      });
  }
  return companiesRefresh;
}

async function loadCompanies(): Promise<ActiveCompany[]> {
  if (companiesCache && companiesCache.expiresAt > Date.now()) {
    return companiesCache.companies;
  }
  if (companiesCache) {
    // Serve the previous list immediately and refresh in the background.
    void refreshCompaniesInBackground().catch((error) => {
      console.error('Failed to refresh job company options:', error);
    });
    return companiesCache.companies;
  }
  return refreshCompaniesInBackground();
}

export async function GET(request: Request) {
  try {
    // 公司清单带岗位数量，同属岗位数据，未登录访客不返回
    const denied = await requireJobAccess(request);
    if (denied) return denied;
    const [activeCompanies, uploadedLogos, configuredLogos] = await Promise.all([
      loadCompanies(),
      fetchLogoUrls('company_logos'),
      fetchLogoUrls('company_config'),
    ]);
    const companies = activeCompanies.map(({ companyName, jobUrl, jobCount }) => {
      const storedLogo = uploadedLogos.get(companyName) ?? configuredLogos.get(companyName);
      const logos = resolveDisplayLogoUrls(companyName.trim(), jobUrl, storedLogo);
      return {
        company_name: companyName.trim(),
        logo_url: logos.logo_url,
        fallback_logo_url: logos.logo_fallback_url,
        job_count: jobCount,
      };
    });
    const payload = { companies, total: companies.length };
    const version = `"${createHash('sha256').update(JSON.stringify(payload)).digest('base64url')}"`;
    const headers = { 'Cache-Control': 'private, no-cache', ETag: `W/${version}` };
    const requestedVersions = request.headers.get('If-None-Match')?.split(',') ?? [];
    if (requestedVersions.some((tag) => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === version)) {
      return new NextResponse(null, { status: 304, headers });
    }
    return NextResponse.json(payload, { headers });
  } catch (error) {
    console.error('Error fetching job companies:', error);
    return NextResponse.json({ error: '获取品牌列表失败' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
