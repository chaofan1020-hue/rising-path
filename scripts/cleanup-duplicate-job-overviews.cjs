require('dotenv').config({ path: '.env.local', quiet: true });
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 200;
const MAX_DATABASE_BYTES = 496_000_000;

async function databaseBytes(client) {
  const result = await client.query(`select pg_database_size(current_database())::bigint as bytes`);
  return Number(result.rows[0].bytes);
}

(async () => {
  if (!process.env.SUPABASE_DB_URL) throw new Error('缺少 SUPABASE_DB_URL');
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    query_timeout: 120_000,
  });
  await client.connect();
  try {
    const beforeBytes = await databaseBytes(client);
    console.log(JSON.stringify({ phase: 'preflight', beforeBytes, batchSize: BATCH_SIZE, apply: APPLY }));
    if (!APPLY) return;

    let cleared = 0;
    let scanned = 0;
    let lastId = 0;
    while (true) {
      const currentBytes = await databaseBytes(client);
      if (currentBytes >= MAX_DATABASE_BYTES) {
        throw new Error(`数据库空间保护已触发，当前 ${currentBytes} bytes，已停止后续清理。`);
      }
      const page = await client.query(`
        select id, overview is not null and overview = description as is_duplicate
        from public.jobs
        where id > $1
        order by id
        limit $2
      `, [lastId, BATCH_SIZE]);
      if (page.rowCount === 0) break;
      lastId = Number(page.rows[page.rows.length - 1].id);
      scanned += page.rowCount;
      const targetIds = page.rows.filter((row) => row.is_duplicate).map((row) => row.id);
      const result = targetIds.length === 0
        ? { rowCount: 0 }
        : await client.query(`
          update public.jobs
          set overview = null
          where id = any($1::integer[])
          returning id
        `, [targetIds]);
      cleared += result.rowCount || 0;
      console.log(JSON.stringify({ phase: 'clear', scanned, batch: result.rowCount || 0, cleared }));
    }

    // Reclaim the dead TOAST entries for reuse by future job syncs. This does
    // not rewrite the table, so it is safe under the current tight quota.
    await client.query('vacuum (analyze) public.jobs');
    const afterBytes = await databaseBytes(client);
    console.log(JSON.stringify({ phase: 'complete', cleared, beforeBytes, afterBytes }));
  } finally {
    await client.end();
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : '岗位重复正文清理失败');
  process.exitCode = 1;
});
