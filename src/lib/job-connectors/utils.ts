import { parseJobDeadline } from '@/lib/job-deadline';
import { jobHtmlToPlainText } from '@/lib/job-content';
import type { ConnectorUrlCheckResult } from '@/lib/job-connectors/types';

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record).filter((item) => Object.keys(item).length > 0) : [];
}

export function htmlToText(value: unknown): string {
  // Keep connector parsing aligned with the shared content normalizer. In
  // particular, Greenhouse returns HTML encoded as text ("&lt;li&gt;...")
  // and some boards encode it twice.
  return jobHtmlToPlainText(value);
}

function locationLabel(value: unknown, depth = 0): string {
  if (depth > 3 || value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map((item) => locationLabel(item, depth + 1)).filter(Boolean).join(', ');
  const item = record(value);
  const preferred = [
    item.name,
    item.label,
    item.location,
    item.city,
    item.city_name,
    item.addressLocality,
    item.addressRegion,
    item.state,
    item.country,
    item.addressCountry,
  ].map((candidate) => locationLabel(candidate, depth + 1)).filter(Boolean);
  return preferred.join(', ');
}

export function normalizeLocations(values: unknown[]): string[] {
  const output: string[] = [];
  for (const value of values) {
    const parts = (Array.isArray(value) ? value : [value])
      .map((item) => locationLabel(item).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    for (const part of parts) {
      const lower = part.toLocaleLowerCase();
      if (output.some((existing) => existing.toLocaleLowerCase() === lower)) continue;
      if (output.some((existing) => existing.toLocaleLowerCase().includes(lower))) continue;
      for (let index = output.length - 1; index >= 0; index -= 1) {
        if (lower.includes(output[index].toLocaleLowerCase())) output.splice(index, 1);
      }
      output.push(part);
    }
  }
  return output;
}

export function normalizeWorkplace(values: unknown[]): { workplaceType: string | null; isRemote: boolean } {
  const value = values.map(text).filter(Boolean).join(' ').toLowerCase();
  if (/remote|work from anywhere|distributed|anywhere/.test(value)) return { workplaceType: 'Remote', isRemote: true };
  if (/hybrid/.test(value)) return { workplaceType: 'Hybrid', isRemote: false };
  if (/on.?site|in.?office|office/.test(value)) return { workplaceType: 'On-site', isRemote: false };
  return { workplaceType: null, isRemote: false };
}

export function normalizeEmploymentCategory(values: unknown[]): string {
  const value = values.map(text).filter(Boolean).join(' ').toLowerCase();
  // Word boundaries avoid treating "international" or "internal" as
  // internship signals.
  if (/\b(?:intern|internship|co-?op)\b|\bsummer\s+(?:analyst|associate|intern)\b/.test(value)) return '实习';
  if (/\b(?:new\s+grad(?:uate)?|entry[- ]?level|graduate|campus|early\s+career|analyst\s+program|university)\b/.test(value)) return '校招';
  if (/\b(?:full[- ]?time|part[- ]?time|permanent|experienced|professional|senior|manager|director|staff|lead|principal|architect|specialist|counsel|vice\s+president|vp|associate)\b/.test(value)) return '社招';
  return '未知';
}

export interface ParsedExperience {
  min: number | null;
  max: number | null;
  text: string | null;
}

const EXPERIENCE_NUMBER = '(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const EXPERIENCE_UNIT = '(?:years?|yrs?\\.?|yr\\.?|months?|mos?\\.?|mths?\\.?|年|个月|月)';

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function experienceNumber(value: string): number | null {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return NUMBER_WORDS[value.trim().toLowerCase()] ?? null;
}

function experienceYears(value: string, unit: string): number | null {
  const amount = experienceNumber(value);
  if (amount == null) return null;
  return /^(?:months?|mos?\.?|mths?\.?|个月|月)$/i.test(unit.trim())
    ? Number((amount / 12).toFixed(2))
    : amount;
}

function experienceSnippet(body: string, index: number | undefined, fallback: string): string {
  if (index == null) return fallback.trim();
  const start = Math.max(0, index - 140);
  const end = Math.min(body.length, index + 360);
  const snippet = body.slice(start, end).replace(/\s+/g, ' ').trim();
  return (snippet || fallback).slice(0, 500);
}

function experienceLine(body: string, index: number): string {
  const start = body.lastIndexOf('\n', index) + 1;
  const endAt = body.indexOf('\n', index);
  const end = endAt === -1 ? body.length : endAt;
  return body.slice(start, end).replace(/^[-•\s]+/, '').replace(/\s+/g, ' ').trim();
}

function monthMatchHasExperienceContext(body: string, index: number): boolean {
  return /experience|working|professional|relevant|prior\s+work/i.test(experienceLine(body, index));
}

function standaloneMatchHasExperienceContext(body: string, index: number): boolean {
  const line = experienceLine(body, index);
  // Company introductions frequently say things such as "more than 30 years
  // of investing experience". That describes the employer, not an applicant
  // requirement, and must never become a candidate-facing experience field.
  if (/\b(?:more\s+than|over)\s+\d+(?:\.\d+)?\s+years?\s+of\s+(?:investing|investment|operating|industry|company|firm|business|financial)\s+experience\b/i.test(line)) {
    return false;
  }
  // Compact ATS metadata can legitimately be just "3 years". Narrative
  // descriptions need a requirement cue before an unqualified number is used.
  if (/^\s*(?:minimum\s+of\s+|at\s+least\s+)?(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:years?|yrs?\.?|months?|mos?\.?|mths?\.?|个月|月)\s*$/i.test(line)) {
    return true;
  }
  return /\b(?:require(?:s|d)?|minimum|at\s+least|must|need(?:ed)?|qualif(?:ication|ied)|candidate|you(?:'| a)re|we\s+want|professional|relevant|prior\s+work|work(?:ing)?\s+experience)\b/i.test(line);
}

function parseExperienceUnbounded(values: unknown[], explicitLevel?: unknown): ParsedExperience {
  const body = values
    .map((value) => htmlToText(Array.isArray(value) ? value.join(' ') : value))
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!body) return { min: null, max: null, text: null };
  const noExperience = /\b(?:no|without)\s+(?:prior\s+)?experience\b|无经验|无需经验/i.exec(body);
  if (noExperience) return { min: 0, max: 0, text: experienceSnippet(body, noExperience.index, noExperience[0]) || 'No experience required' };

  const range = new RegExp(`(${EXPERIENCE_NUMBER})\\s*(?:(${EXPERIENCE_UNIT})\\s*)?(?:-|to|–|—)\\s*(${EXPERIENCE_NUMBER})\\s*(\\+)?\\s*(${EXPERIENCE_UNIT})`, 'i').exec(body);
  if (range) {
    if (/months?|mos?\\.?|mths?\\.?|个月|月/i.test(`${range[2] || ''} ${range[5]}`)
      && !monthMatchHasExperienceContext(body, range.index)) {
      // Do not mistake an internal-transfer or eligibility window such as
      // "18-24 months before you may apply" for job experience.
    } else {
      const min = experienceYears(range[1], range[2] || range[5]);
      const max = experienceYears(range[3], range[5]);
      if (min != null && max != null) return { min, max: range[4] ? null : max, text: experienceSnippet(body, range.index, range[0]) };
    }
  }

  const plus = new RegExp(`(${EXPERIENCE_NUMBER})\\s*\\+\\s*(${EXPERIENCE_UNIT})`, 'i').exec(body);
  if (plus) {
    if (/months?|mos?\\.?|mths?\\.?|个月|月/i.test(plus[2])
      && !monthMatchHasExperienceContext(body, plus.index)) {
      // See the range guard above.
    } else {
    const min = experienceYears(plus[1], plus[2]);
    if (min != null) return { min, max: null, text: experienceSnippet(body, plus.index, plus[0]) };
    }
  }

  const minimum = new RegExp(`(?:at\\s+least|minimum(?:\\s+of)?|at\\s+minimum|至少)\\s*(${EXPERIENCE_NUMBER})\\s*(${EXPERIENCE_UNIT})`, 'i').exec(body);
  if (minimum) {
    if (!/months?|mos?\\.?|mths?\\.?|个月|月/i.test(minimum[2]) || monthMatchHasExperienceContext(body, minimum.index)) {
      const min = experienceYears(minimum[1], minimum[2]);
      if (min != null) return { min, max: null, text: experienceSnippet(body, minimum.index, minimum[0]) };
    }
  }

  const single = new RegExp(`(${EXPERIENCE_NUMBER})\\s*(${EXPERIENCE_UNIT})\\s*(?:of\\s+)?(?:relevant\\s+|professional\\s+|prior\\s+|work(?:ing)?\\s+)?experience\\b`, 'i').exec(body);
  if (single) {
    const min = experienceYears(single[1], single[2]);
    if (min != null) return { min, max: null, text: experienceSnippet(body, single.index, single[0]) };
  }
  const possessive = new RegExp(`(${EXPERIENCE_NUMBER})\\s*(${EXPERIENCE_UNIT})['’]\\s+experience\\b`, 'i').exec(body);
  if (possessive) {
    const min = experienceYears(possessive[1], possessive[2]);
    if (min != null) return { min, max: null, text: experienceSnippet(body, possessive.index, possessive[0]) };
  }
  // ATS payloads often expose a compact value such as "3 years" without
  // repeating the word "experience". Keep this deliberately narrow so a
  // phrase like "experience with Python" cannot become a numeric requirement.
  const standalone = new RegExp(`(?:^|\\s)(${EXPERIENCE_NUMBER})\\s*(${EXPERIENCE_UNIT})(?=\\s|$)`, 'i').exec(body);
  if (standalone) {
    if ((!/months?|mos?\\.?|mths?\\.?|个月|月/i.test(standalone[2]) || monthMatchHasExperienceContext(body, standalone.index))
      && standaloneMatchHasExperienceContext(body, standalone.index)) {
      const min = experienceYears(standalone[1], standalone[2]);
      if (min != null) return { min, max: null, text: experienceSnippet(body, standalone.index, standalone[0]) };
    }
  }
  // Generic entry-level labels are a fallback only; explicit numeric years
  // above win when both signals appear in a description.
  const entryLevel = /entry[- ]level|new graduate|recent graduate|university\s+program|(?:graduate|university)\s+(?:program|role|opportunity)|应届|校招/i.exec(body);
  if (entryLevel) return { min: 0, max: 1, text: experienceSnippet(body, entryLevel.index, 'Entry Level') };
  // An ATS level field is stronger evidence than a title mentioning a
  // university. Restrict this fallback to the structured level value.
  if (/^(?:university|graduate|entry[- ]level)$/i.test(text(explicitLevel))) {
    return { min: 0, max: 1, text: text(explicitLevel) };
  }
  return { min: null, max: null, text: null };
}

// `jobs.experience_*` is numeric(4,1). A malformed upstream value such as
// "1000 years" must not reject an otherwise valid feed page. Keep the raw
// requirement out of the standard numeric fields and let a later official
// detail pass retry it with better evidence.
const MAX_STORED_EXPERIENCE_YEARS = 999.9;

export function parseExperience(values: unknown[], explicitLevel?: unknown): ParsedExperience {
  const parsed = parseExperienceUnbounded(values, explicitLevel);
  const numbers = [parsed.min, parsed.max].filter((value): value is number => value != null);
  if (numbers.some((value) => !Number.isFinite(value) || value < 0 || value > MAX_STORED_EXPERIENCE_YEARS)) {
    return { min: null, max: null, text: null };
  }
  return {
    min: parsed.min == null ? null : Number(parsed.min.toFixed(1)),
    max: parsed.max == null ? null : Number(parsed.max.toFixed(1)),
    text: parsed.text,
  };
}

export function extractSalary(values: unknown[]): string | null {
  const body = htmlToText(values.map(text).filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
  if (!body || body.length > 300) return null;
  const currency = /(?:US\$|CA\$|AU\$|HK\$|S\$|\$|€|£|¥|\b(?:USD|CAD|AUD|GBP|EUR|HKD|SGD|CNY|RMB)\b)/i.test(body);
  const amount = /(?<!\d)(?:\d{4,7}|\d{1,3}(?:[,.]\d{3})+|\d{2,3})(?:\.\d{1,2})?\s*(?:k|m)?\b/i.test(body);
  if (!currency || !amount || /^(?:0|n\/?a|none|not disclosed)$/i.test(body)) return null;
  return body;
}

/** Extract compact, candidate-facing pay ranges from an official job body. */
export function extractSalaryFromDescription(value: unknown): string | null {
  const body = htmlToText(value).replace(/\s+/g, ' ').trim();
  if (!body) return null;
  const currency = '(?:US\\$|CA\\$|AU\\$|HK\\$|S\\$|\\$|€|£|¥|\\b(?:USD|CAD|AUD|GBP|EUR|HKD|SGD|CNY|RMB)\\b)';
  // Require a full numeric token. The previous 2-3 digit pattern could match
  // the trailing `000` of Google Careers values such as `$118000 - $169000`.
  const amount = '(?<!\\d)(?:\\d{4,7}|\\d{1,3}(?:[,.]\\d{3})+|\\d{2,3})(?:\\.\\d{1,2})?\\s*(?:k|m)?';
  const range = new RegExp(
    `(?:${currency}\\s*)?${amount}\\s*(?:-|to|–|—)\\s*(?:${currency}\\s*)?${amount}`,
    'gi',
  );
  const matches = [...body.matchAll(range)]
    .filter((match) => {
      const start = Math.max(0, (match.index || 0) - 100);
      const end = Math.min(body.length, (match.index || 0) + match[0].length + 100);
      const context = body.slice(start, end);
      // Job descriptions often mention client revenue, assets, portfolio
      // size, or loan amounts. Those figures are not candidate pay.
      return !/(?:annual\s+)?revenues?|assets?|portfolio|loan(?:s)?|aum|transaction(?:s)?|billion\s+business/i.test(context);
    })
    .map((match) => match[0].replace(/\s+/g, ' ').trim())
    .filter((match) => new RegExp(currency, 'i').test(match));
  const unique = [...new Set(matches)];
  return extractSalary([unique.slice(0, 4).join('; ')]);
}

export function extractDeadline(values: unknown[]): string | null {
  for (const value of values) {
    const candidate = text(value);
    // Direct fields may contain an ISO date or timestamp. Narrative content
    // must go through the labelled-deadline matcher below: Date.parse() would
    // otherwise interpret a sentence in the server time zone and shift a
    // date-only deadline by one day.
    const isDirectDate = typeof value === 'number'
      || /^\d{10,13}$/.test(candidate)
      || /^(?:20\d{2}[/.\-]\d{1,2}[/.\-]\d{1,2}(?:T[^\s]+)?|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+20\d{2})?|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?),?\s+20\d{2}|20\d{2}年\d{1,2}月\d{1,2}日?)$/i.test(candidate);
    const parsed = isDirectDate ? parseJobDeadline(value) : null;
    if (parsed) return parsed;
  }
  const body = htmlToText(values.map(text).filter(Boolean).join(' '));
  const match = body.match(/(?:application\s+(?:closing\s+)?deadline|closing\s+date|deadline(?:\s+to\s+apply)?|applications?\s+(?:will\s+)?close|apply\s+by|截止(?:日期|时间)?)[^\d]{0,60}((?:20\d{2}[\/.\-]\d{1,2}[\/.\-]\d{1,2})|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+20\d{2})?)/i);
  return match ? parseJobDeadline(match[1]) : null;
}

export function sourceEvidence(sourceUrl: string, connector: string, fields: Record<string, string | null>) {
  const structuredFieldSources: Record<string, string> = {};
  for (const [field, source] of Object.entries(fields)) {
    if (source) structuredFieldSources[field] = source;
  }
  return {
    source_type: 'official_ats',
    connector,
    source_url: sourceUrl,
    structured_field_sources: structuredFieldSources,
  };
}

export function isOfficialHost(url: string, connector: 'greenhouse' | 'ashby' | 'lever' | 'phenom' | 'oracle_hcm'): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (connector === 'greenhouse') {
      // Greenhouse lets employers publish the same official posting on their
      // own careers domain. Those canonical links carry the stable `gh_jid`
      // query parameter instead of a `/jobs/:id` path.
      return /(^|\.)greenhouse\.io$/.test(hostname)
        || (parsed.protocol === 'https:' && /^\d+$/.test(parsed.searchParams.get('gh_jid') || ''));
    }
    if (connector === 'ashby') return /(^|\.)ashbyhq\.com$/.test(hostname);
    if (connector === 'phenom') return parsed.protocol === 'https:' && /\/job\/[^/]+/i.test(parsed.pathname);
    if (connector === 'oracle_hcm') return parsed.protocol === 'https:' && /\.oraclecloud\.com$/i.test(hostname) && /\/job\/[^/]+/i.test(parsed.pathname);
    return /(^|\.)lever\.co$/.test(hostname);
  } catch {
    return false;
  }
}

export function validConnectorUrl(url: string, connector: 'greenhouse' | 'ashby' | 'lever' | 'phenom' | 'oracle_hcm', expectedJobId?: string): boolean {
  if (!isOfficialHost(url, connector)) return false;
  try {
    const parsed = new URL(url);
    if (connector === 'greenhouse') {
      const pathId = parsed.pathname.match(/\/jobs\/(\d+)(?:\/|$)/i)?.[1];
      const canonicalId = parsed.searchParams.get('gh_jid')?.match(/^\d+$/)?.[0];
      const jobId = pathId || canonicalId;
      return Boolean(jobId && (!expectedJobId || jobId === expectedJobId));
    }
    if (connector === 'ashby') return parsed.pathname.split('/').filter(Boolean).length >= 2;
    if (connector === 'phenom') {
      const jobId = parsed.pathname.match(/\/job\/([^/]+)/i)?.[1];
      return Boolean(jobId && (!expectedJobId || jobId === expectedJobId));
    }
    if (connector === 'oracle_hcm') {
      const match = parsed.pathname.match(/\/job\/([^/]+)/i);
      return Boolean(match && (!expectedJobId || decodeURIComponent(match[1]) === expectedJobId));
    }
    return parsed.pathname.split('/').filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

export async function checkConnectorJobUrl(
  url: string,
  connector: 'greenhouse' | 'ashby' | 'lever' | 'phenom' | 'oracle_hcm',
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<ConnectorUrlCheckResult> {
  const checkedAt = new Date().toISOString();
  if (!validConnectorUrl(url, connector)) return { url, status: 'unknown', httpStatus: null, checkedAt };
  const fetcher = options.fetcher || fetch;
  const timeoutMs = Math.min(Math.max(options.timeoutMs || 15_000, 1_000), 60_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetcher(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal, headers: { Accept: 'text/html,application/xhtml+xml' } });
    if (response.status === 405 || response.status === 501) {
      response = await fetcher(url, { method: 'GET', redirect: 'follow', signal: controller.signal, headers: { Accept: 'text/html,application/xhtml+xml' } });
    }
    const status = response.status === 404 || response.status === 410
      ? 'closed'
      : response.status === 401 || response.status === 403 || response.status === 429
        ? 'blocked'
        : response.status >= 200 && response.status < 400
          ? 'valid'
          : response.status >= 500
            ? 'unknown'
            : 'unknown';
    return { url, status, httpStatus: response.status, checkedAt, redirectedUrl: response.url || null };
  } catch (error) {
    return { url, status: error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'unknown', httpStatus: null, checkedAt };
  } finally {
    clearTimeout(timeout);
  }
}
