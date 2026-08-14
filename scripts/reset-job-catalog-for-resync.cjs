require('dotenv').config({ path: '.env.local', quiet: true });
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');

const RETAINED_JOBS = `
  select job_id from public.ai_matches
  union select job_id from public.applications
  union select job_id from public.application_fields
  union select job_id from public.favorites
  union select job_id from public.interview_questions where job_id is not null
  union select job_id from public.interview_sessions where job_id is not null
  union select job_id from public.ai_usage_events where job_id is not null
  union select job_id from public.prefill_feedback where job_id is not null
  union select job_id from public.resume_optimizations where job_id is not null
`;

(async () => {
  if (!process.env.SUPABASE_DB_URL) throw new Error('缺少 SUPABASE_DB_URL');
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    query_timeout: 120_000,
  });
  await client.connect();
  try {
    const preflight = await client.query(`
      with retained as (${RETAINED_JOBS})
      select
        (select count(*)::int from retained) as retained_jobs,
        (select count(*)::int from public.jobs where id not in (select job_id from retained)) as deletable_jobs
    `);
    console.log(JSON.stringify({ phase: 'preflight', apply: APPLY, ...preflight.rows[0] }));
    if (!APPLY) return;

    await client.query('begin');
    try {
      await client.query('lock table public.jobs in share row exclusive mode');
      const deleted = await client.query(`
        with retained as (${RETAINED_JOBS}),
        deleted as (
          delete from public.jobs
          where id not in (select job_id from retained)
          returning id
        )
        select count(*)::int as deleted_jobs from deleted
      `);
      await client.query('commit');
      console.log(JSON.stringify({ phase: 'complete', ...deleted.rows[0] }));
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end();
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : '岗位目录重置失败');
  process.exitCode = 1;
});
