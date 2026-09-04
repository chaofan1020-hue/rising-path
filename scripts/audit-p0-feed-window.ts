import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: '.env.local' });

async function main() {
  const minutes = Math.max(10, Number(process.argv.find((arg) => arg.startsWith('--minutes='))?.split('=')[1] || 180));
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const client = getSupabaseClient();
  const [runs, state, failures, changes, closed] = await Promise.all([
    client.from('job_sync_runs').select('id,source_system,mode,status,started_at,completed_at,last_heartbeat_at,pages,received,upserted,closed,skipped,row_failures,fatal_failures,stop_reason,error_message,cursor_before,cursor_after').eq('source_system', 'collector_feed').gte('started_at', since).order('started_at', { ascending: true }),
    client.from('job_sync_state').select('source_system,cursor,reconcile_cursor,last_incremental_success_at,last_reconcile_success_at,last_attempted_at,last_success_at,next_retry_at,consecutive_failures,lease_owner,lease_expires_at,last_error,updated_at').eq('source_system', 'collector_feed').maybeSingle(),
    client.from('job_sync_failures').select('status,operation').gte('created_at', since),
    client.from('jobs').select('is_active,is_closed,updated_at').eq('source_system', 'collector_feed').gte('updated_at', since),
    client.from('jobs').select('id,company,external_job_id,job_url,is_active,is_closed,updated_at').eq('source_system', 'collector_feed').eq('is_active', false).eq('is_closed', true).gte('updated_at', since).order('updated_at', { ascending: false }).limit(30),
  ]);
  for (const result of [runs, state, failures, changes, closed]) {
    if (!result.error) continue;
    if (result.error.code === '42703' && /last_heartbeat_at/.test(result.error.message)) {
      throw new Error('当前数据库未部署岗位同步实时进度迁移（0101/0103）；请在目标生产环境执行本审计，或先完成数据库迁移');
    }
    throw new Error(result.error.message);
  }
  const runRows = runs.data || [];
  const changeRows = changes.data || [];
  const summary = runRows.reduce((acc, row) => {
    for (const key of ['received', 'upserted', 'closed', 'skipped', 'row_failures', 'fatal_failures'] as const) acc[key] += Number(row[key]) || 0;
    acc.statuses[row.status] = (acc.statuses[row.status] || 0) + 1;
    return acc;
  }, { received: 0, upserted: 0, closed: 0, skipped: 0, row_failures: 0, fatal_failures: 0, statuses: {} as Record<string, number> });
  console.log(JSON.stringify({ since, run_count: runRows.length, summary, state: state.data || null, failure_queue_rows: failures.data || [], changed_job_rows: changeRows.length, changed_job_samples: changeRows.slice(0, 20), closed_job_samples: closed.data || [], runs: runRows }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
