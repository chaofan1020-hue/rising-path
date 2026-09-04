import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.env.AUDIT_ENV_FILE || '.env.production.local', override: true, quiet: true });

type JobRow = { id: number; is_active: boolean | null; is_closed: boolean | null; external_job_id: string | null };
type RecordRow = { job_id: number; missing_feed_checks: number | null; missing_from_feed_at: string | null; last_verified_at: string | null; last_link_error: string | null; availability_status: string | null };

async function main(): Promise<void> {
  const client = getSupabaseClient();
  const jobs: JobRow[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const { data, error } = await client
      .from('jobs')
      .select('id,is_active,is_closed,external_job_id')
      .eq('company', 'JPMorgan Chase')
      .eq('source_system', 'collector_feed')
      .range(offset, offset + 999);
    if (error) throw new Error(`读取岗位失败: ${error.message}`);
    jobs.push(...((data || []) as JobRow[]));
    if (!data || data.length < 1_000) break;
  }
  const records: RecordRow[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const ids = jobs.slice(offset, offset + 1_000).map((job) => job.id);
    if (!ids.length) break;
    const { data, error } = await client
      .from('job_sync_records')
      .select('job_id,missing_feed_checks,missing_from_feed_at,last_verified_at,last_link_error,availability_status')
      .in('job_id', ids);
    if (error) throw new Error(`读取对账记录失败: ${error.message}`);
    records.push(...((data || []) as RecordRow[]));
  }
  const active = jobs.filter((job) => job.is_active !== false && job.is_closed !== true);
  const byChecks = new Map<string, number>();
  const byStatus = new Map<string, number>();
  for (const record of records) {
    const checks = String(record.missing_feed_checks || 0);
    byChecks.set(checks, (byChecks.get(checks) || 0) + 1);
    const status = record.availability_status || '(空)';
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
  }
  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    company: 'JPMorgan Chase',
    jobs: { total: jobs.length, active: active.length, inactive: jobs.length - active.length },
    sync_records: { total: records.length, missing_checks: Object.fromEntries(byChecks), availability_status: Object.fromEntries(byStatus) },
    records_with_missing_observation: records.filter((record) => (record.missing_feed_checks || 0) > 0).length,
    records_with_two_or_more_missing_observations: records.filter((record) => (record.missing_feed_checks || 0) >= 2).length,
    note: '只读检查，未修改岗位、对账记录或生命周期。',
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
