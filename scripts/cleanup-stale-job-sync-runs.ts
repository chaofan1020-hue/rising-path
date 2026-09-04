import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: '.env.local' });

const staleAfterMinutes = Number(process.env.JOB_SYNC_STALE_RUN_MINUTES || 20);
const cutoff = new Date(Date.now() - Math.max(5, staleAfterMinutes) * 60_000).toISOString();
const client = getSupabaseClient();

async function main() {
  const { data, error } = await client
    .from('job_sync_runs')
    .select('id,source_system,company_name,started_at,last_heartbeat_at')
    .eq('status', 'running')
    .lt('last_heartbeat_at', cutoff)
    .order('id');
  if (error) throw new Error(`读取过期同步运行失败: ${error.message}`);

  const rows = data || [];
  const write = process.argv.includes('--write');
  if (!write) {
    console.log(JSON.stringify({ dry_run: true, cutoff, count: rows.length, rows }, null, 2));
    return;
  }
  if (!rows.length) {
    console.log(JSON.stringify({ dry_run: false, cutoff, updated: 0 }, null, 2));
    return;
  }
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await client
    .from('job_sync_runs')
    .update({
      status: 'failed',
      current_stage: 'finished',
      completed_at: now,
      last_heartbeat_at: now,
      error_message: 'worker heartbeat timeout; cursor and jobs unchanged',
      stop_reason: 'worker_heartbeat_timeout',
    })
    .in('id', rows.map((row) => row.id))
    .eq('status', 'running')
    .select('id');
  if (updateError) throw new Error(`收口过期同步运行失败: ${updateError.message}`);
  console.log(JSON.stringify({ dry_run: false, cutoff, updated: updated?.length || 0 }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
