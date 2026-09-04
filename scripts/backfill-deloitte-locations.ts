import { config as loadDotenv } from 'dotenv';

import { extractOfficialJobDetails } from '@/lib/job-official-detail';
import { fetchSafeExternalPage } from '@/lib/safe-external-fetch';
import { getSupabaseClient } from '@/storage/database/supabase-client';

type JobRow = {
  id: number;
  external_job_id: string | null;
  title: string | null;
  company: string;
  job_url: string | null;
  region: string | null;
  field_evidence: Record<string, unknown> | null;
};

const PAGE_SIZE = 1_000;

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function projectRef(): string | null {
  try { return new URL(process.env.SUPABASE_URL || '').hostname.split('.')[0] || null; } catch { return null; }
}

function positiveInteger(name: string): number | null {
  const raw = argument(name);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  return value;
}

function locationStatus(job: JobRow): string | null {
  const value = job.field_evidence?.fields;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const location = (value as Record<string, unknown>).location;
  if (!location || typeof location !== 'object' || Array.isArray(location)) return null;
  const status = (location as Record<string, unknown>).status;
  return typeof status === 'string' ? status : null;
}

function isLocationRepairCandidate(job: JobRow): boolean {
  return ['unavailable_on_official_source', 'pending_recheck'].includes(locationStatus(job) || '');
}

function officialHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === 'apply.deloitte.com';
  } catch {
    return false;
  }
}

function delayMs(): number {
  const value = Number(process.env.JOB_BACKFILL_REQUEST_DELAY_MS || 1_200);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 60_000) : 1_200;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function activeJobs(): Promise<JobRow[]> {
  const client = getSupabaseClient();
  const rows: JobRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from('jobs')
      .select('id,external_job_id,title,company,job_url,region,field_evidence')
      .eq('source_system', 'collector_feed')
      .eq('company', 'Deloitte')
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`读取 Deloitte 岗位失败: ${error.message}`);
    rows.push(...((data || []) as JobRow[]));
    if (!data || data.length < PAGE_SIZE) return rows.filter(isLocationRepairCandidate);
  }
}

function locationEvidence(job: JobRow, pageUrl: string, source: string): Record<string, unknown> {
  const previous = job.field_evidence && typeof job.field_evidence === 'object' && !Array.isArray(job.field_evidence)
    ? job.field_evidence
    : {};
  const previousFields = previous.fields && typeof previous.fields === 'object' && !Array.isArray(previous.fields)
    ? previous.fields as Record<string, unknown>
    : {};
  return {
    ...previous,
    version: 1,
    source_type: 'official_ats',
    source_url: pageUrl,
    fields: {
      ...previousFields,
      location: {
        status: 'verified',
        source,
        evidence_url: pageUrl,
        evidence_kind: 'official_detail_page',
        verified_at: new Date().toISOString(),
      },
    },
  };
}

async function main(): Promise<void> {
  const envFile = argument('env-file') || '.env.local';
  loadDotenv({ path: envFile, override: false, quiet: true });
  const write = hasFlag('write');
  const all = hasFlag('all');
  const limit = positiveInteger('limit');
  if (all && limit != null) throw new Error('--all and --limit cannot be combined');
  if (write && process.env.JOB_BACKFILL_WRITE_ENABLED !== 'true') {
    throw new Error('Writes are disabled. Set JOB_BACKFILL_WRITE_ENABLED=true together with --write.');
  }
  if (write && !all && limit == null) throw new Error('A write requires --limit=<count> or --all.');

  const candidates = await activeJobs();
  const selected = all || limit == null ? candidates : candidates.slice(0, limit);
  const result = {
    environment: { env_file: envFile, supabase_project_ref: projectRef() },
    company: 'Deloitte',
    active_location_repair_candidates: candidates.length,
    selected_candidates: selected.length,
    selection: all ? 'all' : limit == null ? 'dry_run_all_candidates' : `first_${limit}_by_job_id`,
    fetched: 0,
    with_official_location: 0,
    would_update: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    skip_reasons: {} as Record<string, number>,
    samples: [] as Array<Record<string, unknown>>,
  };
  const client = getSupabaseClient();
  let nextRequestAt = 0;
  const bumpSkip = (reason: string) => {
    result.skipped += 1;
    result.skip_reasons[reason] = (result.skip_reasons[reason] || 0) + 1;
  };

  for (const job of selected) {
    try {
      if (!job.job_url || !officialHost(job.job_url)) {
        bumpSkip('unapproved_or_missing_url');
        continue;
      }
      const now = Date.now();
      const startAt = Math.max(now, nextRequestAt);
      nextRequestAt = startAt + delayMs();
      if (startAt > now) await sleep(startAt - now);
      const page = await fetchSafeExternalPage(job.job_url);
      if (!officialHost(page.url)) {
        bumpSkip('redirected_official_host');
        continue;
      }
      result.fetched += 1;
      const details = extractOfficialJobDetails(page);
      if (!details) {
        bumpSkip('no_official_details');
        continue;
      }
      const location = details.location?.trim().slice(0, 100) || null;
      if (!location) {
        bumpSkip('no_official_location');
        continue;
      }
      result.with_official_location += 1;
      result.would_update += 1;
      const source = details.source === 'official_structured_data'
        ? 'official_link_structured_field'
        : 'official_link_description';
      const patch = {
        region: location,
        location_source: source,
        field_evidence: locationEvidence(job, page.url, source),
        updated_at: new Date().toISOString(),
      };
      if (result.samples.length < 20) {
        result.samples.push({ id: job.id, external_job_id: job.external_job_id, title: job.title, location, evidence_url: page.url });
      }
      if (write) {
        const { data, error } = await client
          .from('jobs')
          .update(patch)
          .eq('id', job.id)
          .eq('source_system', 'collector_feed')
          .eq('company', 'Deloitte')
          .eq('is_active', true)
          .select('id')
          .maybeSingle();
        if (error) throw new Error(`更新岗位 ${job.id} 失败: ${error.message}`);
        if (!data) throw new Error(`岗位 ${job.id} 未匹配到仍在招的 Deloitte 记录`);
        result.updated += 1;
      }
    } catch (error) {
      result.failed += 1;
      const reason = error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160);
      result.skip_reasons[reason] = (result.skip_reasons[reason] || 0) + 1;
    }
  }

  console.log(JSON.stringify({ ...result, dry_run: !write }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
