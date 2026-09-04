import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.env.AUDIT_ENV_FILE || '.env.production.local', override: true, quiet: true });

type FeedItem = { company_name?: unknown; external_job_id?: unknown; id?: unknown; sync_action?: unknown; status?: unknown; closed_at?: unknown };
type LocalRow = { company: string | null; external_job_id: string | null; is_active: boolean | null; is_closed: boolean | null };

const PAGE_SIZE = 500;
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim(); }
function isClosed(item: FeedItem): boolean { return item.sync_action === 'close' || /^(closed|close)$/i.test(text(item.status)) || Boolean(text(item.closed_at)); }
function wait(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function scanFeed(): Promise<Map<string, { rows: number; open: number; ids: Set<string>; closed: number }>> {
  const feedUrl = process.env.JOBS_FEED_URL || 'https://hfscareer.com/collector-api/integrations/v1/jobs';
  const apiKey = process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY;
  if (!apiKey) throw new Error('缺少上游 Feed API key');
  const byCompany = new Map<string, { rows: number; open: number; ids: Set<string>; closed: number }>();
  let cursor: string | null = null;
  for (let page = 0; page < 500; page += 1) {
    const url = new URL(feedUrl);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('include_closed', 'false');
    if (cursor) url.searchParams.set('cursor', cursor);
    let payload: { items?: FeedItem[]; next_cursor?: string | null; has_more?: boolean } | undefined;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000);
      try {
        const response = await fetch(url, { headers: { Accept: 'application/json', 'X-Integration-Key': apiKey }, cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`上游 Feed HTTP ${response.status}`);
        payload = await response.json() as typeof payload;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await wait(attempt * 2_000);
      } finally {
        clearTimeout(timeout);
      }
    }
    if (!payload) throw lastError instanceof Error ? lastError : new Error(String(lastError));
    try {
      for (const item of payload.items || []) {
        const company = text(item.company_name) || '(未注明公司)';
        const entry = byCompany.get(company) || { rows: 0, open: 0, ids: new Set<string>(), closed: 0 };
        entry.rows += 1;
        if (isClosed(item)) entry.closed += 1;
        else entry.open += 1;
        const id = text(item.external_job_id || item.id);
        if (id) entry.ids.add(id);
        byCompany.set(company, entry);
      }
      cursor = payload.next_cursor || null;
      if (!payload.has_more || !cursor) break;
    } finally { /* page retry cleanup happens above */ }
  }
  return byCompany;
}

async function scanLocal(): Promise<Map<string, { total: number; active: number; ids: Set<string> }>> {
  const client = getSupabaseClient();
  const rows: LocalRow[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const { data, error } = await client.from('jobs').select('company,external_job_id,is_active,is_closed').eq('source_system', 'collector_feed').range(offset, offset + 999);
    if (error) throw new Error(`读取本地岗位失败: ${error.message}`);
    rows.push(...((data || []) as LocalRow[]));
    if (!data || data.length < 1_000) break;
  }
  const byCompany = new Map<string, { total: number; active: number; ids: Set<string> }>();
  for (const row of rows) {
    const company = text(row.company) || '(未注明公司)';
    const entry = byCompany.get(company) || { total: 0, active: 0, ids: new Set<string>() };
    entry.total += 1;
    if (row.is_active !== false && row.is_closed !== true) {
      entry.active += 1;
      const id = text(row.external_job_id);
      if (id) entry.ids.add(id);
    }
    byCompany.set(company, entry);
  }
  return byCompany;
}

async function main(): Promise<void> {
  const [feed, local] = await Promise.all([scanFeed(), scanLocal()]);
  const companies = [...new Set([...feed.keys(), ...local.keys()])].map((company) => {
    const upstream = feed.get(company) || { rows: 0, open: 0, ids: new Set<string>(), closed: 0 };
    const site = local.get(company) || { total: 0, active: 0, ids: new Set<string>() };
    const extra = [...site.ids].filter((id) => !upstream.ids.has(id)).length;
    const missing = [...upstream.ids].filter((id) => !site.ids.has(id)).length;
    return { company, upstream_open_rows: upstream.open, upstream_unique_ids: upstream.ids.size, local_active_rows: site.active, local_unique_ids: site.ids.size, local_minus_upstream: site.ids.size - upstream.ids.size, local_ids_not_in_upstream: extra, upstream_ids_not_on_site: missing };
  }).sort((a, b) => b.local_minus_upstream - a.local_minus_upstream || a.company.localeCompare(b.company));
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), company_count: companies.length, feed_companies: feed.size, local_companies: local.size, companies }, null, 2));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });
