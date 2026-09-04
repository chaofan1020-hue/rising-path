import { Client } from 'pg';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.local' });

async function main(): Promise<void> {
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (!databaseUrl) throw new Error('缺少 SUPABASE_DB_URL');
  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE public.jobs
      SET job_type = '社招', employment_category = '社招', updated_at = now()
      WHERE is_active = true
        AND job_type = '实习'
        AND coalesce(title, '') !~* '\\m(intern|internship|co[- ]?op)\\M'
        AND coalesce(title, '') ~* '\\m(senior|sr\\.?|manager|director|vice[[:space:]]+president|vp|lead|principal|recruiter|auditor|associate|international|internal)\\M'
      RETURNING id
    `);
    await client.query('COMMIT');
    console.log(JSON.stringify({ updated: result.rowCount || 0 }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
