import { jobHtmlToPlainText } from '@/lib/job-content';

export type JobDeadlineSource =
  | 'valid_through'
  | 'application_deadline'
  | 'structured_field'
  | 'description';

export interface JobDeadlineResult {
  value: string;
  source: JobDeadlineSource;
  fieldSource: string;
}

const DEADLINE_KEYS = new Set([
  'validthrough',
  'applicationdeadline',
  'submissiondeadline',
  'applicationclosedate',
  'applicationclosingdate',
  'closingdate',
  'closedate',
  'deadline',
]);

const MONTHS = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_TOKEN = `(?:20\\d{2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{1,2}|\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-](?:20\\d{2}|\\d{2})|${MONTHS}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+20\\d{2})?|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTHS}(?:,?\\s+20\\d{2})?|20\\d{2}年\\d{1,2}月\\d{1,2}日?)`;
const DATE_TOKEN_RE = new RegExp(`^${DATE_TOKEN}$`, 'i');
const MONTH_NUMBERS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};
const TEXT_DEADLINE_RE = new RegExp(
  `(?:application\\s+(?:closing\\s+)?deadline|application\\s+period|submission\\s+deadline|closing\\s+date|deadline(?:\\s+to\\s+apply)?|last\\s+day\\s+to\\s+apply|applications?\\s+(?:(?:will|are)\\s+)?(?:close|closing|end|ending)|(?:apply|submit)(?: your application)?\\s+(?:by|before|no later than)|申请(?:截止|截至|报名截止)(?:日期|时间)?|截止(?:日期|时间))[^\\d]{0,80}(${DATE_TOKEN})`,
  'i',
);
const CHINESE_TEXT_DEADLINE_RE = /(?:申请(?:截止|截至|报名截止)(?:日期|时间)?|截止(?:日期|时间)?)[^\d]{0,30}(20\d{2}年\d{1,2}月\d{1,2}日?)/i;

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isReasonableDate(date: Date): boolean {
  const year = date.getUTCFullYear();
  return Number.isFinite(date.getTime()) && year >= 2000 && year <= 2200;
}

function isPlausibleDeadline(value: string, datePosted?: unknown, now = Date.now()): boolean {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const lowerBound = Date.UTC(2024, 0, 1);
  const postedAt = typeof datePosted === 'string' ? Date.parse(datePosted) : NaN;
  // No employer should publish a deadline years before a current listing.
  if (timestamp < lowerBound || (Number.isFinite(postedAt) && timestamp < postedAt - 24 * 60 * 60 * 1_000)) return false;
  // This is deliberately broad: graduate programs are often published well
  // ahead of the cycle. It only blocks timestamp/unit mistakes, not real jobs.
  return timestamp <= now + 8 * 365 * 24 * 60 * 60 * 1_000;
}

function dateOnlyToIso(year: number, month: number, day: number): string | null {
  const timestamp = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  const date = new Date(timestamp);
  if (!isReasonableDate(date) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString();
}

function parseNamedMonthDate(value: string): string | null {
  const normalized = value.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const monthPattern = Object.keys(MONTH_NUMBERS).join('|');
  const monthFirst = new RegExp(`^(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(20\\d{2})$`, 'i').exec(normalized);
  const dayFirst = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\s+(20\\d{2})$`, 'i').exec(normalized);
  if (monthFirst) return dateOnlyToIso(Number(monthFirst[3]), MONTH_NUMBERS[monthFirst[1].toLowerCase()], Number(monthFirst[2]));
  if (dayFirst) return dateOnlyToIso(Number(dayFirst[3]), MONTH_NUMBERS[dayFirst[2].toLowerCase()], Number(dayFirst[1]));
  return null;
}

function parseYearlessNamedMonthDeadline(value: string, datePosted?: unknown, now = Date.now()): string | null {
  const normalized = value.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const monthPattern = Object.keys(MONTH_NUMBERS).join('|');
  const match = new RegExp(`^(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?$`, 'i').exec(normalized);
  if (!match) return null;

  const month = MONTH_NUMBERS[match[1].toLowerCase()];
  const day = Number(match[2]);
  const postedAt = typeof datePosted === 'string' ? Date.parse(datePosted) : NaN;
  const reference = Number.isFinite(postedAt) ? new Date(postedAt) : new Date(now);
  let year = reference.getUTCFullYear();
  let candidate = dateOnlyToIso(year, month, day);
  if (!candidate) return null;

  // A labelled date without a year is common on graduate-program pages. Use
  // the listing's recruiting cycle when available; only roll into next year
  // when the stated day is clearly before that listing was published.
  const floor = Number.isFinite(postedAt) ? postedAt - 24 * 60 * 60 * 1_000 : now - 31 * 24 * 60 * 60 * 1_000;
  if (Date.parse(candidate) < floor) {
    year += 1;
    candidate = dateOnlyToIso(year, month, day);
  }
  return candidate;
}

/** Parse dates without relying on the host-specific interpretation of date-only strings. */
export function parseJobDeadline(value: unknown): string | null {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10,13}$/.test(value.trim()))) {
    const numeric = typeof value === 'number' ? value : Number(value.trim());
    const milliseconds = numeric < 100_000_000_000 ? numeric * 1_000 : numeric;
    const date = new Date(milliseconds);
    return isReasonableDate(date) ? date.toISOString() : null;
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[\u00a0\u200b]/g, ' ');
  if (!normalized || normalized.length > 160) return null;

  const chinese = normalized.match(/^(20\d{2})年(\d{1,2})月(\d{1,2})日?$/);
  if (chinese) return dateOnlyToIso(Number(chinese[1]), Number(chinese[2]), Number(chinese[3]));

  const isoDate = normalized.match(/^(20\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?:$|T|\s)/);
  if (isoDate) {
    const dateOnly = dateOnlyToIso(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
    if (dateOnly && !/[T\s]/.test(normalized.slice(10))) return dateOnly;
  }

  const slashDate = normalized.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2}|\d{2})$/);
  if (slashDate) {
    // The feed is primarily North American, so ambiguous slash dates follow MM/DD/YYYY.
    const month = Number(slashDate[1]);
    const day = Number(slashDate[2]);
    const year = slashDate[3].length === 2 ? 2000 + Number(slashDate[3]) : Number(slashDate[3]);
    return dateOnlyToIso(year, month, day);
  }

  const namedMonthDate = parseNamedMonthDate(normalized);
  if (namedMonthDate) return namedMonthDate;

  // Never let the JavaScript runtime infer a year for values such as
  // "October 14". V8 currently turns those into a 2001 date, which was the
  // source of the public 01.10.13 error. Labelled narrative deadlines take
  // the explicit recruiting-cycle path in findTextDeadline below.
  if (new RegExp(`^${MONTHS}\\s+\\d{1,2}(?:st|nd|rd|th)?$`, 'i').test(normalized)) return null;

  if (!DATE_TOKEN_RE.test(normalized) && /^20\d{2}[\/.\-]\d{1,2}[\/.\-]\d{1,2}(?:T|\s)\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/i.test(normalized)) {
    const timestamp = Date.parse(normalized);
    const date = new Date(timestamp);
    return isReasonableDate(date) ? date.toISOString() : null;
  }
  return null;
}

function findNestedDeadline(value: unknown, depth = 0): string | null {
  if (depth > 3 || !value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findNestedDeadline(item, depth + 1);
      if (result) return result;
    }
    return null;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (DEADLINE_KEYS.has(normalizeKey(key))) {
      const parsed = parseJobDeadline(nested);
      if (parsed) return parsed;
    }
    if (nested && typeof nested === 'object') {
      const result = findNestedDeadline(nested, depth + 1);
      if (result) return result;
    }
  }
  return null;
}

function findTextDeadline(value: unknown, datePosted?: unknown): string | null {
  if (typeof value !== 'string') return null;
  const plainText = jobHtmlToPlainText(value).replace(/\s+/g, ' ').trim();
  const chineseMatch = CHINESE_TEXT_DEADLINE_RE.exec(plainText);
  if (chineseMatch) return parseJobDeadline(chineseMatch[1]);
  const match = TEXT_DEADLINE_RE.exec(plainText);
  if (!match) return null;
  // A month/day without a year is not a verifiable deadline. Do not infer a
  // recruiting cycle year from the current date or publication date.
  return parseJobDeadline(match[1]);
}

export interface DeadlineSourceItem {
  valid_through?: unknown;
  application_deadline?: unknown;
  deadline?: unknown;
  application_close_date?: unknown;
  application_closing_date?: unknown;
  closing_date?: unknown;
  close_date?: unknown;
  end_date?: unknown;
  expires_at?: unknown;
  expiration_date?: unknown;
  description?: unknown;
  application_process?: unknown;
  qualifications?: unknown;
  raw_payload?: unknown;
  source_evidence?: unknown;
  date_posted?: unknown;
}

function explicitDeadlineSource(item: DeadlineSourceItem, field: string): string | null {
  const evidence = item.source_evidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const sources = (evidence as Record<string, unknown>).structured_field_sources;
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) return null;
  const value = (sources as Record<string, unknown>)[field];
  return typeof value === 'string' ? value.trim().toLowerCase() || null : null;
}

function isTrustedDeadlineSource(source: string | null): boolean {
  return source === 'official_payload' || source === 'official_description';
}

/** Resolve only explicit or high-confidence deadline evidence from a feed item. */
export function resolveJobDeadline(item: DeadlineSourceItem): JobDeadlineResult | null {
  const directCandidates: Array<[JobDeadlineSource, unknown]> = [
    ['valid_through', item.valid_through],
    ['application_deadline', item.application_deadline],
  ];
  for (const [source, candidate] of directCandidates) {
    const sourceField = source === 'valid_through' ? 'valid_through' : 'application_deadline';
    if (!isTrustedDeadlineSource(explicitDeadlineSource(item, sourceField))) continue;
    const fieldSource = explicitDeadlineSource(item, sourceField);
    const parsed = parseJobDeadline(candidate);
    if (parsed && isPlausibleDeadline(parsed, item.date_posted)) return { value: parsed, source, fieldSource: fieldSource! };
  }

  const structuredSource = explicitDeadlineSource(item, 'deadline');
  if (isTrustedDeadlineSource(structuredSource)) {
    const structured = findNestedDeadline({
      deadline: item.deadline,
      application_close_date: item.application_close_date,
      application_closing_date: item.application_closing_date,
      closing_date: item.closing_date,
      close_date: item.close_date,
      raw_payload: item.raw_payload,
    });
    if (structured && isPlausibleDeadline(structured, item.date_posted)) return { value: structured, source: 'structured_field', fieldSource: structuredSource! };
  }

  const descriptionSource = explicitDeadlineSource(item, 'description')
    || explicitDeadlineSource(item, 'application_process')
    || explicitDeadlineSource(item, 'application_deadline');
  if (!isTrustedDeadlineSource(descriptionSource)) return null;
  for (const text of [item.application_process, item.description, item.qualifications]) {
    const parsed = findTextDeadline(text, item.date_posted);
    if (parsed && isPlausibleDeadline(parsed, item.date_posted)) return { value: parsed, source: 'description', fieldSource: descriptionSource! };
  }
  return null;
}

export function isJobDeadlineExpired(value: unknown, now = Date.now()): boolean {
  const parsed = parseJobDeadline(value);
  return Boolean(parsed && Date.parse(parsed) < now);
}

/** Candidate-facing gate for stored deadlines. Reject legacy timestamp/date
 * corruption such as 2001-10-13 while allowing expired records to remain
 * visible in admin/history views. */
export function isDisplayableJobDeadline(
  value: unknown,
  source?: string | null,
  sourceType?: string | null,
  now = Date.now(),
): boolean {
  const parsed = parseJobDeadline(value);
  if (!parsed) return false;
  // Candidate-facing dates require either a labelled official description or
  // an explicitly identified official ATS payload. Generic feed metadata and
  // historical timestamps remain hidden even when their date shape is valid.
  const visibleSource = source === 'official_description'
    || source === 'official_link_description'
    || (source === 'official_link_structured_field' && sourceType === 'official_ats')
    || (source === 'official_payload' && sourceType === 'official_ats');
  if (!visibleSource) return false;
  const timestamp = Date.parse(parsed);
  const year = new Date(timestamp).getUTCFullYear();
  return year >= 2024 && timestamp <= now + 8 * 365 * 24 * 60 * 60 * 1_000;
}

export interface JobDeadlineRemaining {
  totalMinutes: number;
  days: number;
  hours: number;
  minutes: number;
  expired: boolean;
}

/** Calculate a live countdown from the exact stored deadline, not from midnight. */
export function getJobDeadlineRemaining(value: unknown, now = Date.now()): JobDeadlineRemaining | null {
  const parsed = parseJobDeadline(value);
  if (!parsed) return null;
  const difference = Date.parse(parsed) - now;
  if (difference <= 0) {
    return { totalMinutes: 0, days: 0, hours: 0, minutes: 0, expired: true };
  }
  const totalMinutes = Math.max(1, Math.ceil(difference / 60_000));
  return {
    totalMinutes,
    days: Math.max(1, Math.ceil(totalMinutes / 1_440)),
    hours: Math.floor((totalMinutes % 1_440) / 60),
    minutes: totalMinutes % 60,
    expired: false,
  };
}
