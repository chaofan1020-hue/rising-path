import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: '.env.local' });

async function main() {
  const client = getSupabaseClient();
  const [{ data: states, error: stateError }, { data: failures, error: failureError }] = await Promise.all([
    client.from('job_sync_state').select('source_system,cursor,reconcile_cursor,reconcile_started_at,last_incremental_success_at,last_reconcile_success_at,last_error,consecutive_failures,last_attempted_at,last_success_at,next_retry_at,priority,lease_owner,lease_expires_at,updated_at').order('source_system'),
    client.from('job_sync_failures').select('status'),
  ]);
  if (stateError) throw new Error(`读取岗位同步状态失败: ${stateError.message}`);
  if (failureError) throw new Error(`读取岗位失败队列失败: ${failureError.message}`);
  const queue: Record<string, number> = {};
  for (const row of failures || []) queue[row.status] = (queue[row.status] || 0) + 1;
  const feed = (states || []).find((row) => row.source_system === 'collector_feed') as Record<string, unknown> | undefined;
  const lastProgress = typeof feed?.last_incremental_success_at === 'string' ? Date.parse(feed.last_incremental_success_at) : NaN;
  console.log(JSON.stringify({
    feed_health: feed ? {
      caught_up: !feed.cursor && !feed.reconcile_cursor,
      last_incremental_success_at: feed.last_incremental_success_at || null,
      minutes_since_incremental_success: Number.isFinite(lastProgress) ? Math.max(0, Math.round((Date.now() - lastProgress) / 60_000)) : null,
      reconcile_in_progress: Boolean(feed.reconcile_started_at || feed.reconcile_cursor),
      consecutive_failures: Number(feed.consecutive_failures) || 0,
      last_error: feed.last_error || null,
      lease_active: typeof feed.lease_expires_at === 'string' && Date.parse(feed.lease_expires_at) > Date.now(),
    } : null,
    states: states || [],
    queue,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
