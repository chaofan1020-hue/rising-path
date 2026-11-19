import { isDisplayableJobDescription, jobHtmlToPlainText } from '@/lib/job-content';

export const LINKEDIN_COMPANY_ID = '1337';
export const LINKEDIN_WORLDWIDE_GEO_ID = '92000000';
export const LINKEDIN_SEARCH_URL = `https://www.linkedin.com/jobs/search/?f_C=${LINKEDIN_COMPANY_ID}&geoId=${LINKEDIN_WORLDWIDE_GEO_ID}&sortBy=DD`;
export const LINKEDIN_GUEST_SEARCH_URL = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?f_C=${LINKEDIN_COMPANY_ID}&geoId=${LINKEDIN_WORLDWIDE_GEO_ID}&sortBy=DD`;
export const LINKEDIN_CAREERS_URL = 'https://careers.linkedin.com/';
export const LINKEDIN_FEED_PATH = '/app/app/static/feeds/linkedin-official-jobs.json';
export const LINKEDIN_FEED_URL = 'http://api:8000/static/feeds/linkedin-official-jobs.json';

const LINKEDIN_HOSTS = new Set(['www.linkedin.com', 'linkedin.com']);
const JOB_VIEW_PATH = /^\/jobs\/view\/(?:[a-z0-9-]+-)?(\d+)\/?$/i;
const CHALLENGE_RE = /just a moment|cf-challenge|checking your browser|verify you are human|turnstile|security verification|enable javascript to continue|access denied|authwall|captcha|checkpoint\/challenge|unusual traffic|ccookie=/i;
const HIRING_RE = /^(linkedin)(\s+(corporation|ireland|india|singapore))?$/i;

export type LinkedInListCard = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
};

export type LinkedInDetailParse = {
  id: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  description: string | null;
  department: string | null;
  employmentType: string | null;
  datePosted: string | null;
  blocked: boolean;
  blockReason: string | null;
};

export type LinkedInCapturedJob = {
  id: string;
  title: string;
  url: string;
  location: string | null;
  department: string | null;
  description: string;
  company: string;
  employment_type?: string | null;
  date_posted?: string | null;
  captured_at: string;
  source_reported_count?: number;
  source_expected_count?: number;
  source_complete?: boolean;
  source_count_basis?: string;
};

function decode(value: string): string {
  return jobHtmlToPlainText(value).replace(/\s+/g, ' ').trim();
}

function textBetween(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  if (!match?.[1]) return null;
  const text = decode(match[1]);
  return text || null;
}

export function isLinkedInChallenge(html: string, title?: string | null): boolean {
  return CHALLENGE_RE.test(`${title || ''}\n${html}`);
}

export function linkedInJobIdFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (!LINKEDIN_HOSTS.has(url.hostname.toLowerCase())) return null;
    const match = url.pathname.match(JOB_VIEW_PATH);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

export function normalizeLinkedInJobUrl(value: string | null | undefined): string | null {
  const id = linkedInJobIdFromUrl(value);
  if (!id) return null;
  try {
    const url = new URL(value!.trim());
    const path = url.pathname.replace(/\/+$/, '');
    const slugMatch = path.match(/^\/jobs\/view\/([a-z0-9-]+-\d+)$/i);
    const canonicalPath = slugMatch ? `/jobs/view/${slugMatch[1]}` : `/jobs/view/${id}`;
    return `https://www.linkedin.com${canonicalPath}`;
  } catch {
    return `https://www.linkedin.com/jobs/view/${id}`;
  }
}

export function isLinkedInJobUrl(value: string | null | undefined): boolean {
  return Boolean(normalizeLinkedInJobUrl(value));
}

export function isLinkedInHiringCompany(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = decode(value).toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('linkedin jobs')) return false;
  return HIRING_RE.test(normalized);
}

export function parseLinkedInReportedTotal(text: string | null | undefined): number | null {
  if (!text) return null;
  const values = [...text.matchAll(/(\d[\d,]*)\s*(?:jobs?|open roles?|results|个结果)/gi)]
    .map((match) => Number(match[1].replace(/,/g, '')))
    .filter((total) => Number.isFinite(total) && total > 0);
  return values.length > 0 ? Math.max(...values) : null;
}

function viewModelText(value: unknown): string | null {
  if (typeof value === 'string') return decode(value) || null;
  if (!value || typeof value !== 'object') return null;
  const text = (value as { text?: unknown }).text;
  return typeof text === 'string' ? decode(text) || null : null;
}

function jobIdFromUrn(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/(\d{8,})/);
  return match?.[1] || null;
}

export function linkedInJobCardsUrl(start = 0): string {
  return `https://www.linkedin.com/voyager/api/voyagerJobsDashJobCards?decorationId=com.linkedin.voyager.dash.deco.jobs.search.JobSearchCardsCollection-221&count=25&q=jobSearch&query=(origin:JOB_SEARCH_PAGE_OTHER_ENTRY,locationUnion:(geoId:${LINKEDIN_WORLDWIDE_GEO_ID}),selectedFilters:(sortBy:List(DD),company:List(${LINKEDIN_COMPANY_ID})),spellCorrectionEnabled:true)&start=${start}`;
}

export function linkedInJobDescriptionUrl(id: string): string {
  return `https://www.linkedin.com/voyager/api/graphql?includeWebMetadata=true&variables=(cardSectionTypes:List(JOB_DESCRIPTION_CARD),jobPostingUrn:urn%3Ali%3Afsd_jobPosting%3A${id},includeSecondaryActionsV2:true)&queryId=voyagerJobsDashJobPostingDetailSections.bc2eee77d01abc6616b8c8855344dfd5`;
}

export function parseLinkedInJobCardsPayload(payload: unknown): { total: number | null; cards: LinkedInListCard[] } {
  if (!payload || typeof payload !== 'object') return { total: null, cards: [] };
  const root = payload as { data?: Record<string, unknown>; included?: unknown[] };
  const paging = root.data?.paging && typeof root.data.paging === 'object'
    ? root.data.paging as { total?: unknown }
    : {};
  const subtitleTotal = parseLinkedInReportedTotal(viewModelText(
    root.data?.metadata && typeof root.data.metadata === 'object'
      ? (root.data.metadata as { subtitle?: unknown }).subtitle
      : null,
  ));
  const total = typeof paging.total === 'number' && paging.total > 0 ? paging.total : subtitleTotal;
  const cards: LinkedInListCard[] = [];
  const seen = new Set<string>();
  const included = Array.isArray(root.included) ? root.included : [];
  for (const item of included) {
    if (!item || typeof item !== 'object') continue;
    const card = item as Record<string, unknown>;
    if (card.$type !== 'com.linkedin.voyager.dash.jobs.JobPostingCard') continue;
    if (!String(card.entityUrn || '').includes('JOBS_SEARCH')) continue;
    const id = jobIdFromUrn(card.jobPostingUrn) || jobIdFromUrn(card['*jobPosting']) || jobIdFromUrn(card.entityUrn);
    const title = typeof card.jobPostingTitle === 'string' ? decode(card.jobPostingTitle) : viewModelText(card.title);
    const company = viewModelText(card.primaryDescription) || 'LinkedIn';
    const location = viewModelText(card.secondaryDescription);
    pushCard(cards, seen, { id, title, company, location, url: id ? `https://www.linkedin.com/jobs/view/${id}` : null });
  }
  return { total, cards };
}

export function parseLinkedInJobDescriptionPayload(payload: unknown): LinkedInDetailParse {
  const empty: LinkedInDetailParse = {
    id: null,
    title: null,
    company: null,
    location: null,
    description: null,
    department: null,
    employmentType: null,
    datePosted: null,
    blocked: false,
    blockReason: null,
  };
  if (!payload || typeof payload !== 'object') return empty;
  const included = Array.isArray((payload as { included?: unknown[] }).included)
    ? (payload as { included: Array<Record<string, unknown>> }).included
    : [];
  const descriptionNode = included.find((item) => item?.$type === 'com.linkedin.voyager.dash.jobs.JobDescription');
  const postingNode = included.find((item) => item?.$type === 'com.linkedin.voyager.dash.jobs.JobPosting');
  const companyNode = included.find((item) => item?.$type === 'com.linkedin.voyager.dash.organization.Company');
  const description = viewModelText(descriptionNode?.descriptionText)
    || viewModelText(postingNode?.description);
  const postedOn = typeof descriptionNode?.postedOnText === 'string'
    ? descriptionNode.postedOnText.match(/([A-Z][a-z]{2} \d{1,2}, \d{4})/)?.[1] || null
    : null;
  const id = jobIdFromUrn(descriptionNode?.entityUrn) || jobIdFromUrn(postingNode?.entityUrn);
  return {
    ...empty,
    id,
    title: typeof postingNode?.title === 'string' ? decode(postingNode.title) : null,
    company: typeof companyNode?.name === 'string' ? decode(companyNode.name) : viewModelText(companyNode?.name),
    description,
    datePosted: postedOn,
  };
}

function pushCard(
  cards: LinkedInListCard[],
  seen: Set<string>,
  card: Partial<LinkedInListCard> & { id?: string | null },
): void {
  const id = card.id;
  if (!id || seen.has(id)) return;
  const url = normalizeLinkedInJobUrl(card.url) || `https://www.linkedin.com/jobs/view/${id}`;
  if (!linkedInJobIdFromUrl(url)) return;
  const title = card.title?.trim();
  if (!title) return;
  const company = card.company?.trim() || 'LinkedIn';
  if (company && !isLinkedInHiringCompany(company)) return;
  seen.add(id);
  cards.push({
    id,
    title,
    company,
    location: card.location?.trim() || null,
    url,
  });
}

export function parseLinkedInListHtml(html: string): LinkedInListCard[] {
  if (isLinkedInChallenge(html)) return [];
  const cards: LinkedInListCard[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/data-entity-urn="urn:li:jobPosting:/i);
  for (let index = 1; index < blocks.length; index += 1) {
    const block = blocks[index];
    const idMatch = block.match(/^(\d+)/);
    const id = idMatch?.[1];
    if (!id || seen.has(id)) continue;
    const href = textBetween(block, /href="(https?:\/\/[^"]+\/jobs\/view\/[^"]+)"/i)
      || textBetween(block, /href="(\/jobs\/view\/[^"]+)"/i);
    const title = textBetween(block, /base-search-card__title[^>]*>([\s\S]*?)<\//i)
      || textBetween(block, /base-card__title[^>]*>([\s\S]*?)<\//i)
      || textBetween(block, /job-card-list__title[^>]*>([\s\S]*?)<\//i);
    const company = textBetween(block, /base-search-card__subtitle[^>]*>([\s\S]*?)<\//i)
      || textBetween(block, /artdeco-entity-lockup__subtitle[^>]*>([\s\S]*?)<\//i);
    const location = textBetween(block, /job-search-card__location[^>]*>([\s\S]*?)<\//i)
      || textBetween(block, /job-card-container__metadata-item[^>]*>([\s\S]*?)<\//i);
    pushCard(cards, seen, { id, title, company, location, url: href || `https://www.linkedin.com/jobs/view/${id}` });
  }
  return cards;
}

function parseJsonLdJob(html: string): Partial<LinkedInDetailParse> {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1]) as unknown;
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const job = node as Record<string, unknown>;
        if (job['@type'] !== 'JobPosting') continue;
        const org = job.hiringOrganization && typeof job.hiringOrganization === 'object'
          ? job.hiringOrganization as Record<string, unknown>
          : {};
        const place = job.jobLocation && typeof job.jobLocation === 'object'
          ? job.jobLocation as Record<string, unknown>
          : {};
        const address = place.address && typeof place.address === 'object'
          ? place.address as Record<string, unknown>
          : {};
        const locationParts = [address.addressLocality, address.addressRegion, address.addressCountry]
          .map((part) => (typeof part === 'string' ? part.trim() : ''))
          .filter(Boolean);
        const identifier = job.identifier && typeof job.identifier === 'object'
          ? job.identifier as Record<string, unknown>
          : {};
        return {
          id: typeof identifier.value === 'string' ? identifier.value.replace(/\D/g, '') || null : null,
          title: typeof job.title === 'string' ? decode(job.title) : null,
          company: typeof org.name === 'string' ? decode(org.name) : null,
          location: locationParts.join(', ') || null,
          description: typeof job.description === 'string' ? jobHtmlToPlainText(job.description) : null,
          employmentType: typeof job.employmentType === 'string' ? decode(job.employmentType) : null,
          datePosted: typeof job.datePosted === 'string' ? job.datePosted : null,
        };
      }
    } catch {
      continue;
    }
  }
  return {};
}

export function parseLinkedInDetailHtml(html: string, title?: string | null): LinkedInDetailParse {
  if (isLinkedInChallenge(html, title)) {
    return {
      id: null,
      title: null,
      company: null,
      location: null,
      description: null,
      department: null,
      employmentType: null,
      datePosted: null,
      blocked: true,
      blockReason: 'linkedin_challenge',
    };
  }
  const jsonLd = parseJsonLdJob(html);
  const heading = textBetween(html, /topcard__title[^>]*>([\s\S]*?)<\//i)
    || textBetween(html, /top-card-layout__title[^>]*>([\s\S]*?)<\//i)
    || (title ? decode(title) : null);
  const company = textBetween(html, /topcard__org-name-link[^>]*>([\s\S]*?)<\//i)
    || textBetween(html, /topcard__flavor\s[^>]*>([\s\S]*?)<\//i)
    || jsonLd.company
    || null;
  const location = textBetween(html, /topcard__flavor--bullet[^>]*>([\s\S]*?)<\//i)
    || jsonLd.location
    || null;
  const descriptionHtml = html.match(/show-more-less-html__markup[\s\S]*?>([\s\S]*?)<\/div>/i)?.[1]
    || html.match(/description__text[\s\S]*?>([\s\S]*?)<\/div>/i)?.[1]
    || '';
  const description = jobHtmlToPlainText(descriptionHtml) || jsonLd.description || null;
  const id = jsonLd.id
    || html.match(/urn:li:jobPosting:(\d+)/)?.[1]
    || html.match(/\/jobs\/view\/[a-z0-9-]*?(\d{8,})/i)?.[1]
    || null;
  return {
    id,
    title: jsonLd.title || heading,
    company,
    location,
    description,
    department: null,
    employmentType: jsonLd.employmentType || null,
    datePosted: jsonLd.datePosted || null,
    blocked: false,
    blockReason: null,
  };
}

export function isUsableLinkedInDescription(value: string | null | undefined): boolean {
  if (!value) return false;
  const text = jobHtmlToPlainText(value);
  if (text.length < 160 || text.length > 100_000) return false;
  if (!isDisplayableJobDescription(text)) return false;
  if (isLinkedInChallenge(text)) return false;
  return true;
}

export function assertLinkedInFeedComplete(input: {
  jobs: LinkedInCapturedJob[];
  reportedTotal: number | null;
  previousCount?: number | null;
  listComplete: boolean;
  allowPartial?: boolean;
}): void {
  const unique = new Set(input.jobs.map((job) => job.id));
  if (unique.size !== input.jobs.length) {
    throw new Error(`LinkedIn 快照有重复岗位 ID：${input.jobs.length} 条，唯一 ${unique.size}`);
  }
  if (input.allowPartial) return;
  if (!input.listComplete) {
    throw new Error('LinkedIn 列表未翻完，拒绝覆盖采集器完整快照');
  }
  if (input.jobs.length === 0) {
    throw new Error('LinkedIn 快照为空');
  }
  if (!input.reportedTotal) {
    throw new Error('LinkedIn 官方页没有给出岗位总数，拒绝当作完整快照');
  }
  if (input.reportedTotal && input.jobs.length < Math.floor(input.reportedTotal * 0.9)) {
    throw new Error(`LinkedIn 快照 ${input.jobs.length} 条，低于官方标题总数 ${input.reportedTotal} 的 90%`);
  }
  if (input.previousCount && input.jobs.length < Math.floor(input.previousCount * 0.9)) {
    throw new Error(`LinkedIn 快照 ${input.jobs.length} 条，低于上次 ${input.previousCount} 的 90%，保留旧快照`);
  }
}
