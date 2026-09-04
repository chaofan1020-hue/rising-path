import { config as loadDotenv } from 'dotenv';

import { isTrustedJobFieldSource } from '@/lib/job-field-provenance';
import { getSupabaseClient } from '@/storage/database/supabase-client';

type FieldName = 'location' | 'workplace_type' | 'employment_category' | 'experience' | 'salary' | 'deadline';

interface JobRow {
  id: number;
  region: string | null;
  field_evidence: Record<string, unknown> | null;
  location_source: string | null;
  workplace_type: string | null;
  employment_category: string | null;
  experience_min_years: number | null;
  experience_max_years: number | null;
  experience_text: string | null;
  salary_range: string | null;
  salary_source: string | null;
  valid_through: string | null;
  deadline_source: string | null;
}

const FIELDS: FieldName[] = ['location', 'workplace_type', 'employment_category', 'experience', 'salary', 'deadline'];
const PAGE_SIZE = 1_000;

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function hasValue(row: JobRow, field: FieldName): boolean {
  switch (field) {
    case 'location': return Boolean(row.region);
    case 'workplace_type': return Boolean(row.workplace_type);
    case 'employment_category': return Boolean(row.employment_category && row.employment_category !== '未知');
    case 'experience': return row.experience_min_years != null || row.experience_max_years != null || Boolean(row.experience_text);
    case 'salary': return Boolean(row.salary_range);
    case 'deadline': return Boolean(row.valid_through);
  }
}

function isVerified(row: JobRow, field: FieldName): boolean {
  const fields = row.field_evidence?.fields;
  const evidence = fields && typeof fields === 'object' && !Array.isArray(fields)
    ? (fields as Record<string, unknown>)[field]
    : null;
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    && (evidence as Record<string, unknown>).status === 'verified') return true;
  if (field === 'location') return isTrustedJobFieldSource(row.location_source);
  if (field === 'salary') return isTrustedJobFieldSource(row.salary_source);
  if (field === 'deadline') return isTrustedJobFieldSource(row.deadline_source);
  return false;
}

async function activeCompanyJobs(company: string): Promise<JobRow[]> {
  const client = getSupabaseClient();
  const jobs: JobRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from('jobs')
      .select('id,region,field_evidence,location_source,workplace_type,employment_category,experience_min_years,experience_max_years,experience_text,salary_range,salary_source,valid_through,deadline_source')
      .eq('source_system', 'collector_feed')
      .eq('company', company)
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`读取 ${company} 岗位失败: ${error.message}`);
    jobs.push(...(data || []) as JobRow[]);
    if (!data || data.length < PAGE_SIZE) return jobs;
  }
}

async function main(): Promise<void> {
  const company = argument('company');
  if (!company) throw new Error('请指定 --company=公司名');
  const envFile = argument('env-file') || '.env.local';
  loadDotenv({ path: envFile, override: false });

  const jobs = await activeCompanyJobs(company);
  const coverage = Object.fromEntries(FIELDS.map((field) => [field, {
    present: jobs.filter((job) => hasValue(job, field)).length,
    verified: jobs.filter((job) => isVerified(job, field)).length,
  }]));
  const sampleIds = jobs
    .filter((job) => isVerified(job, 'workplace_type') || isVerified(job, 'employment_category') || isVerified(job, 'experience'))
    .slice(0, 20)
    .map((job) => job.id);

  console.log(JSON.stringify({
    company,
    active_collector_feed_jobs: jobs.length,
    coverage,
    sample_job_ids: sampleIds,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
