import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCompanyFaviconUrl, getCompanyLogoUrl } from '@/lib/company-logo';

interface CompanyOption {
  company_name: string;
  logo_url: string | null;
  fallback_logo_url: string | null;
  job_count: number;
}

let companiesCache: { expiresAt: number; companies: CompanyOption[] } | null = null;
const COMPANIES_CACHE_MS = 5 * 60 * 1000;

async function loadCompanies(): Promise<CompanyOption[]> {
  if (companiesCache && companiesCache.expiresAt > Date.now()) {
    return companiesCache.companies;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('list_active_company_options');
  if (error) throw new Error(`读取岗位品牌失败: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    company_name?: unknown;
    job_url?: unknown;
    job_count?: unknown;
    logo_url?: unknown;
  }>;
  const companies: CompanyOption[] = rows
    .map((row) => {
      const company = typeof row.company_name === 'string' ? row.company_name.trim() : '';
      const jobUrl = typeof row.job_url === 'string' ? row.job_url : null;
      return {
        company_name: company,
        logo_url: typeof row.logo_url === 'string' && row.logo_url ? row.logo_url : getCompanyLogoUrl(company, jobUrl),
        fallback_logo_url: getCompanyFaviconUrl(company, jobUrl),
        job_count: Number(row.job_count) || 0,
      };
    })
    .filter((company) => company.company_name);

  companiesCache = { expiresAt: Date.now() + COMPANIES_CACHE_MS, companies };
  return companies;
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
