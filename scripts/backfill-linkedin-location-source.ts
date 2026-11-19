import { config as loadDotenv } from 'dotenv';
import { fieldEvidence as buildFieldEvidence, isTrustedJobFieldSource } from '@/lib/job-field-provenance';
import { hasOfficialCompanyHost } from '@/lib/job-company-field-rules';
import { normalizeWorkplace } from '@/lib/job-connectors/utils';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.argv.find((value) => value.startsWith('--env-file='))?.slice('--env-file='.length) || '.env.production.local', override: true });

const WRITE = process.argv.includes('--write');
const PAGE_SIZE = 200;

type JobRow = {
  id: number;
  title: string | null;
  region: string | null;
  location_source: string | null;
  workplace_type: string | null;
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
      .select('id,title,region,location_source,workplace_type,job_url,field_evidence')
      .eq('company', 'LinkedIn')
      .eq('source_system', 'collector_feed')
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (data || []) as JobRow[];
    jobs.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  const now = new Date().toISOString();
  const candidates = jobs.filter((job) => {
    if (!hasOfficialCompanyHost('LinkedIn', job.job_url)) return false;
    const needsLocation = !placeholder(job.region) && !isTrustedJobFieldSource(job.location_source);
    const inferredWorkplace = normalizeWorkplace([job.workplace_type, job.region]).workplaceType;
    const needsWorkplace = !job.workplace_type && Boolean(inferredWorkplace);
    return needsLocation || needsWorkplace;
  });

  let updated = 0;
  for (const job of candidates) {
    const previous = job.field_evidence && typeof job.field_evidence === 'object' ? job.field_evidence : {};
    const previousFields = previous.fields && typeof previous.fields === 'object' && !Array.isArray(previous.fields)
      ? previous.fields as Record<string, unknown>
      : {};
    const inferredWorkplace = normalizeWorkplace([job.workplace_type, job.region]).workplaceType;
    const patch: Record<string, unknown> = {
      updated_at: now,
      field_evidence: {
        ...previous,
        version: 1,
        source_type: previous.source_type || 'public_feed',
        source_url: job.job_url,
        fields: { ...previousFields },
      },
    };
    const fields = (patch.field_evidence as { fields: Record<string, unknown> }).fields;
    if (!placeholder(job.region) && !isTrustedJobFieldSource(job.location_source)) {
      patch.location_source = 'official_payload';
      fields.location = buildFieldEvidence('official_payload', job.job_url, now);
    }
    if (!job.workplace_type && inferredWorkplace) {
      patch.workplace_type = inferredWorkplace;
      fields.workplace_type = buildFieldEvidence('official_payload', job.job_url, now);
    }
    if (WRITE) {
      const { error } = await client
        .from('jobs')
        .update(patch)
        .eq('id', job.id)
        .eq('company', 'LinkedIn')
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
    already_complete: jobs.length - candidates.length,
    candidates: candidates.length,
    updated,
    samples: candidates.slice(0, 8).map((job) => ({
      id: job.id,
      title: job.title,
      region: job.region,
      location_source: job.location_source,
      workplace_type: job.workplace_type,
      inferred_workplace: normalizeWorkplace([job.workplace_type, job.region]).workplaceType,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
