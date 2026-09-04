import { config as loadDotenv } from 'dotenv';
import { getSupabaseClient } from '@/storage/database/supabase-client';

loadDotenv({ path: '.env.local' });

function host(value: unknown): string {
  try { return new URL(String(value || '')).hostname.toLowerCase(); } catch { return 'invalid_or_missing_url'; }
}

async function main(): Promise<void> {
  const client = getSupabaseClient();
  const { data: sources, error: sourceError } = await client.from('job_company_sources').select('company_name,status').eq('is_active', true).in('status', ['discovery_required', 'source_family_identified']);
  if (sourceError) throw new Error(sourceError.message);
  const companies = (sources || []).map((row) => row.company_name as string);
  const result = new Map<string, Map<string, number>>();
  for (const company of companies) {
    const counts = new Map<string, number>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.from('jobs').select('job_url,source_url').eq('source_system', 'collector_feed').eq('company', company).eq('is_active', true).range(offset, offset + 999);
      if (error) throw new Error(`${company}: ${error.message}`);
      for (const row of data || []) {
        const value = row.job_url || row.source_url;
        const key = host(value);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      if (!data || data.length < 1000) break;
    }
    result.set(company, counts);
  }
  const rows = [...result.entries()].map(([company, counts]) => ({ company, hosts: Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1])), jobs: [...counts.values()].reduce((a, b) => a + b, 0) })).sort((a, b) => b.jobs - a.jobs || a.company.localeCompare(b.company));
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
