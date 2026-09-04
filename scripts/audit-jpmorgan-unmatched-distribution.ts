import { config as loadDotenv } from 'dotenv';
import { getConnectorBoard, fetchConnectorBoard } from '@/lib/job-connectors';
import { getSupabaseClient } from '@/storage/database/supabase-client';

type JobRow = {
  id: number;
  company: string | null;
  source_system: string | null;
  external_job_id: string | null;
  source_url: string | null;
  job_url: string | null;
  title: string | null;
  updated_at: string | null;
  created_at: string | null;
  is_active: boolean | null;
  is_closed: boolean | null;
};

const COMPANY = 'JPMorgan Chase';
const PAGE_SIZE = 1_000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function host(value: string | null): string {
  const raw = text(value);
  if (!raw) return '(空)';
  try { return new URL(raw).hostname.toLowerCase(); } catch { return '(非法 URL)'; }
}

function idShape(value: string | null): string {
  const id = text(value);
  if (!id) return '(空)';
  if (/^\d+$/.test(id)) return '纯数字';
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) return 'UUID';
  if (/^[A-Z]{1,8}[-_]?\d+$/i.test(id)) return '字母前缀+数字';
  if (/^[A-Z0-9]{2,}[-_]\d+[-_A-Z0-9]*$/i.test(id)) return '复合 requisition ID';
  if (/https?:\/\//i.test(id) || id.includes('/')) return 'URL/路径';
  return id.length <= 12 ? '短文本' : '长文本';
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) || 0) + 1);
}

function sortedMap(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

async function readAllJobs(): Promise<JobRow[]> {
  const client = getSupabaseClient();
  const rows: JobRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from('jobs')
      .select('id,company,source_system,external_job_id,source_url,job_url,title,updated_at,created_at,is_active,is_closed')
      .eq('company', COMPANY)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`读取生产岗位失败（offset ${offset}）: ${error.message}`);
    rows.push(...((data || []) as JobRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function main(): Promise<void> {
  const envFile = process.env.AUDIT_ENV_FILE || '.env.production.local';
  loadDotenv({ path: envFile, override: true, quiet: true });
  const board = getConnectorBoard(COMPANY);
  if (!board || board.connector !== 'oracle_hcm') throw new Error(`${COMPANY} 没有 Oracle HCM 来源配置`);

  // An empty detail set intentionally performs list-only discovery, avoiding thousands of detail calls.
  const official = await fetchConnectorBoard(board, { timeoutMs: 90_000, detailJobIds: new Set<string>() });
  const officialIds = new Set(official.jobs.map((job) => text(job.external_job_id || job.id)).filter(Boolean));
  const allRows = await readAllJobs();
  const activeRows = allRows.filter((row) => row.is_active !== false && row.is_closed !== true);
  const productionIds = new Set(activeRows.map((row) => text(row.external_job_id)).filter(Boolean));
  const unmatched = activeRows.filter((row) => {
    const id = text(row.external_job_id);
    return !id || !officialIds.has(id);
  });

  const sourceSystems = new Map<string, number>();
  const sourceHosts = new Map<string, number>();
  const idShapes = new Map<string, number>();
  const idPrefixes = new Map<string, number>();
  const updateMonths = new Map<string, number>();
  const duplicateIds = new Map<string, number>();
  const allIdCounts = new Map<string, number>();
  for (const row of activeRows) {
    const id = text(row.external_job_id);
    if (id) increment(allIdCounts, id);
  }
  for (const [id, count] of allIdCounts) if (count > 1) duplicateIds.set(id, count);
  for (const row of unmatched) {
    increment(sourceSystems, text(row.source_system) || '(空)');
    increment(sourceHosts, host(row.source_url || row.job_url));
    increment(idShapes, idShape(row.external_job_id));
    const id = text(row.external_job_id);
    const prefix = id.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() || (id ? '(无字母前缀)' : '(空)');
    increment(idPrefixes, prefix);
    const date = text(row.updated_at || row.created_at);
    increment(updateMonths, /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : '(无时间)');
  }

  const samples = unmatched.slice(0, 50).map((row) => ({
    id: row.id,
    title: row.title,
    source_system: row.source_system,
    external_job_id: row.external_job_id,
    source_host: host(row.source_url || row.job_url),
    source_url: row.source_url,
    job_url: row.job_url,
    updated_at: row.updated_at,
    created_at: row.created_at,
    duplicate_external_id_count: text(row.external_job_id) ? (allIdCounts.get(text(row.external_job_id)) || 0) : 0,
  }));

  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    environment: envFile,
    company: COMPANY,
    official: {
      connector: official.connector,
      board: official.board,
      received: official.received,
      parsed: official.jobs.length,
      unique_external_ids: officialIds.size,
      fetched_at: official.fetchedAt,
      source_url: official.sourceUrl,
    },
    production: {
      total_rows: allRows.length,
      active_rows: activeRows.length,
      unique_external_ids: productionIds.size,
      duplicate_external_id_values: duplicateIds.size,
      duplicate_external_id_rows: [...duplicateIds.values()].reduce((sum, count) => sum + count, 0),
    },
    unmatched_against_official_external_ids: {
      rows: unmatched.length,
      rows_with_external_id: unmatched.filter((row) => Boolean(text(row.external_job_id))).length,
      rows_without_external_id: unmatched.filter((row) => !text(row.external_job_id)).length,
      source_system_distribution: sortedMap(sourceSystems),
      source_host_distribution: sortedMap(sourceHosts),
      external_id_shape_distribution: sortedMap(idShapes),
      external_id_prefix_distribution: sortedMap(idPrefixes),
      updated_month_distribution: sortedMap(updateMonths),
      duplicate_external_ids_in_active_set: Object.fromEntries([...duplicateIds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100)),
      samples,
    },
    note: '只读审计；未写入岗位、游标、来源台账或生命周期字段。未匹配不等于应关闭。',
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
