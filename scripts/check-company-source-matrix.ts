import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

async function main() {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('job_company_sources')
    .select('company_name,is_active,status,source_type,active_jobs,last_observed_at,last_attempted_at,last_success_at,next_retry_at')
    .order('company_name');
  if (error) throw new Error(`读取公司来源台账失败: ${error.message}`);

  const active = (data || []).filter((row) => row.is_active === true);
  const byStatus: Record<string, number> = {};
  const bySourceType: Record<string, number> = {};
  for (const row of active) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    bySourceType[row.source_type] = (bySourceType[row.source_type] || 0) + 1;
  }
  console.log(JSON.stringify({
    total_rows: (data || []).length,
    active_companies: active.length,
    inactive_rows: (data || []).length - active.length,
    active_jobs: active.reduce((sum, row) => sum + (Number(row.active_jobs) || 0), 0),
    with_attempted_at: active.filter((row) => Boolean(row.last_attempted_at)).length,
    with_success_at: active.filter((row) => Boolean(row.last_success_at)).length,
    with_retry_backoff: active.filter((row) => Boolean(row.next_retry_at)).length,
    latest_success_at: active.reduce<string | null>((latest, row) => {
      if (!row.last_success_at) return latest;
      return !latest || Date.parse(row.last_success_at) > Date.parse(latest) ? row.last_success_at : latest;
    }, null),
    by_status: byStatus,
    by_source_type: bySourceType,
    latest_observed_at: active.reduce<string | null>((latest, row) => {
      if (!row.last_observed_at) return latest;
      return !latest || Date.parse(row.last_observed_at) > Date.parse(latest) ? row.last_observed_at : latest;
    }, null),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
