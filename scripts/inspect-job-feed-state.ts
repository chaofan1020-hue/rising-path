import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { JOBS_FEED_SOURCE } from '@/lib/jobs-feed';

loadDotenv({ path: '.env.local' });

async function main() {
  const client = getSupabaseClient();
  const { data: state, error: stateError } = await client
    .from('job_sync_state')
    .select('*')
    .eq('source_system', JOBS_FEED_SOURCE)
    .maybeSingle();
  if (stateError) throw new Error(stateError.message);

  const { count: total, error: totalError } = await client
    .from('jobs')
    .select('*', { count: 'exact', head: true });
  if (totalError) throw new Error(totalError.message);

  const { count: active, error: activeError } = await client
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);
  if (activeError) throw new Error(activeError.message);

  const { count: feedActive, error: feedActiveError } = await client
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('source_system', JOBS_FEED_SOURCE)
    .eq('is_active', true);
  if (feedActiveError) throw new Error(feedActiveError.message);

  console.log(JSON.stringify({ state, total, active, feed_active: feedActive }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
