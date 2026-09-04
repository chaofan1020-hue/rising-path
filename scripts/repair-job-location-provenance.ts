import { Client } from 'pg';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.local' });

async function main(): Promise<void> {
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (!databaseUrl) throw new Error('缺少 SUPABASE_DB_URL');
  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    let updated = 0;
    // Keep each transaction small. The jobs table is written by the feed
    // worker, so a single full-table update can wait behind an upsert batch.
    for (let start = 0; start < 200_000; start += 1_000) {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '10s'");
      const result = await client.query(`
        UPDATE public.jobs
        SET location_source = 'official_payload', updated_at = now()
        WHERE id >= $1 AND id < $2
          AND source_system = 'collector_feed'
          AND is_active = true
          AND coalesce(trim(region), '') NOT IN ('', '未注明')
          AND (location_source IS NULL OR location_source NOT IN ('official_payload','official_description','official_link_description'))
      `, [start, start + 1_000]);
      await client.query('COMMIT');
      updated += result.rowCount || 0;
    }
    console.log(JSON.stringify({ updated }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
