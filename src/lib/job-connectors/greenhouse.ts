import type { ConnectorJob, ConnectorParseOptions } from '@/lib/job-connectors/types';
import {
  arrayOfRecords,
  extractDeadline,
  extractSalary,
  extractSalaryFromDescription,
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

function metadataValue(metadata: unknown, names: RegExp): string | null {
  for (const item of arrayOfRecords(metadata)) {
    const name = text(item.name || item.key || item.label);
    const value = text(item.value || item.text || item.description);
    if (value && names.test(name)) return value;
  }
  return null;
}

function departmentName(value: unknown): string | null {
  const names = arrayOfRecords(value).map((item) => text(item.name)).filter(Boolean);
  return names.length > 0 ? names.join(', ') : null;
}

function mapStatus(raw: Record<string, unknown>): 'open' | 'closed' {
  if (raw.active === false || /closed|inactive|expired|removed/i.test(text(raw.status))) return 'closed';
  return 'open';
}

export function parseGreenhouseJob(rawValue: unknown, options: ConnectorParseOptions): ConnectorJob | null {
  const raw = record(rawValue);
  const title = text(raw.title || raw.name);
  const sourceUrl = text(raw.absolute_url || raw.job_url || options.sourceUrl);
  const company = text(options.companyName || raw.company_name);
  const id = text(raw.id || raw.internal_job_id);
  if (!title || !sourceUrl || !company || !id || !validConnectorUrl(sourceUrl, 'greenhouse', id)) return null;

  const location = record(raw.location).name || raw.location;
  const offices = arrayOfRecords(raw.offices).map((office) => ({
    name: text(office.name),
    location: text(office.location),
  })).filter((office) => office.name || office.location);
  const locationValues = normalizeLocations([location, offices]);
  const metadata = raw.metadata;
  const employmentType = metadataValue(metadata, /employment|job\s*type|commitment|schedule/i);
  const level = metadataValue(metadata, /level|seniority|career\s*stage/i);
  const workplace = normalizeWorkplace([location, metadataValue(metadata, /workplace|remote|location\s*type/i)]);
  const experience = parseExperience([
    metadataValue(metadata, /experience|years?/i),
    level,
    raw.content,
  ], level);
  const description = htmlToText(raw.content || raw.description || raw.description_html);
  const salary = extractSalary([
    metadataValue(metadata, /salary|compensation|pay/i),
    raw.pay_input_ranges,
    raw.salary_range,
    raw.compensation,
  ]) || extractSalaryFromDescription(raw.content || raw.description || raw.description_html);
  const structuredDeadline = extractDeadline([raw.valid_through, raw.application_deadline]);
  const narrativeDeadline = structuredDeadline ? null : extractDeadline([
    metadataValue(metadata, /deadline|closing|close\s*date/i),
    raw.content,
  ]);
  const deadline = structuredDeadline || narrativeDeadline;
  const deadlineSource = structuredDeadline ? 'official_payload' : narrativeDeadline ? 'official_description' : null;
  const employmentCategory = normalizeEmploymentCategory([employmentType, level, title, description]);
  const structuredFieldSources = sourceEvidence(sourceUrl, 'greenhouse', {
    location: location || offices.length > 0 ? 'official_payload' : null,
    offices: offices.length > 0 ? 'official_payload' : null,
    employment_type: employmentType ? 'official_payload' : null,
    employment_category: employmentCategory !== '未知'
      ? employmentType ? 'official_payload' : 'official_description'
      : null,
    workplace_type: workplace.workplaceType ? 'official_payload' : null,
    experience: experience.text ? 'official_description' : null,
    salary_range: salary ? 'official_description' : null,
    valid_through: deadlineSource,
    description: description ? 'official_description' : null,
  });

  return {
    id,
    external_job_id: id,
    company_name: company,
    title,
    description: description || null,
    source_url: sourceUrl,
    location: locationValues.length > 0 ? locationValues : null,
    offices: offices.length > 0 ? offices : null,
    department: departmentName(raw.departments),
    job_function: departmentName(raw.departments),
    level,
    employment_type: employmentType,
    employment_category: employmentCategory,
    experience: experience.text,
    experience_min_years: experience.min,
    experience_max_years: experience.max,
    experience_text: experience.text,
    workplace_type: workplace.workplaceType,
    salary_range: salary,
    compensation: salary,
    valid_through: deadline,
    status: mapStatus(raw),
    sync_action: mapStatus(raw) === 'closed' ? 'close' : 'upsert',
    source_evidence: structuredFieldSources,
    raw_payload: raw,
  };
}

export interface GreenhouseBoardResponse {
  jobs?: unknown[];
}

export function parseGreenhouseBoard(payload: GreenhouseBoardResponse, options: ConnectorParseOptions): ConnectorJob[] {
  return (Array.isArray(payload.jobs) ? payload.jobs : [])
    .map((job) => parseGreenhouseJob(job, options))
    .filter((job): job is ConnectorJob => Boolean(job));
}
