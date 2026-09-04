import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { fetchSafeExternalPage } from '@/lib/safe-external-fetch';
import { extractOfficialJobDetails } from '@/lib/job-official-detail';

loadDotenv({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function numberArgument(name: string, fallback: number): number {
  const value = Number(argument(name));
  return Number.isInteger(value) && value > 0 && value <= 100 ? value : fallback;
}

function hostOf(value: string): string {
  try { return new URL(value).hostname.toLowerCase(); } catch { return 'invalid_url'; }
}

function fieldFlags(details: ReturnType<typeof extractOfficialJobDetails> | null): Record<string, boolean> | null {
  if (!details) return null;
  return {
    location: Boolean(details.location),
    workplace_type: Boolean(details.workplaceType),
    employment_category: Boolean(details.employmentType),
    experience: Boolean(details.experience),
    salary: Boolean(details.salaryRange),
    deadline: Boolean(details.validThrough),
  };
}

async function main(): Promise<void> {
  const company = argument('company');
  if (!company) throw new Error('需要 --company=公司名');
  const sampleSize = numberArgument('sample', 20);
  const client = getSupabaseClient();
  const { data, error } = await client.from('jobs')
    .select('id,title,job_url,external_job_id')
    .eq('company', company)
    .eq('source_system', 'collector_feed')
    .eq('is_active', true)
    .not('job_url', 'is', null)
    .order('id', { ascending: true });
  if (error) throw new Error(`${company}: 读取岗位失败: ${error.message}`);

  const byHost = new Map<string, Array<{ id: number; title: string; job_url: string; external_job_id: string | null }>>();
  for (const row of data || []) {
    const jobUrl = String(row.job_url || '').trim();
    if (!jobUrl) continue;
    const host = hostOf(jobUrl);
    const jobs = byHost.get(host) || [];
    if (jobs.length < sampleSize) jobs.push({ id: Number(row.id), title: String(row.title || ''), job_url: jobUrl, external_job_id: row.external_job_id ? String(row.external_job_id) : null });
    byHost.set(host, jobs);
  }

  const results: Array<Record<string, unknown>> = [];
  for (const [host, jobs] of byHost) {
    const samples: Array<Record<string, unknown>> = [];
    for (const job of jobs) {
      try {
        const page = await fetchSafeExternalPage(job.job_url);
        const details = extractOfficialJobDetails(page);
        samples.push({
          id: job.id,
          external_job_id: job.external_job_id,
          title: job.title,
          url: job.job_url,
          http_status: page.httpStatus,
          final_url: page.url,
          description_length: details?.description?.length || 0,
          fields: fieldFlags(details),
          result: details?.description ? 'usable_detail' : 'no_usable_detail',
        });
      } catch (probeError) {
        samples.push({ id: job.id, external_job_id: job.external_job_id, title: job.title, url: job.job_url, result: 'error', error: probeError instanceof Error ? probeError.message : String(probeError) });
      }
    }
    const usable = samples.filter((sample) => sample.result === 'usable_detail');
    const fieldCoverage = Object.fromEntries(['location', 'workplace_type', 'employment_category', 'experience', 'salary', 'deadline'].map((field) => [field, usable.filter((sample) => (sample.fields as Record<string, boolean> | null)?.[field]).length]));
    results.push({ host, sampled: samples.length, usable_details: usable.length, errors: samples.filter((sample) => sample.result === 'error').length, field_coverage: fieldCoverage, samples });
  }

  console.log(JSON.stringify({ company, active_jobs_with_urls: data?.length || 0, hosts: results }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });
