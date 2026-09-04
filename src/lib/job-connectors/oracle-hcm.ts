import type { ConnectorBoardConfig, ConnectorJob, ConnectorParseOptions } from '@/lib/job-connectors/types';
import {
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

function apiObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function apiArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(apiObject) : [];
}

function oracleJobUrl(config: ConnectorBoardConfig, id: string): string {
  const base = config.oracleCareersUrl || '';
  const careers = base || `https://${new URL(config.oracleApiBaseUrl || '').hostname}/hcmUI/CandidateExperience/en/sites/${config.board}`;
  return `${careers.replace(/\/?(?:jobs|search-results)\/?$/i, '').replace(/\/$/, '')}/job/${encodeURIComponent(id)}`;
}

function mapLocations(raw: Record<string, unknown>): unknown[] {
  const locations = [raw.PrimaryLocation, ...apiArray(raw.workLocation).map((item) => item.LocationName || item.TownOrCity), ...apiArray(raw.secondaryLocations).map((item) => item.Name || item.LocationName)];
  return normalizeLocations(locations.filter(Boolean));
}

export function parseOracleHcmJob(rawValue: unknown, options: ConnectorParseOptions): ConnectorJob | null {
  const raw = record(rawValue);
  const id = text(raw.Id || raw.id || raw.RequisitionNumber);
  const title = text(raw.Title || raw.title);
  const sourceUrl = text(raw.source_url || options.sourceUrl);
  const company = text(options.companyName);
  if (!id || !title || !sourceUrl || !company || !validConnectorUrl(sourceUrl, 'oracle_hcm', id)) return null;

  const description = htmlToText(raw.ExternalDescriptionStr || raw.description || raw.ExternalResponsibilitiesStr || raw.ExternalQualificationsStr);
  const locations = mapLocations(raw);
  const workplace = normalizeWorkplace([raw.WorkplaceType, raw.WorkplaceTypeCode, ...locations]);
  const experience = parseExperience([raw.ExternalQualificationsStr, raw.ExternalDescriptionStr, raw.JobLevel, raw.StudyLevel]);
  // Structured Oracle pay fields take precedence. Description extraction is
  // deliberately separate so the stored value is the pay range, not the
  // entire qualifications paragraph.
  const salary = extractSalary([raw.SalaryRange, raw.salaryRange, raw.Compensation]) || extractSalaryFromDescription(raw.ExternalDescriptionStr);
  const deadline = extractDeadline([raw.ExternalPostedEndDate, raw.PostingEndDate, raw.ApplicationDeadline]);
  const employmentCategory = normalizeEmploymentCategory([raw.RequisitionType, raw.ContractType, raw.WorkerType, raw.JobType, raw.StudyLevel, title, description]);
  const fields = sourceEvidence(sourceUrl, 'oracle_hcm', {
    location: locations.length ? 'official_payload' : null,
    workplace_type: workplace.workplaceType ? 'official_payload' : null,
    employment_type: raw.ContractType || raw.WorkerType || raw.JobType ? 'official_payload' : null,
    employment_category: employmentCategory !== '未知' ? 'official_payload' : null,
    experience: experience.text ? 'official_description' : null,
    salary_range: salary ? 'official_description' : null,
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
    location: locations.length ? locations : null,
    employment_type: text(raw.ContractType || raw.WorkerType || raw.JobType) || null,
    employment_category: employmentCategory,
    experience: experience.text,
    experience_min_years: experience.min,
    experience_max_years: experience.max,
    experience_text: experience.text,
    workplace_type: workplace.workplaceType,
    salary_range: salary,
    compensation: salary,
    valid_through: deadline,
    status: 'open',
    sync_action: 'upsert',
    date_posted: text(raw.ExternalPostedStartDate || raw.PostedDate) || null,
    source_evidence: fields,
    raw_payload: raw,
  };
}

type OracleResponse = { items?: unknown[] };

async function fetchJson(fetcher: typeof fetch, url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { headers: { Accept: 'application/json', 'User-Agent': 'Liorvix official connector' }, cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`Oracle HCM returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T>(items: T[], limit: number, action: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await action(item);
    }
  }));
}

export async function fetchOracleHcmBoard(
  config: ConnectorBoardConfig,
  options: { fetcher?: typeof fetch; timeoutMs?: number; detailJobIds?: ReadonlySet<string> } = {},
) {
  const fetcher = options.fetcher || fetch;
  const timeoutMs = Math.min(Math.max(options.timeoutMs || 30_000, 1_000), 120_000);
  const detailJobIds = options.detailJobIds;
  const apiBase = (config.oracleApiBaseUrl || '').replace(/\/$/, '');
  const siteNumber = config.oracleSiteNumber || 'CX_1';
  if (!apiBase) throw new Error(`Oracle HCM 公司 ${config.company} 缺少 api base URL`);
  const list: Record<string, unknown>[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  const pageSize = 100;
  while (offset < total) {
    const url = new URL(`${apiBase}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`);
    url.searchParams.set('onlyData', 'true');
    url.searchParams.set('expand', 'requisitionList.workLocation,requisitionList.otherWorkLocations,requisitionList.secondaryLocations');
    url.searchParams.set('finder', `findReqs;siteNumber=${siteNumber},limit=${pageSize},offset=${offset}`);
    const payload = apiObject(await fetchJson(fetcher, url.toString(), timeoutMs)) as OracleResponse;
    const search = apiObject(payload.items?.[0]);
    const rows = apiArray(search.requisitionList);
    total = Number(search.TotalJobsCount) || (offset + rows.length);
    list.push(...rows);
    if (rows.length === 0) break;
    offset += rows.length;
  }

  const detailTargets = detailJobIds
    ? list.filter((row) => {
        const id = text(row.Id);
        return id && detailJobIds.has(id);
      })
    : list;
  const detailed = new Map<string, Record<string, unknown>>();
  let detailFailed = 0;
  await mapWithConcurrency(detailTargets, 4, async (row) => {
    const id = text(row.Id);
    if (!id) return;
    const url = new URL(`${apiBase}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails`);
    url.searchParams.set('expand', 'all');
    url.searchParams.set('onlyData', 'true');
    url.searchParams.set('finder', `ById;Id="${id}",siteNumber=${siteNumber}`);
    try {
      const payload = apiObject(await fetchJson(fetcher, url.toString(), timeoutMs));
      const detail = apiArray(payload.items)[0] || {};
      if (Object.keys(detail).length) detailed.set(id, { ...row, ...detail });
      else detailFailed += 1;
    } catch {
      detailFailed += 1;
    }
  });

  const jobs = list.map((row) => {
    const id = text(row.Id);
    const merged = detailed.get(id) || row;
    return parseOracleHcmJob(merged, { companyName: config.company, boardToken: config.board, sourceUrl: oracleJobUrl(config, id) });
  }).filter((job): job is ConnectorJob => Boolean(job));
  return {
    connector: config.connector,
    company: config.company,
    board: config.board,
    jobs,
    received: list.length,
    dropped: list.length - jobs.length,
    fetchedAt: new Date().toISOString(),
    sourceUrl: `${apiBase}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`,
    detailRequested: detailTargets.length,
    detailFailed,
    detailClosed: 0,
    detailAmbiguous: 0,
    duplicateListingRows: 0,
    duplicateExternalIds: 0,
  };
}
