import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildJobSyncFailure,
  enqueueJobSyncFailures,
  syncJobRecords,
  type JobSyncFailureInput,
  type JobSyncRecord,
} from '@/lib/job-sync';
import { jobHtmlToPlainText, sanitizeJobContent } from '@/lib/job-content';
import { parseExperience } from '@/lib/job-connectors/utils';
import { isTargetRegion } from '@/lib/job-region-scope';
import { resolveJobDeadline } from '@/lib/job-deadline';
import { fieldEvidence as buildFieldEvidence } from '@/lib/job-field-provenance';
import { hasOfficialCompanyHost, isCompanyFieldEvidenceTrusted } from '@/lib/job-company-field-rules';
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
  source_system?: string | null;
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
  compensation?: string | null;
  salary_range?: string | null;
  deadline?: string | null;
  application_close_date?: string | null;
  application_closing_date?: string | null;
  closing_date?: string | null;
  close_date?: string | null;
  end_date?: string | null;
  expires_at?: string | null;
  expiration_date?: string | null;
  employment_type?: string | null;
  experience?: string | null;
  employment_category?: string | null;
  experience_min_years?: number | null;
  experience_max_years?: number | null;
  experience_text?: string | null;
  workplace_type?: string | null;
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

export function isValidFeedPage(value: unknown): value is FeedPage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const page = value as FeedPage;
  if (!Array.isArray(page.items)) return false;
  return page.has_more !== true || typeof page.next_cursor === 'string';
}

export interface JobsFeedSyncResult {
  pages: number;
  received: number;
  upserted: number;
  closed: number;
  skipped: number;
  failed: number;
  row_failures: number;
  fatal_failures: number;
  write_batches: number;
  write_batch_failures: number;
  write_fallback_rows: number;
  write_duration_ms: number;
  next_cursor: string | null;
  has_more: boolean;
  open_seen: number;
  skipped_by_reason: Record<string, number>;
  company_observations: Record<string, {
    received: number;
    upserted: number;
    closed: number;
    skipped: number;
    row_failures: number;
    fatal_failures: number;
  }>;
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

function sourceForField(item: JobsFeedItem, field: string): string | null {
  const evidence = item.source_evidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const sources = (evidence as Record<string, unknown>).structured_field_sources;
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) return null;
  const source = (sources as Record<string, unknown>)[field];
  return typeof source === 'string' ? source.trim() || null : null;
}

function normalizeSalary(item: JobsFeedItem, company: string, sourceUrl: string): { value: string | null; source: string | null } {
  const source = sourceForField(item, 'salary_range') || sourceForField(item, 'compensation');
  const value = text(item.salary_range) || text(item.compensation);
  if (!value || !isCompanyFieldEvidenceTrusted(company, sourceUrl, source)) return { value: null, source: null };
  const normalized = jobHtmlToPlainText(value).replace(/\s+/g, ' ').trim();
  const hasCurrency = /(?:US\$|CA\$|AU\$|HK\$|S\$|\$|€|£|¥|\b(?:USD|CAD|AUD|GBP|EUR|HKD|SGD|CNY|RMB)\b)/i.test(normalized);
  const hasPayAmount = /\d{2,3}(?:[,.]\d{3})*(?:\.\d{1,2})?\s*(?:k|m)?\b/i.test(normalized);
  const hasPayPeriod = /(?:per\s*(?:hour|year|annum|month)|\/\s*(?:hr|hour|year|yr|month)|hourly|annual(?:ly)?|base\s*pay|salary)/i.test(normalized);
  if (!normalized || normalized.length > 160 || /^(?:0|0\.0+|n\/?a|none|not disclosed)$/i.test(normalized)
    || !hasCurrency || !hasPayAmount || (!hasPayPeriod && !/\s(?:-|to|–|—)\s/i.test(normalized))) {
    return { value: null, source: null };
  }
  return { value: normalized, source };
}

function joinLocationParts(values: unknown[]): string {
  const parts: string[] = [];
  for (const value of values) {
    const candidate = normalizeFeedLocation(value).replace(/\s+/g, ' ').trim();
    if (!candidate) continue;
    const normalized = candidate.toLocaleLowerCase();
    if (parts.some((part) => part.toLocaleLowerCase().includes(normalized))) continue;
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      if (normalized.includes(parts[index].toLocaleLowerCase())) parts.splice(index, 1);
    }
    parts.push(candidate);
  }
  return parts.join(', ');
}

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function companyObservation(
  result: JobsFeedSyncResult,
  companyName: string,
): JobsFeedSyncResult['company_observations'][string] | null {
  const company = companyName.trim();
  if (!company) return null;
  const current = result.company_observations[company];
  if (current) return current;
  const created = { received: 0, upserted: 0, closed: 0, skipped: 0, row_failures: 0, fatal_failures: 0 };
  result.company_observations[company] = created;
  return created;
}

type CloseMatchField = 'external_job_id' | 'source_url' | 'job_url';

async function closeJobsByField(
  client: SupabaseClient,
  company: string,
  values: string[],
  field: CloseMatchField,
  closePayload: Record<string, unknown>,
  operation: string,
): Promise<{ closedIds: number[]; failures: JobSyncFailureInput[] }> {
  const closedIds: number[] = [];
  const failures: JobSyncFailureInput[] = [];
  for (const batch of chunks([...new Set(values)], 100)) {
    const { data, error } = await client
      .from('jobs')
      .update(closePayload)
      .eq('source_system', JOBS_FEED_SOURCE)
      .eq('company', company)
      .eq('is_active', true)
      .in(field, batch)
      .select('id');
    if (!error) {
      for (const job of (data || []) as Array<{ id: number }>) closedIds.push(job.id);
      continue;
    }

    // A bad value or row must not make the complete close-event batch block
    // the feed cursor. Retry each identity independently and quarantine only
    // the rows that still fail.
    for (const value of batch) {
      try {
        const single = await client
          .from('jobs')
          .update(closePayload)
          .eq('source_system', JOBS_FEED_SOURCE)
          .eq('company', company)
          .eq('is_active', true)
          .eq(field, value)
          .select('id');
        if (single.error) {
          failures.push(buildJobSyncFailure({
            source_system: JOBS_FEED_SOURCE,
            company,
            external_job_id: field === 'external_job_id' ? value : null,
            source_url: field === 'external_job_id' ? null : value,
          }, operation, single.error));
        } else {
          for (const job of (single.data || []) as Array<{ id: number }>) closedIds.push(job.id);
        }
      } catch (error) {
        failures.push(buildJobSyncFailure({
          source_system: JOBS_FEED_SOURCE,
          company,
          external_job_id: field === 'external_job_id' ? value : null,
          source_url: field === 'external_job_id' ? null : value,
        }, operation, error));
      }
    }
  }
  return { closedIds, failures };
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
  // Do not match the "intern" substring in international/internal.
  if (/\b(?:intern|internship|co-?op)\b|\bsummer\s+(?:analyst|associate|intern)\b/.test(value)) return '实习';
  if (/\b(?:graduate|new\s+grad(?:uate)?|entry[- ]?level|campus|early\s+career|full[- ]?time\s+analyst(?:\s+program)?)\b/.test(value)) return '校招';
  if (/\b(?:experienced|professional|senior|manager|director|full[- ]?time|vice\s+president|vp|associate)\b/.test(value)) return '社招';
  return text(item.employment_type) ? text(item.employment_type).slice(0, 50) : '未知';
}

function extractExperience(item: JobsFeedItem): { min: number | null; max: number | null; text: string | null } {
  const storageSafeNumber = (value: unknown): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    const rounded = Number(value.toFixed(1));
    return rounded <= 999.9 ? rounded : null;
  };
  const min = storageSafeNumber(item.experience_min_years);
  const max = storageSafeNumber(item.experience_max_years);
  if (min != null || max != null) {
    return {
      min,
      max,
      text: text(item.experience_text) || text(item.experience) || null,
    };
  }
  return parseExperience([
    item.experience,
    item.experience_text,
    item.level,
    item.description,
    item.qualifications,
    item.required_skills,
  ], item.level);
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
  // Prefer the actual listing location, enrich it with official office data,
  // and remove redundant fragments such as "Toronto, Toronto, Canada".
  const rawLocation = joinLocationParts([
    item.location,
    item.official_location,
    item.offices,
  ]);
  const rawCountry = normalizeFeedLocation(item.country);
  const location = joinLocationParts([rawLocation, rawCountry]) || '未注明';
  if (!isTargetRegion(rawLocation, rawCountry)) return null;
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
  const resolvedDeadline = resolveJobDeadline(item);
  // Feed payload dates can come from hidden ATS metadata or list snapshots.
  // A labelled deadline in the official description is candidate-safe. A
  // structured value is also safe, but only when the connector identifies
  // the payload as an official ATS response. This keeps generic feed
  // timestamps and legacy metadata out of the public catalog.
  const officialAtsPayloadDeadline = resolvedDeadline?.fieldSource === 'official_payload'
    && text(item.source_evidence?.source_type).toLowerCase() === 'official_ats';
  const deadline = resolvedDeadline
    && (resolvedDeadline.fieldSource === 'official_description' || officialAtsPayloadDeadline)
    && isCompanyFieldEvidenceTrusted(company, sourceUrl, resolvedDeadline.fieldSource)
    ? resolvedDeadline
    : null;
  const salary = normalizeSalary(item, company, sourceUrl);
  const employmentSource = sourceForField(item, 'employment_type');
  const workplaceSource = sourceForField(item, 'workplace_type');
  const employmentCategorySource = sourceForField(item, 'employment_category') || employmentSource;
  const employmentType = isCompanyFieldEvidenceTrusted(company, sourceUrl, employmentSource) ? text(item.employment_type).slice(0, 50) || null : null;
  const workplaceType = isCompanyFieldEvidenceTrusted(company, sourceUrl, workplaceSource) ? text(item.workplace_type).slice(0, 50) || null : null;
  const employmentCategory = inferJobType(item);
  const experience = extractExperience(item);
  const rawLocationSource = sourceForField(item, 'official_location')
    || sourceForField(item, 'location')
    || sourceForField(item, 'offices')
    || sourceForField(item, 'country');
  const feedSourceType = text(item.source_evidence?.source_type).toLowerCase();
  const officialFeedPayload = /(?:official[_ -]?ats|oracle[_ -]?hcm|greenhouse|lever|ashby|workday|smartrecruiters|icims|taleo|successfactors)/i.test(feedSourceType);
  // Talent Gateway list payloads used by Morgan Stanley expose a canonical
  // location but omit the individual source tag. Restrict this fallback to
  // the configured official ATS host; no generic third-party list is trusted.
  const locationSource = isCompanyFieldEvidenceTrusted(company, sourceUrl, rawLocationSource)
    ? rawLocationSource
    : officialFeedPayload && (rawLocation || rawCountry)
      ? 'official_payload'
    : hasOfficialCompanyHost(company, sourceUrl) && (rawLocation || rawCountry)
      ? 'official_payload'
      : null;
  const now = new Date().toISOString();
  const fieldEvidence = {
    version: 1,
    source_type: typeof item.source_evidence?.source_type === 'string' ? item.source_evidence.source_type : null,
    source_url: sourceUrl,
    fields: {
      deadline: buildFieldEvidence(deadline?.fieldSource || null, sourceUrl, now),
      salary: buildFieldEvidence(salary.source, sourceUrl, now),
      location: buildFieldEvidence(locationSource, sourceUrl, now),
      employment_type: buildFieldEvidence(employmentSource, sourceUrl, now),
      workplace_type: buildFieldEvidence(workplaceSource, sourceUrl, now),
      employment_category: buildFieldEvidence(employmentCategorySource, sourceUrl, now),
      experience: buildFieldEvidence(sourceForField(item, 'experience') || sourceForField(item, 'qualifications'), sourceUrl, now),
    },
  };

  return {
    title: title.substring(0, 255),
    company: company.substring(0, 255),
    region: location.substring(0, 100),
    direction: inferDirection(item),
    audience: '留学生',
    job_type: inferJobType(item).substring(0, 50),
    employment_category: employmentCategory.substring(0, 20),
    experience_min_years: experience.min,
    experience_max_years: experience.max,
    experience_text: experience.text?.substring(0, 500) || null,
    // Evidence is audit metadata, never candidate-facing job content. Keep a
    // missing description empty instead of leaking the JSON payload (or using
    // the title as a misleading placeholder).
    description: description ? description.substring(0, 50000) : null,
    // The feed has no separate overview field. Persisting the same body in
    // both columns doubles storage for every job; the detail view falls back
    // to description when no curated overview is available.
    overview: null,
    responsibilities: null,
    requirements: requirements.substring(0, 50000) || null,
    nice_to_have: niceToHave.substring(0, 50000) || null,
    salary_range: salary.value,
    employment_type: employmentType,
    workplace_type: workplaceType,
    deadline_source: deadline?.fieldSource || null,
    salary_source: salary.source,
    location_source: locationSource,
    field_evidence: fieldEvidence,
    job_url: sourceUrl.substring(0, 2048),
    source_url: sourceUrl.substring(0, 2048),
    sponsorship: item.visa_sponsorship === true ? 'yes' : item.visa_sponsorship === false ? 'no' : 'unknown',
    is_active: !closed,
    is_closed: closed,
    source_system: JOBS_FEED_SOURCE,
    external_job_id: text(item.external_job_id) || text(item.id) || null,
    valid_through: deadline?.value || null,
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

async function fetchPage(cursor?: string, since?: string, includeClosed = true, companyId?: string): Promise<FeedPage> {
  const config = getFeedConfig();
  const params = new URLSearchParams({ include_closed: String(includeClosed) });
  if (cursor) params.set('cursor', cursor);
  if (since) params.set('since', since);
  if (companyId) params.set('company_id', companyId);

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
          const page = await response.json() as unknown;
          if (!isValidFeedPage(page)) {
            lastError = new Error('招聘数据源返回的岗位列表不是数组');
            break;
          }
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

function sameUrl(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  try {
    const normalize = (value: string) => {
      const url = new URL(value);
      url.hash = '';
      url.pathname = url.pathname.replace(/\/+$/u, '') || '/';
      return url.toString();
    };
    return normalize(left) === normalize(right);
  } catch {
    return left.trim() === right.trim();
  }
}

/**
 * Re-fetch one failed collector record without touching the shared cursor.
 * The exact identity must be present in the response; a broad first-page
 * fallback is deliberately rejected because it could replay the wrong job.
 */
export async function fetchJobForSyncRetry(identity: {
  externalJobId?: string | null;
  sourceUrl?: string | null;
  company?: string | null;
}): Promise<JobsFeedItem | null> {
  const config = getFeedConfig();
  const candidates = [
    ['external_job_id', text(identity.externalJobId)],
    ['source_url', text(identity.sourceUrl)],
  ] as const;
  let lastError: Error | null = null;
  for (const [field, value] of candidates) {
    if (!value) continue;
    const params = new URLSearchParams({ include_closed: 'true', limit: '10', [field]: value });
    if (identity.company) params.set('company_name', identity.company);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      try {
        const response = await fetch(`${config.url}?${params.toString()}`, {
          headers: { Accept: 'application/json', 'X-Integration-Key': config.apiKey },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          lastError = new Error(`重试读取岗位失败: HTTP ${response.status}`);
        } else {
          const payload = await response.json() as unknown;
          if (!isValidFeedPage(payload)) {
            lastError = new Error('重试读取岗位返回了无效页面结构');
          } else {
            const match = payload.items?.find((item) => {
              const externalId = text(item.external_job_id) || text(item.id);
              const idMatch = field === 'external_job_id' && externalId === value;
              const urlMatch = field === 'source_url' && sameUrl(text(item.source_url), value);
              const companyMatch = !identity.company || text(item.company_name).toLocaleLowerCase() === identity.company.toLocaleLowerCase();
              return (idMatch || urlMatch) && companyMatch;
            });
            if (match) return match;
            break;
          }
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      } finally {
        clearTimeout(timeout);
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  if (lastError) throw lastError;
  return null;
}

export async function syncJobsFeed(
  client: SupabaseClient,
  options: {
    cursor?: string;
    since?: string;
    maxPages?: number;
    verifiedAt?: string;
    includeClosed?: boolean;
    companyId?: string;
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
    row_failures: 0,
    fatal_failures: 0,
    write_batches: 0,
    write_batch_failures: 0,
    write_fallback_rows: 0,
    write_duration_ms: 0,
    next_cursor: cursor || null,
    has_more: false,
    open_seen: 0,
    skipped_by_reason: {},
    company_observations: {},
  };

  while (hasMore && result.pages < maxPages) {
    const requestedCursor = cursor;
    const page = await fetchPage(cursor, cursor ? undefined : options.since, options.includeClosed ?? true, options.companyId);
    const rawItems = Array.isArray(page.items) ? page.items : [];
    const greenhouseEnriched = await enrichGreenhouseOffices(rawItems);
    const items = await enrichAshbyLocations(greenhouseEnriched);
    result.pages += 1;
    result.received += items.length;

    for (const item of items) {
      const observed = companyObservation(result, text(item.company_name));
      if (observed) observed.received += 1;
    }

    const openItems: JobSyncRecord[] = [];
    const closeSourcesByCompany = new Map<string, string[]>();
    const closeExternalIdsByCompany = new Map<string, string[]>();
    for (const item of items) {
      if (isClosedItem(item)) {
        const observed = companyObservation(result, text(item.company_name));
        const sourceUrl = text(item.source_url);
        const externalJobId = text(item.external_job_id) || text(item.id);
        if (!sourceUrl && !externalJobId) {
          incrementSkipReason(result, 'closed_without_identity');
          if (observed) observed.skipped += 1;
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
      else {
        incrementSkipReason(result, normalizeSkipReason(item) || 'invalid_record');
        const observed = companyObservation(result, text(item.company_name));
        if (observed) observed.skipped += 1;
      }
    }

    const verifiedAt = options.verifiedAt || new Date().toISOString();
    const closePayload = {
      is_active: false,
      is_closed: true,
      source_system: JOBS_FEED_SOURCE,
      updated_at: new Date().toISOString(),
    };
    const closedJobIds = new Set<number>();
    const closeFailures: JobSyncFailureInput[] = [];
    // Stable IDs survive ATS URL rotations, so use them before URL fallbacks.
    for (const [company, externalIds] of closeExternalIdsByCompany) {
      const outcome = await closeJobsByField(client, company, externalIds, 'external_job_id', closePayload, 'close');
      for (const id of outcome.closedIds) closedJobIds.add(id);
      closeFailures.push(...outcome.failures);
    }
    // Older records can predate external IDs. Preserve both URL fallbacks so
    // close events can still find a job after the feed changed its URL field.
    for (const [company, sourceUrls] of closeSourcesByCompany) {
      const outcome = await closeJobsByField(client, company, sourceUrls, 'source_url', closePayload, 'close');
      for (const id of outcome.closedIds) closedJobIds.add(id);
      closeFailures.push(...outcome.failures);
    }
    for (const [company, sourceUrls] of closeSourcesByCompany) {
      const outcome = await closeJobsByField(client, company, sourceUrls, 'job_url', closePayload, 'close');
      for (const id of outcome.closedIds) closedJobIds.add(id);
      closeFailures.push(...outcome.failures);
    }
    result.closed += closedJobIds.size;
    for (const [company, externalIds] of closeExternalIdsByCompany) {
      const observed = companyObservation(result, company);
      if (observed) observed.closed += externalIds.length;
    }
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
      if (syncStateError) {
        // The lifecycle update above is authoritative and already committed.
        // Retry only the auxiliary sync metadata row by row.
        for (const jobId of closedJobIds) {
          try {
            const { error } = await client
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
              .eq('job_id', jobId);
            if (!error) continue;
            closeFailures.push(buildJobSyncFailure({
              source_system: JOBS_FEED_SOURCE,
              job_id: jobId,
            }, 'close_sync_record', error));
          } catch (error) {
            closeFailures.push(buildJobSyncFailure({
              source_system: JOBS_FEED_SOURCE,
              job_id: jobId,
            }, 'close_sync_record', error));
          }
        }
      }
    }

    result.failed += closeFailures.length;
    result.row_failures += closeFailures.length;
    for (const failure of closeFailures) {
      const observed = companyObservation(result, failure.company || '');
      if (observed) observed.row_failures += 1;
    }
    await enqueueJobSyncFailures(client, closeFailures);

    if (openItems.length > 0) {
      const synced = await syncJobRecords(client, openItems, 'sync', { verifiedAt });
      result.upserted += synced.created + synced.updated + synced.unchanged;
      result.open_seen += openItems.length;
      result.failed += synced.failed;
      result.row_failures += synced.recoverable_failures;
      result.write_batches += synced.write_batches;
      result.write_batch_failures += synced.write_batch_failures;
      result.write_fallback_rows += synced.write_fallback_rows;
      result.write_duration_ms += synced.write_duration_ms;
      result.skipped += synced.skipped + synced.invalidJobs.length;
      if (synced.skipped > 0) result.skipped_by_reason.invalid_sync_record = (result.skipped_by_reason.invalid_sync_record || 0) + synced.skipped;
      if (synced.invalidJobs.length > 0) result.skipped_by_reason.invalid_sync_record = (result.skipped_by_reason.invalid_sync_record || 0) + synced.invalidJobs.length;
      if (synced.invalidJobs.length > 0) {
        console.error('[JobsFeed] rejected records:', JSON.stringify(synced.invalidJobs.slice(0, 10)));
      }
      for (const item of openItems) {
        const observed = companyObservation(result, item.company);
        if (observed) observed.upserted += 1;
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
