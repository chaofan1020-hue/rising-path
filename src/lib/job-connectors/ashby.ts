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

function firstText(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = text(raw[key]);
    if (value) return value;
  }
  return null;
}

function status(raw: Record<string, unknown>): 'open' | 'closed' {
  if (raw.isArchived === true || raw.isClosed === true || /closed|archived|expired/i.test(text(raw.status))) return 'closed';
  return 'open';
}

export function parseAshbyJob(rawValue: unknown, options: ConnectorParseOptions): ConnectorJob | null {
  const raw = record(rawValue);
  const title = firstText(raw, ['title', 'name']);
  const sourceUrl = firstText(raw, ['jobUrl', 'jobPostingUrl', 'sourceUrl', 'source_url', 'applyUrl']) || text(options.sourceUrl);
  const company = text(options.companyName || raw.companyName || raw.company);
  const id = firstText(raw, ['id', 'jobId']);
  if (!title || !sourceUrl || !company || !id || !validConnectorUrl(sourceUrl, 'ashby')) return null;

  const address = record(raw.address);
  const postalAddress = record(address.postalAddress);
  const locations = normalizeLocations([
    raw.location,
    raw.locations,
    raw.secondaryLocations,
    raw.secondary_locations,
    postalAddress,
  ]);
  const remoteSignal = [
    raw.isRemote,
    raw.workplaceType,
    raw.workplace_type,
    raw.location,
  ].map((value) => typeof value === 'boolean' ? (value ? 'remote' : '') : text(value));
  const workplace = normalizeWorkplace(remoteSignal);
  const workplaceType = workplace.workplaceType || (raw.isRemote === true ? 'Remote' : null);
  const description = htmlToText(firstText(raw, ['descriptionHtml', 'description_html', 'description', 'descriptionPlain']));
  const employmentType = firstText(raw, ['employmentType', 'employment_type', 'commitment', 'jobType']);
  const level = firstText(raw, ['level', 'seniority', 'careerLevel']);
  const experience = parseExperience([
    raw.experience,
    raw.experienceRequirement,
    raw.experience_requirement,
    level,
    description,
  ], level);
  const salary = extractSalary([
    raw.compensationTierSummary,
    raw.compensation,
    raw.salaryRange,
    raw.salary_range,
  ]);
  const deadline = extractDeadline([
    raw.applicationDeadline,
    raw.application_deadline,
    raw.deadline,
    description,
  ]);
  const category = normalizeEmploymentCategory([employmentType, level, title, description]);
  const structuredFieldSources = sourceEvidence(sourceUrl, 'ashby', {
    location: locations.length > 0 ? 'official_payload' : null,
    official_location: postalAddress.addressCountry || postalAddress.addressLocality ? 'official_payload' : null,
    employment_type: employmentType ? 'official_payload' : null,
    employment_category: category !== '未知'
      ? employmentType ? 'official_payload' : 'official_description'
      : null,
    workplace_type: workplaceType ? 'official_payload' : null,
    experience: experience.text ? 'official_description' : null,
    salary_range: salary ? 'official_payload' : null,
    valid_through: deadline ? 'official_payload' : null,
    description: description ? 'official_description' : null,
  });

  return {
    id,
    external_job_id: id,
    company_name: company,
    title,
    description: description || null,
    source_url: sourceUrl,
    location: locations.length > 0 ? locations : workplace.isRemote ? 'Remote' : null,
    country: text(postalAddress.addressCountry) || null,
    official_location: postalAddress.addressCountry || postalAddress.addressLocality ? postalAddress : null,
    employment_type: employmentType,
    employment_category: category,
    level,
    experience: experience.text,
    experience_min_years: experience.min,
    experience_max_years: experience.max,
    experience_text: experience.text,
    workplace_type: workplaceType,
    salary_range: salary,
    compensation: salary,
    valid_through: deadline,
    application_deadline: deadline,
    status: status(raw),
    sync_action: status(raw) === 'closed' ? 'close' : 'upsert',
    source_evidence: structuredFieldSources,
    raw_payload: raw,
  };
}

export interface AshbyBoardResponse {
  jobs?: unknown[];
}

export function parseAshbyBoard(payload: AshbyBoardResponse, options: ConnectorParseOptions): ConnectorJob[] {
  return (Array.isArray(payload.jobs) ? payload.jobs : [])
    .map((job) => parseAshbyJob(job, options))
    .filter((job): job is ConnectorJob => Boolean(job));
}
