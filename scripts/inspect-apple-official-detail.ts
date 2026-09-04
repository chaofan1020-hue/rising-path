import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { fetchSafeExternalPage } from '@/lib/safe-external-fetch';

loadDotenv({ path: '.env.local' });

async function main(): Promise<void> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('jobs')
    .select('id,external_job_id,title,job_url')
    .eq('company', 'Apple')
    .eq('source_system', 'collector_feed')
    .eq('is_active', true)
    .order('id', { ascending: true })
    .limit(1);
  if (error) throw new Error(`读取 Apple 岗位失败: ${error.message}`);
  const job = data?.[0];
  if (!job?.job_url) throw new Error('没有可检查的 Apple 在招岗位链接');
  const page = await fetchSafeExternalPage(job.job_url);
  console.log(JSON.stringify({
    job,
    page: {
      url: page.url,
      http_status: page.httpStatus,
      title: page.title,
      metadata: page.metadata,
      content_preview: page.content.slice(0, 12_000),
    },
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
