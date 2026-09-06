import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

/**
 * close-removed-by-apple-api.ts
 *
 * 用 Apple 官方 jobDetails API 做"官网上下架同步"：
 *   先请求 /api/v1/CSRFToken 拿 token+cookie，再请求 /api/v1/jobDetails/<jobNumber>：
 *   - HTTP 200        -> 官网在招，保留
 *   - HTTP 404 / 410  -> 官网明确撤下，下架（is_active=false, is_closed=true）
 *   - 其他（403/429/超时/网络）-> 保留，不误删
 *
 * 用法：
 *   pnpm exec tsx scripts/close-removed-by-apple-api.ts           # dry-run 全部 Apple active
 *   pnpm exec tsx scripts/close-removed-by-apple-api.ts --write   # 写库
 *   pnpm exec tsx scripts/close-removed-by-apple-api.ts --limit=50 --write
 */

loadDotenv({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

const PAGE_SIZE = 200;
const MAX_LIMIT = 10_000;
const APPLE_BASE = 'https://jobs.apple.com';

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
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

function appleJobNumber(jobUrl: string): string | null {
  try {
    const url = new URL(jobUrl);
    if (url.hostname.toLowerCase() !== 'jobs.apple.com') return null;
    const match = url.pathname.match(/\/details\/(\d+)/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

type AppleSession = { headers: Record<string, string> };

async function createAppleSession(): Promise<AppleSession> {
  const headers = { accept: 'application/json, text/plain, */*', referer: `${APPLE_BASE}/en-us/details/200000000`, origin: APPLE_BASE };
  const csrf = await fetch(`${APPLE_BASE}/api/v1/CSRFToken`, { headers });
  if (csrf.status !== 200) throw new Error(`CSRF HTTP ${csrf.status}`);
  const setCookie = csrf.headers.get('set-cookie') || '';
  const cookie = setCookie.split(/,\s*(?=jobs|jssid|AWSALBAPP)/i).map((s) => s.split(';')[0]).join('; ');
  const token = csrf.headers.get('x-apple-csrf-token');
  return { headers: { ...headers, ...(cookie ? { cookie } : {}), ...(token ? { 'x-apple-csrf-token': token } : {}) } };
}

async function fetchAppleJobStatus(session: AppleSession, jobNumber: string): Promise<{ status: 'open' | 'removed' | 'unknown'; httpStatus: number | null; error: string | null }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${APPLE_BASE}/api/v1/jobDetails/${jobNumber}`, {
        headers: session.headers,
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
}function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
  const write = hasFlag('write');
  const limit = positiveInteger('limit', MAX_LIMIT);
  const delayMs = Math.min(Math.max(Number(process.env.APPLE_DETAIL_DELAY_MS || 300), 0), 5_000);
  const concurrency = Math.min(Math.max(Number(process.env.APPLE_DETAIL_CONCURRENCY || 4), 1), 8);
  const client = getSupabaseClient();

  const result = {
    environment: { supabase_project_ref: projectRef() },
    mode: 'Apple',
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

  const candidates: Array<{ id: number; company: string; job_url: string; job_number: string }> = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('jobs')
      .select('id,company,job_url')
      .eq('company', 'Apple')
      .eq('source_system', 'collector_feed')
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`读取 Apple 岗位失败: ${error.message}`);
    const rows = (data || []) as Array<{ id: number; company: string; job_url: string | null }>;
    for (const row of rows) {
      if (!row.job_url) {
        result.skipped_no_url += 1;
        continue;
      }
      const jobNumber = appleJobNumber(row.job_url);
      if (!jobNumber) {
        result.skipped_no_detail_url += 1;
        continue;
      }
      candidates.push({ id: row.id, company: row.company, job_url: row.job_url, job_number: jobNumber });
    }
    if (rows.length < PAGE_SIZE) break;
    if (limit != null && candidates.length >= limit) break;
  }

  const selected = limit != null ? candidates.slice(0, limit) : candidates;
  const session = await createAppleSession();
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= selected.length) return;
      const cand = selected[index];
      await sleep(delayMs);
      const q = await fetchAppleJobStatus(session, cand.job_number);
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
              last_link_error: 'official Apple jobDetails API returned HTTP 404/410',
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