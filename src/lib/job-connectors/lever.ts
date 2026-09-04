import type { ConnectorJob, ConnectorParseOptions } from '@/lib/job-connectors/types';
import {
  arrayOfRecords,
  extractDeadline,
  extractSalary,
  htmlToText,
  normalizeEmploymentCategory,
  normalizeLocations,
  normalizeWorkplace,
  parseExperience,
  record,
  sourceEvidence,
  text,
  validConnectorUrl,
} from '@/lib/job-connectors/utils';

function additionalValue(raw: Record<string, unknown>, names: RegExp): string | null {
  const additional = arrayOfRecords(raw.additional);
  for (const item of additional) {
    const title = text(item.name || item.title || item.key);
    const value = text(item.value || item.text || item.content);
    if (value && names.test(title)) return value;
  }
  return null;
}

function status(raw: Record<string, unknown>): 'open' | 'closed' {
  if (raw.archived === true || raw.isClosed === true || /closed|archived|expired/i.test(text(raw.status))) return 'closed';
  return 'open';
}

export function parseLeverJob(rawValue: unknown, options: ConnectorParseOptions): ConnectorJob | null {
  const raw = record(rawValue);
  const categories = record(raw.categories);
  const title = text(raw.text || raw.title || raw.name);
  const sourceUrl = text(raw.hostedUrl || raw.hosted_url || raw.jobUrl || raw.url || options.sourceUrl);
  const company = text(options.companyName || raw.companyName || raw.company);
  const id = text(raw.id || raw.requisitionCode || raw.slug);
  if (!title || !sourceUrl || !company || !id || !validConnectorUrl(sourceUrl, 'lever')) return null;

  const locationValues = normalizeLocations([
    categories.location,
    raw.location,
    raw.locations,
    raw.workplaceLocations,
  ]);
  const workplace = normalizeWorkplace([
    raw.workplaceType,
    raw.workplace_type,
    raw.workplace,
    categories.location,
  ]);
  const description = htmlToText(raw.descriptionPlain || raw.description || raw.descriptionHtml);
  const employmentType = text(categories.commitment || raw.commitment || raw.employmentType || raw.employment_type) || null;
  const level = text(raw.level || categories.level || additionalValue(raw, /level|seniority/i)) || null;
  const experience = parseExperience([
    raw.experience,
    raw.experienceRequirement,
    additionalValue(raw, /experience|years?/i),
    level,
    description,
  ], level);
  const salary = extractSalary([
    raw.salaryDescription,
    raw.salary_description,
    raw.salaryRange,
    raw.salary_range,
    additionalValue(raw, /salary|compensation|pay/i),
  ]);
  const deadline = extractDeadline([
    raw.applicationDeadline,
    raw.application_deadline,
    raw.deadline,
    additionalValue(raw, /deadline|closing|close\s*date/i),
    description,
  ]);
  const category = normalizeEmploymentCategory([employmentType, level, title, description]);
  const structuredFieldSources = sourceEvidence(sourceUrl, 'lever', {
    location: locationValues.length > 0 ? 'official_payload' : null,
    employment_type: employmentType ? 'official_payload' : null,
    employment_category: category !== '未知'
      ? employmentType ? 'official_payload' : 'official_description'
      : null,
    workplace_type: workplace.workplaceType ? 'official_payload' : null,
    experience: experience.text ? 'official_description' : null,
    salary_range: salary ? 'official_detail_page' : null,
    valid_through: deadline ? 'official_detail_page' : null,
    description: description ? 'official_description' : null,
  });

  return {
    id,
    external_job_id: id,
    company_name: company,
    title,
    description: description || null,
    source_url: sourceUrl,
    location: locationValues.length > 0 ? locationValues : workplace.isRemote ? 'Remote' : null,
    department: text(categories.department) || null,
    job_function: text(categories.team || categories.department) || null,
    level,
    employment_type: employmentType,
    employment_category: category,
    experience: experience.text,
    experience_min_years: experience.min,
    experience_max_years: experience.max,
    experience_text: experience.text,
    workplace_type: workplace.workplaceType,
    salary_range: salary,
    compensation: salary,
    valid_through: deadline,
    application_deadline: deadline,
    date_posted: text(raw.createdAt || raw.created_at || raw.publishedAt) || null,
    status: status(raw),
    sync_action: status(raw) === 'closed' ? 'close' : 'upsert',
    source_evidence: structuredFieldSources,
    raw_payload: raw,
  };
}

export function parseLeverBoard(payload: unknown, options: ConnectorParseOptions): ConnectorJob[] {
  const jobs = Array.isArray(payload) ? payload : record(payload).postings;
  return (Array.isArray(jobs) ? jobs : [])
    .map((job) => parseLeverJob(job, options))
    .filter((job): job is ConnectorJob => Boolean(job));
}
