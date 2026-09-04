import { parseAshbyBoard } from '@/lib/job-connectors/ashby';
import { parseGreenhouseBoard } from '@/lib/job-connectors/greenhouse';
import { parseLeverBoard } from '@/lib/job-connectors/lever';
import { parsePhenomJob } from '@/lib/job-connectors/phenom';
import { fetchOracleHcmBoard } from '@/lib/job-connectors/oracle-hcm';
import type { ConnectorBoardConfig, ConnectorJob } from '@/lib/job-connectors/types';

export interface ConnectorFetchResult {
  connector: ConnectorBoardConfig['connector'];
  company: string;
  board: string;
  jobs: ConnectorJob[];
  received: number;
  dropped: number;
  fetchedAt: string;
  sourceUrl: string;
  detailRequested: number;
  detailFailed: number;
  /** Explicitly closed official detail pages that contain no matching job data. */
  detailClosed: number;
  /** Pages with valid job data plus a dormant expiration component. Kept open. */
  detailAmbiguous: number;
  /** Duplicate list rows retained for audit; rows are merged by stable ID. */
  duplicateListingRows: number;
  duplicateExternalIds: number;
}

type FetchOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  /** Detail pages are only needed for existing records being audited/backfilled. */
  detailJobIds?: ReadonlySet<string>;
};

function connectorUrl(config: ConnectorBoardConfig): string {
  if (config.connector === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(config.board)}/jobs?content=true`;
  if (config.connector === 'ashby') return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(config.board)}`;
  if (config.connector === 'lever') return `https://api.lever.co/v0/postings/${encodeURIComponent(config.board)}?mode=json`;
  if (config.phenomSearchUrl) return config.phenomSearchUrl;
  throw new Error(`Phenom 公司 ${config.company} 缺少官方搜索页配置`);
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  url: string,
  timeoutMs: number,
  accept: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      headers: { Accept: accept },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`官方岗位源返回 HTTP ${response.status}: ${url}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/** Extract a JSON object assigned in an official Phenom HTML page safely. */
export function extractEmbeddedJsonAssignment(html: string, assignment: string): unknown {
  const marker = html.indexOf(assignment);
  if (marker < 0) throw new Error(`官方 Phenom 页面缺少 ${assignment}`);
  const start = html.indexOf('{', marker + assignment.length);
  if (start < 0) throw new Error(`官方 Phenom 页面中的 ${assignment} 不是 JSON 对象`);

  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, index + 1));
        } catch {
          throw new Error(`官方 Phenom 页面中的 ${assignment} JSON 无法解析`);
        }
      }
    }
  }
  throw new Error(`官方 Phenom 页面中的 ${assignment} JSON 未闭合`);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numeric(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(typeof value === 'string' ? value : NaN);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function phenomListPayload(html: string): { jobs: unknown[]; totalHits: number | null } {
  const payload = object(extractEmbeddedJsonAssignment(html, 'phApp.ddo ='));
  const eager = object(payload.eagerLoadRefineSearch);
  const data = object(eager.data);
  return {
    jobs: Array.isArray(data.jobs) ? data.jobs : [],
    totalHits: numeric(eager.totalHits),
  };
}

function phenomDetailPayload(html: string): Record<string, unknown> | null {
  const payload = object(extractEmbeddedJsonAssignment(html, 'phApp.ddo ='));
  const job = object(object(object(payload.jobDetail).data).job);
  return Object.keys(job).length > 0 ? job : null;
}

/**
 * Phenom templates can include a dormant expired-job panel on valid pages.
 * A matching official payload proves that the panel alone is not a closure
 * signal for this specific URL.
 */
export function hasMatchingPhenomDetailPayload(url: string, html: string): boolean {
  try {
    const externalJobId = new URL(url).pathname.match(/\/job\/([^/]+)/i)?.[1];
    if (!externalJobId) return false;
    const detail = phenomDetailPayload(html);
    return detail?.jobSeqNo === decodeURIComponent(externalJobId);
  } catch {
    // `fetchSafeExternalPage` intentionally preserves only the first part of
    // a large page. BCG's payload starts early but its `jobSeqNo` can fall
    // beyond that limit, so JSON parsing is necessarily incomplete. The
    // official detail envelope still proves that this is a job detail, while
    // a genuine expired page has no `jobDetail.data.job` payload at all.
    return /phApp\.ddo\s*=\s*\{\s*"jobDetail"\s*:\s*\{[\s\S]{0,300}?"data"\s*:\s*\{\s*"job"\s*:\s*\{/i.test(html);
  }
}

function phenomDetailIsExplicitlyClosed(html: string): boolean {
  // This is deliberately a secondary signal. Some Phenom tenants include an
  // expired-job component in every HTML response, including pages with a
  // matching live `jobDetail` payload.
  const visibleText = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:#x27|#39|apos);/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  return /(?:job|position|role|opening|opportunity).{0,100}(?:has been filled|is filled|is closed|no longer available|no longer accepting applications|has expired)/i.test(visibleText)
    || /we'?re sorry.{0,200}(?:job|position|role).{0,100}(?:filled|closed|no longer available|expired)/i.test(visibleText);
}

function phenomJobUrl(searchUrl: string, externalJobId: string): string {
  const search = new URL(searchUrl);
  const basePath = search.pathname.replace(/\/search-results\/?$/i, '/');
  return new URL(`${basePath}job/${encodeURIComponent(externalJobId)}`, search.origin).toString();
}

function mergePhenomListJob(
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const locations = [
    existing.location,
    ...(Array.isArray(existing.multi_location_array) ? existing.multi_location_array : []),
    ...(Array.isArray(existing.multi_location) ? existing.multi_location : []),
    next.location,
    ...(Array.isArray(next.multi_location_array) ? next.multi_location_array : []),
    ...(Array.isArray(next.multi_location) ? next.multi_location : []),
  ].filter((value) => value != null);
  return {
    ...existing,
    ...next,
    multi_location_array: locations,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  action: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await action(items[index]);
    }
  }));
  return results;
}

async function fetchPhenomBoard(
  config: ConnectorBoardConfig,
  fetcher: typeof fetch,
  timeoutMs: number,
  detailJobIds?: ReadonlySet<string>,
): Promise<ConnectorFetchResult> {
  const sourceUrl = connectorUrl(config);
  const firstResponse = await fetchWithTimeout(fetcher, sourceUrl, timeoutMs, 'text/html,application/xhtml+xml');
  const firstPage = phenomListPayload(await firstResponse.text());
  const listJobs = [...firstPage.jobs];
  const totalHits = firstPage.totalHits;
  const pageSize = firstPage.jobs.length;
  if (totalHits != null && pageSize === 0 && totalHits > 0) {
    throw new Error(`${config.company} 官方 Phenom 列表声明 ${totalHits} 条岗位，但首屏没有岗位数据`);
  }
  if (totalHits != null && pageSize > 0) {
    const offsets: number[] = [];
    for (let offset = pageSize; offset < totalHits; offset += pageSize) offsets.push(offset);
    const pages = await mapWithConcurrency(offsets, 6, async (offset) => {
      const pageUrl = new URL(sourceUrl);
      pageUrl.searchParams.set('from', String(offset));
      pageUrl.searchParams.set('s', '1');
      const response = await fetchWithTimeout(fetcher, pageUrl.toString(), timeoutMs, 'text/html,application/xhtml+xml');
      const page = phenomListPayload(await response.text());
      if (page.jobs.length === 0) {
        throw new Error(`${config.company} 官方 Phenom 列表在 offset=${offset} 提前结束（期望 ${totalHits} 条）`);
      }
      return page.jobs;
    });
    for (const jobs of pages) listJobs.push(...jobs);
  }

  const byExternalId = new Map<string, Record<string, unknown>>();
  let duplicateListingRows = 0;
  let duplicateConflictingIds = 0;
  for (const item of listJobs) {
    const job = object(item);
    const id = typeof job.jobSeqNo === 'string' ? job.jobSeqNo.trim() : '';
    if (!id) continue;
    const existing = byExternalId.get(id);
    if (!existing) {
      byExternalId.set(id, job);
      continue;
    }
    duplicateListingRows += 1;
    // Phenom commonly repeats one role for multiple locations or categories.
    // Only a disagreement in immutable identity fields indicates a bad
    // pagination/matching result; location differences are expected and are
    // merged into multi_location_array by mergePhenomListJob.
    const existingTitle = String(existing.title || existing.name || '').trim();
    const nextTitle = String(job.title || job.name || '').trim();
    const existingCompany = String(existing.companyName || existing.company || '').trim();
    const nextCompany = String(job.companyName || job.company || '').trim();
    const existingUrl = String(existing.jobUrl || existing.jobPostingUrl || '').trim();
    const nextUrl = String(job.jobUrl || job.jobPostingUrl || '').trim();
    if ((existingTitle && nextTitle && existingTitle !== nextTitle)
      || (existingCompany && nextCompany && existingCompany !== nextCompany)
      || (existingUrl && nextUrl && existingUrl !== nextUrl)) {
      duplicateConflictingIds += 1;
    }
    byExternalId.set(id, mergePhenomListJob(existing, job));
  }
  const duplicateExternalIds = duplicateConflictingIds;

  const detailTargets = [...byExternalId.keys()].filter((id) => detailJobIds?.has(id));
  let detailFailed = 0;
  let detailClosed = 0;
  let detailAmbiguous = 0;
  const detailed = await mapWithConcurrency(detailTargets, 4, async (id) => {
    const jobUrl = phenomJobUrl(sourceUrl, id);
    try {
      const response = await fetchWithTimeout(fetcher, jobUrl, timeoutMs, 'text/html,application/xhtml+xml');
      const html = await response.text();
      const explicitlyClosed = phenomDetailIsExplicitlyClosed(html);
      let detail: Record<string, unknown> | null = null;
      try {
        detail = phenomDetailPayload(html);
      } catch (error) {
        if (explicitlyClosed) return { id, detail: null, jobUrl, closed: true };
        throw error;
      }
      if (detail && detail.jobSeqNo === id) {
        if (explicitlyClosed) detailAmbiguous += 1;
        return { id, detail, jobUrl, closed: false };
      }
      if (explicitlyClosed) return { id, detail: null, jobUrl, closed: true };
      throw new Error('详情页岗位 ID 不匹配');
    } catch {
      detailFailed += 1;
      return { id, detail: null, jobUrl, closed: false };
    }
  });
  for (const { id, detail, jobUrl, closed } of detailed) {
    const listed = byExternalId.get(id);
    if (!listed) continue;
    if (closed) {
      detailClosed += 1;
      byExternalId.set(id, { ...listed, jobUrl, status: 'closed' });
    } else {
      byExternalId.set(id, { ...listed, ...(detail || {}), jobUrl });
    }
  }

  const jobs = [...byExternalId.values()]
    .map((job) => parsePhenomJob(job, {
      companyName: config.company,
      boardToken: config.board,
      sourceUrl: phenomJobUrl(sourceUrl, String(job.jobSeqNo || '')),
    }))
    .filter((job): job is ConnectorJob => Boolean(job));
  return {
    connector: config.connector,
    company: config.company,
    board: config.board,
    jobs,
    received: listJobs.length,
    dropped: Math.max(0, byExternalId.size - jobs.length),
    fetchedAt: new Date().toISOString(),
    sourceUrl,
    detailRequested: detailTargets.length,
    detailFailed,
    detailClosed,
    detailAmbiguous,
    duplicateListingRows,
    duplicateExternalIds,
  };
}

export async function fetchConnectorBoard(
  config: ConnectorBoardConfig,
  options: FetchOptions = {},
): Promise<ConnectorFetchResult> {
  const fetcher = options.fetcher || fetch;
  const timeoutMs = Math.min(Math.max(options.timeoutMs || 30_000, 1_000), 120_000);
  if (config.connector === 'oracle_hcm') {
    return fetchOracleHcmBoard(config, { fetcher, timeoutMs, detailJobIds: options.detailJobIds });
  }
  if (config.connector === 'phenom') {
    return fetchPhenomBoard(config, fetcher, timeoutMs, options.detailJobIds);
  }

  const boards = [config.board, ...(config.boardAliases || [])];
  const results = await Promise.all(boards.map(async (board) => {
    const sourceUrl = connectorUrl({ ...config, board });
    const response = await fetchWithTimeout(fetcher, sourceUrl, timeoutMs, 'application/json');
    const payload = await response.json() as unknown;
    const parseOptions = { companyName: config.company, boardToken: board };
    const rawJobs = config.connector === 'lever'
      ? Array.isArray(payload) ? payload : Array.isArray((payload as { postings?: unknown[] } | null)?.postings) ? (payload as { postings: unknown[] }).postings : []
      : Array.isArray((payload as { jobs?: unknown[] } | null)?.jobs) ? (payload as { jobs: unknown[] }).jobs : [];
    const jobs = config.connector === 'greenhouse'
      ? parseGreenhouseBoard((payload || {}) as { jobs?: unknown[] }, parseOptions)
      : config.connector === 'ashby'
        ? parseAshbyBoard((payload || {}) as { jobs?: unknown[] }, parseOptions)
        : parseLeverBoard(payload, parseOptions);
    return { jobs, received: rawJobs.length, dropped: Math.max(0, rawJobs.length - jobs.length), sourceUrl };
  }));
  const byId = new Map(results.flatMap((result) => result.jobs).map((job) => [job.external_job_id || job.id, job]));
  return {
    connector: config.connector,
    company: config.company,
    board: config.board,
    jobs: [...byId.values()],
    received: results.reduce((sum, result) => sum + result.received, 0),
    dropped: results.reduce((sum, result) => sum + result.dropped, 0),
    fetchedAt: new Date().toISOString(),
    sourceUrl: results.map((result) => result.sourceUrl).join(','),
    detailRequested: 0,
    detailFailed: 0,
    detailClosed: 0,
    detailAmbiguous: 0,
    duplicateListingRows: 0,
    duplicateExternalIds: 0,
  };
}
