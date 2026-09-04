import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { isTrustedJobFieldSource } from '@/lib/job-field-provenance';
import { JOB_COMPANY_FIELD_RULES } from '@/lib/job-company-field-rules';

export const dynamic = 'force-dynamic';

type FieldRow = {
  company: string;
  valid_through: string | null;
  salary_range: string | null;
  region: string | null;
  deadline_source: string | null;
  salary_source: string | null;
  location_source: string | null;
  field_evidence: { fields?: Record<string, { status?: string }> } | null;
  updated_at: string | null;
};
type RemoteCompany = { id: string; name: string };

function sourceBase(): string | null {
  const source = process.env.JOBS_FEED_URL;
  if (!source) return null;
  const endpoint = new URL(source);
  endpoint.pathname = endpoint.pathname.replace(/\/integrations\/v1\/jobs\/?$/, '');
  endpoint.search = '';
  return endpoint.toString().replace(/\/$/, '');
}

async function remoteCompanyIds(): Promise<Map<string, string>> {
  const base = sourceBase();
  const key = process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY;
  if (!base || !key) return new Map();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${base}/dashboard/company-directory`, {
      headers: { Accept: 'application/json', 'X-Integration-Key': key }, cache: 'no-store', signal: controller.signal,
    });
    if (!response.ok) return new Map();
    const rows = await response.json() as RemoteCompany[];
    return new Map(rows.map((row) => [row.name.trim().toLowerCase(), row.id]));
  } catch {
    return new Map();
  } finally {
    clearTimeout(timeout);
  }
}

function statusFor(row: FieldRow, name: 'deadline' | 'salary' | 'location'): string | null {
  return row.field_evidence?.fields?.[name]?.status || null;
}

export async function GET(request: NextRequest) {
  const permissionError = requireAdminPermission(request, ADMIN_PERMISSIONS.dashboardRead);
  if (permissionError) return permissionError;

  try {
    const client = getSupabaseClient();
    const remoteIds = await remoteCompanyIds();
    const rows: FieldRow[] = [];
    const pageSize = 1_000;
    for (let offset = 0; offset < 50_000; offset += pageSize) {
      const { data, error } = await client
        .from('jobs')
        .select('company,valid_through,salary_range,region,deadline_source,salary_source,location_source,field_evidence,updated_at')
        .eq('source_system', 'collector_feed')
        .eq('is_active', true)
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(error.message);
      rows.push(...((data || []) as FieldRow[]));
      if (!data || data.length < pageSize) break;
    }

    const companies = new Map<string, {
      company: string; total: number; verifiedDeadline: number; verifiedSalary: number; verifiedLocation: number;
      pending: number; rejected: number; invalidDeadline: number; latestVerifiedAt: string | null;
    }>();
    for (const row of rows) {
      const key = row.company || '未注明公司';
      const item = companies.get(key) || {
        company: key, total: 0, verifiedDeadline: 0, verifiedSalary: 0, verifiedLocation: 0,
        pending: 0, rejected: 0, invalidDeadline: 0, latestVerifiedAt: null,
      };
      item.total += 1;
      const deadlineVerified = Boolean(row.valid_through && isTrustedJobFieldSource(row.deadline_source));
      const salaryVerified = Boolean(row.salary_range && isTrustedJobFieldSource(row.salary_source));
      const locationVerified = Boolean(row.region && isTrustedJobFieldSource(row.location_source));
      if (deadlineVerified) item.verifiedDeadline += 1;
      if (salaryVerified) item.verifiedSalary += 1;
      if (locationVerified) item.verifiedLocation += 1;
      for (const name of ['deadline', 'salary', 'location'] as const) {
        const state = statusFor(row, name);
        const source = name === 'deadline' ? row.deadline_source : name === 'salary' ? row.salary_source : row.location_source;
        if (state === 'rejected_legacy') item.rejected += 1;
        if (state === 'pending_recheck' || (!state && !isTrustedJobFieldSource(source))) item.pending += 1;
      }
      if (row.valid_through && Date.parse(row.valid_through) < Date.UTC(2024, 0, 1)) item.invalidDeadline += 1;
      if (row.updated_at && (!item.latestVerifiedAt || Date.parse(row.updated_at) > Date.parse(item.latestVerifiedAt))) item.latestVerifiedAt = row.updated_at;
      companies.set(key, item);
    }

    const rules = new Map(JOB_COMPANY_FIELD_RULES.map((rule) => [rule.company.toLowerCase(), rule]));
    const payload = [...companies.values()].map((item) => {
      const missing = item.total * 3 - item.verifiedDeadline - item.verifiedSalary - item.verifiedLocation;
      const priorityScore = item.total * 3 + missing * 2 + item.pending * 2 + item.rejected * 5 + item.invalidDeadline * 10;
      return {
        ...item,
        coverage: {
          deadline: item.total ? Math.round(item.verifiedDeadline / item.total * 100) : 0,
          salary: item.total ? Math.round(item.verifiedSalary / item.total * 100) : 0,
          location: item.total ? Math.round(item.verifiedLocation / item.total * 100) : 0,
        },
        priorityScore,
        releaseGate: item.invalidDeadline === 0 && item.pending === 0 && item.rejected === 0 ? 'passed' : 'pending_recheck',
        ruleConfigured: rules.has(item.company.toLowerCase()),
        companyId: remoteIds.get(item.company.toLowerCase()) || null,
      };
    }).sort((left, right) => right.priorityScore - left.priorityScore || right.total - left.total).slice(0, 200);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      companySyncAvailable: process.env.JOBS_FEED_COMPANY_FILTER_ENABLED === 'true',
      companies: payload,
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '读取字段质量失败' }, { status: 500 });
  }
}
