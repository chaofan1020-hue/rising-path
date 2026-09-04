import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
loadDotenv({ path: '.env.local' });

function arg(name: string): string { return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3).trim() || ''; }

async function main(): Promise<void> {
  const company = arg('company');
  const processed = Number(arg('processed'));
  const updated = Number(arg('updated'));
  if (!company || !Number.isInteger(processed) || processed < 0 || !Number.isInteger(updated) || updated < 0) throw new Error('需要 --company --processed --updated');
  const client = getSupabaseClient();
  const { data: current, error: readError } = await client.from('job_historical_field_reviews').select('id,total_candidates,status').eq('company_name', company).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!current) throw new Error(`未找到 ${company}`);
  const total = Math.max(Number(current.total_candidates) || 0, processed);
  const { data, error } = await client.from('job_historical_field_reviews').update({ status: 'completed', total_candidates: total, processed_candidates: processed, remaining_candidates: 0, updated_jobs: updated, last_error: null, completed_at: new Date().toISOString(), lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq('id', current.id).select('company_name,status,total_candidates,processed_candidates,remaining_candidates,updated_jobs').single();
  if (error) throw new Error(error.message);
  console.log(JSON.stringify(data));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
