import { config as loadDotenv } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.env.AUDIT_ENV_FILE || '.env.production.local', override: true, quiet: true });

type Candidate = { job_id: number; external_job_id: string; is_active: boolean | null; is_closed: boolean | null };
type Job = { id: number; company: string | null; source_system: string | null; is_active: boolean | null; is_closed: boolean | null };

function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function main(): Promise<void> {
  if (!process.argv.includes('--write')) {
    throw new Error('必须显式传入 --write；不带 --write 只允许做预检查');
  }
  const raw = await readFile('output/jpmorgan-history-candidates.json', 'utf8');
  const report = JSON.parse(raw) as { candidates?: Candidate[] };
  const candidateIds = [...new Set((report.candidates || []).map((row) => row.job_id).filter((id) => Number.isInteger(id)))];
  if (!candidateIds.length) throw new Error('候选清单为空，已停止');

  const client = getSupabaseClient();
  const jobs: Job[] = [];
  for (const ids of batches(candidateIds, 500)) {
    const { data, error } = await client.from('jobs').select('id,company,source_system,is_active,is_closed').in('id', ids);
    if (error) throw new Error(`读取候选岗位失败: ${error.message}`);
    jobs.push(...((data || []) as Job[]));
  }
  const invalid = jobs.filter((job) => job.company !== 'JPMorgan Chase' || job.source_system !== 'collector_feed');
  if (invalid.length) throw new Error(`候选岗位来源校验失败: ${invalid.length} 条不是 JPMorgan Chase/collector_feed`);
  const missing = candidateIds.filter((id) => !jobs.some((job) => job.id === id));
  if (missing.length) throw new Error(`候选岗位在生产库不存在: ${missing.length} 条`);
  const active = jobs.filter((job) => job.is_active !== false && job.is_closed !== true);
  const now = new Date().toISOString();
  let closed = 0;
  let stateUpdated = 0;
  for (const ids of batches(active.map((job) => job.id), 500)) {
    const { data, error } = await client
      .from('jobs')
      .update({ is_active: false, is_closed: true, updated_at: now })
      .in('id', ids)
      .eq('company', 'JPMorgan Chase')
      .eq('source_system', 'collector_feed')
      .eq('is_active', true)
      .eq('is_closed', false)
      .select('id');
    if (error) throw new Error(`关闭岗位失败: ${error.message}`);
    closed += data?.length || 0;
  }
  for (const ids of batches(active.map((job) => job.id), 500)) {
    const { data, error } = await client
      .from('job_sync_records')
      .update({
        availability_status: 'closed',
        link_health: 'closed',
        last_link_error: '官方 Oracle ById 连续两次未返回该岗位，按严格官网同步规则关闭',
        availability_checked_at: now,
        last_link_checked_at: now,
        last_link_http_status: 200,
        updated_at: now,
      })
      .in('job_id', ids)
      .select('job_id');
    if (error) throw new Error(`更新岗位状态记录失败: ${error.message}`);
    stateUpdated += data?.length || 0;
  }
  console.log(JSON.stringify({
    generated_at: now,
    company: 'JPMorgan Chase',
    candidate_count: candidateIds.length,
    active_before_write: active.length,
    closed,
    sync_records_updated: stateUpdated,
    note: '仅处理连续两次官方 ById 缺失候选；未删除岗位、收藏、投递或 AI 匹配，未修改主 Feed。',
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
