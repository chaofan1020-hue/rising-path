import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { JOBS_FEED_SOURCE } from '@/lib/jobs-feed';

loadDotenv({ path: '.env.local' });

type LinkState = {
  availability_status: string | null;
  link_health: string | null;
  last_link_http_status: number | null;
  last_link_error: string | null;
  availability_checked_at: string | null;
};

async function main() {
  const client = getSupabaseClient();
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data, error } = await client
    .from('job_sync_records')
    .select('availability_status,link_health,last_link_http_status,last_link_error,availability_checked_at')
    .eq('source_system', JOBS_FEED_SOURCE)
    .gte('availability_checked_at', since)
    .order('availability_checked_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);

  const grouped = new Map<string, number>();
  for (const row of (data || []) as LinkState[]) {
    const key = JSON.stringify({
      availability_status: row.availability_status,
      link_health: row.link_health,
      http_status: row.last_link_http_status,
      error: row.last_link_error,
    });
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }
  console.log(JSON.stringify({
    inspected_since: since,
    records: data?.length || 0,
    groups: [...grouped.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 20)
      .map(([key, count]) => ({ count, ...JSON.parse(key) })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
