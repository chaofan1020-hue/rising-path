import { jobHtmlToPlainText } from '@/lib/job-content';

export type JobDeadlineSource =
  | 'valid_through'
  | 'application_deadline'
  | 'structured_field'
  | 'description';

export interface JobDeadlineResult {
  value: string;
  source: JobDeadlineSource;
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
  'enddate',
  'expiresat',
  'expires',
  'expirationdate',
  'expiration',
  'expirydate',
  'expiry',
  'dateexpires',
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

  if (!DATE_TOKEN_RE.test(normalized)) {
    const timestamp = Date.parse(normalized);
    const date = new Date(timestamp);
    return isReasonableDate(date) ? date.toISOString() : null;
  }

  const timestamp = Date.parse(normalized);
  const date = new Date(timestamp);
  return isReasonableDate(date) ? date.toISOString() : null;
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

function findTextDeadline(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const plainText = jobHtmlToPlainText(value).replace(/\s+/g, ' ').trim();
  const chineseMatch = CHINESE_TEXT_DEADLINE_RE.exec(plainText);
  if (chineseMatch) return parseJobDeadline(chineseMatch[1]);
  const match = TEXT_DEADLINE_RE.exec(plainText);
  return match ? parseJobDeadline(match[1]) : null;
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
}

/** Resolve only explicit or high-confidence deadline evidence from a feed item. */
export function resolveJobDeadline(item: DeadlineSourceItem): JobDeadlineResult | null {
  const directCandidates: Array<[JobDeadlineSource, unknown]> = [
    ['valid_through', item.valid_through],
    ['application_deadline', item.application_deadline],
  ];
  for (const [source, candidate] of directCandidates) {
    const parsed = parseJobDeadline(candidate);
    if (parsed) return { value: parsed, source };
  }

  const structured = findNestedDeadline({
    deadline: item.deadline,
    application_close_date: item.application_close_date,
    application_closing_date: item.application_closing_date,
    closing_date: item.closing_date,
    close_date: item.close_date,
    end_date: item.end_date,
    expires_at: item.expires_at,
    expiration_date: item.expiration_date,
    raw_payload: item.raw_payload,
    source_evidence: item.source_evidence,
  });
  if (structured) return { value: structured, source: 'structured_field' };

  for (const text of [item.application_process, item.description, item.qualifications]) {
    const parsed = findTextDeadline(text);
    if (parsed) return { value: parsed, source: 'description' };
  }
  return null;
}

export function isJobDeadlineExpired(value: unknown, now = Date.now()): boolean {
  const parsed = parseJobDeadline(value);
  return Boolean(parsed && Date.parse(parsed) < now);
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
