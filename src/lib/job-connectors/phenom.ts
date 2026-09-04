import type { ConnectorJob, ConnectorParseOptions } from '@/lib/job-connectors/types';
import {
  extractDeadline,
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

function firstText(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = text(raw[key]);
    if (value) return value;
  }
  return null;
}

function phenomLocationValues(...values: unknown[]): unknown[] {
  const output: unknown[] = [];
  for (const value of values) {
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) {
      const item = record(candidate);
      // Phenom location objects carry both a complete `location` label and
      // city/country fragments. Prefer the complete label so it is not
      // rendered as "Boston, United States, Boston, United States".
      output.push(item.location || item.cityStateCountry || item.cityCountry || item.standardisedMapQueryLocation || candidate);
    }
  }
  return output;
}

/** Parses a Phenom job record after its official list or detail page is read. */
export function parsePhenomJob(rawValue: unknown, options: ConnectorParseOptions): ConnectorJob | null {
  const raw = record(rawValue);
  const id = firstText(raw, ['jobSeqNo', 'jobId', 'reqId', 'id']);
  const title = firstText(raw, ['title', 'name']);
  const company = text(options.companyName || raw.companyName || raw.company);
  const sourceUrl = firstText(raw, ['jobUrl', 'jobPostingUrl', 'sourceUrl']) || text(options.sourceUrl);
  if (!id || !title || !company || !sourceUrl || !validConnectorUrl(sourceUrl, 'phenom', id)) return null;

  const description = htmlToText(firstText(raw, ['description', 'descriptionHtml', 'description_html']));
  const locations = normalizeLocations(phenomLocationValues(
    raw.location,
    raw.multi_location_array,
    raw.multi_location,
    raw.standardised_multi_location,
  ));
  const workplace = normalizeWorkplace([
    raw.workplaceType,
    raw.workplace_type,
    raw.location,
    raw.multi_location,
    raw.isRemote === true ? 'remote' : '',
    description,
  ]);
  const employmentType = firstText(raw, ['type', 'employmentType', 'employment_type', 'jobTypeValue']);
  const jobType = firstText(raw, ['jobType', 'job_type', 'subCategory']);
  const category = normalizeEmploymentCategory([employmentType, jobType, title, description]);
  // Phenom list teasers are not treated as candidate requirements. Only the
  // job detail's official description can provide experience, pay or deadline.
  const experience = parseExperience([description]);
  const salary = extractSalaryFromDescription(description);
  const deadline = extractDeadline([raw.applicationDeadline, raw.application_deadline, raw.deadline, description]);
  const fields = sourceEvidence(sourceUrl, 'phenom', {
    location: locations.length ? 'official_payload' : null,
    employment_type: employmentType ? 'official_payload' : null,
    employment_category: category !== '未知' ? (employmentType || jobType ? 'official_payload' : 'official_description') : null,
    workplace_type: workplace.workplaceType ? description ? 'official_description' : 'official_payload' : null,
    experience: experience.text ? 'official_description' : null,
    salary_range: salary ? 'official_description' : null,
    valid_through: deadline ? raw.applicationDeadline || raw.application_deadline || raw.deadline ? 'official_payload' : 'official_description' : null,
    description: description ? 'official_description' : null,
  });

  return {
    id,
    external_job_id: id,
    company_name: company,
    title,
    description: description || null,
    source_url: sourceUrl,
    location: locations.length ? locations : null,
    country: text(raw.country) || null,
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
    status: /closed|archived|expired/i.test(text(raw.status)) ? 'closed' : 'open',
    sync_action: /closed|archived|expired/i.test(text(raw.status)) ? 'close' : 'upsert',
    source_evidence: fields,
    raw_payload: raw,
  };
}

export function parsePhenomBoard(payload: { jobs?: unknown[] }, options: ConnectorParseOptions): ConnectorJob[] {
  return (Array.isArray(payload.jobs) ? payload.jobs : [])
    .map((job) => parsePhenomJob(job, options))
    .filter((job): job is ConnectorJob => Boolean(job));
}
