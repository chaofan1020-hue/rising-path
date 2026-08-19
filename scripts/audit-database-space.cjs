require('dotenv').config({ path: '.env.local', quiet: true });
const { Client } = require('pg');

(async () => {
  if (!process.env.SUPABASE_DB_URL) throw new Error('缺少 SUPABASE_DB_URL');
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const database = await client.query(`
      select pg_database_size(current_database())::text as bytes,
             pg_size_pretty(pg_database_size(current_database())) as size
    `);
    const relations = await client.query(`
      select n.nspname as schema,
             c.relname as name,
             c.relkind as kind,
             pg_total_relation_size(c.oid)::text as bytes,
             pg_size_pretty(pg_total_relation_size(c.oid)) as size
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'i', 'm', 't')
      order by pg_total_relation_size(c.oid) desc
      limit 40
    `);
    const functions = await client.query(`
      select proname, pg_get_function_identity_arguments(pg_proc.oid) as arguments
      from pg_proc
      join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
      where nspname = 'public'
        and proname like 'search_ai_match_candidates%'
      order by proname
    `);
    const jobColumns = await client.query(`
      select column_name, data_type, udt_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'jobs'
      order by ordinal_position
    `);
    const jobStats = await client.query(`
      select
        count(*)::int as total_jobs,
        count(*) filter (where is_active)::int as active_jobs,
        count(*) filter (where not is_active)::int as inactive_jobs,
        coalesce(sum(octet_length(description)), 0)::bigint as description_bytes,
        coalesce(sum(octet_length(requirements)), 0)::bigint as requirements_bytes,
        max(octet_length(description))::int as max_description_bytes,
        max(octet_length(requirements))::int as max_requirements_bytes
      from public.jobs
    `);
    const jobContentBreakdown = await client.query(`
      select
        case when is_active then 'active' else 'inactive' end as lifecycle,
        count(*)::int as jobs,
        coalesce(sum(octet_length(description)), 0)::bigint as description_bytes,
        coalesce(sum(octet_length(overview)), 0)::bigint as overview_bytes,
        coalesce(sum(octet_length(responsibilities)), 0)::bigint as responsibilities_bytes,
        coalesce(sum(octet_length(requirements)), 0)::bigint as requirements_bytes,
        coalesce(sum(octet_length(nice_to_have)), 0)::bigint as nice_to_have_bytes,
        coalesce(sum(octet_length(job_url)), 0)::bigint as job_url_bytes,
        coalesce(sum(octet_length(source_url)), 0)::bigint as source_url_bytes,
        coalesce(sum(octet_length(external_job_id)), 0)::bigint as external_job_id_bytes,
        coalesce(sum(
          coalesce(octet_length(description), 0) + coalesce(octet_length(overview), 0)
          + coalesce(octet_length(responsibilities), 0) + coalesce(octet_length(requirements), 0)
          + coalesce(octet_length(nice_to_have), 0)
        ), 0)::bigint as rich_text_bytes
      from public.jobs
      group by is_active
      order by is_active desc
    `);
    const largestJobs = await client.query(`
      select
        id,
        is_active,
        octet_length(description) as description_bytes,
        octet_length(overview) as overview_bytes,
        octet_length(responsibilities) as responsibilities_bytes,
        octet_length(requirements) as requirements_bytes,
        octet_length(nice_to_have) as nice_to_have_bytes,
          coalesce(octet_length(description), 0) + coalesce(octet_length(overview), 0)
          + coalesce(octet_length(responsibilities), 0) + coalesce(octet_length(requirements), 0)
          + coalesce(octet_length(nice_to_have), 0) as rich_text_bytes,
        case when coalesce(description, '') ~ '<[^>]+>' then true else false end as description_has_html
      from public.jobs
      order by rich_text_bytes desc nulls last
      limit 20
    `);
    const inactiveReferences = await client.query(`
      select
        (select count(*)::int from public.ai_matches matches
          join public.jobs jobs on jobs.id = matches.job_id
          where not jobs.is_active) as ai_matches,
        (select count(*)::int from public.applications applications
          join public.jobs jobs on jobs.id = applications.job_id
          where not jobs.is_active) as applications,
        (select count(*)::int from public.favorites favorites
          join public.jobs jobs on jobs.id = favorites.job_id
          where not jobs.is_active) as favorites,
        (select count(*)::int from public.interview_sessions sessions
          join public.jobs jobs on jobs.id = sessions.job_id
          where not jobs.is_active) as interview_sessions
    `);
    const deadTuples = await client.query(`
      select n_live_tup, n_dead_tup, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
      from pg_stat_user_tables
      where relname = 'jobs'
    `);
    console.log(JSON.stringify({
      database: database.rows[0],
      relations: relations.rows,
      aiMatchFunctions: functions.rows,
      jobColumns: jobColumns.rows,
      jobStats: jobStats.rows[0],
      jobContentBreakdown: jobContentBreakdown.rows,
      largestJobs: largestJobs.rows,
      inactiveReferences: inactiveReferences.rows[0],
      deadTuples: deadTuples.rows[0],
    }, null, 2));
  } finally {
    await client.end();
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : '数据库空间审计失败');
  process.exitCode = 1;
});
