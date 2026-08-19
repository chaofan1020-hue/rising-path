import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: '.env.local', quiet: true });

async function main() {
  if (!process.env.SUPABASE_DB_URL) throw new Error('缺少 SUPABASE_DB_URL');
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const database = await client.query<{ bytes: string; size: string }>(`
      select pg_database_size(current_database())::text as bytes,
             pg_size_pretty(pg_database_size(current_database())) as size
    `);
    const relations = await client.query<{
      schema: string;
      name: string;
      kind: string;
      bytes: string;
      size: string;
    }>(`
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
    const functions = await client.query<{ proname: string }>(`
      select proname
      from pg_proc
      join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
      where nspname = 'public'
        and proname like 'search_ai_match_candidates%'
      order by proname
    `);
    console.log(JSON.stringify({
      database: database.rows[0],
      relations: relations.rows,
      aiMatchFunctions: functions.rows.map((row) => row.proname),
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '数据库空间审计失败');
  process.exitCode = 1;
});
