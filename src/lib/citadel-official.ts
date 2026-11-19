import { isDisplayableJobDescription, jobHtmlToPlainText } from '@/lib/job-content';

const CITADEL_HOST = 'www.citadel.com';
const CITADEL_DETAIL_PATH = /^\/careers\/details\/([^/]+)\/?$/i;
const CHALLENGE_RE = /just a moment|cf-challenge|checking your browser|verify you are human|turnstile|performing security verification|enable javascript to continue|access denied/i;
const JOB_BODY_RE = /role overview|your objectives|key responsibilities|responsibilities:|qualifications:|about citadel|if you aspire to|your skills/i;

const LOCATION_TOKENS: Array<[string, string]> = [
  ['new-york', 'New York'],
  ['hong-kong', 'Hong Kong'],
  ['san-francisco', 'San Francisco'],
  ['singapore', 'Singapore'],
  ['london', 'London'],
  ['chicago', 'Chicago'],
  ['miami', 'Miami'],
  ['toronto', 'Toronto'],
  ['shanghai', 'Shanghai'],
  ['zurich', 'Zurich'],
  ['dubai', 'Dubai'],
  ['paris', 'Paris'],
  ['emea', 'EMEA'],
  ['asia', 'Asia'],
  ['europe', 'Europe'],
  ['americas', 'Americas'],
  ['us', 'United States'],
];

export type CitadelDetailParse = {
  title: string | null;
  description: string | null;
  location: string | null;
  blocked: boolean;
  blockReason: string | null;
};

export function normalizeCitadelCareerUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return null;
    if (url.hostname.toLowerCase() !== CITADEL_HOST) return null;
    const match = url.pathname.match(CITADEL_DETAIL_PATH);
    if (!match) return null;
    return `https://${CITADEL_HOST}/careers/details/${match[1].toLowerCase()}/`;
  } catch {
    return null;
  }
}

export function isCitadelCareerUrl(value: string | null | undefined): boolean {
  return Boolean(normalizeCitadelCareerUrl(value));
}

export function citadelExternalId(value: string | null | undefined): string | null {
  const url = normalizeCitadelCareerUrl(value);
  if (!url) return null;
  return url.replace(/\/$/, '').split('/').pop() || null;
}

export function citadelSlugTitle(value: string | null | undefined): string {
  const id = citadelExternalId(value);
  if (!id) return 'Untitled';
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function citadelLocationFromUrl(value: string | null | undefined): string | null {
  const slug = citadelExternalId(value);
  if (!slug) return null;
  for (const [token, label] of LOCATION_TOKENS) {
    if (new RegExp(`(?:^|-)${escapeRegExp(token)}(?:-|$)`).test(slug)) return label;
  }
  return null;
}

export function isCitadelExcludedSlug(value: string | null | undefined): boolean {
  const location = citadelLocationFromUrl(value);
  return location === 'Asia' || location === 'Europe' || location === 'EMEA';
}

export function citadelSlugWithoutGqs(value: string | null | undefined): string | null {
  const slug = citadelExternalId(value);
  return slug ? slug.replace(/-gqs-/, '-') : null;
}

export function isDisplayableCitadelBody(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length >= 160
    && isDisplayableJobDescription(value)
    && !CHALLENGE_RE.test(text);
}

export function parseCitadelDetailHtml(html: string, pageTitle = ''): CitadelDetailParse {
  const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || '';
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '';
  const headingText = jobHtmlToPlainText(heading) || null;
  const preview = jobHtmlToPlainText(html).slice(0, 4000);
  if (CHALLENGE_RE.test(`${pageTitle}\n${titleTag}\n${preview}`) && !JOB_BODY_RE.test(preview)) {
    return {
      title: headingText,
      description: null,
      location: null,
      blocked: true,
      blockReason: 'cloudflare_challenge',
    };
  }

  const postings = extractJsonLd(html).filter(isJobPosting);
  const posting = postings[0] || null;
  const jsonDescription = posting ? jobHtmlToPlainText(textValue(posting.description)) : '';
  const jsonTitle = posting ? textValue(posting.title) : '';
  const jsonLocation = posting ? locationFromJobPosting(posting) : null;
  const fallbackDescription = fallbackPageDescription(html);
  const description = pickBody(jsonDescription) || pickBody(fallbackDescription);
  return {
    title: jsonTitle || headingText,
    description,
    location: jsonLocation,
    blocked: !description,
    blockReason: description ? null : 'missing_job_body',
  };
}

function pickBody(value: string): string | null {
  return isDisplayableCitadelBody(value) ? value.trim() : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && 'name' in value && typeof (value as { name?: unknown }).name === 'string') {
    return (value as { name: string }).name.trim();
  }
  return '';
}

function extractJsonLd(html: string): Record<string, unknown>[] {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const nodes: Record<string, unknown>[] = [];
  for (const match of blocks) {
    try {
      const parsed = JSON.parse(match[1].replace(/<!--[\s\S]*?-->/g, '').trim()) as unknown;
      collectJsonLd(parsed, nodes);
    } catch {
      continue;
    }
  }
  return nodes;
}

function collectJsonLd(value: unknown, nodes: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLd(item, nodes);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  nodes.push(record);
  if (Array.isArray(record['@graph'])) collectJsonLd(record['@graph'], nodes);
}

function isJobPosting(value: Record<string, unknown>): boolean {
  const type = value['@type'];
  return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
}

function locationFromJobPosting(job: Record<string, unknown>): string | null {
  const raw = job.jobLocation;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const parts: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const address = record.address && typeof record.address === 'object'
      ? record.address as Record<string, unknown>
      : record;
    const line = [
      textValue(address.addressLocality),
      textValue(address.addressRegion),
      textValue(address.addressCountry) || textValue(record.name),
    ].filter(Boolean);
    const unique = [...new Set(line)];
    if (unique.length) parts.push(unique.join(', '));
  }
  const uniqueParts = [...new Set(parts)];
  return uniqueParts.length ? uniqueParts.join('; ') : null;
}

function fallbackPageDescription(html: string): string {
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    || html.match(/<div[^>]*class=["'][^"']*entry-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
    || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    || '';
  return jobHtmlToPlainText(article || html);
}
