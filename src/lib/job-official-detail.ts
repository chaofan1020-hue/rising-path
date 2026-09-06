import { jobHtmlToPlainText } from '@/lib/job-content';
import type { ExternalPageContent } from '@/lib/safe-external-fetch';

export interface OfficialJobDetails {
  description: string | null;
  responsibilities: string | null;
  requirements: string | null;
  experience: string | null;
  location: string | null;
  validThrough: string | null;
  postedAt: string | null;
  salaryRange: string | null;
  employmentType: string | null;
  workplaceType: string | null;
  source: 'official_structured_data' | 'official_page_text';
}

export function isJobContentShell(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const normalized = value.trim();
  if (!normalized) return true;
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) return false;
  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    return Boolean(parsed && typeof parsed === 'object' && (
      parsed.widget === 'redirect' || parsed.externalSpa === true || parsed.source_evidence || parsed.structured_field_sources
    ));
  } catch { return false; }
}

function text(value: unknown): string {
  if (typeof value === 'string') return jobHtmlToPlainText(value).replace(/\s+/g, ' ').trim();
  if (typeof value === 'number') return String(value);
  return '';
}

const UNAVAILABLE_PLACEHOLDERS = /^(?:unavailable|not provided|na|n\/a|tbd|to be determined|not available)$/i;

function isUsablePart(value: unknown): boolean {
  const normalized = text(value);
  return Boolean(normalized) && !UNAVAILABLE_PLACEHOLDERS.test(normalized);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return null;
}

/** Normalize a schema.org experienceRequirements object to a readable string. */
function experienceRequirementsText(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const months = firstString(record.monthsOfExperience, record.monthsOfExperienceMin);
  if (months && !UNAVAILABLE_PLACEHOLDERS.test(months)) {
    const range = months.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const minYears = (Number(range[1]) / 12).toFixed(Number(range[1]) % 12 === 0 ? 0 : 1).replace(/\.0$/, '');
      const maxYears = (Number(range[2]) / 12).toFixed(Number(range[2]) % 12 === 0 ? 0 : 1).replace(/\.0$/, '');
      return `${minYears}-${maxYears} years`;
    }
    const monthsNumber = Number.parseInt(months, 10);
    if (Number.isInteger(monthsNumber) && monthsNumber > 0) {
      const years = (monthsNumber / 12).toFixed(monthsNumber % 12 === 0 ? 0 : 1).replace(/\.0$/, '');
      return `${years} years`;
    }
    return months;
  }
  const years = firstString(record.yearsOfExperience, record.yearsOfExperienceMin);
  if (years && !UNAVAILABLE_PLACEHOLDERS.test(years)) return `${years} years`;
  return null;
}

function structuredRecords(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(structuredRecords);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const records = [record];
  if (Array.isArray(record['@graph'])) records.push(...record['@graph'].flatMap(structuredRecords));
  return records;
}

function isJobPosting(record: Record<string, unknown>): boolean {
  const type = record['@type'];
  return Array.isArray(type)
    ? type.some((value) => String(value).toLowerCase() === 'jobposting')
    : String(type || '').toLowerCase() === 'jobposting';
}

function decodeStructuredData(value: string): unknown {
  const decoded = value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
  try { return JSON.parse(decoded); } catch { return null; }
}

function extractAddress(value: unknown): string | null {
  const addresses = Array.isArray(value) ? value : [value];
  const output: string[] = [];
  for (const item of addresses) {
    if (typeof item === 'string') {
      if (item.trim()) output.push(item.trim());
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const address = (item as Record<string, unknown>).address;
    const record = address && typeof address === 'object' ? address as Record<string, unknown> : item as Record<string, unknown>;
    const parts = [record.addressLocality, record.addressRegion, record.addressCountry, record.streetAddress]
      .filter(isUsablePart);
    if (parts.length) output.push([...new Set(parts)].join(', '));
  }
  return output.length ? [...new Set(output)].join('; ') : null;
}

function extractSalary(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return isUsablePart(value) ? text(value) : null;
  if (typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const currencyRaw = firstString(record.currency, record.currencyCode);
  const currency = currencyRaw && !UNAVAILABLE_PLACEHOLDERS.test(currencyRaw) ? currencyRaw : null;
  const nested = record.value && typeof record.value === 'object' ? record.value as Record<string, unknown> : record;
  const min = firstString(nested.minValue, nested.minimum, nested.from);
  const max = firstString(nested.maxValue, nested.maximum, nested.to);
  const single = firstString(nested.value, nested.amount);
  if (min && UNAVAILABLE_PLACEHOLDERS.test(min)) return null;
  if (max && UNAVAILABLE_PLACEHOLDERS.test(max)) return null;
  if (single && UNAVAILABLE_PLACEHOLDERS.test(single)) return null;
  const amount = min && max ? `${min}-${max}` : min || max || single;
  if (!amount) return null;
  const unitRaw = firstString(record.unitText, record.unit);
  const unit = unitRaw && !UNAVAILABLE_PLACEHOLDERS.test(unitRaw) ? unitRaw : null;
  return `${currency ? `${currency} ` : ''}${amount}${unit ? ` ${unit}` : ''}`.trim();
}

function section(textValue: string, startPattern: RegExp, endPattern: RegExp): string | null {
  const normalized = textValue.replace(/\s+/g, ' ').trim();
  const start = startPattern.exec(normalized);
  if (!start) return null;
  const remainder = normalized.slice((start.index || 0) + start[0].length).trim();
  const end = endPattern.exec(remainder);
  const result = (end ? remainder.slice(0, end.index) : remainder).trim();
  return result.length >= 40 ? result.slice(0, 20_000) : null;
}

function googleDetailsFromVisibleText(page: ExternalPageContent, visible: string): Partial<OfficialJobDetails> {
  let hostname = '';
  try { hostname = new URL(page.url).hostname.toLowerCase(); } catch { /* keep generic extraction */ }
  if (!/(?:^|\.)google\.com$/.test(hostname) || !visible.includes('corporate_fare')) return {};

  // Google renders the detail panel as plain text after the search result list.
  // Keep this parser deliberately narrow so unrelated Google pages do not gain
  // guessed fields.
  const locationMatch = visible.match(/corporate_fare\s+.+?\s+place\s+(.+?)(?=\s+bar_chart|\s+Apply\b)/i);
  const requirements = section(
    visible,
    /minimum qualifications:/i,
    /about the job|responsibilities|benefits|compensation|equal opportunity/i,
  );
  return {
    location: locationMatch?.[1]?.replace(/\s+/g, ' ').trim() || null,
    requirements,
  };
}

function deloitteDetailsFromText(page: ExternalPageContent, description: string | null, visible: string): Partial<OfficialJobDetails> {
  let hostname = '';
  try { hostname = new URL(page.url).hostname.toLowerCase(); } catch { return {}; }
  if (hostname !== 'apply.deloitte.com') return {};

  // Deloitte's JSON-LD leaves jobLocation empty even though the official page
  // renders the location in its own "article__header--locations" block.
  const headerBlock = page.content?.match(/article__header--locations[\s\S]{0,3000}?<p[^>]*class="[^"]*paragraph[^"]*"[^>]*>([^<]+)<\/p>/i);
  const headerLocation = headerBlock?.[1] ? text(headerBlock[1]) || null : null;
  const sources = [description, visible]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.trim());
  const location = headerLocation
    || sources
      .map((source) => (
        source.match(/(?:seeks|seeking|hiring)\s+(?:a|an)?\s*[^.]{1,140}?\s+in\s+([A-Z][A-Za-z .'-]{1,70}?,\s*[A-Z][A-Za-z .'-]{1,50}?)(?:,\s*United States)?\./i)?.[1]
        || source.match(/position\s+in\s+([A-Z][A-Za-z .'-]{1,70}?,\s*[A-Z][A-Za-z .'-]{1,50}?)(?:,\s*United States)?\./i)?.[1]
        || source.match(/\b([A-Z][A-Za-z .'-]{1,50},\s*[A-Z][A-Za-z .'-]{1,50}),\s*United States\b/)?.[1]
        || null
      ))
      .find((value) => Boolean(value))
    || null;
  const workplaceType = sources.some((source) => /telecommuting permitted|remote work permitted|work from home/i.test(source)) ? 'Hybrid/Remote' : null;
  return { location, workplaceType };
}

function goldmanDetailsFromText(page: ExternalPageContent, description: string | null, visible: string): Partial<OfficialJobDetails> {
  let hostname = '';
  try { hostname = new URL(page.url).hostname.toLowerCase(); } catch { return {}; }
  if (hostname !== 'higher.gs.com') return {};

  const source = description || visible;
  const location = source.match(/location_on\s+(.+?)(?=\s+Apply\b|\s+Who We Are\b)/i)?.[1]?.replace(/\s+/g, ' ').trim() || null;
  const salaryRange = source.match(/(?:expected base salary|base salary)[^$]{0,120}(\$\s?[\d,]+(?:\.\d+)?\s*[-–]\s*\$?\s?[\d,]+(?:\.\d+)?)/i)?.[1]?.replace(/\s+/g, ' ').trim() || null;
  const experience = source.match(/\b(\d+\s*[-–]\s*\d+\s+years?\s+of\s+(?:work\s+)?experience)\b/i)?.[1] || null;
  return { location, salaryRange, experience };
}

/**
 * Amazon.jobs renders the official location inside a sanitized
 * `association location-icon` block (e.g. `IND, KA, Bengaluru` or
 * `US, WA, Redmond`). The plain-text fallback drops that structure, so
 * extract it straight from the page HTML before the generic text parser.
 */
function amazonDetailsFromText(page: ExternalPageContent): OfficialJobDetails | null {
  let hostname = '';
  try { hostname = new URL(page.url).hostname.toLowerCase(); } catch { return null; }
  if (hostname !== 'www.amazon.jobs' && hostname !== 'amazon.jobs') return null;
  const visible = jobHtmlToPlainText(page.content).replace(/\s+/g, " ").trim();
  if (visible.length < 160) return null;

  // amazon.jobs renders the official location as a list item below the
  // "Job details" heading (e.g. "IND, KA, Bengaluru" / "US, WA, Redmond").
  const detailsMarker = visible.search(/Job details\s/);
  const location = detailsMarker >= 0
    ? visible.slice(detailsMarker).match(/[-–]\s*([A-Z]{2,3}, [A-Z]{2}, [^-\n]+?)(?=\s*[-–]|\s*(?:Basic|Last updated|Score|Share|Apply|Job details|\$))/i)?.[1]?.trim() || null
    : null;
  const descriptionStart = visible.search(/\n Description\n/);
  const description = descriptionStart >= 0 ? visible.slice(descriptionStart) : visible;
  return {
    description: description && description.length >= 160 ? description : null,
    responsibilities: null,
    requirements: null,
    experience: null,
    location: location || null,
    validThrough: null,
    postedAt: null,
    salaryRange: null,
    employmentType: null,
    workplaceType: null,
    source: 'official_page_text',
  };
}
function jefferiesDetailsFromText(page: ExternalPageContent): OfficialJobDetails | null {
  let hostname = '';
  try { hostname = new URL(page.url).hostname.toLowerCase(); } catch { return null; }
  if (hostname !== 'jefferies.tal.net') return null;
  const visible = jobHtmlToPlainText(page.content).replace(/\s+/g, ' ').trim();
  if (visible.length < 160) return null;

  const location = visible.match(/\bLocation\s+([A-Z][A-Za-z .,'-]{1,80}?)(?=\s+(?:Business unit|Business units|Region|Department|Program type|Graduation|Job description|Job Description|Description|Apply|Share))/)?.at(1) || null;
  const descriptionStart = visible.search(/Job description/i);
  const description = descriptionStart >= 0 ? visible.slice(descriptionStart) : visible;
  return {
    description: description.length >= 160 ? description : null,
    responsibilities: null,
    requirements: null,
    experience: null,
    location: location ? location.replace(/\s+/g, ' ').trim() : null,
    validThrough: null,
    postedAt: null,
    salaryRange: null,
    employmentType: null,
    workplaceType: null,
    source: 'official_page_text',
  };
}

function evercoreDetailsFromText(page: ExternalPageContent): OfficialJobDetails | null {
  let hostname = '';
  try { hostname = new URL(page.url).hostname.toLowerCase(); } catch { return null; }
  if (hostname !== 'evercore.tal.net') return null;
  const visible = jobHtmlToPlainText(page.content).replace(/\s+/g, ' ').trim();
  if (visible.length < 160) return null;

  const location = visible.match(/\bLocation\s+([A-Z][A-Za-z .,'-]{1,80}?)(?=\s+(?:Region|Group|Job description|Job Description|Description|Apply|Share))/)?.at(1) || null;
  const descriptionStart = visible.search(/Job description/);
  const description = descriptionStart >= 0 ? visible.slice(descriptionStart) : visible;
  return {
    description: description.length >= 160 ? description : null,
    responsibilities: null,
    requirements: null,
    experience: null,
    location: location ? location.replace(/\s+/g, ' ').trim() : null,
    validThrough: null,
    postedAt: null,
    salaryRange: null,
    employmentType: null,
    workplaceType: null,
    source: 'official_page_text',
  };
}

function bainDetailsFromText(page: ExternalPageContent): OfficialJobDetails | null {
  let hostname = '';
  try { hostname = new URL(page.url).hostname.toLowerCase(); } catch { return null; }
  if (hostname !== 'careers.bain.com') return null;
  const visible = jobHtmlToPlainText(page.content).replace(/\s+/g, ' ').trim();
  if (visible.length < 160) return null;

  const location = visible.match(/(?:Location\(s\)|Locations)\s*:?\s*([A-Z][A-Za-z ,.|-]+?)(?=\s+(?:Description & Requirements|What Makes Us|Job Description|About the Role|Description|Job ID))/)?.at(1) || null;
  const employmentType = visible.match(/Employment Type\s+([A-Za-z-]+(?:\s+[A-Za-z-]+)?)/)?.[1] || null;
  const descriptionStart = visible.search(/(?:Description & Requirements|Job Description|About the Role)/);
  const description = descriptionStart >= 0 ? visible.slice(descriptionStart) : visible;
  return {
    description: description.length >= 160 ? description : null,
    responsibilities: null,
    requirements: null,
    experience: null,
    location: location ? location.replace(/\s+/g, ' ').trim() : null,
    validThrough: null,
    postedAt: null,
    salaryRange: null,
    employmentType,
    workplaceType: null,
    source: 'official_page_text',
  };
}

function twoSigmaDetailsFromText(page: ExternalPageContent): OfficialJobDetails | null {
  let hostname = '';
  try { hostname = new URL(page.url).hostname.toLowerCase(); } catch { return null; }
  if (hostname !== 'careers.twosigma.com') return null;
  const visible = jobHtmlToPlainText(page.content).replace(/\s+/g, ' ').trim();
  if (visible.length < 160) return null;

  const location = visible.match(/Location\s+([A-Z][A-Za-z ,.'-]{1,80}?)(?=\s+(?:Business|Function|Experience Level|Position Summary|Apply|Share))/)?.at(1) || null;
  const descriptionStart = visible.search(/Position Summary/);
  const description = descriptionStart >= 0 ? visible.slice(descriptionStart) : visible;
  return {
    description: description.length >= 160 ? description : null,
    responsibilities: null,
    requirements: null,
    experience: null,
    location: location ? location.replace(/\s+/g, ' ').trim() : null,
    validThrough: null,
    postedAt: null,
    salaryRange: null,
    employmentType: null,
    workplaceType: null,
    source: 'official_page_text',
  };
}

function blackrockDetailsFromText(page: ExternalPageContent, description: string | null): Partial<OfficialJobDetails> {
  let hostname = '';
  try { hostname = new URL(page.url).hostname.toLowerCase(); } catch { return {}; }
  if (hostname !== 'careers.blackrock.com') return {};

  // BlackRock's JSON-LD carries the full description but no structured
  // experience/employment fields; the official page text has a clear
  // "Required experience" section. Extract only that official section.
  const source = description || '';
  const experience = section(
    source,
    /required experience\s*:?/i,
    /responsibilities|about (?:the role|the job|blackrock)|equal opportunity|application process/i,
  );
  return { experience };
}

/**
 * Parse the Deutsche Bank official beesite API detail payload
 * ({ html: string, apply_uri?: string }) returned by
 * https://api-deutschebank.beesite.de/jobhtml/{PositionID}.json.
 *
 * The payload is the official job ad HTML: a structured header table
 * (Location / Full-Part-Time / Listed) plus the full ad body. Only official
 * fields are extracted: location and Full/Part-Time come from the structured
 * header; the ad body becomes the description. "Listed" is a publish date,
 * not an application deadline, so it is never emitted as validThrough.
 */
export function deutscheBankDetailsFromApi(payload: unknown): OfficialJobDetails | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const html = typeof record.html === "string" ? record.html : null;
  if (!html) return null;
  const plain = jobHtmlToPlainText(html).replace(/\s+/g, " ").trim();
  if (plain.length < 160) return null;

  const location = plain.match(/\bLocation:\s*([A-Z][A-Za-z .'\u2019-]{1,90}?)(?=\s+(?:Position Overview|Job Title|POSITION OVERVIEW|Employer|Details of|Additional Job Description)|\s*$)/)?.[1]?.trim() || null;
  const employmentType = plain.match(/Full\/Part-Time:\s*([A-Za-z-]+)/)?.[1] || null;

  return {
    description: plain,
    responsibilities: null,
    requirements: null,
    experience: null,
    location,
    validThrough: null,
    postedAt: null,
    salaryRange: null,
    employmentType,
    workplaceType: null,
    source: "official_structured_data",
  };
}


function fromPosting(posting: Record<string, unknown>): OfficialJobDetails {
  const description = firstString(posting.description, posting.descriptionText, posting.jobDescription);
  const responsibilities = firstString(posting.responsibilities, posting.jobResponsibilities);
  const requirements = firstString(posting.qualifications, posting.requirements, posting.experienceRequirements);
  const combined = [description, responsibilities, requirements].filter(Boolean).join(' ');
  return {
    description: description || null,
    responsibilities: responsibilities || null,
    requirements: requirements || section(combined, /(?:basic|minimum|preferred) qualifications|requirements|what you(?:'|’)ll bring|skills(?: and experience)?/i, /responsibilities|what you(?:'|’)ll do|benefits|compensation|about (?:the role|the job)|application process/i),
    experience: experienceRequirementsText(posting.experienceRequirements) || firstString(posting.experience, posting.experienceYears),
    location: extractAddress(posting.jobLocation || posting.jobLocationType),
    validThrough: firstString(posting.validThrough, posting.applicationDeadline, posting.closingDate),
    postedAt: firstString(posting.datePosted, posting.datePostedISO, posting.originalPostingDate),
    salaryRange: extractSalary(posting.baseSalary || posting.salary),
    employmentType: firstString(posting.employmentType),
    workplaceType: firstString(posting.jobLocationType, posting.workplaceType),
    source: 'official_structured_data',
  };
}

/** Extract a public JobPosting payload without exposing ATS configuration JSON. */
export function extractOfficialJobDetails(page: ExternalPageContent): OfficialJobDetails | null {
  // Bain and Two Sigma render their full job ad server-side; the thin
  // JobPosting JSON-LD on those pages carries no description, so their
  // dedicated text parsers run first and own the extraction.
  const bain = bainDetailsFromText(page);
  if (bain) return bain;
  const twoSigma = twoSigmaDetailsFromText(page);
  if (twoSigma) return twoSigma;
  const evercore = evercoreDetailsFromText(page);
  if (evercore) return evercore;
  const jefferies = jefferiesDetailsFromText(page);
  if (jefferies) return jefferies;
  const amazon = amazonDetailsFromText(page);
  if (amazon) return amazon;

  const records = structuredRecords(page.metadata?.structured_data).filter(isJobPosting);
  if (records.length > 0) {
    const details = fromPosting(records[0]);
    const visible = jobHtmlToPlainText(page.content);
    const deloitte = deloitteDetailsFromText(page, details.description, visible);
    const goldman = goldmanDetailsFromText(page, details.description, visible);
    const blackrock = blackrockDetailsFromText(page, details.description);
    return {
      ...details,
      location: details.location || deloitte.location || goldman.location || null,
      workplaceType: details.workplaceType || deloitte.workplaceType || goldman.workplaceType || null,
      salaryRange: details.salaryRange || goldman.salaryRange || null,
      experience: details.experience || goldman.experience || blackrock.experience || null,
    };
  }
  const visible = jobHtmlToPlainText(page.content);
  if (visible.length < 160) return null;
  const metaDescription = typeof page.metadata?.description === 'string' ? page.metadata.description : null;
  const googleDetails = googleDetailsFromVisibleText(page, visible);
  const goldmanDetails = goldmanDetailsFromText(page, null, visible);
  return {
    description: metaDescription && metaDescription.length >= 160 ? metaDescription : visible,
    responsibilities: null,
    requirements: googleDetails.requirements || null,
    experience: goldmanDetails.experience || null,
    location: googleDetails.location || goldmanDetails.location || null,
    validThrough: null,
    postedAt: null,
    salaryRange: goldmanDetails.salaryRange || null,
    employmentType: null,
    workplaceType: null,
    source: 'official_page_text',
  };
}
