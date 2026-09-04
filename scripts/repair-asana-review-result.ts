import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';
loadDotenv({ path: '.env.local' });
async function main() {
  const client = getSupabaseClient();
  const { data, error } = await client.from('job_historical_field_reviews').update({ updated_jobs: 35, updated_at: new Date().toISOString() }).eq('company_name', 'Asana').eq('status', 'completed').select('company_name,status,total_candidates,processed_candidates,remaining_candidates,updated_jobs').maybeSingle();
  if (error) throw new Error(error.message);
  console.log(JSON.stringify(data));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
