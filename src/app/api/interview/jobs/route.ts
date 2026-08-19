import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { sanitizeJobContent } from '@/lib/job-content';
import { TARGET_REGION_KEYWORDS, targetRegionPostgrestClauses } from '@/lib/job-region-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const COMPANY_CACHE_TTL_MS = 300_000;
const JOBS_CACHE_TTL_MS = 300_000;
let companyCache: { expiresAt: number; companies: string[] } | null = null;
let companyCatalogInFlight: Promise<string[]> | null = null;
interface InterviewPickerJob {
  id: number;
  title: string;
  company: string;
}

const jobsCache = new Map<string, { expiresAt: number; jobs: InterviewPickerJob[] }>();
const jobsInFlight = new Map<string, Promise<InterviewPickerJob[]>>();

function interviewRegionPatterns(): string[] {
  return Object.values(TARGET_REGION_KEYWORDS).flat().map((keyword) => `%${keyword}%`);
}

async function loadCompanyCatalog(): Promise<string[]> {
  if (companyCatalogInFlight) return companyCatalogInFlight;
  companyCatalogInFlight = (async () => {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('get_interview_company_catalog', {
      p_region_patterns: interviewRegionPatterns(),
    });
    if (error) throw error;
    return (data || [])
      .map((row: { company: string | null }) => row.company?.trim() || '')
      .filter(Boolean);
  })();
  try {
    return await companyCatalogInFlight;
  } finally {
    companyCatalogInFlight = null;
  }
}

async function loadJobsForCompany(company: string): Promise<InterviewPickerJob[]> {
  const key = company.trim().toLocaleLowerCase();
  const cached = jobsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.jobs;
  const running = jobsInFlight.get(key);
  if (running) return running;
  const request = (async () => {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('jobs')
      // The picker only renders an id and title. The full JD is loaded by the
      // authoritative chat endpoint after the candidate has selected a job.
      .select('id, title, company')
      .eq('company', company)
      .eq('is_active', true)
      .or(targetRegionPostgrestClauses().join(','))
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    const jobs = (data || []).map((job) => ({
      id: job.id,
      title: sanitizeJobContent(job).title,
      company: job.company,
    }));
    jobsCache.set(key, { expiresAt: Date.now() + JOBS_CACHE_TTL_MS, jobs });
    return jobs;
  })();
  jobsInFlight.set(key, request);
  try {
    return await request;
  } finally {
    jobsInFlight.delete(key);
  }
}

// 获取可用于模拟面试的公司/岗位列表（岗位是公共数据，不依赖用户会话）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const company = searchParams.get('company');

    if (company) {
      const jobs = await loadJobsForCompany(company);
      return NextResponse.json(
        { jobs, cached: Boolean(jobsCache.get(company.trim().toLocaleLowerCase())) },
        { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' } },
      );
    }

    if (companyCache && companyCache.expiresAt > Date.now()) {
      return NextResponse.json({
        companies: companyCache.companies,
        count: companyCache.companies.length,
        total: companyCache.companies.length,
        appliedRegionFilter: true,
        hasMore: false,
        cached: true,
      }, { headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=600' } });
    }

    const sortedCompanies = await loadCompanyCatalog();
    companyCache = { companies: sortedCompanies, expiresAt: Date.now() + COMPANY_CACHE_TTL_MS };
    return NextResponse.json({
      companies: sortedCompanies,
      count: sortedCompanies.length,
      total: sortedCompanies.length,
      appliedRegionFilter: true,
      hasMore: false,
      cached: false,
    }, { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' } });
  } catch (error) {
    console.error('Interview jobs error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取岗位失败' },
      { status: 500 }
    );
  }
}
