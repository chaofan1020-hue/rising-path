import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

function arg(name: string): string { return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3).trim() || ''; }

async function main(): Promise<void> {
  loadDotenv({ path: arg('env-file') || '.env.local' });
  const company = arg('company');
  if (!company) throw new Error('需要 --company');
  const { data, error } = await getSupabaseClient().from('jobs').select('id,title,job_url,external_job_id').eq('company', company).eq('source_system', 'collector_feed').eq('is_active', true).order('id').limit(20);
  if (error) throw new Error(error.message);
  console.log(JSON.stringify(data || [], null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
