import { config as loadDotenv } from 'dotenv';
import { PHASE2_CONNECTOR_BOARDS, fetchConnectorBoard } from '@/lib/job-connectors';

loadDotenv({ path: '.env.local' });

const TARGET_COMPANIES = new Set(['Coinbase', 'Asana', 'Brex', 'Databricks', 'Figma', 'GitLab']);
const PAGE_SIZE = 500;
const MAX_PAGES = 500;

type FeedItem = {
  id?: unknown;
  external_job_id?: unknown;
  company_id?: unknown;
  company_name?: unknown;
  title?: unknown;
  source_url?: unknown;
  status?: unknown;
  sync_action?: unknown;
  closed_at?: unknown;
  description?: unknown;
  detail_status?: unknown;
  source_evidence?: Record<string, unknown> | null;
};

type CompanyAudit = {
  upstream_items: number;
  upstream_unique_external_ids: number;
  upstream_duplicate_external_ids: number;
  upstream_closed_items: number;
  upstream_with_description: number;
  upstream_detail_fetched: number;
  upstream_company_ids: string[];
  upstream_sample_titles: string[];
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function isClosed(item: FeedItem): boolean {
  const status = text(item.status).toLowerCase();
  return item.sync_action === 'close' || status === 'closed' || status === 'close' || Boolean(text(item.closed_at));
}

function createAudit(): CompanyAudit {
  return {
    upstream_items: 0,
    upstream_unique_external_ids: 0,
    upstream_duplicate_external_ids: 0,
    upstream_closed_items: 0,
    upstream_with_description: 0,
    upstream_detail_fetched: 0,
    upstream_company_ids: [],
    upstream_sample_titles: [],
  };
}

async function fetchOfficialCounts() {
  const boards = PHASE2_CONNECTOR_BOARDS.filter((board) => TARGET_COMPANIES.has(board.company));
  const results = await Promise.all(boards.map(async (board) => {
    try {
      const official = await fetchConnectorBoard(board, { timeoutMs: 60_000 });
      return [board.company, {
        official_connector: board.connector,
        official_board: board.board,
        official_received: official.received,
        official_parsed_open: official.jobs.filter((job) => job.status !== 'closed').length,
        official_dropped: official.dropped,
        official_unique_external_ids: new Set(official.jobs.map((job) => text(job.external_job_id || job.id)).filter(Boolean)).size,
        official_external_ids: official.jobs.map((job) => text(job.external_job_id || job.id)).filter(Boolean),
      }] as const;
    } catch (error) {
      return [board.company, { official_error: error instanceof Error ? error.message : String(error) }] as const;
    }
  }));
  return Object.fromEntries(results);
}

async function main() {
  const feedUrl = process.env.JOBS_FEED_URL || 'https://hfscareer.com/collector-api/integrations/v1/jobs';
  const apiKey = process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY;
  if (!apiKey) throw new Error('缺少 JOBS_FEED_API_KEY 或 INTEGRATION_API_KEY');
  const officialPromise = fetchOfficialCounts();
  const audits = Object.fromEntries([...TARGET_COMPANIES].map((company) => [company, createAudit()])) as Record<string, CompanyAudit>;
  const seenExternalIds = Object.fromEntries([...TARGET_COMPANIES].map((company) => [company, new Set<string>()])) as Record<string, Set<string>>;
  let pages = 0;
  let received = 0;
  let cursor: string | null = null;
  let contractVersion: string | null = null;

  for (; pages < MAX_PAGES; pages += 1) {
    const url = new URL(feedUrl);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('include_closed', 'false');
    if (cursor) url.searchParams.set('cursor', cursor);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    let payload: { items?: FeedItem[]; next_cursor?: string | null; has_more?: boolean; contract_version?: string };
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'X-Integration-Key': apiKey },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`上游 feed HTTP ${response.status}`);
      payload = await response.json() as typeof payload;
    } finally {
      clearTimeout(timeout);
    }
    contractVersion ||= text(payload.contract_version) || null;
    const items = Array.isArray(payload.items) ? payload.items : [];
    received += items.length;
    for (const item of items) {
      const company = text(item.company_name);
      if (!TARGET_COMPANIES.has(company)) continue;
      const audit = audits[company];
      audit.upstream_items += 1;
      if (isClosed(item)) audit.upstream_closed_items += 1;
      const externalId = text(item.external_job_id || item.id);
      if (externalId) {
        if (seenExternalIds[company].has(externalId)) audit.upstream_duplicate_external_ids += 1;
        else seenExternalIds[company].add(externalId);
      }
      const description = text(item.description);
      if (description.length >= 160 && !description.startsWith('{')) audit.upstream_with_description += 1;
      const detailStatus = text(item.detail_status || item.source_evidence?.detail_status).toLowerCase();
      if (/^fetched/.test(detailStatus)) audit.upstream_detail_fetched += 1;
      const companyId = text(item.company_id);
      if (companyId && !audit.upstream_company_ids.includes(companyId)) audit.upstream_company_ids.push(companyId);
      const title = text(item.title);
      if (title && audit.upstream_sample_titles.length < 5) audit.upstream_sample_titles.push(title);
    }
    cursor = payload.next_cursor || null;
    console.log(JSON.stringify({ phase: 'feed_scan', pages: pages + 1, received, cursor: Boolean(cursor), counts: Object.fromEntries([...TARGET_COMPANIES].map((company) => [company, audits[company].upstream_items])) }));
    if (!payload.has_more || !cursor) break;
  }
  for (const company of TARGET_COMPANIES) audits[company].upstream_unique_external_ids = seenExternalIds[company].size;

  const official = await officialPromise;
  const companies = Object.fromEntries([...TARGET_COMPANIES].map((company) => {
    const officialEntry = official[company] || {};
    const audit = audits[company];
    const officialCount = typeof officialEntry.official_parsed_open === 'number' ? officialEntry.official_parsed_open : null;
    return [company, {
      ...officialEntry,
      ...audit,
      delta_upstream_vs_official: officialCount == null ? null : audit.upstream_unique_external_ids - officialCount,
      coverage_ratio: officialCount && officialCount > 0 ? Number((audit.upstream_unique_external_ids / officialCount).toFixed(4)) : null,
      missing_upstream_external_ids: Array.isArray(officialEntry.official_external_ids)
        ? officialEntry.official_external_ids.filter((id: string) => !seenExternalIds[company].has(id))
        : null,
      extra_upstream_external_ids: Array.isArray(officialEntry.official_external_ids)
        ? [...seenExternalIds[company]].filter((id) => !officialEntry.official_external_ids.includes(id))
        : null,
    }];
  }));
  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    feed_url: feedUrl,
    feed_contract_version: contractVersion,
    feed_pages: pages + 1,
    feed_received: received,
    companies,
  }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });
