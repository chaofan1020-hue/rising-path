import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

function arg(name: string): string { return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3).trim() || ''; }

async function main(): Promise<void> {
  loadDotenv({ path: arg('env-file') || '.env.local' });
  const company = arg('company');
  if (!company) throw new Error('需要 --company=公司名');
  const { data, error } = await getSupabaseClient().from('job_company_sources').select('*').eq('company_name', company).maybeSingle();
  if (error) throw new Error(error.message);
  console.log(JSON.stringify(data, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
