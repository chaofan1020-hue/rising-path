import { config as loadDotenv } from 'dotenv';
import { getCompanySourceProfile, fetchConnectorBoard } from '@/lib/job-connectors';
import { isTrustedJobFieldSource } from '@/lib/job-field-provenance';
import { normalizeFeedItem } from '@/lib/jobs-feed';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { JobSyncRecord } from '@/lib/job-sync';
import { recordJobSyncRunProgress } from '@/lib/job-sync-dashboard';

type FieldName = 'location' | 'workplace_type' | 'employment_category' | 'experience' | 'salary' | 'deadline';

interface ExistingJob {
  id: number;
  external_job_id: string | null;
  region: string | null;
  location_source: string | null;
  workplace_type: string | null;
  employment_category: string | null;
  experience_min_years: number | null;
  experience_max_years: number | null;
  experience_text: string | null;
  salary_range: string | null;
  salary_source: string | null;
  valid_through: string | null;
  deadline_source: string | null;
  field_evidence: Record<string, unknown> | null;
}

const FIELDS: FieldName[] = ['location', 'workplace_type', 'employment_category', 'experience', 'salary', 'deadline'];
const PAGE_SIZE = 1_000;

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function evidence(job: ExistingJob, field: FieldName): Record<string, unknown> | null {
  const fields = job.field_evidence?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const value = (fields as Record<string, unknown>)[field];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function evidenceIsVerified(job: ExistingJob, field: FieldName): boolean {
  // field_evidence.status is the authoritative state. A legacy value that was
  // explicitly quarantined (rejected_legacy) or is under review
  // (pending_recheck) must not be treated as verified just because the column
  // source happens to read as trusted (e.g. official_payload). Only when no
  // field evidence exists at all do we fall back to the column source.
  const status = evidence(job, field)?.status;
  if (status === 'verified') return true;
  if (status != null) return false;
  if (field === 'location') return isTrustedJobFieldSource(job.location_source);
  if (field === 'salary') return isTrustedJobFieldSource(job.salary_source);
  if (field === 'deadline') return isTrustedJobFieldSource(job.deadline_source);
  return false;
}

function hasExistingValue(job: ExistingJob, field: FieldName): boolean {
  switch (field) {
    case 'location': return Boolean(text(job.region));
    case 'workplace_type': return Boolean(text(job.workplace_type));
    case 'employment_category': return Boolean(text(job.employment_category) && text(job.employment_category) !== '未知');
    case 'experience': return job.experience_min_years != null || job.experience_max_years != null || Boolean(text(job.experience_text));
    case 'salary': return Boolean(text(job.salary_range));
    case 'deadline': return Boolean(text(job.valid_through));
  }
}

function hasOfficialValue(job: JobSyncRecord, field: FieldName): boolean {
  switch (field) {
    case 'location': return Boolean(text(job.region));
    case 'workplace_type': return Boolean(text(job.workplace_type));
    case 'employment_category': return Boolean(text(job.employment_category) && text(job.employment_category) !== '未知');
    case 'experience': return job.experience_min_years != null || job.experience_max_years != null || Boolean(text(job.experience_text));
    case 'salary': return Boolean(text(job.salary_range));
    case 'deadline': return Boolean(text(job.valid_through));
  }
}

function sourceFor(job: JobSyncRecord, field: FieldName): string | null {
  const fields = job.field_evidence?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const raw = (fields as Record<string, unknown>)[field];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = (raw as Record<string, unknown>).source;
  return typeof source === 'string' ? source : null;
}

function canBackfill(existing: ExistingJob, official: JobSyncRecord, field: FieldName): boolean {
  // Do not overwrite a verified field. A missing or quarantined legacy value
  // is safe to replace only when the current official board has its own value.
  return hasOfficialValue(official, field) && (!hasExistingValue(existing, field) || !evidenceIsVerified(existing, field));
}

function applyField(patch: Record<string, unknown>, official: JobSyncRecord, field: FieldName): void {
  switch (field) {
    case 'location':
      patch.region = official.region;
      patch.location_source = sourceFor(official, field);
      break;
    case 'workplace_type':
      patch.workplace_type = official.workplace_type;
      break;
    case 'employment_category':
      patch.employment_category = official.employment_category;
      patch.job_type = official.job_type;
      break;
    case 'experience':
      patch.experience_min_years = official.experience_min_years;
      patch.experience_max_years = official.experience_max_years;
      patch.experience_text = official.experience_text;
      break;
    case 'salary':
      patch.salary_range = official.salary_range;
      patch.salary_source = sourceFor(official, field);
      break;
    case 'deadline':
      patch.valid_through = official.valid_through;
      patch.deadline_source = sourceFor(official, field);
      break;
  }
}

function officialEvidence(official: JobSyncRecord, field: FieldName, now: string) {
  return {
    status: 'verified',
    source: sourceFor(official, field),
    evidence_url: official.source_url || official.job_url,
    evidence_kind: 'official_ats_payload',
    verified_at: now,
  };
}

async function activeCompanyJobs(company: string, afterId: number | null): Promise<ExistingJob[]> {
  const client = getSupabaseClient();
  const jobs: ExistingJob[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = client
      .from('jobs')
      .select('id,external_job_id,region,location_source,workplace_type,employment_category,experience_min_years,experience_max_years,experience_text,salary_range,salary_source,valid_through,deadline_source,field_evidence')
      .eq('source_system', 'collector_feed')
      .eq('company', company)
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (afterId != null) query = query.gt('id', afterId);
    const { data, error } = await query;
    if (error) throw new Error(`读取 ${company} 第 ${Math.floor(offset / PAGE_SIZE) + 1} 页岗位失败: ${error.message}`);
    jobs.push(...(data || []) as ExistingJob[]);
    if (!data || data.length < PAGE_SIZE) break;
  }
  return jobs;
}

async function main(): Promise<void> {
  const envFile = argument('env-file') || '.env.local';
  loadDotenv({ path: envFile, override: false });
  const company = argument('company');
  const write = hasFlag('write');
  const all = hasFlag('all');
  const limitValue = argument('limit');
  const limit = limitValue == null ? null : Number(limitValue);
  const afterIdValue = argument('after-id');
  const afterId = afterIdValue == null ? null : Number(afterIdValue);
  const runIdValue = argument('run-id');
  const runId = runIdValue == null ? null : Number(runIdValue);
  if (!company) throw new Error('请指定 --company=公司名');
  if (limitValue != null && (!Number.isInteger(limit) || limit == null || limit < 1 || limit > 1_000)) {
    throw new Error('--limit 必须是 1 到 1000 之间的整数');
  }
  if (afterIdValue != null && (!Number.isInteger(afterId) || afterId == null || afterId < 1)) {
    throw new Error('--after-id 必须是正整数');
  }
  if (all && limit != null) throw new Error('--all 与 --limit 不能同时使用');
  if (write && process.env.JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED !== 'true') {
    throw new Error('字段回填写入默认关闭；请显式设置 JOBS_CONNECTOR_BACKFILL_WRITE_ENABLED=true 后再执行');
  }
  if (write && !all && limit == null) {
    throw new Error('首次写入必须显式指定 --limit=<数量>；完成生产抽样验收后才可使用 --all');
  }
  const profile = getCompanySourceProfile(company);
  if (!profile) throw new Error(`未找到阶段 2 公司配置：${company}`);

  const existing = await activeCompanyJobs(profile.company, afterId);
  let official;
  let candidateSource: ExistingJob[] = existing;
  if (profile.connector === 'oracle_hcm') {
    // Large Oracle boards use two passes: first list-only to resolve which
    // active jobs are still published, then details only for the selected
    // canary/all targets so a first sample never issues thousands of requests.
    const listOfficial = await fetchConnectorBoard(profile, { detailJobIds: new Set<string>() });
    const listById = new Map(
      listOfficial.jobs
        .filter((item) => item.status === 'open')
        .map((item) => normalizeFeedItem({ ...item, source_system: 'collector_feed' }))
        .filter((item): item is JobSyncRecord => Boolean(item))
        .map((item) => [item.external_job_id, item] as const)
        .filter(([id]) => Boolean(id)),
    );
    const matched = existing.filter((job) => listById.has(job.external_job_id || ''));
    const targets = all || limit == null ? matched : matched.slice(0, limit);
    const targetIds = new Set(targets.map((job) => job.external_job_id).filter((id): id is string => Boolean(id)));
    official = targetIds.size > 0
      ? await fetchConnectorBoard(profile, { detailJobIds: targetIds })
      : listOfficial;
    if (limit != null && !all) candidateSource = targets;
  } else {
    const detailJobIds = profile.connector === 'phenom'
      ? new Set(existing.map((job) => job.external_job_id).filter((id): id is string => Boolean(id)))
      : undefined;
    official = await fetchConnectorBoard(profile, { detailJobIds });
  }
  const officialById = new Map(
    official.jobs
      // A Phenom search page may lag its official detail page. A role that is
      // explicitly filled on detail is never field evidence for an open job.
      .filter((item) => item.status === 'open')
      .map((item) => normalizeFeedItem({ ...item, source_system: 'collector_feed' }))
      .filter((item): item is JobSyncRecord => Boolean(item))
      .map((item) => [item.external_job_id, item] as const)
      .filter(([id]) => Boolean(id)),
  );
  const candidates = candidateSource.flatMap((job) => {
    const officialJob = officialById.get(job.external_job_id || '');
    if (!officialJob) return [];
    const fields = FIELDS.filter((field) => canBackfill(job, officialJob, field));
    return fields.length > 0 ? [{ job, officialJob, fields }] : [];
  });
  const selectedCandidates = all || limit == null ? candidates : candidates.slice(0, limit);
  const candidateFields = Object.fromEntries(FIELDS.map((field) => [field, selectedCandidates.filter((item) => item.fields.includes(field)).length]));
  const projectRef = (() => {
    try { return new URL(process.env.SUPABASE_URL || '').hostname.split('.')[0] || null; } catch { return null; }
  })();
  const result = {
    environment: { env_file: envFile, supabase_project_ref: projectRef },
    company: profile.company,
    connector: profile.connector,
    board: profile.board,
    official_received: official.received,
    official_parsed: official.jobs.length,
    official_detail_requested: official.detailRequested,
    official_detail_failed: official.detailFailed,
    official_detail_closed: official.detailClosed,
    official_detail_ambiguous: official.detailAmbiguous,
    official_duplicate_listing_rows: official.duplicateListingRows,
    official_duplicate_external_ids: official.duplicateExternalIds,
    official_normalized_target_region: officialById.size,
    active_collector_feed_jobs: existing.length,
    after_id: afterId,
    matched_external_ids: existing.filter((job) => officialById.has(job.external_job_id || '')).length,
    candidate_jobs: candidates.length,
    selected_candidate_jobs: selectedCandidates.length,
    selection: all ? 'all' : limit == null ? 'dry_run_all_candidates' : `first_${limit}_by_job_id`,
    candidate_fields: candidateFields,
    updated: 0,
    last_processed_job_id: selectedCandidates.length > 0
      ? selectedCandidates[selectedCandidates.length - 1].job.id
      : null,
    dry_run: !write,
  };

  if (!write) {
    console.log(JSON.stringify({
      ...result,
      samples: selectedCandidates.slice(0, 10).map(({ job, officialJob, fields }) => ({
        id: job.id,
        external_job_id: job.external_job_id,
        fields,
        evidence_url: officialJob.source_url,
      })),
    }, null, 2));
    return;
  }

  const client = getSupabaseClient();
  for (let index = 0; index < selectedCandidates.length; index += 1) {
    const { job, officialJob, fields } = selectedCandidates[index];
    const now = new Date().toISOString();
    const previousFields = job.field_evidence?.fields && typeof job.field_evidence.fields === 'object' && !Array.isArray(job.field_evidence.fields)
      ? job.field_evidence.fields as Record<string, unknown>
      : {};
    const patch: Record<string, unknown> = { updated_at: now };
    const nextEvidence = { ...previousFields };
    for (const field of fields) {
      applyField(patch, officialJob, field);
      nextEvidence[field] = officialEvidence(officialJob, field, now);
    }
    patch.field_evidence = {
      ...(job.field_evidence || {}),
      version: 1,
      source_type: 'official_ats',
      source_url: officialJob.source_url || officialJob.job_url || null,
      fields: nextEvidence,
    };
    const { error } = await client
      .from('jobs')
      .update(patch)
      .eq('id', job.id)
      .eq('source_system', 'collector_feed')
      .eq('is_active', true);
    if (error) throw new Error(`更新岗位 ${job.id} 失败: ${error.message}`);
    result.updated += 1;
    if (runId && (index % 5 === 0 || index === selectedCandidates.length - 1)) {
      await recordJobSyncRunProgress(client, runId, {
        current_stage: 'writing',
        current_company_name: company,
        current_page: 1,
        current_cursor: String(job.id),
        has_more: index < selectedCandidates.length - 1,
        total_candidates: candidates.length,
        processed_candidates: index + 1,
        remaining_candidates: Math.max(0, candidates.length - index - 1),
        pages: 1,
        received: index + 1,
        upserted: result.updated,
        skipped: 0,
        row_failures: 0,
      });
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
