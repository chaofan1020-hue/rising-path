import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

function arg(name: string): string { return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3).trim() || ''; }

async function main(): Promise<void> {
  loadDotenv({ path: arg('env-file') || '.env.local' });
  const company = arg('company');
  const minutes = Number(arg('minutes') || '15');
  if (!company || !Number.isInteger(minutes) || minutes < 1) throw new Error('需要 --company 和有效的 --minutes');
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const { data, error } = await getSupabaseClient().from('jobs')
    .select('id,company,is_active,is_closed,updated_at,region,employment_category')
    .eq('company', company).eq('source_system', 'collector_feed').gte('updated_at', since)
    .order('updated_at', { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  console.log(JSON.stringify({ company, since, count: data?.length || 0, rows: data || [] }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
