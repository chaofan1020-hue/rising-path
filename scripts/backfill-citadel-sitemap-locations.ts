import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.env.ENV_FILE || process.env.DOTENV_CONFIG_PATH || '.env.local' });

type JobRow = {
  id: number;
  title: string;
  company: string;
  source_url: string | null;
  region: string | null;
  location_source: string | null;
  field_evidence: Record<string, unknown> | null;
};

function isCitadelCareerUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'www.citadel.com'
      && /^\/careers\/details\/[^/]+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function hasUsableRegion(value: string | null): boolean {
  return Boolean(value && value.trim() && value.trim() !== '未注明');
}

function locationEvidence(row: JobRow, verifiedAt: string): Record<string, unknown> {
  const current = row.field_evidence && typeof row.field_evidence === 'object'
    ? row.field_evidence
    : {};
  const fields = current.fields && typeof current.fields === 'object' && !Array.isArray(current.fields)
    ? current.fields as Record<string, unknown>
    : {};
  return {
    ...current,
    version: typeof current.version === 'number' ? current.version : 1,
    fields: {
      ...fields,
      location: {
        source: 'official_payload',
        status: 'verified',
        verified_at: verifiedAt,
        evidence_url: row.source_url,
        evidence_kind: 'official_payload',
      },
    },
  };
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  if (write && process.env.CITADEL_SITEMAP_BACKFILL_WRITE_ENABLED !== 'true') {
    throw new Error('写入默认关闭；请同时设置 CITADEL_SITEMAP_BACKFILL_WRITE_ENABLED=true 和 --write');
  }
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('jobs')
    .select('id,title,company,source_url,region,location_source,field_evidence')
    .eq('company', 'Citadel')
    .eq('is_active', true)
    .eq('is_closed', false)
    .is('location_source', null);
  if (error) throw new Error(`读取 Citadel 地点缺失岗位失败: ${error.message}`);

  const candidates = (data || []).filter((row): row is JobRow => {
    const job = row as JobRow;
    return isCitadelCareerUrl(job.source_url) && hasUsableRegion(job.region);
  });
  const written: number[] = [];
  const skipped: Array<{ id: number; reason: string }> = [];
  const verifiedAt = new Date().toISOString();
  if (write) {
    for (const row of candidates) {
      const { data: updated, error: updateError } = await client
        .from('jobs')
        .update({
          location_source: 'official_payload',
          field_evidence: locationEvidence(row, verifiedAt),
          updated_at: verifiedAt,
        })
        .eq('id', row.id)
        .eq('company', 'Citadel')
        .eq('is_active', true)
        .eq('is_closed', false)
        .is('location_source', null)
        .select('id');
      if (updateError) throw new Error(`更新 Citadel 岗位 ${row.id} 地点证据失败: ${updateError.message}`);
      if (updated?.length) written.push(row.id);
      else skipped.push({ id: row.id, reason: '记录已被其他同步任务更新' });
    }
  }

  console.log(JSON.stringify({
    generated_at: verifiedAt,
    mode: write ? 'write' : 'dry_run',
    target: 'Citadel',
    candidate_count: candidates.length,
    candidates: candidates.map((row) => ({ id: row.id, title: row.title, region: row.region, source_url: row.source_url })),
    written,
    skipped,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
