import { getSupabaseClient } from '@/storage/database/supabase-client';
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
async function main() {
  const ids = process.argv.slice(2).map(Number).filter(Number.isInteger);
  const { data, error } = await getSupabaseClient().from('jobs').select('id,company,title,job_url').in('id', ids);
  if (error) throw new Error(error.message);
  console.log(JSON.stringify(data, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
