import { config as loadDotenv } from 'dotenv';
import { getConnectorBoard, fetchConnectorBoard } from '@/lib/job-connectors';
import { getSupabaseClient } from '@/storage/database/supabase-client';

type JobRow = {
  id: number;
  title: string | null;
  external_job_id: string | null;
  source_url: string | null;
  updated_at: string | null;
  created_at: string | null;
  is_active: boolean | null;
  is_closed: boolean | null;
};

const COMPANY = 'JPMorgan Chase';
const API_BASE = 'https://jpmc.fa.oraclecloud.com';
const SITE_NUMBER = 'CX_1001';
const PAGE_SIZE = 1_000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function dateBucket(value: string | null): string {
  const raw = text(value);
  return /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 7) : '(no date)';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, action: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      results[current] = await action(items[current]);
    }
  }));
  return results;
}

async function readActiveJobs(): Promise<JobRow[]> {
  const client = getSupabaseClient();
  const rows: JobRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from('jobs')
      .select('id,title,external_job_id,source_url,updated_at,created_at,is_active,is_closed')
      .eq('company', COMPANY)
      .eq('source_system', 'collector_feed')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`读取生产岗位失败（offset ${offset}）: ${error.message}`);
    rows.push(...((data || []) as JobRow[]));
    if (!data || data.length < PAGE_SIZE) return rows.filter((row) => row.is_active !== false && row.is_closed !== true);
  }
}

async function currentOfficialIds(): Promise<Set<string>> {
  const board = getConnectorBoard(COMPANY);
  if (!board || board.connector !== 'oracle_hcm') throw new Error(`${COMPANY} 没有 Oracle HCM 来源配置`);
  let official: Awaited<ReturnType<typeof fetchConnectorBoard>> | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      official = await fetchConnectorBoard(board, { timeoutMs: 90_000, detailJobIds: new Set<string>() });
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(attempt * 2_000);
    }
  }
  if (!official) throw lastError instanceof Error ? lastError : new Error(String(lastError));
  return new Set(official.jobs.map((job) => text(job.external_job_id || job.id)).filter(Boolean));
}

async function fetchDetail(externalId: string): Promise<{ status: 'present' | 'absent' | 'error'; title?: string; detailId?: string; httpStatus?: number; reason?: string }> {
  const url = new URL(`${API_BASE}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails`);
  url.searchParams.set('onlyData', 'true');
  url.searchParams.set('expand', 'all');
  url.searchParams.set('finder', `ById;Id=\"${externalId}\",siteNumber=${SITE_NUMBER}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Liorvix read-only audit' }, cache: 'no-store', signal: controller.signal });
    if (!response.ok) return { status: 'error', httpStatus: response.status, reason: `HTTP ${response.status}` };
    const payload = await response.json() as { items?: Array<{ Id?: unknown; Title?: unknown }> };
    const detail = payload.items?.[0];
    const detailId = text(detail?.Id);
    return detailId === externalId
      ? { status: 'present', detailId, title: text(detail?.Title) || undefined, httpStatus: response.status }
      : { status: 'absent', detailId: detailId || undefined, httpStatus: response.status, reason: '详情接口未返回匹配岗位 ID' };
  } catch (error) {
    return { status: 'error', reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  loadDotenv({ path: process.env.AUDIT_ENV_FILE || '.env.production.local', override: true, quiet: true });
  const [officialIds, activeJobs] = await Promise.all([currentOfficialIds(), readActiveJobs()]);
  const unmatched = activeJobs.filter((row) => {
    const externalId = text(row.external_job_id);
    return externalId && !officialIds.has(externalId);
  });
  const byBucket = new Map<string, JobRow[]>();
  for (const row of unmatched) {
    const bucket = dateBucket(row.updated_at || row.created_at);
    const rows = byBucket.get(bucket) || [];
    rows.push(row);
    byBucket.set(bucket, rows);
  }
  // Spread samples across update periods and the full ID range; this avoids only testing the first page.
  const samples: JobRow[] = process.argv.includes('--all') ? unmatched : (() => {
    const selected: JobRow[] = [];
    for (const rows of byBucket.values()) {
      const sorted = [...rows].sort((a, b) => Number(a.external_job_id) - Number(b.external_job_id));
      const sampleCount = Math.min(20, sorted.length);
      const indices = Array.from({ length: sampleCount }, (_, position) =>
        sampleCount === 1 ? 0 : Math.round(position * (sorted.length - 1) / (sampleCount - 1)));
      for (const index of indices) {
        const row = sorted[index];
        if (row && !selected.some((item) => item.id === row.id)) selected.push(row);
      }
    }
    return selected;
  })();
  const checked = await mapWithConcurrency(samples, 8, async (row) => ({
    job_id: row.id,
    external_job_id: row.external_job_id,
    title: row.title,
    updated_at: row.updated_at,
    source_url: row.source_url,
    result: await fetchDetail(text(row.external_job_id)),
  }));
  const byResult = checked.reduce<Record<string, number>>((counts, item) => {
    counts[item.result.status] = (counts[item.result.status] || 0) + 1;
    return counts;
  }, {});
  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    company: COMPANY,
    official_list_unique_ids: officialIds.size,
    active_production_jobs: activeJobs.length,
    unmatched_jobs: unmatched.length,
    sample_strategy: process.argv.includes('--all')
      ? '全量未匹配岗位；详情接口按同一 Oracle site CX_1001 查询，8 并发只读核验'
      : '每个更新时间段按外部 ID 范围均匀抽取最多 20 个样本；详情接口按同一 Oracle site CX_1001 查询',
    sample_result_counts: byResult,
    checks: checked,
    note: '只读验证：未写入、未关闭岗位、未推进游标。',
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
