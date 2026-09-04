import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { normalizeFeedItem } from '@/lib/jobs-feed';
import { syncJobRecords, type JobSyncResult, type JobSyncRecord } from '@/lib/job-sync';
import { fetchConnectorBoard } from '@/lib/job-connectors/fetch';
import type { CompanySourceProfile, ConnectorJob } from '@/lib/job-connectors/types';

export interface ConnectorSyncResult extends JobSyncResult {
  connector: CompanySourceProfile['connector'];
  company: string;
  board: string;
  source_system: string;
  received: number;
  parsed: number;
  normalized: number;
  filtered_out: number;
  parser_dropped: number;
  detail_requested: number;
  detail_failed: number;
  detail_closed: number;
  detail_ambiguous: number;
  duplicate_external_ids: number;
  dry_run: boolean;
  field_coverage: Record<'location' | 'workplace_type' | 'employment_category' | 'experience' | 'salary' | 'deadline', { present: number; verified: number }>;
  collector_feed_match: {
    active_company_jobs: number;
    matched_external_ids: number;
    unmatched_official_jobs: number;
  };
}

function sourceSystem(profile: CompanySourceProfile): string {
  return `ats:${profile.connector}:${profile.board}`.slice(0, 50);
}

function normalizeConnectorJob(job: ConnectorJob, profile: CompanySourceProfile): JobSyncRecord | null {
  return normalizeFeedItem({
    ...job,
    source_system: sourceSystem(profile),
  });
}

function emptyJobResult(): JobSyncResult {
  return {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    recoverable_failures: 0,
    write_batches: 0,
    write_batch_failures: 0,
    write_fallback_rows: 0,
    write_duration_ms: 0,
    invalidJobs: [],
  };
}

type AuditedField = 'location' | 'workplace_type' | 'employment_category' | 'experience' | 'salary' | 'deadline';

function evidenceStatus(job: JobSyncRecord, field: AuditedField): string | null {
  const fields = job.field_evidence?.fields as Record<string, unknown> | undefined;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const evidence = fields[field];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const status = (evidence as Record<string, unknown>).status;
  return typeof status === 'string' ? status : null;
}

function fieldPresent(job: JobSyncRecord, field: AuditedField): boolean {
  switch (field) {
    case 'location': return Boolean(job.region);
    case 'workplace_type': return Boolean(job.workplace_type);
    case 'employment_category': return Boolean(job.employment_category && job.employment_category !== '未知');
    case 'experience': return job.experience_min_years != null || job.experience_max_years != null || Boolean(job.experience_text);
    case 'salary': return Boolean(job.salary_range);
    case 'deadline': return Boolean(job.valid_through);
  }
}

function fieldCoverage(jobs: JobSyncRecord[]): ConnectorSyncResult['field_coverage'] {
  const fields: AuditedField[] = ['location', 'workplace_type', 'employment_category', 'experience', 'salary', 'deadline'];
  return Object.fromEntries(fields.map((field) => [field, {
    present: jobs.filter((job) => fieldPresent(job, field)).length,
    verified: jobs.filter((job) => fieldPresent(job, field) && evidenceStatus(job, field) === 'verified').length,
  }])) as ConnectorSyncResult['field_coverage'];
}

async function collectorFeedSnapshot(
  client: SupabaseClient,
  profile: CompanySourceProfile,
): Promise<{ activeCompanyJobs: number; externalIds: Set<string> }> {
  const { count, error: countError } = await client.from('jobs').select('*', { count: 'exact', head: true })
    .eq('source_system', 'collector_feed').eq('company', profile.company).eq('is_active', true);
  if (countError) throw new Error(`读取 ${profile.company} 当前岗位数量失败: ${countError.message}`);
  const externalIds = new Set<string>();
  for (let offset = 0; ; offset += 1_000) {
    const { data, error } = await client.from('jobs').select('external_job_id')
      .eq('source_system', 'collector_feed').eq('company', profile.company).eq('is_active', true)
      .range(offset, offset + 999);
    if (error) throw new Error(`读取 ${profile.company} 外部岗位 ID 失败: ${error.message}`);
    for (const row of data || []) {
      if (typeof row.external_job_id === 'string' && row.external_job_id) externalIds.add(row.external_job_id);
    }
    if (!data || data.length < 1_000) break;
  }
  return { activeCompanyJobs: count || 0, externalIds };
}

function collectorFeedMatch(
  snapshot: { activeCompanyJobs: number; externalIds: Set<string> },
  jobs: JobSyncRecord[],
): ConnectorSyncResult['collector_feed_match'] {
  const externalIds = [...new Set(jobs.map((job) => job.external_job_id).filter((id): id is string => Boolean(id)))];
  const matched = externalIds.filter((id) => snapshot.externalIds.has(id));
  return {
    active_company_jobs: snapshot.activeCompanyJobs,
    matched_external_ids: matched.length,
    unmatched_official_jobs: externalIds.length - matched.length,
  };
}

/**
 * Normalize an official ATS board without changing production data by
 * default. Writes require both an explicit option and an environment gate so
 * the first company can be reviewed in dry-run mode.
 */
export async function syncConnectorBoard(
  profile: CompanySourceProfile,
  options: { client?: SupabaseClient; timeoutMs?: number; write?: boolean } = {},
): Promise<ConnectorSyncResult> {
  const source = sourceSystem(profile);
  const client = options.client || getSupabaseClient();
  const snapshot = await collectorFeedSnapshot(client, profile);
  const fetched = await fetchConnectorBoard(profile, {
    timeoutMs: options.timeoutMs,
    detailJobIds: profile.connector === 'phenom' ? snapshot.externalIds : undefined,
  });
  const normalizedJobs = fetched.jobs
    .map((job) => normalizeConnectorJob(job, profile))
    .filter((job): job is JobSyncRecord => Boolean(job));
  const match = collectorFeedMatch(snapshot, normalizedJobs);
  const writeEnabled = options.write === true && process.env.JOBS_CONNECTOR_WRITE_ENABLED === 'true';
  if (options.write === true && !writeEnabled) {
    throw new Error('连接器写入默认关闭；请显式设置 JOBS_CONNECTOR_WRITE_ENABLED=true 后再执行');
  }
  const writeResult = writeEnabled
    ? await syncJobRecords(client, normalizedJobs, 'sync', { verifiedAt: new Date().toISOString() })
    : emptyJobResult();
  return {
    connector: profile.connector,
    company: profile.company,
    board: profile.board,
    source_system: source,
    received: fetched.received,
    parsed: fetched.jobs.length,
    normalized: normalizedJobs.length,
    filtered_out: fetched.jobs.length - normalizedJobs.length,
    parser_dropped: fetched.dropped,
    detail_requested: fetched.detailRequested,
    detail_failed: fetched.detailFailed,
    detail_closed: fetched.detailClosed,
    detail_ambiguous: fetched.detailAmbiguous,
    duplicate_external_ids: fetched.duplicateExternalIds,
    dry_run: !writeEnabled,
    field_coverage: fieldCoverage(normalizedJobs),
    collector_feed_match: match,
    ...writeResult,
  };
}
