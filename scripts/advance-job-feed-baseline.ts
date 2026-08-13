import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { JOBS_FEED_SOURCE } from '@/lib/jobs-feed';

loadDotenv({ path: '.env.local' });

async function main() {
  const client = getSupabaseClient();
  const { data: state, error: readError } = await client
    .from('job_sync_state')
    .select('last_reconcile_success_at, reconcile_started_at')
    .eq('source_system', JOBS_FEED_SOURCE)
    .single();
  if (readError) throw new Error(`读取同步状态失败: ${readError.message}`);

  const baseline = state.last_reconcile_success_at || state.reconcile_started_at;
  if (!baseline) throw new Error('没有可用于增量同步的完整对账基线');

  const { error: updateError } = await client
    .from('job_sync_state')
    .update({
      cursor: null,
      last_incremental_success_at: baseline,
      last_error: null,
      consecutive_failures: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('source_system', JOBS_FEED_SOURCE);
  if (updateError) throw new Error(`更新同步基线失败: ${updateError.message}`);

  console.log(JSON.stringify({ baseline }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
