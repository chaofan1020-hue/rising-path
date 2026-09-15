import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { isTrustedJobFieldSource } from '@/lib/job-field-provenance';

loadDotenv({ path: process.env.ENV_FILE || process.env.DOTENV_CONFIG_PATH || '.env.local' });

type JobRow = {
  id: number;
  title: string;
  company: string;
  job_url: string | null;
  source_url: string | null;
  region: string | null;
  location_source: string | null;
  field_evidence: Record<string, unknown> | null;
};

const PAGE_SIZE = 1000;
const WRITE_BATCH = 8;
const WRITE_RETRIES = 3;

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function isAmazonJobUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && (host === 'www.amazon.jobs' || host === 'amazon.jobs')
      && /\/jobs\/\d+/i.test(url.pathname);
  } catch {
    return false;
  }
}

function hasUsableRegion(value: string | null): boolean {
  return Boolean(value && value.trim() && value.trim() !== '未注明');
}

function locationEvidence(row: JobRow, verifiedAt: string, evidenceUrl: string): Record<string, unknown> {
  const current = row.field_evidence && typeof row.field_evidence === 'object' ? row.field_evidence : {};
  const fields = current.fields && typeof current.fields === 'object' && !Array.isArray(current.fields)
    ? current.fields as Record<string, unknown>
    : {};
  return {
    ...current,
    version: typeof current.version === 'number' ? current.version : 1,
    source_type: typeof current.source_type === 'string' ? current.source_type : 'amazon',
    source_url: evidenceUrl,
    fields: {
      ...fields,
      location: {
        source: 'official_payload',
        status: 'verified',
        verified_at: verifiedAt,
        evidence_url: evidenceUrl,
        evidence_kind: 'official_payload',
      },
    },
  };
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  if (write && process.env.AMAZON_LISTING_LOCATION_WRITE_ENABLED !== 'true') {
    throw new Error('写入默认关闭；请同时设置 AMAZON_LISTING_LOCATION_WRITE_ENABLED=true 和 --write');
  }
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const projectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : 'unknown';
  const limit = Number.parseInt(argument('limit') || '', 10);
  const client = getSupabaseClient();
  const rows: JobRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from('jobs')
      .select('id,title,company,job_url,source_url,region,location_source,field_evidence')
      .eq('company', 'Amazon')
      .eq('source_system', 'collector_feed')
      .eq('is_active', true)
      .eq('is_closed', false)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`读取 Amazon 岗位失败: ${error.message}`);
    rows.push(...((data || []) as JobRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const candidates = rows.filter((row) => {
    const url = row.job_url || row.source_url;
    return isAmazonJobUrl(url)
      && hasUsableRegion(row.region)
      && !isTrustedJobFieldSource(row.location_source);
  }).slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined);

  const verifiedAt = new Date().toISOString();
  const written: number[] = [];
  const skipped: Array<{ id: number; reason: string }> = [];
  if (write) {
    for (let index = 0; index < candidates.length; index += WRITE_BATCH) {
      const batch = candidates.slice(index, index + WRITE_BATCH);
      for (const row of batch) {
        const evidenceUrl = row.job_url || row.source_url || '';
        let lastError: string | null = null;
        let updatedIds: Array<{ id: number }> | null = null;
        for (let attempt = 1; attempt <= WRITE_RETRIES; attempt += 1) {
          const { data: updated, error: updateError } = await client
            .from('jobs')
            .update({
              location_source: 'official_payload',
              field_evidence: locationEvidence(row, verifiedAt, evidenceUrl),
              updated_at: verifiedAt,
            })
            .eq('id', row.id)
            .eq('company', 'Amazon')
            .eq('is_active', true)
            .eq('is_closed', false)
            .select('id');
          if (!updateError) {
            updatedIds = (updated || []) as Array<{ id: number }>;
            lastError = null;
            break;
          }
          lastError = updateError.message;
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        }
        if (lastError) throw new Error(`更新 Amazon 岗位 ${row.id} 地点证据失败: ${lastError}`);
        if (updatedIds?.length) written.push(row.id);
        else skipped.push({ id: row.id, reason: '记录已被其他同步任务更新' });
      }
    }
  }

  console.log(JSON.stringify({
    generated_at: verifiedAt,
    mode: write ? 'write' : 'dry_run',
    environment: 'production',
    project_ref: projectRef,
    scanned: rows.length,
    candidate_count: candidates.length,
    already_verified: rows.filter((row) => hasUsableRegion(row.region) && isTrustedJobFieldSource(row.location_source)).length,
    sample: candidates.slice(0, 8).map((row) => ({
      id: row.id,
      title: row.title,
      region: row.region,
      location_source: row.location_source,
      job_url: row.job_url,
    })),
    written_count: written.length,
    skipped_count: skipped.length,
    skipped: skipped.slice(0, 20),
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
