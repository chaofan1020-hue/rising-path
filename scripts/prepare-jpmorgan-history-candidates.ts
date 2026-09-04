import { config as loadDotenv } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.env.AUDIT_ENV_FILE || '.env.production.local', override: true, quiet: true });

type Check = { job_id: number; external_job_id: string; title: string | null; source_url: string | null; result: { status: string } };
type Job = { id: number; company: string | null; title: string | null; external_job_id: string | null; is_active: boolean | null; is_closed: boolean | null; updated_at: string | null };

async function readRows<T>(table: string, columns: string, ids: number[]): Promise<T[]> {
  const client = getSupabaseClient();
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const batch = ids.slice(offset, offset + 500);
    const { data, error } = await client.from(table).select(columns).in('job_id', batch);
    if (error) throw new Error(`读取 ${table} 失败: ${error.message}`);
    rows.push(...((data || []) as T[]));
  }
  return rows;
}

async function main(): Promise<void> {
  const raw = await readFile('output/jpmorgan-unmatched-second-audit.json', 'utf8');
  const report = JSON.parse(raw.slice(raw.indexOf('{'))) as { checks?: Check[] };
  const candidates = (report.checks || []).filter((check) => check.result?.status === 'absent');
  const ids = candidates.map((row) => row.job_id);
  const client = getSupabaseClient();
  const jobs: Job[] = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const batch = ids.slice(offset, offset + 500);
    const { data, error } = await client.from('jobs').select('id,company,title,external_job_id,is_active,is_closed,updated_at').in('id', batch);
    if (error) throw new Error(`读取岗位失败: ${error.message}`);
    jobs.push(...((data || []) as Job[]));
  }
  const [applications, matches, syncRecords] = await Promise.all([
    readRows<{ job_id: number }>('applications', 'job_id', ids),
    readRows<{ job_id: number }>('ai_matches', 'job_id', ids),
    readRows<{ job_id: number; missing_feed_checks: number | null; last_link_error: string | null }>('job_sync_records', 'job_id,missing_feed_checks,last_link_error', ids),
  ]);
  const countByJob = (rows: Array<{ job_id: number }>) => new Map(rows.map((row) => [row.job_id, 1]));
  const applicationIds = countByJob(applications);
  const matchIds = countByJob(matches);
  const syncByJob = new Map(syncRecords.map((row) => [row.job_id, row]));
  const enriched = candidates.map((candidate) => {
    const job = jobs.find((row) => row.id === candidate.job_id);
    const sync = syncByJob.get(candidate.job_id);
    return {
      job_id: candidate.job_id,
      external_job_id: candidate.external_job_id,
      title: candidate.title,
      source_url: candidate.source_url,
      updated_at: job?.updated_at || null,
      is_active: job?.is_active ?? null,
      is_closed: job?.is_closed ?? null,
      has_application: applicationIds.has(candidate.job_id),
      has_ai_match: matchIds.has(candidate.job_id),
      missing_feed_checks: sync?.missing_feed_checks || 0,
      last_link_error: sync?.last_link_error || null,
      action: '待独立处理；当前不自动下架',
    };
  });
  const summary = {
    generated_at: new Date().toISOString(),
    company: 'JPMorgan Chase',
    candidate_count: enriched.length,
    active_count: enriched.filter((row) => row.is_active && !row.is_closed).length,
    with_application: enriched.filter((row) => row.has_application).length,
    with_ai_match: enriched.filter((row) => row.has_ai_match).length,
    with_missing_feed_observation: enriched.filter((row) => row.missing_feed_checks > 0).length,
    note: '连续两次官方 ById 详情缺失的只读候选清单；未写入岗位、未下架、未删除用户关联数据。',
  };
  await writeFile('output/jpmorgan-history-candidates.json', `${JSON.stringify({ summary, candidates: enriched }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
