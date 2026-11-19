import { config as loadDotenv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';

loadDotenv({ path: process.env.DOTENV_CONFIG_PATH || '.env.production.local' });

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing production supabase');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error, count } = await client
    .from('jobs')
    .select('id,title,region,location_source,workplace_type,employment_type,posted_at,is_active,is_closed,job_url,field_evidence', { count: 'exact' })
    .eq('company', 'LinkedIn')
    .eq('source_system', 'collector_feed')
    .range(0, 999);
  if (error) throw new Error(error.message);
  const rows = data || [];
  const active = rows.filter((row) => row.is_active !== false && row.is_closed !== true);
  const loc = active.filter((row) => row.region && row.region !== '未注明').length;
  const sourced = active.filter((row) => typeof row.location_source === 'string' && row.location_source).length;
  const workplace = active.filter((row) => row.workplace_type).length;
  const posted = active.filter((row) => row.posted_at).length;
  const samples = active.slice(0, 8).map((row) => ({
    id: row.id,
    title: row.title,
    region: row.region,
    location_source: row.location_source,
    workplace_type: row.workplace_type,
    posted_at: row.posted_at,
  }));
  let capture = { jobs: 0, withLocation: 0, workplaces: {} as Record<string, number> };
  try {
    const payload = JSON.parse(await readFile('output/linkedin-browser-jobs-latest.json', 'utf8')) as {
      jobs?: Array<{ location?: string | null }>;
    };
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    capture.jobs = jobs.length;
    capture.withLocation = jobs.filter((job) => job.location).length;
    for (const job of jobs) {
      const match = String(job.location || '').match(/\(([^)]+)\)\s*$/);
      if (match) capture.workplaces[match[1]] = (capture.workplaces[match[1]] || 0) + 1;
    }
  } catch {
    capture = { jobs: -1, withLocation: -1, workplaces: {} };
  }
  console.log(JSON.stringify({
    env: url.replace(/https:\/\/([^.]+).*/, '$1'),
    db_rows: count,
    fetched: rows.length,
    active: active.length,
    region_filled: loc,
    location_source_filled: sourced,
    workplace_filled: workplace,
    posted_filled: posted,
    samples,
    capture,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
