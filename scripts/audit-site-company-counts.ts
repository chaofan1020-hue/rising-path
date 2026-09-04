import { config as loadDotenv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

loadDotenv({ path: '.env.local' });

const companies = ['Coinbase', 'Asana', 'Brex', 'Databricks', 'Figma', 'GitLab'];

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
  const client = createClient(url, key, { db: { timeout: 120_000 }, auth: { persistSession: false, autoRefreshToken: false } });
  for (const company of companies) {
    const rows: Array<{ external_job_id?: string | null; is_active?: boolean | null; is_closed?: boolean | null }> = [];
    for (let offset = 0; ; offset += 1_000) {
      const { data, error } = await client
        .from('jobs')
        .select('external_job_id,is_active,is_closed')
        .eq('source_system', 'collector_feed')
        .eq('company', company)
        .range(offset, offset + 999);
      if (error) throw new Error(`${company}: ${error.message}`);
      rows.push(...((data || []) as typeof rows));
      if (!data || data.length < 1_000) break;
    }
    const active = rows.filter((row) => row.is_active !== false && row.is_closed !== true);
    const ids = new Set(active.map((row) => typeof row.external_job_id === 'string' ? row.external_job_id.trim() : '').filter(Boolean));
    console.log(JSON.stringify({ company, total_rows: rows.length, active_rows: active.length, unique_active_external_ids: ids.size, duplicate_active_external_ids: active.length - ids.size }));
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });
