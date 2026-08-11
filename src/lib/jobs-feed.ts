import type { SupabaseClient } from '@supabase/supabase-js';
import { syncJobRecords, type JobSyncRecord } from '@/lib/job-sync';
import { isTargetRegion } from '@/lib/job-region-scope';

const DEFAULT_FEED_URL = 'https://hfscareer.com/collector-api/integrations/v1/jobs';
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGES_PER_RUN = 1000;

export interface JobsFeedItem {
  id: string;
  external_job_id?: string | null;
  company_name?: string | null;
  title?: string | null;
  description?: string | null;
  source_url?: string | null;
  location?: string | null;
  country?: string | null;
  department?: string | null;
  job_function?: string | null;
  level?: string | null;
  required_skills?: unknown[] | null;
  preferred_skills?: unknown[] | null;
  visa_sponsorship?: boolean | null;
  date_posted?: string | null;
  valid_through?: string | null;
  employment_type?: string | null;
  status?: string | null;
  sync_action?: 'upsert' | 'close';
  missing_fields?: string[];
  data_completeness?: string | null;
  source_evidence?: Record<string, unknown>;
  lifecycle?: unknown[];
  raw_payload?: Record<string, unknown> | null;
}

interface FeedPage {
  items?: JobsFeedItem[];
  next_cursor?: string | null;
  has_more?: boolean;
  contract_version?: string;
}

export interface JobsFeedSyncResult {
  pages: number;
  received: number;
  upserted: number;
  closed: number;
  skipped: number;
  failed: number;
  next_cursor: string | null;
  has_more: boolean;
}

function getFeedConfig() {
  const apiKey = process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY;
  if (!apiKey) {
    throw new Error('未配置 JOBS_FEED_API_KEY（或 INTEGRATION_API_KEY）');
  }

  const pageSize = Number.parseInt(process.env.JOBS_FEED_PAGE_SIZE || '', 10);
  return {
    url: process.env.JOBS_FEED_URL || DEFAULT_FEED_URL,
    apiKey,
    pageSize: Number.isFinite(pageSize) ? Math.min(Math.max(pageSize, 1), 500) : DEFAULT_PAGE_SIZE,
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function inferDirection(item: JobsFeedItem): string {
  const value = `${text(item.job_function)} ${text(item.department)} ${text(item.title)}`.toLowerCase();
  if (/quant|trading|trader/.test(value)) return 'Quant';
  if (/investment banking|ibd|sales.?and.?trading|capital markets/.test(value)) return 'IBD/S&T';
  if (/risk|compliance|fraud|regulatory/.test(value)) return 'Risk';
  if (/machine learning|artificial intelligence|\bml\b|\bai\b|research scientist/.test(value)) return 'ML/AI';
  if (/data|analytics|statistic/.test(value)) return 'Data';
  if (/software|developer|engineering|engineer|technology|\bswe\b|devops|infrastructure/.test(value)) return 'SDE';
  if (/product|program manager/.test(value)) return 'PM';
  if (/consult/.test(value)) return 'Consulting';
  if (/marketing|communications|brand/.test(value)) return 'MKT';
  if (/legal|attorney|counsel/.test(value)) return 'Legal';
  return 'Finance';
}

function inferJobType(item: JobsFeedItem): string {
  const value = `${text(item.title)} ${text(item.employment_type)} ${text(item.level)}`.toLowerCase();
  if (/intern|internship|summer analyst|summer associate/.test(value)) return '实习';
  if (/graduate|new grad|entry.?level|campus|early career/.test(value)) return '校招';
  return text(item.employment_type) || '社招';
}

function normalizeItem(item: JobsFeedItem): JobSyncRecord | null {
  const title = text(item.title);
  const company = text(item.company_name);
  const sourceUrl = text(item.source_url);
  if (!title || !company || !sourceUrl) return null;

  const description = text(item.description);
  const required = list(item.required_skills);
  const preferred = list(item.preferred_skills);
  const location = text(item.location) || text(item.country) || '未注明';
  if (!isTargetRegion(item.location, item.country)) return null;
  const evidence = item.source_evidence ? JSON.stringify(item.source_evidence) : '';
  const requirements = required.length > 0 ? required.join('\n') : '';
  const niceToHave = preferred.length > 0 ? preferred.join('\n') : '';
  const status = text(item.status).toLowerCase();
  const closed = item.sync_action === 'close' || status === 'closed' || status === 'close';

  return {
    title: title.substring(0, 255),
    company: company.substring(0, 255),
    region: location.substring(0, 100),
    direction: inferDirection(item),
    audience: '留学生',
    job_type: inferJobType(item).substring(0, 50),
    description: (description || evidence || title).substring(0, 50000),
    overview: description ? description.substring(0, 50000) : null,
    responsibilities: null,
    requirements: requirements.substring(0, 50000) || null,
    nice_to_have: niceToHave.substring(0, 50000) || null,
    salary_range: null,
    job_url: sourceUrl.substring(0, 2048),
    source_url: sourceUrl.substring(0, 2048),
    sponsorship: item.visa_sponsorship === true ? 'yes' : item.visa_sponsorship === false ? 'no' : 'unknown',
    is_active: !closed,
    is_closed: closed,
  };
}

async function fetchPage(cursor?: string, since?: string): Promise<FeedPage> {
  const config = getFeedConfig();
  const params = new URLSearchParams({ include_closed: 'true' });
  if (cursor) params.set('cursor', cursor);
  if (since) params.set('since', since);

  let lastError: unknown;
  const limits = [...new Set([config.pageSize, 50, 25, 10, 1].filter((limit) => limit <= config.pageSize))];
  const cursors: Array<string | undefined> = cursor ? [cursor] : [undefined];
  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { updated_at?: string };
      if (decoded.updated_at) {
        const timestamp = Date.parse(decoded.updated_at);
        if (Number.isFinite(timestamp)) {
          for (const delta of [-1, 1]) {
            cursors.push(Buffer.from(JSON.stringify({ ...decoded, updated_at: new Date(timestamp + delta).toISOString() })).toString('base64url'));
          }
        }
      }
    } catch {
      // 游标格式由数据源定义，无法解析时继续使用原游标重试。
    }
  }
  for (const candidateCursor of cursors) {
    if (candidateCursor) params.set('cursor', candidateCursor);
    else params.delete('cursor');
    for (const limit of limits) {
      params.set('limit', String(limit));
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60_000);
        try {
          const response = await fetch(`${config.url}?${params.toString()}`, {
            headers: {
              Accept: 'application/json',
              'X-Integration-Key': config.apiKey,
            },
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(`招聘数据源返回 HTTP ${response.status}`);
          }
          return await response.json() as FeedPage;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
        } finally {
          clearTimeout(timeout);
        }
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('招聘数据源请求失败');
}

export async function syncJobsFeed(
  client: SupabaseClient,
  options: { cursor?: string; since?: string; maxPages?: number } = {},
): Promise<JobsFeedSyncResult> {
  const maxPages = Math.min(Math.max(options.maxPages ?? MAX_PAGES_PER_RUN, 1), MAX_PAGES_PER_RUN);
  let cursor = options.cursor;
  let hasMore = true;
  const result: JobsFeedSyncResult = {
    pages: 0,
    received: 0,
    upserted: 0,
    closed: 0,
    skipped: 0,
    failed: 0,
    next_cursor: cursor || null,
    has_more: false,
  };

  while (hasMore && result.pages < maxPages) {
    const page = await fetchPage(cursor, cursor ? undefined : options.since);
    const items = Array.isArray(page.items) ? page.items : [];
    result.pages += 1;
    result.received += items.length;

    const openItems: JobSyncRecord[] = [];
    for (const item of items) {
      if (item.sync_action === 'close' || text(item.status).toLowerCase() === 'closed') {
        const sourceUrl = text(item.source_url);
        if (!sourceUrl) {
          result.skipped += 1;
          continue;
        }
        const { error } = await client.from('jobs').update({
          is_active: false,
          is_closed: true,
          updated_at: new Date().toISOString(),
        }).eq('job_url', sourceUrl);
        if (error) result.failed += 1;
        else result.closed += 1;
        continue;
      }
      const normalized = normalizeItem(item);
      if (normalized) openItems.push(normalized);
      else result.skipped += 1;
    }

    if (openItems.length > 0) {
      const synced = await syncJobRecords(client, openItems, 'sync');
      result.upserted += synced.created + synced.updated;
      result.failed += synced.failed;
      result.skipped += synced.skipped + synced.invalidJobs.length;
    }

    cursor = page.next_cursor || undefined;
    hasMore = page.has_more === true && Boolean(cursor);
    result.next_cursor = cursor || null;
  }

  result.has_more = hasMore;
  return result;
}
