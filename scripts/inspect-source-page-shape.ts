import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { fetchSafeExternalPage } from '@/lib/safe-external-fetch';

loadDotenv({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

const company = process.argv.find((item) => item.startsWith('--company='))?.slice('--company='.length) || '';
const count = Number(process.argv.find((item) => item.startsWith('--count='))?.slice('--count='.length) || 3);

async function main(): Promise<void> {
  if (!company) throw new Error('需要 --company=公司名');
  const { data, error } = await getSupabaseClient().from('jobs')
    .select('id,title,job_url,external_job_id')
    .eq('company', company).eq('source_system', 'collector_feed').eq('is_active', true)
    .not('job_url', 'is', null).order('id', { ascending: true }).limit(Math.max(1, Math.min(count, 10)));
  if (error) throw new Error(error.message);
  const rows = [];
  for (const job of data || []) {
    const page = await fetchSafeExternalPage(String(job.job_url));
    rows.push({
      id: job.id,
      title: job.title,
      external_job_id: job.external_job_id,
      url: page.url,
      http_status: page.httpStatus,
      metadata_keys: Object.keys(page.metadata || {}),
      structured_data: page.metadata?.structured_data || null,
      metadata_description: page.metadata?.description || null,
      content_start: page.content.slice(0, 5000),
    });
  }
  console.log(JSON.stringify({ company, rows }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });
