/**
 * 只读探针：统计「自动网申」真实的存量与可达性。
 * 不写任何数据；只跑 count 与样例查询。
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

function loadEnvFile(file: string): Record<string, string> {
  const result: Record<string, string> = {};
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) return result;
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

async function main() {
  const env = { ...loadEnvFile('.env.production.local'), ...process.env } as Record<string, string>;
  const dbUrl = env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('SUPABASE_DB_URL missing');

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query("set statement_timeout = '120s'");

  const one = async (sql: string) => (await client.query(sql)).rows[0];
  const all = async (sql: string) => (await client.query(sql)).rows;

  const out: Record<string, unknown> = {};

  out.applications = await one(`
    select count(*)::int as total,
           count(distinct user_id)::int as users,
           max(created_at) as latest,
           count(*) filter (where submitted_at is not null)::int as submitted
    from public.applications`);

  out.applicationStatus = await all(`
    select coalesce(status,'(null)') as status, count(*)::int as n
    from public.applications group by 1 order by n desc`);

  out.profiles = await one(`
    select count(*)::int as total, count(distinct user_id)::int as users, max(updated_at) as latest
    from public.application_profiles`);

  out.prefillFeedback = await all(`
    select count(*)::int as total, count(distinct user_id)::int as users, max(created_at) as latest
    from public.prefill_feedback`);

  out.resumes = await one(`select count(*)::int as total, count(distinct user_id)::int as users from public.resumes`);

  out.aiUsagePrefill = await all(`
    select date_trunc('month', created_at)::date as month, count(*)::int as calls, count(distinct user_id)::int as users
    from public.ai_usage_events
    where feature = 'application_prefill'
    group by 1 order by 1 desc limit 6`).catch(() => 'n/a');

  out.activeJobs = await one(`select count(*)::int as total from public.jobs where is_active`);

  out.atsReach = await all(`
    with hosts as (
      select
        case
          when job_url ilike '%greenhouse.io%' then 'greenhouse'
          when job_url ilike '%lever.co%' then 'lever'
          when job_url ilike '%myworkdayjobs.com%' then 'workday'
          when job_url ilike '%icims.com%' then 'icims'
          when job_url ilike '%taleo.net%' then 'taleo'
          when job_url ilike '%smartrecruiters.com%' then 'smartrecruiters'
          when job_url ilike '%ashbyhq.com%' then 'ashby'
          when job_url ilike '%successfactors%' or job_url ilike '%sapsf.%' then 'successfactors'
          when job_url ilike '%linkedin.com%' then 'linkedin'
          when job_url ilike '%indeed.com%' then 'indeed'
          when job_url ilike '%glassdoor%' then 'glassdoor'
          when job_url ilike '%handshake%' then 'handshake'
          else 'company_direct'
        end as bucket
      from public.jobs where is_active
    )
    select bucket, count(*)::int as n from hosts group by 1 order by n desc`);

  out.topDirectHosts = await all(`
    select regexp_replace(lower(coalesce(job_url,'')), '^https?://(www\\.)?([^/]+).*$', '\\2') as host,
           count(*)::int as n
    from public.jobs
    where is_active and job_url is not null and job_url <> ''
    group by 1 order by n desc limit 25`);

  console.log(JSON.stringify(out, null, 2));
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
