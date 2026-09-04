import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
loadDotenv({ path: '.env.local' });

const items = [
  ['General Atlantic', 0, 0],
  ['Perplexity', 0, 0],
  ['Bridgewater Associates', 0, 0],
  ['OpenAI', 2, 2],
  ['Stripe', 46, 46],
] as const;

async function main(): Promise<void> {
  const client = getSupabaseClient();
  const results: unknown[] = [];
  for (const [company, processed, updated] of items) {
    const { data: current, error: readError } = await client.from('job_historical_field_reviews').select('id,total_candidates').eq('company_name', company).maybeSingle();
    if (readError) throw new Error(`${company}: ${readError.message}`);
    if (!current) { results.push({ company, error: '未找到队列' }); continue; }
    const total = Math.max(Number(current.total_candidates) || 0, processed);
    const { data, error } = await client.from('job_historical_field_reviews').update({ status: 'completed', total_candidates: total, processed_candidates: processed, remaining_candidates: 0, updated_jobs: updated, last_error: null, completed_at: new Date().toISOString(), lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq('id', current.id).select('company_name,status,total_candidates,processed_candidates,remaining_candidates,updated_jobs').single();
    if (error) throw new Error(`${company}: ${error.message}`);
    results.push(data);
  }
  console.log(JSON.stringify(results, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
