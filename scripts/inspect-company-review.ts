import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: process.env.ENV_FILE || '.env.local' });

async function main(): Promise<void> {
  const company = process.argv.find((value) => value.startsWith('--company='))?.slice('--company='.length).trim();
  if (!company) throw new Error('Specify --company=<company>');
  const client = getSupabaseClient();
  const [{ data: queue, error: queueError }, { data: jobs, error: jobsError }] = await Promise.all([
    client.from('job_historical_field_reviews').select('company_name,status,source_family,total_candidates,processed_candidates,remaining_candidates,updated_jobs,verified_fields,unavailable_fields,skipped_jobs,failed_jobs,last_error,cursor_job_id,last_heartbeat_at').eq('company_name', company).maybeSingle(),
    client.from('jobs').select('id,field_evidence').eq('company', company).eq('source_system', 'collector_feed').eq('is_active', true),
  ]);
  if (queueError) throw new Error(`读取复核队列失败: ${queueError.message}`);
  if (jobsError) throw new Error(`读取岗位证据失败: ${jobsError.message}`);
  const counts = { location: 0, workplace_type: 0, employment_category: 0, experience: 0, salary: 0, deadline: 0 };
  for (const job of jobs || []) {
    const fields = job.field_evidence && typeof job.field_evidence === 'object' && !Array.isArray(job.field_evidence)
      ? (job.field_evidence as Record<string, unknown>).fields : null;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
    for (const field of Object.keys(counts)) if ((fields as Record<string, unknown>)[field] && typeof (fields as Record<string, unknown>)[field] === 'object' && ((fields as Record<string, unknown>)[field] as Record<string, unknown>).status === 'verified') counts[field as keyof typeof counts] += 1;
  }
  console.log(JSON.stringify({ company, queue, active_jobs: jobs?.length || 0, verified_field_evidence: counts }, null, 2));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
