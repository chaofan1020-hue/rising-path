import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { buildWorkdayCxsDetailUrl } from '@/lib/safe-external-fetch';

/**
 * close-removed-by-official-list.ts
 *
 * 用官方 Workday 详情 API（wday/cxs/<tenant>/<site>/job/<slug>）做"官网上下架同步"：
 *   - HTTP 200        -> 官网仍在招，保留
 *   - HTTP 404 / 410  -> 官网明确撤下，下架（is_active=false, is_closed=true）
 *   - 其他（403/429/超时/网络）-> 保留，不误删
 *
 * 每个岗位从 job_url 推导详情 API URL，避免列表搜索对带 -1/-2 后缀 ID 的误判。
 *
 * 用法：
 *   pnpm exec tsx scripts/close-removed-by-official-list.ts --company=Citigroup          # dry-run
 *   pnpm exec tsx scripts/close-removed-by-official-list.ts --company=Citigroup --write  # 写库
 *   pnpm exec tsx scripts/close-removed-by-official-list.ts --all --write                # 全部 Workday 公司
 *   pnpm exec tsx scripts/close-removed-by-official-list.ts --company=Citigroup --limit=30 --write
 */

loadDotenv({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

type Candidate = {
  id: number;
  company: string;
  job_url: string | null;
  title: string | null;
};

const PAGE_SIZE = 200;
const MAX_LIMIT = 5_000;

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function positiveInteger(name: string, max: number): number | null {
  const raw = argument(name);
  if (raw == null) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > max) throw new Error(`--${name} must be an integer from 1 to ${max}`);
  return value;
}

function projectRef(): string | null {
  try {
    return new URL(process.env.SUPABASE_URL || '').hostname.split('.')[0] || null;
  } catch {
    return null;
  }
}

async function fetchDetailStatus(detailUrl: string): Promise<{ status: 'open' | 'removed' | 'unknown'; httpStatus: number | null; error: string | null }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(detailUrl, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (response.status === 200) return { status: 'open', httpStatus: 200, error: null };
      if (response.status === 404 || response.status === 410) return { status: 'removed', httpStatus: response.status, error: null };
      return { status: 'unknown', httpStatus: response.status, error: `HTTP ${response.status}` };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return { status: 'unknown', httpStatus: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
  const company = argument('company');
  const all = hasFlag('all');
  const write = hasFlag('write');
  const limit = positiveInteger('limit', MAX_LIMIT);
  const delayMs = Math.min(Math.max(Number(process.env.JOB_LIST_DELAY_MS || 300), 0), 5_000);
  const concurrency = Math.min(Math.max(Number(process.env.JOB_LIST_CONCURRENCY || 4), 1), 8);
  if (!company && !all) throw new Error('Specify --company=<company> or --all');
  if (company && all) throw new Error('--company and --all cannot be combined');

  const client = getSupabaseClient();
  const result = {
    environment: { supabase_project_ref: projectRef() },
    mode: all ? 'all_workday' : company,
    write,
    dry_run: !write,
    checked: 0,
    verified_open: 0,
    removed: 0,
    removed_job_ids: [] as number[],
    unknown: 0,
    unknown_job_ids: [] as number[],
    skipped_no_url: 0,
    skipped_no_detail_url: 0,
    samples: [] as Array<{ id: number; status: string; http?: number | null; reason?: string }>,
  };

  const candidates: Candidate[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = client
      .from('jobs')
      .select('id,company,job_url,title')
      .eq('source_system', 'collector_feed')
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (company) query = query.eq('company', company);
    const { data, error } = await query;
    if (error) throw new Error(`读取岗位失败: ${error.message}`);
    const rows = (data || []) as Candidate[];
    for (const row of rows) {
      if (!row.job_url) {
        result.skipped_no_url += 1;
        continue;
      }
      if (!buildWorkdayCxsDetailUrl(row.job_url)) {
        result.skipped_no_detail_url += 1;
        continue;
      }
      candidates.push(row);
    }
    if (rows.length < PAGE_SIZE) break;
    if (limit != null && candidates.length >= limit) break;
  }

  const selected = limit != null ? candidates.slice(0, limit) : candidates;
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= selected.length) return;
      const cand = selected[index];
      const detailUrl = buildWorkdayCxsDetailUrl(cand.job_url as string);
      if (!detailUrl) {
        result.skipped_no_detail_url += 1;
        continue;
      }
      await sleep(delayMs);
      const q = await fetchDetailStatus(detailUrl);
      if (q.status === 'open') {
        result.checked += 1;
        result.verified_open += 1;
      } else if (q.status === 'removed') {
        result.checked += 1;
        result.removed += 1;
        result.removed_job_ids.push(cand.id);
        if (result.samples.length < 30) result.samples.push({ id: cand.id, status: 'removed', http: q.httpStatus });
        if (write) {
          const now = new Date().toISOString();
          const { error: jobError } = await client
            .from('jobs')
            .update({ is_active: false, is_closed: true, updated_at: now })
            .eq('id', cand.id)
            .eq('source_system', 'collector_feed')
            .eq('company', cand.company)
            .eq('is_active', true);
          if (jobError) throw new Error(`下架岗位失败 ${cand.id}: ${jobError.message}`);
          const { error: syncError } = await client
            .from('job_sync_records')
            .update({
              availability_status: 'closed',
              link_health: 'closed',
              last_link_error: 'official Workday detail API returned HTTP 404/410',
              last_link_checked_at: now,
              availability_checked_at: now,
              updated_at: now,
            })
            .eq('job_id', cand.id);
          if (syncError) throw new Error(`保存下架状态失败 ${cand.id}: ${syncError.message}`);
        }
      } else {
        result.unknown += 1;
        result.unknown_job_ids.push(cand.id);
        if (result.samples.length < 30) result.samples.push({ id: cand.id, status: 'unknown', http: q.httpStatus, reason: q.error ?? undefined });
      }
    }
  }
  const workerCount = Math.min(concurrency, Math.max(selected.length, 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});