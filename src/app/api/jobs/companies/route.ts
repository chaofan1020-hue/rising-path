import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { resolveDisplayLogoUrls } from '@/lib/company-logo';
import { targetRegionPostgrestClauses } from '@/lib/job-region-scope';

interface CompanyOption {
  company_name: string;
  logo_url: string | null;
  fallback_logo_url: string | null;
  job_count: number;
}

// Company counts change slowly; the aggregate RPC still scans the target-region
// slice, so keep it cached longer and refresh stale entries in the background
// instead of making the filter dialog wait for it.
let companiesCache: { expiresAt: number; companies: CompanyOption[] } | null = null;
let companiesRefresh: Promise<CompanyOption[]> | null = null;
const COMPANIES_CACHE_MS = 15 * 60 * 1000;

async function fetchCompanies(): Promise<CompanyOption[]> {
  const supabase = getSupabaseClient();
  // Prefer the aggregate RPC. During a rolling deploy the function or its
  // target-region column may not exist yet, so fall back to the base jobs
  // table instead of turning the filter dialog into a 500 response.
  const rpcResult = await supabase.rpc('list_active_company_options');
  let rows: Array<{
    company_name?: unknown;
    job_url?: unknown;
    job_count?: unknown;
    logo_url?: unknown;
  }>;
  if (!rpcResult.error && Array.isArray(rpcResult.data) && rpcResult.data.length > 0) {
    rows = (rpcResult.data ?? []) as unknown as typeof rows;
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
      const company = typeof row.company === 'string' ? row.company.trim() : '';
      if (!company) continue;
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
    .map((row) => {
      const company = typeof row.company_name === 'string' ? row.company_name.trim() : '';
      const jobUrl = typeof row.job_url === 'string' ? row.job_url : null;
      const logos = resolveDisplayLogoUrls(
        company,
        jobUrl,
        typeof row.logo_url === 'string' && row.logo_url ? row.logo_url : null,
      );
      return {
        company_name: company,
        logo_url: logos.logo_url,
        fallback_logo_url: logos.logo_fallback_url,
        job_count: Number(row.job_count) || 0,
      };
    })
    .filter((company) => company.company_name);
}

function refreshCompaniesInBackground(): Promise<CompanyOption[]> {
  if (!companiesRefresh) {
    companiesRefresh = fetchCompanies()
      .then((companies) => {
        if (companies.length > 0) {
          companiesCache = { expiresAt: Date.now() + COMPANIES_CACHE_MS, companies };
        }
        return companies;
      })
      .finally(() => {
        companiesRefresh = null;
      });
  }
  return companiesRefresh;
}

async function loadCompanies(): Promise<CompanyOption[]> {
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

export async function GET() {
  try {
    const companies = await loadCompanies();
    return NextResponse.json(
      { companies, total: companies.length },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  } catch (error) {
    console.error('Error fetching job companies:', error);
    return NextResponse.json({ error: '获取品牌列表失败' }, { status: 500 });
  }
}
