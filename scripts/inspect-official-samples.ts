import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { fetchSafeExternalPage } from '@/lib/safe-external-fetch';
import { extractOfficialJobDetails } from '@/lib/job-official-detail';

loadDotenv({ path: '.env.local' });
const companies = process.argv.slice(2);

async function main(): Promise<void> {
  const client = getSupabaseClient();
  const output: Array<Record<string, unknown>> = [];
  for (const company of companies) {
    const { data, error } = await client.from('jobs').select('id,title,job_url').eq('company', company).eq('source_system', 'collector_feed').eq('is_active', true).order('id', { ascending: true }).limit(1);
    if (error) throw new Error(`${company}: ${error.message}`);
    const job = data?.[0];
    if (!job?.job_url) { output.push({ company, result: 'no_job_url' }); continue; }
    try {
      const page = await fetchSafeExternalPage(job.job_url);
      const details = extractOfficialJobDetails(page);
      output.push({ company, id: job.id, title: job.title, host: new URL(job.job_url).hostname, http_status: page.httpStatus, description_length: details?.description?.length || 0, fields: details ? { location: Boolean(details.location), workplace_type: Boolean(details.workplaceType), employment_type: Boolean(details.employmentType), experience: Boolean(details.experience), salary: Boolean(details.salaryRange), deadline: Boolean(details.validThrough) } : null });
    } catch (error) { output.push({ company, id: job.id, host: new URL(job.job_url).hostname, error: error instanceof Error ? error.message : String(error) }); }
  }
  console.log(JSON.stringify(output, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
