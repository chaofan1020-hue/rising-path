import { config as loadDotenv } from 'dotenv';
import { fieldEvidence as buildFieldEvidence, isTrustedJobFieldSource } from '@/lib/job-field-provenance';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.argv.find((value) => value.startsWith('--env-file='))?.slice('--env-file='.length) || '.env.production.local', override: true });

const WRITE = process.argv.includes('--write');
const PAGE_SIZE = 200;

type JobRow = {
  id: number;
  title: string | null;
  region: string | null;
  location_source: string | null;
  job_url: string | null;
  field_evidence: Record<string, unknown> | null;
};

function placeholder(value: string | null | undefined): boolean {
  const normalized = (value || '').trim();
  return !normalized || normalized === '未注明';
}

function projectRef(): string {
  try {
    return new URL(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname.split('.')[0] || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function main(): Promise<void> {
  const client = getSupabaseClient();
  const jobs: JobRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('jobs')
      .select('id,title,region,location_source,job_url,field_evidence')
      .eq('company', 'Evercore')
      .eq('source_system', 'collector_feed')
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (data || []) as JobRow[];
    jobs.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  const candidates = jobs.filter((job) => {
    if (placeholder(job.region)) return false;
    if (isTrustedJobFieldSource(job.location_source)) return false;
    try {
      return job.job_url ? new URL(job.job_url).hostname.toLowerCase() === 'evercore.tal.net' : false;
    } catch {
      return false;
    }
  });

  const now = new Date().toISOString();
  let updated = 0;
  for (const job of candidates) {
    const previous = job.field_evidence && typeof job.field_evidence === 'object' ? job.field_evidence : {};
    const previousFields = previous.fields && typeof previous.fields === 'object' && !Array.isArray(previous.fields)
      ? previous.fields as Record<string, unknown>
      : {};
    const patch = {
      location_source: 'official_payload',
      field_evidence: {
        ...previous,
        version: 1,
        source_type: 'official_ats',
        source_url: job.job_url,
        fields: {
          ...previousFields,
          location: buildFieldEvidence('official_payload', job.job_url, now),
        },
      },
      updated_at: now,
    };
    if (WRITE) {
      const { error } = await client
        .from('jobs')
        .update(patch)
        .eq('id', job.id)
        .eq('company', 'Evercore')
        .eq('source_system', 'collector_feed')
        .eq('is_active', true);
      if (error) throw new Error(`Failed to update job ${job.id}: ${error.message}`);
      updated += 1;
    }
  }

  console.log(JSON.stringify({
    env: WRITE ? 'production-write' : 'production-dry-run',
    supabase_ref: projectRef(),
    queried_at: now,
    active: jobs.length,
    already_verified: jobs.length - candidates.length,
    candidates: candidates.length,
    updated,
    samples: candidates.slice(0, 8).map((job) => ({
      id: job.id,
      title: job.title,
      region: job.region,
      location_source: job.location_source,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
