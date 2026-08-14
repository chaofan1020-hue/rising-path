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
  const companyJobs = new Map<string, { jobCount: number; jobUrl: string | null }>();
  const pageSize = 1000;

  // Supabase limits an unbounded response. Aggregate in pages so a growing
  // jobs table does not silently omit brands from the filter list.
  for (let offset = 0; offset < 100_000; offset += pageSize) {
    const { data, error } = await supabase
      .from('jobs')
      .select('company,job_url')
      .eq('is_active', true)
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`读取岗位品牌失败: ${error.message}`);
    for (const job of data || []) {
      const company = typeof job.company === 'string' ? job.company.trim() : '';
      if (!company) continue;
      const current = companyJobs.get(company);
      if (current) {
        current.jobCount += 1;
        if (!current.jobUrl && typeof job.job_url === 'string') current.jobUrl = job.job_url;
      } else {
        companyJobs.set(company, {
          jobCount: 1,
          jobUrl: typeof job.job_url === 'string' ? job.job_url : null,
        });
      }
    }
    if (!data || data.length < pageSize) break;
  }

  const [{ data: logos, error: logoError }, { data: configured, error: configError }] = await Promise.all([
    supabase.from('company_logos').select('company_name,logo_url'),
    supabase.from('company_config').select('company_name,logo_url'),
  ]);
  if (logoError) throw new Error(`读取品牌 logo 失败: ${logoError.message}`);
  if (configError) throw new Error(`读取品牌配置失败: ${configError.message}`);

  const uploadedLogos = new Map((logos || []).map((row) => [row.company_name, row.logo_url]));
  const configuredLogos = new Map((configured || []).map((row) => [row.company_name, row.logo_url]));
  const companies = [...companyJobs.entries()]
    .map(([company, details]) => ({
      company_name: company,
      logo_url: uploadedLogos.get(company) || configuredLogos.get(company) || getCompanyLogoUrl(company, details.jobUrl),
      fallback_logo_url: getCompanyFaviconUrl(company, details.jobUrl),
      job_count: details.jobCount,
    }))
    .sort((a, b) => b.job_count - a.job_count || a.company_name.localeCompare(b.company_name));

  companiesCache = { expiresAt: Date.now() + COMPANIES_CACHE_MS, companies };
  return companies;
}

export async function GET() {
  try {
    const companies = await loadCompanies();
    return NextResponse.json({ companies, total: companies.length });
  } catch (error) {
    console.error('Error fetching job companies:', error);
    return NextResponse.json({ error: '获取品牌列表失败' }, { status: 500 });
  }
}
