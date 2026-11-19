import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { fieldEvidence as buildFieldEvidence } from '@/lib/job-field-provenance';
import { resolveJobDeadline } from '@/lib/job-deadline';

loadDotenv({ path: process.env.ENV_FILE || process.env.DOTENV_CONFIG_PATH || '.env.local' });

type JobRow = {
  id: number;
  title: string;
  company: string;
  job_url: string | null;
  description: string | null;
  posted_at: string | null;
  valid_through: string | null;
  deadline_source: string | null;
  is_active: boolean | null;
  is_closed: boolean | null;
  field_evidence: Record<string, unknown> | null;
};

const PAGE_SIZE = 200;
const WRITE_BATCH = 20;

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function deadlineEvidence(row: JobRow, source: string, verifiedAt: string): Record<string, unknown> {
  const current = row.field_evidence && typeof row.field_evidence === 'object' ? row.field_evidence : {};
  const fields = current.fields && typeof current.fields === 'object' && !Array.isArray(current.fields)
    ? current.fields as Record<string, unknown>
    : {};
  return {
    ...current,
    version: typeof current.version === 'number' ? current.version : 1,
    source_url: row.job_url,
    fields: {
      ...fields,
      deadline: buildFieldEvidence(source, row.job_url, verifiedAt),
    },
  };
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  if (write && process.env.CISCO_DEADLINE_BACKFILL_WRITE_ENABLED !== 'true') {
    throw new Error('写入默认关闭；请同时设置 CISCO_DEADLINE_BACKFILL_WRITE_ENABLED=true 和 --write');
  }
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const projectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : 'unknown';
  const limit = Number.parseInt(argument('limit') || '', 10);
  const client = getSupabaseClient();
  const rows: JobRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const query = client
      .from('jobs')
      .select('id,title,company,job_url,description,posted_at,valid_through,deadline_source,is_active,is_closed,field_evidence')
      .eq('company', 'Cisco')
      .eq('is_active', true)
      .is('valid_through', null)
      .ilike('description', '%application window%')
      .range(offset, offset + PAGE_SIZE - 1);
    const { data, error } = await query;
    if (error) throw error;
    const batch = (data || []) as JobRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    if (Number.isFinite(limit) && rows.length >= limit) break;
  }

  const now = new Date().toISOString();
  const candidates = rows.flatMap((row) => {
    const resolved = resolveJobDeadline({
      description: row.description,
      date_posted: row.posted_at,
      source_evidence: {
        structured_field_sources: {
          description: 'official_description',
        },
      },
    });
    if (!resolved) return [];
    return [{
      id: row.id,
      title: row.title,
      job_url: row.job_url,
      valid_through: resolved.value,
      deadline_source: resolved.fieldSource,
      is_active: row.is_active,
      is_closed: row.is_closed,
      field_evidence: deadlineEvidence(row, resolved.fieldSource, now),
    }];
  }).slice(0, Number.isFinite(limit) ? limit : undefined);

  console.log(JSON.stringify({
    env: projectRef,
    write,
    scanned: rows.length,
    candidates: candidates.length,
    sample: candidates.slice(0, 8).map((item) => ({
      id: item.id,
      title: item.title,
      valid_through: item.valid_through,
      is_active: item.is_active,
      is_closed: item.is_closed,
    })),
  }, null, 2));

  if (!write) {
    console.log('DRY_RUN_OK');
    return;
  }

  for (let index = 0; index < candidates.length; index += WRITE_BATCH) {
    const batch = candidates.slice(index, index + WRITE_BATCH);
    await Promise.all(batch.map(async (item) => {
      const { error } = await client
        .from('jobs')
        .update({
          valid_through: item.valid_through,
          deadline_source: item.deadline_source,
          field_evidence: item.field_evidence,
          updated_at: now,
        })
        .eq('id', item.id)
        .eq('company', 'Cisco')
        .eq('is_active', true)
        .is('valid_through', null);
      if (error) throw error;
    }));
  }
  console.log('WRITE_OK', candidates.length);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
