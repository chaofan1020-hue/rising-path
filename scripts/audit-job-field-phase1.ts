import { config as loadDotenv } from 'dotenv';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { jobHtmlToPlainText, isDisplayableJobDescription } from '@/lib/job-content';

type FieldName = 'location' | 'workplace_type' | 'employment_category' | 'experience' | 'salary' | 'deadline';
type ContentField = 'description' | 'requirements' | 'responsibilities';
type Row = Record<string, unknown>;

const FIELDS: FieldName[] = ['location', 'workplace_type', 'employment_category', 'experience', 'salary', 'deadline'];
const CONTENT_FIELDS: ContentField[] = ['description', 'requirements', 'responsibilities'];
const PAGE_SIZE = 1_000;
const MAX_SAMPLE_IDS = 10;
const STUDENT_SIGNAL_PATTERNS: Array<[string, RegExp]> = [
  ['internship', /\binternships?\b|\bintern\b/i],
  ['co_op', /\bco[ -]?op\b/i],
  ['new_grad', /\bnew grad(?:uate)?\b/i],
  ['campus', /\bcampus\b|\buniversity recruiting\b|\bcollege recruiting\b/i],
  ['early_career', /\bearly career\b/i],
  ['entry_level', /\bentry[ -]?level\b/i],
  ['graduate_program', /\bgraduate program(?:me)?\b/i],
  ['analyst_program', /\banalyst program(?:me)?\b/i],
  ['student', /\bstudents?\b/i],
];
const UPSTREAM_FIELD_NAMES = [
  'education_level',
  'level',
  'employment_type',
  'experience',
  'valid_through',
  'application_deadline',
  'remote_type',
  'work_arrangement',
  'workplace_type',
  'recruiting_program',
  'status',
  'sync_action',
  'description',
  'qualifications',
  'job_url',
  'external_job_id',
  'source_evidence',
] as const;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) || 0) + 1);
}

function topEntries(map: Map<string, number>, limit = 20): Record<string, number> {
  return Object.fromEntries([...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit));
}

function addSample(map: Map<string, number[]>, key: string, id: number): void {
  const ids = map.get(key) || [];
  if (ids.length < MAX_SAMPLE_IDS) ids.push(id);
  map.set(key, ids);
}

function fieldEvidence(row: Row, field: FieldName): Row | null {
  const fields = row.field_evidence;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const evidence = (fields as Row).fields;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const value = (evidence as Row)[field];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
}

function hasValue(row: Row, field: FieldName): boolean {
  switch (field) {
    case 'location': return Boolean(text(row.region));
    case 'workplace_type': return Boolean(text(row.workplace_type));
    case 'employment_category': return Boolean(text(row.employment_category) && text(row.employment_category) !== '未知');
    case 'experience': return row.experience_min_years != null || row.experience_max_years != null || Boolean(text(row.experience_text));
    case 'salary': return Boolean(text(row.salary_range));
    case 'deadline': return Boolean(text(row.valid_through));
  }
}

function contentStats(value: unknown): { text: string; class: string } {
  const plain = jobHtmlToPlainText(value);
  if (!plain) return { text: '', class: 'missing' };
  if (!isDisplayableJobDescription(value)) return { text: plain, class: 'evidence_shell' };
  if (plain.length < 20) return { text: plain, class: 'too_short' };
  if (plain.length < 160) return { text: plain, class: 'short' };
  return { text: plain, class: 'normal' };
}

function emptyContentStats(): Record<ContentField, Map<string, number>> {
  return Object.fromEntries(CONTENT_FIELDS.map((field) => [field, new Map<string, number>()])) as Record<ContentField, Map<string, number>>;
}

function sourceUrl(row: Row): string {
  return text(row.source_url) || text(row.job_url) || '';
}

function detectStudentSignals(row: Row): string[] {
  const values = [
    text(row.title),
    text(row.job_type),
    text(row.employment_category),
    text(row.employment_type),
    text(row.experience_text),
    text(row.description),
    text(row.requirements),
  ].join('\n');
  return STUDENT_SIGNAL_PATTERNS.filter(([, pattern]) => pattern.test(values)).map(([name]) => name);
}

async function loadActiveJobs() {
  const client = getSupabaseClient();
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from('jobs')
      .select('id,company,title,job_url,source_url,external_job_id,description,requirements,responsibilities,region,workplace_type,employment_category,employment_type,job_type,experience_min_years,experience_max_years,experience_text,salary_range,valid_through,field_evidence,source_system,updated_at,is_active,is_closed')
      .eq('source_system', 'collector_feed')
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`读取生产岗位失败: ${error.message}`);
    rows.push(...((data || []) as Row[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function buildReport(rows: Row[], completedBaselineCompanies: Set<string>) {
  const contentClasses = emptyContentStats();
  const contentByCompany = new Map<string, Record<ContentField, Map<string, number>>>();
  const studentSignalCounts = new Map<string, number>();
  const studentByCompany = new Map<string, Map<string, number>>();
  const signalSamples = new Map<string, number[]>();
  const sourceFamilies = new Map<string, number>();
  const evidenceKinds = new Map<string, number>();
  const fieldReasonCounts = new Map<string, number>();
  const fieldReasonByCompany = new Map<string, Map<string, number>>();
  const fieldReasonSamples = new Map<string, number[]>();
  const pendingByCompletedCompany = new Map<string, Map<string, number>>();
  const jobTypeCounts = new Map<string, number>();
  let invalidOfficialUrl = 0;
  let missingExternalId = 0;
  let closedActive = 0;

  for (const row of rows) {
    const id = Number(row.id);
    const company = text(row.company) || '未注明公司';
    const companyContent = contentByCompany.get(company) || emptyContentStats();
    for (const field of CONTENT_FIELDS) {
      const content = contentStats(row[field]);
      increment(contentClasses[field], content.class);
      increment(companyContent[field], content.class);
    }
    contentByCompany.set(company, companyContent);

    if (!text(row.external_job_id)) missingExternalId += 1;
    if (row.is_closed === true) closedActive += 1;
    try {
      const url = new URL(sourceUrl(row));
      increment(sourceFamilies, url.hostname.toLowerCase());
    } catch {
      invalidOfficialUrl += 1;
    }
    increment(jobTypeCounts, text(row.job_type) || 'unknown');

    for (const signal of detectStudentSignals(row)) {
      increment(studentSignalCounts, signal);
      addSample(signalSamples, signal, id);
      const companySignals = studentByCompany.get(company) || new Map<string, number>();
      increment(companySignals, signal);
      studentByCompany.set(company, companySignals);
    }

    for (const field of FIELDS) {
      const evidence = fieldEvidence(row, field);
      const status = text(evidence?.status) || 'none';
      const value = hasValue(row, field);
      let reason = 'no_value_no_evidence';
      if (status === 'verified' && value) reason = 'verified_value';
      else if (status === 'verified' && !value) reason = 'verified_without_value';
      else if (status === 'pending_recheck' && value) reason = 'pending_with_value';
      else if (status === 'pending_recheck') reason = 'pending_without_value';
      else if (status === 'rejected_legacy' && value) reason = 'rejected_with_legacy_value';
      else if (status === 'rejected_legacy') reason = 'rejected_without_value';
      increment(fieldReasonCounts, `${field}:${reason}`);
      const companyReasons = fieldReasonByCompany.get(company) || new Map<string, number>();
      increment(companyReasons, `${field}:${reason}`);
      fieldReasonByCompany.set(company, companyReasons);
      if (completedBaselineCompanies.has(company) && reason.startsWith('pending_')) {
        const pendingReasons = pendingByCompletedCompany.get(company) || new Map<string, number>();
        increment(pendingReasons, `${field}:${reason}`);
        pendingByCompletedCompany.set(company, pendingReasons);
      }
      if (reason !== 'verified_value') addSample(fieldReasonSamples, `${field}:${reason}`, id);
    }

    const root = row.field_evidence;
    if (root && typeof root === 'object' && !Array.isArray(root)) {
      for (const field of FIELDS) {
        const evidence = fieldEvidence(row, field);
        if (evidence) increment(evidenceKinds, `${field}:${text(evidence.evidence_kind) || 'unknown'}`);
      }
    }
  }

  const companyRows = [...new Set(rows.map((row) => text(row.company) || '未注明公司'))].map((company) => ({
    company,
    active_jobs: rows.filter((row) => (text(row.company) || '未注明公司') === company).length,
    content: Object.fromEntries(CONTENT_FIELDS.map((field) => [field, topEntries(contentByCompany.get(company)?.[field] || new Map())])),
    student_signals: topEntries(studentByCompany.get(company) || new Map()),
    non_verified_field_reasons: topEntries(fieldReasonByCompany.get(company) || new Map(), 40),
  })).sort((left, right) => right.active_jobs - left.active_jobs || left.company.localeCompare(right.company));

  return {
    generated_at: new Date().toISOString(),
    environment: {
      supabase_project_ref: (() => { try { return new URL(process.env.SUPABASE_URL || '').hostname.split('.')[0] || null; } catch { return null; } })(),
      source_system: 'collector_feed',
      active_only: true,
    },
    totals: {
      active_jobs: rows.length,
      active_companies: new Set(rows.map((row) => text(row.company))).size,
      invalid_or_missing_official_url: invalidOfficialUrl,
      missing_external_id: missingExternalId,
      active_rows_marked_closed: closedActive,
    },
    content_quality: {
      classes: Object.fromEntries(CONTENT_FIELDS.map((field) => [field, topEntries(contentClasses[field])])),
      by_company: companyRows,
    },
    student_signals: {
      signal_counts: topEntries(studentSignalCounts),
      signal_sample_job_ids: Object.fromEntries(signalSamples),
      job_type_distribution: topEntries(jobTypeCounts),
      note: 'Signals are lexical audit evidence only; this report does not write student eligibility or change job lifecycle.',
    },
    source_and_evidence: {
      source_host_distribution: topEntries(sourceFamilies),
      evidence_kind_distribution: topEntries(evidenceKinds),
    },
    field_reason_summary: {
      reason_counts: topEntries(fieldReasonCounts, 100),
      reason_sample_job_ids: Object.fromEntries(fieldReasonSamples),
      completed_baseline_companies: [...completedBaselineCompanies].sort(),
      completed_baseline_pending_recheck: [...pendingByCompletedCompany.entries()]
        .map(([company, reasons]) => ({ company, reasons: topEntries(reasons, 40) }))
        .sort((left, right) => left.company.localeCompare(right.company)),
      reason_definitions: {
        verified_value: 'verified evidence and a displayable value',
        verified_without_value: 'verified evidence remains but the standardized value is empty',
        pending_with_value: 'value exists but evidence is pending recheck',
        pending_without_value: 'pending evidence without a standardized value',
        rejected_with_legacy_value: 'legacy value remains alongside rejected evidence',
        rejected_without_value: 'legacy evidence rejected and no value',
        no_value_no_evidence: 'no value and no field evidence; not proof that the official source lacks the field',
      },
    },
  };
}

function summarizeUpstreamValue(value: unknown): string {
  if (typeof value === 'string') return value.trim().slice(0, 120) || 'empty';
  if (value == null) return 'empty';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return JSON.stringify(value).slice(0, 120); } catch { return typeof value; }
}

async function auditUpstreamSample(): Promise<Record<string, unknown>> {
  const feedUrl = process.env.JOBS_FEED_URL;
  const apiKey = process.env.JOBS_FEED_API_KEY || process.env.INTEGRATION_API_KEY;
  if (!feedUrl || !apiKey) return { skipped: true, reason: 'missing_upstream_configuration' };
  const endpoint = new URL(feedUrl);
  endpoint.searchParams.set('limit', '500');
  endpoint.searchParams.set('include_closed', 'false');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json', 'X-Integration-Key': apiKey },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return { skipped: true, reason: `upstream_http_${response.status}` };
    const payload = await response.json() as { items?: Row[]; contract_version?: unknown };
    const items = Array.isArray(payload.items) ? payload.items : [];
    const keyPresence = new Map<string, number>();
    const valueDistributions = new Map<string, Map<string, number>>();
    const structuredSources = new Map<string, Map<string, number>>();
    const topLevelKeys = new Map<string, number>();
    for (const item of items) {
      for (const key of Object.keys(item)) increment(topLevelKeys, key);
      for (const field of UPSTREAM_FIELD_NAMES) {
        if (item[field] == null || summarizeUpstreamValue(item[field]) === 'empty') continue;
        increment(keyPresence, field);
        if (['education_level', 'level', 'employment_type', 'experience', 'valid_through', 'application_deadline', 'remote_type', 'work_arrangement', 'workplace_type', 'recruiting_program', 'status', 'sync_action'].includes(field)) {
          const values = valueDistributions.get(field) || new Map<string, number>();
          increment(values, summarizeUpstreamValue(item[field]));
          valueDistributions.set(field, values);
        }
        const evidence = item.source_evidence;
        if (field === 'source_evidence' || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)) continue;
        const sources = (evidence as Row).structured_field_sources;
        if (!sources || typeof sources !== 'object' || Array.isArray(sources)) continue;
        const source = summarizeUpstreamValue((sources as Row)[field]);
        if (source === 'empty') continue;
        const fieldSources = structuredSources.get(field) || new Map<string, number>();
        increment(fieldSources, source);
        structuredSources.set(field, fieldSources);
      }
    }
    return {
      skipped: false,
      contract_version: text(payload.contract_version) || null,
      sampled_jobs: items.length,
      top_level_key_presence: topEntries(topLevelKeys, 100),
      known_field_presence: topEntries(keyPresence, 100),
      known_field_values: Object.fromEntries([...valueDistributions.entries()].map(([field, values]) => [field, topEntries(values, 20)])),
      structured_field_sources: Object.fromEntries([...structuredSources.entries()].map(([field, values]) => [field, topEntries(values, 20)])),
      student_field_presence: Object.fromEntries(['education_level', 'level', 'employment_type', 'experience', 'remote_type', 'work_arrangement', 'workplace_type', 'recruiting_program'].map((field) => [field, keyPresence.get(field) || 0])),
      lifecycle_field_presence: Object.fromEntries(['valid_through', 'application_deadline', 'status', 'sync_action'].map((field) => [field, keyPresence.get(field) || 0])),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadCompletedBaselineCompanies(): Promise<Set<string>> {
  const matrixPath = process.env.PHASE1_SOURCE_MATRIX || 'output/phase1-source-matrix-production-20260902.json';
  const inventoryPath = process.env.PHASE1_TASK_INVENTORY || '岗位字段任务交接包/docs/job-field-task-inventory-20260902.md';
  const result = new Set<string>();
  try {
    const markdown = await readFile(inventoryPath, 'utf8');
    for (const line of markdown.split(/\r?\n/)) {
      const match = line.match(/^\|\s*\d+\s*\|\s*(.*?)\s*\|.*\|\s*`completed_baseline`\s*\|/);
      if (match?.[1]) result.add(match[1].trim());
    }
  } catch {
    // The JSON matrix remains a useful fallback when the handoff package is absent.
  }
  if (result.size > 0) return result;
  try {
    const parsed = JSON.parse(await readFile(matrixPath, 'utf8')) as { companies?: Array<{ company?: unknown; discovery_status?: unknown }> };
    return new Set((parsed.companies || [])
      .filter((company) => text(company.discovery_status) === 'completed_baseline' || text(company.discovery_status) === 'configured_connector')
      .map((company) => text(company.company))
      .filter(Boolean));
  } catch {
    return new Set();
  }
}

async function main(): Promise<void> {
  const envFile = process.env.ENV_FILE || '.env.production.local';
  loadDotenv({ path: envFile, override: false });
  const expectedProject = process.env.EXPECTED_SUPABASE_PROJECT_REF || 'weqvdtdjdzmqflhwobec';
  const actualProject = (() => { try { return new URL(process.env.SUPABASE_URL || '').hostname.split('.')[0] || null; } catch { return null; } })();
  if (actualProject !== expectedProject) throw new Error(`生产环境核验失败: expected ${expectedProject}, got ${actualProject || 'unknown'}`);
  const rows = await loadActiveJobs();
  const completedBaselineCompanies = await loadCompletedBaselineCompanies();
  const report = {
    ...buildReport(rows, completedBaselineCompanies),
    upstream_sample: await auditUpstreamSample(),
  };
  const outputPath = process.env.PHASE1_AUDIT_OUTPUT || null;
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      generated_at: report.generated_at,
      report_file: resolved,
      active_jobs: report.totals.active_jobs,
      active_companies: report.totals.active_companies,
      read_only: true,
    }, null, 2));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
