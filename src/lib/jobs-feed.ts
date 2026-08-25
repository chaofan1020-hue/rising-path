import type { SupabaseClient } from '@supabase/supabase-js';
import { syncJobRecords, type JobSyncRecord } from '@/lib/job-sync';
import { jobHtmlToPlainText, sanitizeJobContent } from '@/lib/job-content';
import { isTargetRegion } from '@/lib/job-region-scope';
import { resolveJobDeadline } from '@/lib/job-deadline';
import {
  isDefinitivelyClosed,
  observeJobLinkHealth,
} from '@/lib/job-link-health';
import { enrichGreenhouseOffices } from '@/lib/greenhouse-location-enrichment';
import { enrichAshbyLocations } from '@/lib/ashby-location-enrichment';

const DEFAULT_FEED_URL = 'https://hfscareer.com/collector-api/integrations/v1/jobs';
export const JOBS_FEED_SOURCE = 'collector_feed';
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGES_PER_RUN = 1000;

export interface JobsFeedItem {
  id: string;
  external_job_id?: string | null;
  company_name?: string | null;
  title?: string | null;
  description?: string | null;
  source_url?: string | null;
  location?: unknown;
  country?: unknown;
  offices?: unknown;
  official_location?: unknown;
  department?: string | null;
  job_function?: string | null;
  level?: string | null;
  required_skills?: unknown[] | null;
  preferred_skills?: unknown[] | null;
  visa_sponsorship?: boolean | null;
  date_posted?: string | null;
  valid_through?: string | null;
  application_deadline?: string | null;
  deadline?: string | null;
  application_close_date?: string | null;
  application_closing_date?: string | null;
  closing_date?: string | null;
  close_date?: string | null;
  end_date?: string | null;
  expires_at?: string | null;
  expiration_date?: string | null;
  employment_type?: string | null;
  responsibilities?: string | null;
  qualifications?: string | null;
  application_process?: string | null;
  status?: string | null;
  sync_action?: 'upsert' | 'close';
  closed_at?: string | null;
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
  open_seen: number;
  skipped_by_reason: Record<string, number>;
}

function getFeedConfig() {
  const apiKey = process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY;
  if (!apiKey) {
    throw new Error('未配置 JOBS_FEED_API_KEY（或 INTEGRATION_API_KEY）');
  }

  const pageSize = Number.parseInt(process.env.JOBS_FEED_PAGE_SIZE || '', 10);
  return sanitizeJobContent({
    url: process.env.JOBS_FEED_URL || DEFAULT_FEED_URL,
    apiKey,
    pageSize: Number.isFinite(pageSize) ? Math.min(Math.max(pageSize, 1), 500) : DEFAULT_PAGE_SIZE,
  });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

export function normalizeFeedLocation(value: unknown, depth = 0): string {
  if (depth > 2 || value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map((item) => normalizeFeedLocation(item, depth + 1)).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [
      record.city,
      record.city_name,
      record.state,
      record.state_code,
      record.region,
      record.country,
      record.country_code,
      record.name,
      record.label,
      record.location,
      record.address,
    ].map((item) => normalizeFeedLocation(item, depth + 1)).filter(Boolean).join(', ');
  }
  return '';
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
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

export function normalizeFeedItem(item: JobsFeedItem): JobSyncRecord | null {
  const title = text(item.title);
  const company = text(item.company_name);
  const sourceUrl = text(item.source_url);
  if (!title || !company || !sourceUrl) return null;

  // Normalize rich text before writing it to the shared jobs table. The feed
  // frequently returns HTML (and sometimes encoded HTML), so keeping the raw
  // payload here would reintroduce markup every time an existing job is synced.
  const description = jobHtmlToPlainText(item.description);
  const required = list(item.required_skills);
  const preferred = list(item.preferred_skills);
  const rawLocation = [
    normalizeFeedLocation(item.location),
    normalizeFeedLocation(item.offices),
    normalizeFeedLocation(item.official_location),
  ].filter(Boolean).join(', ');
  const rawCountry = normalizeFeedLocation(item.country);
  const location = [rawLocation, rawCountry].filter(Boolean).join(', ') || '未注明';
  if (!isTargetRegion(rawLocation, rawCountry)) return null;
  const evidence = item.source_evidence ? JSON.stringify(item.source_evidence) : '';
  const requirements = required.length > 0
    ? required.map((value) => jobHtmlToPlainText(value)).filter(Boolean).join('\n')
    : '';
  const niceToHave = preferred.length > 0
    ? preferred.map((value) => jobHtmlToPlainText(value)).filter(Boolean).join('\n')
    : '';
  const rawHealth = observeJobLinkHealth(item.source_evidence);
  const closeSignal = hasFeedCloseSignal(item)
    || rawHealth.availabilityStatus === 'closed'
    || rawHealth.linkHealth === 'closed';
  const health = closeSignal
    ? {
      availabilityStatus: 'unknown' as const,
      linkHealth: 'unknown' as const,
      httpStatus: null,
      error: '上游标记岗位关闭，等待官网链接核验',
      checkedAt: null,
    }
    : rawHealth;
  const closed = isClosedItem(item);

  return {
    title: title.substring(0, 255),
    company: company.substring(0, 255),
    region: location.substring(0, 100),
    direction: inferDirection(item),
    audience: '留学生',
    job_type: inferJobType(item).substring(0, 50),
    description: (description || evidence || title).substring(0, 50000),
    // The feed has no separate overview field. Persisting the same body in
    // both columns doubles storage for every job; the detail view falls back
    // to description when no curated overview is available.
    overview: null,
    responsibilities: null,
    requirements: requirements.substring(0, 50000) || null,
    nice_to_have: niceToHave.substring(0, 50000) || null,
    salary_range: null,
    job_url: sourceUrl.substring(0, 2048),
    source_url: sourceUrl.substring(0, 2048),
    sponsorship: item.visa_sponsorship === true ? 'yes' : item.visa_sponsorship === false ? 'no' : 'unknown',
    is_active: !closed,
    is_closed: closed,
    source_system: JOBS_FEED_SOURCE,
    external_job_id: text(item.external_job_id) || text(item.id) || null,
    valid_through: resolveJobDeadline(item)?.value || null,
    missing_from_feed_at: null,
    missing_feed_checks: 0,
    availability_status: health.availabilityStatus,
    link_health: health.linkHealth,
    last_link_error: health.error,
    last_link_http_status: health.httpStatus,
    availability_checked_at: health.checkedAt,
  };
}

function normalizeSkipReason(item: JobsFeedItem): string | null {
  if (!text(item.title)) return 'missing_title';
  if (!text(item.company_name)) return 'missing_company';
  if (!text(item.source_url)) return 'missing_source_url';
  if (!isTargetRegion(
    [
      normalizeFeedLocation(item.location),
      normalizeFeedLocation(item.offices),
      normalizeFeedLocation(item.official_location),
    ].filter(Boolean).join(', '),
    normalizeFeedLocation(item.country),
  )) return 'outside_target_region';
  return null;
}

function incrementSkipReason(result: JobsFeedSyncResult, reason: string): void {
  result.skipped += 1;
  result.skipped_by_reason[reason] = (result.skipped_by_reason[reason] || 0) + 1;
}

export function hasFeedCloseSignal(item: JobsFeedItem): boolean {
  const status = text(item.status).toLowerCase();
  return item.sync_action === 'close'
    || status === 'closed'
    || status === 'close'
    || Boolean(text(item.closed_at));
}

export function isClosedItem(item: JobsFeedItem, now = Date.now()): boolean {
  const health = observeJobLinkHealth(item.source_evidence);
  // The collector is the authoritative source for the job lifecycle. A close
  // event must remove the matching catalog record even when the ATS has a
  // stale or generic page cached behind the old application URL.
  if (hasFeedCloseSignal(item)) return true;
  // A 404 remains inconclusive until the local health worker observes it
  // twice. An explicit 410 is definitive immediately.
  if (health.httpStatus === 410) return true;
  if (isDefinitivelyClosed(health) && health.httpStatus === 410) return true;
  // The upstream lifecycle is authoritative. A stale application deadline is
  // not proof that a role was removed; many portals keep open roles listed
  // after the deadline field has passed.
  return false;
}

async function fetchPage(cursor?: string, since?: string, includeClosed = true): Promise<FeedPage> {
  const config = getFeedConfig();
  const params = new URLSearchParams({ include_closed: String(includeClosed) });
  if (cursor) params.set('cursor', cursor);
  if (since) params.set('since', since);

  let lastError: unknown;
  // Use the configured page size for normal operation. Smaller pages remain
  // available for transient gateway failures or an unexpectedly oversized
  // response, but they are no longer the primary synchronization path.
  const limits = [...new Set([
    config.pageSize,
    100,
    25,
    10,
    1,
  ].filter((limit) => limit <= config.pageSize))];
  // Keep the persisted cursor as the source of truth. Falling back to an
  // unscoped first page after a cursor error silently replays the feed.
  const cursors: Array<string | undefined> = [cursor];
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
            lastError = new Error(`招聘数据源返回 HTTP ${response.status}`);
            // Move to a smaller page immediately on a server failure. This
            // avoids retrying a deterministic payload-size or gateway limit
            // while retaining the persisted cursor as the source of truth.
            if (response.status >= 500) break;
            throw lastError;
          }
          const page = await response.json() as FeedPage;
          if (cursor && page.has_more === true && page.next_cursor) {
            if (page.next_cursor === cursor) {
              lastError = new Error('招聘数据源游标没有前进');
              break;
            }
          }
          return page;
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
  options: {
    cursor?: string;
    since?: string;
    maxPages?: number;
    verifiedAt?: string;
    includeClosed?: boolean;
  } = {},
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
    open_seen: 0,
    skipped_by_reason: {},
  };

  while (hasMore && result.pages < maxPages) {
    const requestedCursor = cursor;
    const page = await fetchPage(cursor, cursor ? undefined : options.since, options.includeClosed ?? true);
    const rawItems = Array.isArray(page.items) ? page.items : [];
    const greenhouseEnriched = await enrichGreenhouseOffices(rawItems);
    const items = await enrichAshbyLocations(greenhouseEnriched);
    result.pages += 1;
    result.received += items.length;

    const openItems: JobSyncRecord[] = [];
    const closeSourcesByCompany = new Map<string, string[]>();
    const closeExternalIdsByCompany = new Map<string, string[]>();
    for (const item of items) {
      if (isClosedItem(item)) {
        const sourceUrl = text(item.source_url);
        const externalJobId = text(item.external_job_id) || text(item.id);
        if (!sourceUrl && !externalJobId) {
          incrementSkipReason(result, 'closed_without_identity');
          continue;
        }
        const company = text(item.company_name);
        if (company && sourceUrl) {
          const urls = closeSourcesByCompany.get(company) || [];
          urls.push(sourceUrl);
          closeSourcesByCompany.set(company, urls);
        }
        if (company && externalJobId) {
          const ids = closeExternalIdsByCompany.get(company) || [];
          ids.push(externalJobId);
          closeExternalIdsByCompany.set(company, ids);
        }
        continue;
      }
      const normalized = normalizeFeedItem(item);
      if (normalized) openItems.push(normalized);
      else incrementSkipReason(result, normalizeSkipReason(item) || 'invalid_record');
    }

    const verifiedAt = options.verifiedAt || new Date().toISOString();
    const closePayload = {
      is_active: false,
      is_closed: true,
      source_system: JOBS_FEED_SOURCE,
      updated_at: new Date().toISOString(),
    };
    const closedJobIds = new Set<number>();
    // Stable IDs survive ATS URL rotations, so use them before URL fallbacks.
    for (const [company, externalIds] of closeExternalIdsByCompany) {
      for (const batch of chunks([...new Set(externalIds)], 100)) {
      const { data, error } = await client
        .from('jobs')
        .update(closePayload)
        .eq('source_system', JOBS_FEED_SOURCE)
        .eq('company', company)
        .eq('is_active', true)
        .in('external_job_id', batch)
        .select('id');
      if (error) result.failed += batch.length;
      else {
        for (const job of (data || []) as Array<{ id: number }>) closedJobIds.add(job.id);
      }
      }
    }
    // Older records can predate external IDs. Preserve both URL fallbacks so
    // close events can still find a job after the feed changed its URL field.
    for (const [company, sourceUrls] of closeSourcesByCompany) {
      for (const batch of chunks([...new Set(sourceUrls)], 100)) {
      const { data, error } = await client
        .from('jobs')
        .update(closePayload)
        .eq('source_system', JOBS_FEED_SOURCE)
        .eq('company', company)
        .eq('is_active', true)
        .in('source_url', batch)
        .select('id');
      if (error) result.failed += batch.length;
      else {
        for (const job of (data || []) as Array<{ id: number }>) closedJobIds.add(job.id);
      }
      }
    }
    for (const [company, sourceUrls] of closeSourcesByCompany) {
      for (const batch of chunks([...new Set(sourceUrls)], 100)) {
      const { data, error } = await client
        .from('jobs')
        .update(closePayload)
        .eq('source_system', JOBS_FEED_SOURCE)
        .eq('company', company)
        .eq('is_active', true)
        .in('job_url', batch)
        .select('id');
      if (error) result.failed += batch.length;
      else {
        for (const job of (data || []) as Array<{ id: number }>) closedJobIds.add(job.id);
      }
      }
    }
    result.closed += closedJobIds.size;
    if (closedJobIds.size > 0) {
      const { error: syncStateError } = await client
        .from('job_sync_records')
        .update({
          last_verified_at: verifiedAt,
          missing_from_feed_at: null,
          missing_feed_checks: 0,
          availability_status: 'closed',
          link_health: 'closed',
          last_link_error: null,
          last_link_http_status: null,
          availability_checked_at: verifiedAt,
          updated_at: new Date().toISOString(),
        })
        .in('job_id', [...closedJobIds]);
      if (syncStateError) result.failed += closedJobIds.size;
    }

    if (openItems.length > 0) {
      const synced = await syncJobRecords(client, openItems, 'sync', { verifiedAt });
      result.upserted += synced.created + synced.updated + synced.unchanged;
      result.open_seen += openItems.length;
      result.failed += synced.failed;
      result.skipped += synced.skipped + synced.invalidJobs.length;
      if (synced.skipped > 0) result.skipped_by_reason.invalid_sync_record = (result.skipped_by_reason.invalid_sync_record || 0) + synced.skipped;
      if (synced.invalidJobs.length > 0) result.skipped_by_reason.invalid_sync_record = (result.skipped_by_reason.invalid_sync_record || 0) + synced.invalidJobs.length;
      if (synced.invalidJobs.length > 0) {
        console.error('[JobsFeed] rejected records:', JSON.stringify(synced.invalidJobs.slice(0, 10)));
      }
    }

    const nextCursor = page.next_cursor || undefined;
    if (requestedCursor && nextCursor && nextCursor === requestedCursor) {
      throw new Error('上游游标没有前进，已停止以避免重复同步');
    }
    cursor = nextCursor;
    hasMore = page.has_more === true && Boolean(cursor);
    result.next_cursor = cursor || null;
  }

  result.has_more = hasMore;
  return result;
}
