import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { syncJobsFeed } from '@/lib/jobs-feed';

loadDotenv({ path: '.env.local' });

const CURSOR_CONFIG_TYPE = 'jobs_feed_cursor';

async function readCursor() {
  const { data, error } = await getSupabaseClient()
    .from('job_configs')
    .select('id, config_value')
    .eq('config_type', CURSOR_CONFIG_TYPE)
    .order('id', { ascending: true })
    .limit(1);
  if (error) throw new Error(`读取同步进度失败: ${error.message}`);
  return data?.[0] ?? null;
}

async function saveCursor(cursor: string | null) {
  const client = getSupabaseClient();
  const saved = await readCursor();
  const value = cursor || '';
  const mutation = saved
    ? client.from('job_configs').update({ config_value: value, updated_at: new Date().toISOString() }).eq('id', saved.id)
    : client.from('job_configs').insert({ config_type: CURSOR_CONFIG_TYPE, config_value: value, is_active: true });
  const { error } = await mutation;
  if (error) throw new Error(`保存同步进度失败: ${error.message}`);
}

async function main() {
  const client = getSupabaseClient();
  let cursor = (await readCursor())?.config_value || undefined;
  let round = 0;
  let consecutiveFailures = 0;
  let totalReceived = 0;
  let totalUpserted = 0;
  let totalClosed = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  while (round < 1000) {
    let result;
    try {
      result = await syncJobsFeed(client, { cursor, maxPages: 1 });
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      console.error(`同步请求失败，等待后重试（第 ${consecutiveFailures} 次）`);
      if (consecutiveFailures >= 8) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(consecutiveFailures * 5000, 30000)));
      continue;
    }
    round += 1;
    totalReceived += result.received;
    totalUpserted += result.upserted;
    totalClosed += result.closed;
    totalSkipped += result.skipped;
    totalFailed += result.failed;
    cursor = result.next_cursor || undefined;
    await saveCursor(result.has_more ? result.next_cursor : null);
    console.log(JSON.stringify({
      round,
      pages: result.pages,
      received: result.received,
      upserted: result.upserted,
      closed: result.closed,
      skipped: result.skipped,
      failed: result.failed,
      has_more: result.has_more,
      totals: {
        received: totalReceived,
        upserted: totalUpserted,
        closed: totalClosed,
        skipped: totalSkipped,
        failed: totalFailed,
      },
    }));
    if (!result.has_more) break;
  }

  if (round >= 1000) throw new Error('同步轮次超过安全上限，已停止');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : '岗位同步失败');
  process.exitCode = 1;
});
