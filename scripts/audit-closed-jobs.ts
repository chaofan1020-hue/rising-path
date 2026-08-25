import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { JOBS_FEED_SOURCE } from '@/lib/jobs-feed';

loadDotenv({ path: '.env.local' });

type ClosedJob = {
  id: number;
  title: string;
  company: string;
  job_url: string | null;
  valid_through: string | null;
  updated_at: string | null;
  is_closed: boolean;
};

type SyncState = {
  job_id: number;
  availability_status: string | null;
  link_health: string | null;
  last_link_status: number | null;
  last_link_http_status: number | null;
  last_link_error: string | null;
  link_check_failures: number | null;
  availability_checked_at: string | null;
  missing_feed_checks: number | null;
};

async function main() {
  const client = getSupabaseClient();
  const { data: jobs, error: jobsError } = await client
    .from('jobs')
    .select('id,title,company,job_url,valid_through,updated_at,is_closed')
    .eq('source_system', JOBS_FEED_SOURCE)
    .eq('is_active', false)
    .order('updated_at', { ascending: false })
    .limit(5000);
  if (jobsError) throw new Error(`读取已关闭岗位失败: ${jobsError.message}`);

  const rows = (jobs || []) as ClosedJob[];
  const states = new Map<number, SyncState>();
  for (let offset = 0; offset < rows.length; offset += 500) {
    const ids = rows.slice(offset, offset + 500).map((job) => job.id);
    const { data, error } = await client
      .from('job_sync_records')
      .select('job_id,availability_status,link_health,last_link_status,last_link_http_status,last_link_error,link_check_failures,availability_checked_at,missing_feed_checks')
      .in('job_id', ids);
    if (error) throw new Error(`读取岗位关闭原因失败: ${error.message}`);
    for (const state of (data || []) as SyncState[]) states.set(state.job_id, state);
  }

  const groups = new Map<string, number>();
  for (const job of rows) {
    const state = states.get(job.id);
    const key = [
      state?.availability_status || 'none',
      state?.link_health || 'none',
      state?.last_link_http_status ?? state?.last_link_status ?? 'none',
      state?.last_link_error || 'none',
      state?.missing_feed_checks || 0,
    ].join(' | ');
    groups.set(key, (groups.get(key) || 0) + 1);
  }

  const samples = rows.slice(0, 100).map((job) => ({
    ...job,
    sync: states.get(job.id) || null,
  }));
  console.log(JSON.stringify({
    total_closed: rows.length,
    grouped_by_reason: Object.fromEntries([...groups.entries()].sort((a, b) => b[1] - a[1])),
    samples,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
