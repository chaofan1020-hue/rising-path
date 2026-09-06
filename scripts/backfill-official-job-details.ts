import { config as loadDotenv } from 'dotenv';
import { isDisplayableJobDescription } from '@/lib/job-content';
import { deutscheBankDetailsFromApi, extractOfficialJobDetails, isJobContentShell } from '@/lib/job-official-detail';
import { extractOfficialJobRequirements, looksLikeBlockedPage, looksLikeClosedJobPage } from '@/lib/job-maintenance';
import { ExternalFetchError, fetchSafeExternalPage } from '@/lib/safe-external-fetch';
import {
  extractDeadline,
  extractSalary,
  extractSalaryFromDescription,
  normalizeEmploymentCategory,
  normalizeWorkplace,
  parseExperience,
  text,
} from '@/lib/job-connectors/utils';
import { hasMatchingPhenomDetailPayload, isRegisteredPhenomJobUrl } from '@/lib/job-connectors';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { recordJobSyncRunProgress } from '@/lib/job-sync-dashboard';

type FieldName = 'location' | 'workplace_type' | 'employment_category' | 'experience' | 'salary' | 'deadline';

type Job = {
  id: number;
  external_job_id: string | null;
  title: string;
  company: string;
  job_url: string | null;
  description: string | null;
  requirements: string | null;
  responsibilities: string | null;
  region: string | null;
  location_source: string | null;
  workplace_type: string | null;
  employment_category: string | null;
  job_type: string | null;
  experience_min_years: number | null;
  experience_max_years: number | null;
  experience_text: string | null;
  salary_range: string | null;
  salary_source: string | null;
  valid_through: string | null;
  posted_at: string | null;
  deadline_source: string | null;
  field_evidence: Record<string, unknown> | null;
};

type PreparedJob = {
  job: Job;
  pageUrl: string;
  patch: Record<string, unknown>;
  fields: string[];
  unavailableFields: string[];
};

// Keep each database response bounded. A company page can contain large
// descriptions and field-evidence JSON; reading 1,000 rows at once can hit
// Supabase's statement timeout before the official request even starts.
const PAGE_SIZE = 200;
const FIELDS: FieldName[] = ['location', 'workplace_type', 'employment_category', 'experience', 'salary', 'deadline'];
const APPROVED_GENERIC_HOSTS: Record<string, string[]> = {
  Amazon: ['amazon.jobs'],
  Apple: ['jobs.apple.com'],
  Google: ['google.com'],
  Microsoft: ['apply.careers.microsoft.com'],
  Meta: ['www.metacareers.com', 'metacareers.com'],
  Deloitte: ['apply.deloitte.com'],
  'Morgan Stanley': ['morganstanley.eightfold.ai'],
  'Goldman Sachs': ['higher.gs.com'],
  BlackRock: ['careers.blackrock.com'],
  'Millennium Management': ['mlp.eightfold.ai', 'career.mlp.com'],
  'Deutsche Bank': ['careers.db.com'],
  'Bain & Company': ['careers.bain.com'],
  'Two Sigma': ['careers.twosigma.com'],
  Evercore: ['evercore.tal.net'],
  Jefferies: ['jefferies.tal.net'],
  Accenture: ['www.accenture.com'],
};

function genericOfficialWriteEnabled(company: string): boolean {
  if (process.env.JOBS_GENERIC_OFFICIAL_BACKFILL_WRITE_ENABLED !== 'true') return false;
  const configured = (process.env.JOBS_GENERIC_OFFICIAL_BACKFILL_COMPANIES || '').split(',').map((value) => value.trim().toLocaleLowerCase()).filter(Boolean);
  return configured.length === 0 || configured.includes(company.trim().toLocaleLowerCase());
}

function approvedOfficialHost(company: string, hostname: string): boolean {
  const hosts = APPROVED_GENERIC_HOSTS[company] || [];
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function numberArgument(name: string, min: number, max: number): number | null {
  const raw = argument(name);
  if (raw == null) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function idListArgument(): number[] {
  const raw = argument('job-ids');
  if (!raw) return [];
  const ids = [...new Set(raw.split(',').map((value) => Number(value.trim())))];
  if (ids.some((id) => !Number.isInteger(id) || id < 1)) {
    throw new Error('--job-ids must contain positive integer IDs');
  }
  if (ids.length > 100) throw new Error('--job-ids supports at most 100 IDs per batch');
  return ids;
}

function runIdArgument(): number | null {
  return numberArgument('run-id', 1, Number.MAX_SAFE_INTEGER);
}

function projectRef(): string | null {
  try {
    return new URL(process.env.SUPABASE_URL || '').hostname.split('.')[0] || null;
  } catch {
    return null;
  }
}

function evidence(job: Job, field: FieldName): Record<string, unknown> | null {
  const fields = job.field_evidence?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const value = (fields as Record<string, unknown>)[field];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isVerified(job: Job, field: FieldName): boolean {
  return evidence(job, field)?.status === 'verified';
}

function isUnavailableOnOfficialSource(job: Job, field: FieldName): boolean {
  return evidence(job, field)?.status === 'unavailable_on_official_source';
}

function hasValue(job: Job, field: FieldName): boolean {
  switch (field) {
    case 'location': return Boolean(text(job.region));
    case 'workplace_type': return Boolean(text(job.workplace_type));
    case 'employment_category': return Boolean(text(job.employment_category) && text(job.employment_category) !== '未知');
    case 'experience': return job.experience_min_years != null || job.experience_max_years != null || Boolean(text(job.experience_text));
    case 'salary': return Boolean(text(job.salary_range));
    case 'deadline': return Boolean(text(job.valid_through));
  }
}

function canBackfill(job: Job, field: FieldName, officialValue: unknown): boolean {
  // A prior run may have marked a field unavailable because the parser did
  // not recognize the official evidence. Re-open that field when a later
  // parser revision produces a real first-party value; never overwrite a
  // verified value with an unverified one.
  return Boolean(officialValue) && (!hasValue(job, field) || !isVerified(job, field) || isUnavailableOnOfficialSource(job, field));
}

function needsDetail(job: Job): boolean {
  return !isDisplayableJobDescription(job.description) || isJobContentShell(job.description);
}

function hasCandidate(job: Job): boolean {
  return needsDetail(job) || FIELDS.some((field) => !isUnavailableOnOfficialSource(job, field) && (!hasValue(job, field) || !isVerified(job, field)));
}

function officialWorkplace(value: string | null): string | null {
  if (!value) return null;
  return normalizeWorkplace([value]).workplaceType;
}

function previewValues(patch: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  return {
    location: fields.includes('location') ? patch.region ?? null : null,
    workplace_type: fields.includes('workplace_type') ? patch.workplace_type ?? null : null,
    employment_category: fields.includes('employment_category') ? patch.employment_category ?? null : null,
    experience: fields.includes('experience') ? {
      min: patch.experience_min_years ?? null,
      max: patch.experience_max_years ?? null,
      text: patch.experience_text ?? null,
    } : null,
    salary: fields.includes('salary') ? patch.salary_range ?? null : null,
    deadline: fields.includes('deadline') ? patch.valid_through ?? null : null,
  };
}

function candidateExperience(details: ReturnType<typeof extractOfficialJobDetails>): { min: number | null; max: number | null; text: string | null } {
  if (!details) return { min: null, max: null, text: null };
  const sources = [details.experience, details.requirements].filter(Boolean);
  if (sources.length > 0) {
    const structured = parseExperience(sources);
    if (structured.min != null || structured.max != null || structured.text) return structured;
  }
  const parsed = parseExperience([details.description]);
  const snippet = text(parsed.text);
  // A company introduction is not a candidate requirement, even when it
  // contains a phrase such as "over 30 years of experience".
  if (/\b(?:more than|over)\s+\d+(?:\.\d+)?\s+years?\s+of\s+(?:investing|investment|operating|industry|company|firm|business|financial)?\s*experience\b/i.test(snippet)) {
    return { min: null, max: null, text: null };
  }
  if (!snippet || !/\b(?:require|minimum|at least|qualif|candidate|you|professional|relevant|work(?:ing)?\s+experience|no\s+experience)\b/i.test(snippet)) {
    return { min: null, max: null, text: null };
  }
  return parsed;
}

function preparePatch(
  job: Job,
  pageUrl: string,
  details: NonNullable<ReturnType<typeof extractOfficialJobDetails>>,
  reviewMissingFields = false,
): PreparedJob | null {
  const patch: Record<string, unknown> = {};
  const fields: string[] = [];
  const unavailableFields: string[] = [];
  const fieldSources: Record<string, string> = {};
  const standardSource = details.source === 'official_structured_data'
    ? 'official_link_structured_field'
    : 'official_link_description';

  if (needsDetail(job) && details.description && details.description.length >= 160) {
    patch.description = details.description;
    fields.push('description');
    fieldSources.description = 'official_link_description';
  }
  const requirements = details.requirements || extractOfficialJobRequirements(details.description || '');
  if (!job.requirements && requirements) {
    patch.requirements = requirements;
    fields.push('requirements');
  }
  if (!job.responsibilities && details.responsibilities) {
    patch.responsibilities = details.responsibilities;
    fields.push('responsibilities');
  }

  const location = text(details.location).slice(0, 100) || null;
  if (canBackfill(job, 'location', location)) {
    patch.region = location;
    patch.location_source = standardSource;
    fields.push('location');
    fieldSources.location = standardSource;
  }

  const workplaceType = officialWorkplace(text(details.workplaceType) || null);
  if (canBackfill(job, 'workplace_type', workplaceType)) {
    patch.workplace_type = workplaceType;
    fields.push('workplace_type');
    fieldSources.workplace_type = standardSource;
  }

  const employmentCategory = normalizeEmploymentCategory([details.employmentType, job.title]);
  if (canBackfill(job, 'employment_category', employmentCategory !== '未知' ? employmentCategory : null)) {
    patch.employment_category = employmentCategory;
    patch.job_type = employmentCategory;
    fields.push('employment_category');
    fieldSources.employment_category = standardSource;
  }

  const experience = candidateExperience(details);
  if (canBackfill(job, 'experience', experience.min != null || experience.max != null || experience.text ? experience : null)) {
    patch.experience_min_years = experience.min;
    patch.experience_max_years = experience.max;
    patch.experience_text = experience.text;
    fields.push('experience');
    fieldSources.experience = details.experience ? standardSource : 'official_link_description';
  }

  const salary = extractSalary([details.salaryRange]) || extractSalaryFromDescription(details.description);
  if (canBackfill(job, 'salary', salary)) {
    patch.salary_range = salary;
    patch.salary_source = standardSource;
    fields.push('salary');
    fieldSources.salary = standardSource;
  }

  const deadline = extractDeadline([details.validThrough, details.description]);
  if (canBackfill(job, 'deadline', deadline)) {
    patch.valid_through = deadline;
    patch.deadline_source = standardSource;
    fields.push('deadline');
    fieldSources.deadline = standardSource;
  }
  const postedAt = text(details.postedAt) || null;
  if (postedAt && !text(job.posted_at)) {
    patch.posted_at = postedAt;
    fields.push('posted_at');
  }

  const now = new Date().toISOString();
  const previousFields = job.field_evidence?.fields && typeof job.field_evidence.fields === 'object' && !Array.isArray(job.field_evidence.fields)
    ? job.field_evidence.fields as Record<string, unknown>
    : {};
  const nextFields = { ...previousFields };
  for (const field of fields) {
    nextFields[field] = {
      status: 'verified',
      source: fieldSources[field] || 'official_link_description',
      evidence_url: pageUrl,
      evidence_kind: 'official_detail_page',
      verified_at: now,
    };
  }
  if (reviewMissingFields) {
    const officialValues: Record<FieldName, boolean> = {
      location: Boolean(location),
      workplace_type: Boolean(workplaceType),
      employment_category: employmentCategory !== '未知',
      experience: experience.min != null || experience.max != null || Boolean(experience.text),
      salary: Boolean(salary),
      deadline: Boolean(deadline),
    };
    for (const field of FIELDS) {
      if (isVerified(job, field) || isUnavailableOnOfficialSource(job, field) || officialValues[field]) continue;
      nextFields[field] = {
        status: 'unavailable_on_official_source',
        source: standardSource,
        evidence_url: pageUrl,
        evidence_kind: 'official_detail_page',
        verified_at: now,
        previous_status: evidence(job, field)?.status || null,
      };
      fields.push(field);
      unavailableFields.push(field);
    }
  }
  if (fields.length === 0) return null;
  patch.field_evidence = {
    ...(job.field_evidence || {}),
    version: 1,
    source_type: 'official_ats',
    source_url: pageUrl,
    fields: nextFields,
  };
  patch.updated_at = now;
  return { job, pageUrl, patch, fields, unavailableFields };
}

async function activeCompanyJobs(
  company: string,
  afterId: number | null,
  jobIds: number[] = [],
  candidateCap: number | null = null,
  urlContains: string | null = null,
  scanAll = false,
): Promise<Job[]> {
  const client = getSupabaseClient();
  const candidates: Job[] = [];
  let cursor = afterId;
  for (;;) {
    let query = client
      .from('jobs')
      .select('id,external_job_id,title,company,job_url,description,requirements,responsibilities,region,location_source,workplace_type,employment_category,job_type,experience_min_years,experience_max_years,experience_text,salary_range,salary_source,valid_through,deadline_source,posted_at,field_evidence')
      .eq('source_system', 'collector_feed')
      .eq('company', company)
      .eq('is_active', true)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
    if (cursor != null) query = query.gt('id', cursor);
    if (jobIds.length > 0) query = query.in('id', jobIds);
    if (urlContains) query = query.ilike('job_url', '%' + urlContains + '%');
    const { data, error } = await query;
    if (error) throw new Error(`Failed to read ${company} jobs: ${error.message}`);
    const page = (data || []) as Job[];
    candidates.push(...page.filter((job) => jobIds.length > 0 && jobIds.includes(job.id) ? true : scanAll ? true : (company === 'Deutsche Bank' ? (hasCandidate(job) || job.employment_category === 'Part-Time' || job.job_type === 'Part-Time') : hasCandidate(job))));
  if (jobIds.length > 0 || page.length < PAGE_SIZE || (candidateCap != null && candidates.length >= candidateCap)) break;
    const lastId = Number(page[page.length - 1]?.id);
    if (!Number.isInteger(lastId) || lastId <= (cursor || 0)) break;
    cursor = lastId;
  }
  return candidateCap == null ? candidates : candidates.slice(0, candidateCap);
}

function delayMs(): number {
  const value = Number(process.env.JOB_BACKFILL_REQUEST_DELAY_MS || 0);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 60_000) : 0;
}

function concurrency(): number {
  const value = Number.parseInt(process.env.JOB_BACKFILL_CONCURRENCY || '1', 10);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 5) : 1;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function mapWithConcurrency<T>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(limit, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      await mapper(items[index], index);
    }
  }));
}

async function main(): Promise<void> {
  const envFile = argument('env-file') || '.env.local';
  loadDotenv({ path: envFile, override: false });
  const company = argument('company');
  const write = hasFlag('write');
  const all = hasFlag('all');
  const limit = numberArgument('limit', 1, 1_000);
  const afterId = numberArgument('after-id', 1, Number.MAX_SAFE_INTEGER);
  const jobIds = idListArgument();
  const urlContains = argument('url-contains');
  const reviewMissingFields = hasFlag('review-missing-fields');
  const closeRemoved = hasFlag('close-removed');
  const scanAll = hasFlag('scan-all');
  const runId = runIdArgument();
  if (!company) throw new Error('Specify --company=<company>');
  if (all && limit != null) throw new Error('--all and --limit cannot be combined');
  if (urlContains && jobIds.length > 0) throw new Error('--url-contains and --job-ids cannot be combined');
  const genericWriteEnabled = genericOfficialWriteEnabled(company)
    && Object.prototype.hasOwnProperty.call(APPROVED_GENERIC_HOSTS, company);
  const writeEnabled = process.env.JOB_BACKFILL_WRITE_ENABLED === 'true' || genericWriteEnabled;
  if (write && !writeEnabled) {
    throw new Error('Writes are disabled. Set the matching official backfill write switch together with --write.');
  }
  if (write && !all && limit == null && jobIds.length === 0) {
    throw new Error('A write requires --limit=<count> or explicit --all.');
  }

  const client = getSupabaseClient();
  const jobs = await activeCompanyJobs(company, afterId, jobIds, all || limit == null ? null : limit, urlContains, scanAll);
  const selected = all || limit == null ? jobs : jobs.slice(0, limit);
  const result = {
    environment: { env_file: envFile, supabase_project_ref: projectRef() },
    company,
    active_collector_feed_jobs_after_cursor: jobs.length,
    candidate_jobs: jobs.length,
    selected_candidate_jobs: selected.length,
    selection: all ? 'all' : limit == null ? 'dry_run_all_candidates' : `first_${limit}_by_job_id`,
    after_id: afterId,
    job_ids: jobIds.length > 0 ? jobIds : null,
    review_missing_fields: reviewMissingFields,
    fetched: 0,
    would_update: 0,
    updated: 0,
    removed: 0,
    removed_job_ids: [] as number[],
    skipped: 0,
    failed: 0,
    skip_reasons: {} as Record<string, number>,
    candidate_fields: Object.fromEntries(FIELDS.map((field) => [field, 0])),
    unavailable_fields: 0,
    last_processed_job_id: null as number | null,
  };
  const prepared: PreparedJob[] = [];
  const processedJobIds: number[] = [];
  const skippedJobIds: number[] = [];
  const failedJobIds: number[] = [];
  const incrementSkip = (reason: string) => {
    result.skipped += 1;
    result.skip_reasons[reason] = (result.skip_reasons[reason] || 0) + 1;
  };
  const recordRemoved = async (jobId: number, reason: string, detail: string): Promise<void> => {
    result.removed += 1;
    result.removed_job_ids.push(jobId);
    result.skip_reasons[reason] = (result.skip_reasons[reason] || 0) + 1;
    if (!closeRemoved) return;
    const now = new Date().toISOString();
    const { error: jobError } = await client
      .from('jobs')
      .update({ is_active: false, is_closed: true, updated_at: now })
      .eq('id', jobId)
      .eq('source_system', 'collector_feed')
      .eq('company', company)
      .eq('is_active', true);
    if (jobError) throw new Error(`下架岗位失败 ${jobId}: ${jobError.message}`);
    const { error: syncError } = await client
      .from('job_sync_records')
      .update({
        availability_status: 'closed',
        link_health: 'closed',
        last_link_error: detail.slice(0, 500),
        last_link_checked_at: now,
        availability_checked_at: now,
        updated_at: now,
      })
      .eq('job_id', jobId);
    if (syncError) throw new Error(`保存下架状态失败 ${jobId}: ${syncError.message}`);
  };

  // Keep a single global launch clock even when several workers are active.
  // This overlaps DNS/TLS/response latency without sending a burst to
  // Workday; with the production 1200ms spacing, 100 jobs remain roughly a
  // two-minute batch instead of serial response-latency plus 1200ms each.
  let nextRequestAt = 0;
  async function waitForRequestSlot(): Promise<void> {
    const spacing = delayMs();
    if (spacing <= 0) return;
    const now = Date.now();
    const startAt = Math.max(now, nextRequestAt);
    nextRequestAt = startAt + spacing;
    if (startAt > now) await sleep(startAt - now);
  }

  let completed = 0;
  let progressCursor = afterId;
  let progressChain = Promise.resolve();
  async function recordProgress(): Promise<void> {
    if (!runId) return;
    const cursor = progressCursor ? String(progressCursor) : null;
    progressChain = progressChain.then(() => recordJobSyncRunProgress(client, runId, {
      current_stage: 'writing',
      current_company_name: company,
      current_page: 1,
      current_cursor: cursor,
      has_more: completed < selected.length,
      total_candidates: jobs.length,
      processed_candidates: completed,
      remaining_candidates: Math.max(0, jobs.length - completed),
      pages: 1,
      received: completed,
      upserted: result.updated,
      skipped: result.skipped,
      row_failures: result.failed,
    }));
    await progressChain;
  }

  await mapWithConcurrency(selected, concurrency(), async (job) => {
    if (progressCursor == null || job.id > progressCursor) progressCursor = job.id;
    if (!job.job_url) {
      incrementSkip('no_url');
      skippedJobIds.push(job.id);
    } else {
      try {
        const url = new URL(job.job_url);
        if (url.protocol !== 'https:' || (!/(?:^|\.)myworkdayjobs\.com$/i.test(url.hostname) && !approvedOfficialHost(company, url.hostname.toLowerCase()))) {
          incrementSkip('unapproved_workday_host');
          skippedJobIds.push(job.id);
        } else {
          if (company === 'Deutsche Bank') {
            await waitForRequestSlot();
            const positionId = job.job_url.match(/\/professional\/job\/(\d+)/)?.[1];
            if (!positionId) {
              incrementSkip('no_position_id');
              skippedJobIds.push(job.id);
            } else {
              const apiResponse = await fetch(`https://api-deutschebank.beesite.de/jobhtml/${encodeURIComponent(positionId)}.json`, { cache: 'no-store' });
              if (!apiResponse.ok) {
                if (apiResponse.status === 404 || apiResponse.status === 410) {
                  await recordRemoved(job.id, 'removed_official_404', `Deutsche Bank API HTTP ${apiResponse.status}`);
                } else {
                  result.failed += 1;
                  failedJobIds.push(job.id);
                  const reason = `Deutsche Bank API HTTP ${apiResponse.status}`;
                  result.skip_reasons[reason] = (result.skip_reasons[reason] || 0) + 1;
                }
              } else {
                const payload: unknown = await apiResponse.json();
                const details = deutscheBankDetailsFromApi(payload);
                if (!details?.description || details.description.length < 160) {
                  incrementSkip('no_public_description');
                  skippedJobIds.push(job.id);
                } else {
                  result.fetched += 1;
                  const evidenceUrl = job.job_url;
                  let preparedJob = preparePatch(job, evidenceUrl, details, reviewMissingFields);
                  if (details.employmentType && (job.employment_category === 'Part-Time' || job.job_type === 'Part-Time')) {
                    // Deutsche Bank's Full/Part-Time header is the authoritative
                    // employment schedule. A stored "Part-Time" label that
                    // contradicts an official "Full-time" schedule is legacy
                    // data from an earlier description-only parser; fix it from
                    // the title instead of preserving the wrong label.
                    const corrected = normalizeEmploymentCategory([details.employmentType, job.title]);
                    if (corrected !== '未知') {
                      const previousEvidence = (job.field_evidence && typeof job.field_evidence === 'object')
                        ? job.field_evidence as Record<string, unknown>
                        : {};
                      const previousFields = previousEvidence.fields && typeof previousEvidence.fields === 'object' && !Array.isArray(previousEvidence.fields)
                        ? previousEvidence.fields as Record<string, unknown>
                        : {};
                      const nextFields = { ...previousFields };
                      nextFields.employment_category = {
                        status: 'verified',
                        source: 'official_payload',
                        evidence_url: evidenceUrl,
                        evidence_kind: 'official_payload',
                        verified_at: new Date().toISOString(),
                        previous_status: 'rejected_legacy',
                      };
                      const now = new Date().toISOString();
                      if (preparedJob) {
                        preparedJob.patch.employment_category = corrected;
                        preparedJob.patch.job_type = corrected;
                        if (!preparedJob.fields.includes('employment_category')) preparedJob.fields.push('employment_category');
                        preparedJob.patch.field_evidence = { ...previousEvidence, fields: nextFields };
                      } else {
                        preparedJob = {
                          job,
                          pageUrl: evidenceUrl,
                          patch: {
                            employment_category: corrected,
                            job_type: corrected,
                            field_evidence: { ...previousEvidence, fields: nextFields },
                            updated_at: now,
                          },
                          fields: ['employment_category'],
                          unavailableFields: [],
                        };
                      }
                    }
                  }
                  if (!preparedJob) {
                    incrementSkip('no_new_fields');
                    skippedJobIds.push(job.id);
                  } else {
                    prepared.push(preparedJob);
                    result.would_update += 1;
                    for (const field of FIELDS) {
                      if (preparedJob.fields.includes(field)) result.candidate_fields[field] += 1;
                    }
                    result.unavailable_fields += preparedJob.unavailableFields.length;
                    if (write) {
                      const { error } = await client
                        .from('jobs')
                        .update(preparedJob.patch)
                        .eq('id', job.id)
                        .eq('source_system', 'collector_feed')
                        .eq('company', company)
                        .eq('is_active', true);
                      if (error) throw new Error(`Failed to update job ${job.id}: ${error.message}`);
                      result.updated += 1;
                    }
                    processedJobIds.push(job.id);
                  }
                }
              }
            }
          } else if (company === 'Evercore') {
            // Evercore's Taleo links carry ?instant=apply, which redirects to a
            // registration/apply form instead of the job detail page. The bare
            // opp/{id}/en-GB URL (same pl/{n} path segment) returns the public
            // detail page with the official Location / Region / Job description.
            await waitForRequestSlot();
            const oppId = url.pathname.match(/\/opp\/(\d+)(?:[-/])/)?.[1];
            if (!oppId) {
              incrementSkip('no_opp_id');
              skippedJobIds.push(job.id);
            } else {
              const barePath = url.pathname.replace(/\/opp\/\d+[^/]*/i, `/opp/${oppId}`);
              const bareUrl = `${url.origin}${barePath}`;
              const page = await fetchSafeExternalPage(bareUrl);
              if (looksLikeClosedJobPage(page.title, page.content)) {
                await recordRemoved(job.id, 'removed_closed_page', '官方详情页明确显示岗位已关闭/已下架');
              } else {
                const details = extractOfficialJobDetails(page);
                if (looksLikeBlockedPage(page.title, page.content)) {
                  incrementSkip('blocked');
                  skippedJobIds.push(job.id);
                } else if (!details?.description || details.description.length < 160) {
                  incrementSkip('no_public_description');
                  skippedJobIds.push(job.id);
                } else {
                  result.fetched += 1;
                  const preparedJob = preparePatch(job, bareUrl, details, reviewMissingFields);
                  if (!preparedJob) {
                    incrementSkip('no_new_fields');
                    skippedJobIds.push(job.id);
                  } else {
                    prepared.push(preparedJob);
                    result.would_update += 1;
                    for (const field of FIELDS) {
                      if (preparedJob.fields.includes(field)) result.candidate_fields[field] += 1;
                    }
                    result.unavailable_fields += preparedJob.unavailableFields.length;
                    if (write) {
                      const { error } = await client
                        .from('jobs')
                        .update(preparedJob.patch)
                        .eq('id', job.id)
                        .eq('source_system', 'collector_feed')
                        .eq('company', company)
                        .eq('is_active', true);
                      if (error) throw new Error(`Failed to update job ${job.id}: ${error.message}`);
                      result.updated += 1;
                    }
                    processedJobIds.push(job.id);
                  }
                }
              }
            }
          } else if (company === 'Jefferies') {
            // Jefferies Taleo links carry ?instant=apply, which redirects to a
            // registration/apply form instead of the job detail page. The bare
            // opp/{id}/en-GB URL returns the public detail page with the
            // official Location / Business unit / Job description labels.
            await waitForRequestSlot();
            const oppId = url.pathname.match(/\/opp\/(\d+)(?:[-/])/)?.[1];
            if (!oppId) {
              incrementSkip('no_opp_id');
              skippedJobIds.push(job.id);
            } else {
              const barePath = url.pathname.replace(/\/opp\/\d+[^/]*/i, `/opp/${oppId}`);
              const bareUrl = `${url.origin}${barePath}`;
              const page = await fetchSafeExternalPage(bareUrl);
              if (looksLikeClosedJobPage(page.title, page.content)) {
                await recordRemoved(job.id, 'removed_closed_page', '官方详情页明确显示岗位已关闭/已下架');
              } else {
                const details = extractOfficialJobDetails(page);
                if (looksLikeBlockedPage(page.title, page.content)) {
                  incrementSkip('blocked');
                  skippedJobIds.push(job.id);
                } else if (!details?.description || details.description.length < 160) {
                  incrementSkip('no_public_description');
                  skippedJobIds.push(job.id);
                } else {
                  result.fetched += 1;
                  const preparedJob = preparePatch(job, bareUrl, details, reviewMissingFields);
                  if (!preparedJob) {
                    incrementSkip('no_new_fields');
                    skippedJobIds.push(job.id);
                  } else {
                    prepared.push(preparedJob);
                    result.would_update += 1;
                    for (const field of FIELDS) {
                      if (preparedJob.fields.includes(field)) result.candidate_fields[field] += 1;
                    }
                    result.unavailable_fields += preparedJob.unavailableFields.length;
                    if (write) {
                      const { error } = await client
                        .from('jobs')
                        .update(preparedJob.patch)
                        .eq('id', job.id)
                        .eq('source_system', 'collector_feed')
                        .eq('company', company)
                        .eq('is_active', true);
                      if (error) throw new Error(`Failed to update job ${job.id}: ${error.message}`);
                      result.updated += 1;
                    }
                    processedJobIds.push(job.id);
                  }
                }
              }
            }
          } else {
          await waitForRequestSlot();
          const page = await fetchSafeExternalPage(job.job_url);
          if (looksLikeClosedJobPage(page.title, page.content)
            && !isRegisteredPhenomJobUrl(job.company, job.job_url)
            && !hasMatchingPhenomDetailPayload(job.job_url, page.content)) {
            await recordRemoved(job.id, 'removed_closed_page', '官方详情页明确显示岗位已关闭/已下架');
          } else {
            const details = extractOfficialJobDetails(page);
            if (looksLikeBlockedPage(page.title, page.content) && details?.source !== 'official_structured_data') {
              incrementSkip('blocked');
              skippedJobIds.push(job.id);
            } else if (!details?.description || details.description.length < 160) {
              incrementSkip('no_public_description');
              skippedJobIds.push(job.id);
            } else {
              result.fetched += 1;
              const preparedJob = preparePatch(job, page.url, details, reviewMissingFields);
              if (!preparedJob) {
                incrementSkip('no_new_fields');
                skippedJobIds.push(job.id);
              } else {
                prepared.push(preparedJob);
                result.would_update += 1;
                for (const field of FIELDS) {
                  if (preparedJob.fields.includes(field)) result.candidate_fields[field] += 1;
                }
                result.unavailable_fields += preparedJob.unavailableFields.length;
                if (write) {
                  const { error } = await client
                    .from('jobs')
                    .update(preparedJob.patch)
                    .eq('id', job.id)
                    .eq('source_system', 'collector_feed')
                    .eq('company', company)
                    .eq('is_active', true);
                  if (error) throw new Error(`Failed to update job ${job.id}: ${error.message}`);
                  result.updated += 1;
                }
                processedJobIds.push(job.id);
              }
            }
          }
        }
        }
      } catch (error) {
        const upstreamStatus = error instanceof ExternalFetchError ? error.upstreamStatus : undefined;
        if (upstreamStatus === 404 || upstreamStatus === 410) {
          await recordRemoved(job.id, 'removed_official_404', error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500));
        } else {
          result.failed += 1;
          failedJobIds.push(job.id);
          const reason = error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160);
          result.skip_reasons[reason] = (result.skip_reasons[reason] || 0) + 1;
        }
      }
    }
    completed += 1;
    if (completed % 5 === 0 || completed === selected.length) await recordProgress();
  });
  result.last_processed_job_id = selected.length > 0 ? selected[selected.length - 1].id : null;

  console.log(JSON.stringify({
    ...result,
    dry_run: !write,
    processed_job_ids: processedJobIds,
    skipped_job_ids: skippedJobIds,
    failed_job_ids: failedJobIds,
    samples: prepared.slice(0, 20).map(({ job, pageUrl, patch, fields, unavailableFields }) => ({
      id: job.id,
      external_job_id: job.external_job_id,
      fields,
      unavailable_fields: unavailableFields,
      values: previewValues(patch, fields),
      evidence_url: pageUrl,
    })),
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
