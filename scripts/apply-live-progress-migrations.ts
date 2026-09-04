import fs from 'node:fs/promises';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
  if (!process.env.SUPABASE_DB_URL) throw new Error('missing SUPABASE_DB_URL');
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const file of ['0101_job_sync_run_live_progress.sql', '0103_job_sync_run_candidate_progress.sql']) {
      await client.query(await fs.readFile(`supabase/migrations/${file}`, 'utf8'));
      console.log(`applied ${file}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
