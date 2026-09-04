import { config as loadDotenv } from 'dotenv';
import { getCompanySourceProfile, fetchConnectorBoard } from '@/lib/job-connectors';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: '.env.local' });

interface ExistingJob {
  id: number;
  external_job_id: string | null;
  experience_min_years: number | null;
  experience_max_years: number | null;
  experience_text: string | null;
  field_evidence: Record<string, unknown> | null;
}

function parseArguments(): { company: string; write: boolean } {
  const company = process.argv.find((argument) => argument.startsWith('--company='))?.split('=').slice(1).join('=').trim() || '';
  return { company, write: process.argv.includes('--write') };
}

function hasExperience(job: ExistingJob): boolean {
  return job.experience_min_years != null || job.experience_max_years != null || Boolean(job.experience_text?.trim());
}

async function main(): Promise<void> {
  const { company, write } = parseArguments();
  if (!company) throw new Error('请指定 --company=公司名');
  const profile = getCompanySourceProfile(company);
  if (!profile) throw new Error(`未找到阶段 2 公司配置：${company}`);

  const client = getSupabaseClient();
  const [official, existingResult] = await Promise.all([
    fetchConnectorBoard(profile),
    client
      .from('jobs')
      .select('id,external_job_id,experience_min_years,experience_max_years,experience_text,field_evidence')
      .eq('company', profile.company)
      .eq('is_active', true)
      .limit(1_000),
  ]);
  if (existingResult.error) throw new Error(`读取现有岗位失败: ${existingResult.error.message}`);

  const officialById = new Map(official.jobs.map((job) => [job.external_job_id || job.id, job]));
  const existing = (existingResult.data || []) as ExistingJob[];
  const candidates = existing.flatMap((job) => {
    if (hasExperience(job)) return [];
    const officialJob = officialById.get(job.external_job_id || '');
    if (!officialJob || (officialJob.experience_min_years == null
      && officialJob.experience_max_years == null
      && !officialJob.experience_text)) return [];
    return [{ job, officialJob }];
  });

  const result = {
    company: profile.company,
    connector: profile.connector,
    official_received: official.received,
    official_parsed: official.jobs.length,
    active_existing: existing.length,
    matched_existing: existing.filter((job) => officialById.has(job.external_job_id || '')).length,
    candidates: candidates.length,
    updated: 0,
    dry_run: !write,
  };

  if (!write) {
    console.log(JSON.stringify({
      ...result,
      samples: candidates.slice(0, 10).map(({ job, officialJob }) => ({
        id: job.id,
        external_job_id: job.external_job_id,
        experience_min_years: officialJob.experience_min_years,
        experience_max_years: officialJob.experience_max_years,
        experience_text: officialJob.experience_text,
      })),
    }, null, 2));
    return;
  }

  for (const { job, officialJob } of candidates) {
    const now = new Date().toISOString();
    const previousFields = job.field_evidence?.fields && typeof job.field_evidence.fields === 'object' && !Array.isArray(job.field_evidence.fields)
      ? job.field_evidence.fields as Record<string, unknown>
      : {};
    const { error } = await client
      .from('jobs')
      .update({
        experience_min_years: officialJob.experience_min_years,
        experience_max_years: officialJob.experience_max_years,
        experience_text: officialJob.experience_text,
        field_evidence: {
          ...(job.field_evidence || {}),
          version: 1,
          fields: {
            ...previousFields,
            experience: {
              status: 'verified',
              source: 'official_ats_description',
              evidence_url: officialJob.source_url,
              evidence_kind: 'official_ats_payload',
              verified_at: now,
            },
          },
        },
        updated_at: now,
      })
      // Filling a field must never restore an inactive job or otherwise
      // change its lifecycle while a feed synchronization is in progress.
      .eq('id', job.id)
      .eq('is_active', true);
    if (error) throw new Error(`更新岗位 ${job.id} 失败: ${error.message}`);
    result.updated += 1;
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
