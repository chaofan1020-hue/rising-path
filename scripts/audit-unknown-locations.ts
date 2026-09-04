import { Client } from 'pg';
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });

async function main() {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT company, count(*)::int AS count,
             count(*) FILTER (WHERE source_system = 'collector_feed')::int AS feed_count,
             count(*) FILTER (WHERE location_source IS NULL OR location_source NOT IN ('official_payload','official_description','official_link_description'))::int AS hidden_count
      FROM public.jobs
      WHERE is_active = true
      GROUP BY company ORDER BY count DESC LIMIT 50
    `);
    console.log(JSON.stringify(result.rows, null, 2));
  } finally { await client.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
