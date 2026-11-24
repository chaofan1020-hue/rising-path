/**
 * 数据库基线快照（迁移前/迁移后对比用）。
 *
 * 用法：
 *   DOTENV_CONFIG_PATH=.env.production.local pnpm exec tsx scripts/snapshot-db-baseline.ts --out=docs/baseline/prod-YYYY-MM-DD.json
 *   pnpm exec tsx scripts/snapshot-db-baseline.ts --compare=docs/baseline/prod-before.json --out=docs/baseline/after.json
 *
 * 设计约束：
 * - 单连接、逐条查询，任何一条失败只记录 error，不中断整轮（迁移演练时数据库可能处于中途状态）。
 * - `jobs` 等大表用 pg_class.reltuples 估算，避免撞 Supabase 8 秒语句超时。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local', quiet: true });

const args = process.argv.slice(2);
const argOf = (name: string) => args.find((arg) => arg.startsWith(`${name}=`))?.split('=', 2)[1];
const outPath = argOf('--out') || `docs/baseline/baseline-${new Date().toISOString().slice(0, 10)}.json`;
const comparePath = argOf('--compare') || null;

const largeTables = new Set(['jobs', 'job_sync_records', 'job_sync_runs', 'job_ai_match_scopes']);

type Snapshot = Record<string, unknown>;

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: process.env.SUPABASE_DB_URL?.includes('127.0.0.1') || process.env.SUPABASE_DB_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

const snapshot: Snapshot = { generatedAt: new Date().toISOString(), items: {} as Record<string, unknown> };
const items = snapshot.items as Record<string, unknown>;

async function probe(key: string, sql: string, mapper?: (rows: Record<string, unknown>[]) => unknown) {
  try {
    const res = await client.query(sql);
    items[key] = mapper ? mapper(res.rows) : res.rows.length === 1 ? Object.values(res.rows[0])[0] : res.rows;
  } catch (error) {
    items[key] = { error: (error as Error).message };
  }
}

async function main() {
  if (!process.env.SUPABASE_DB_URL) throw new Error('缺少 SUPABASE_DB_URL（可用 DOTENV_CONFIG_PATH 指定 env 文件）');
  const url = new URL(process.env.SUPABASE_DB_URL);
  items.target = `${url.username}@${url.hostname}:${url.port || '5432'}${url.pathname}`;

  await client.connect();

  await probe('serverVersion', `select version()`);
  await probe('databaseSize', `select pg_size_pretty(pg_database_size(current_database()))`);
  await probe('databaseSizeBytes', `select pg_database_size(current_database())`);

  await probe('publicTables', `select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`);
  await probe('publicViews', `select count(*) from information_schema.views where table_schema='public'`);
  await probe('publicFunctions', `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`);
  await probe('rlsPolicies', `select schemaname, count(*) from pg_policies group by 1 order by 1`,
    (rows) => Object.fromEntries(rows.map((r) => [String(r.schemaname), Number(r.count)])));
  await probe('triggers', `select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','auth')`);
  await probe('sequences', `select sequence_schema as schema, count(*) from information_schema.sequences group by 1 order by 1`,
    (rows) => Object.fromEntries(rows.map((r) => [String(r.schema), Number(r.count)])));
  await probe('sequenceLastValues', `
    select schemaname || '.' || sequencename as name, last_value
    from pg_sequences
    where schemaname in ('public','storage','auth')
    order by 1`, (rows) => Object.fromEntries(rows.map((r) => [String(r.name), String(r.last_value)])));

  await probe('rowCounts', `
    select n.nspname as schema, c.relname as name,
           greatest(c.reltuples::bigint, 0) as estimated
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname in ('public','auth','storage')
    order by n.nspname, c.relname`, (rows) => Object.fromEntries(rows.map((r) => [`${r.schema}.${r.name}`, Number(r.estimated)])));

  // 关键表精确计数（都是小表或走索引，不会超时）
  await probe('exactCounts', `
    select 'auth.users' as k, count(*)::int as v from auth.users
    union all select 'auth.identities', count(*)::int from auth.identities
    union all select 'auth.sessions', count(*)::int from auth.sessions
    union all select 'auth.refresh_tokens', count(*)::int from auth.refresh_tokens
    union all select 'auth.refresh_tokens_active', count(*)::int from auth.refresh_tokens where not revoked
    union all select 'storage.objects', count(*)::int from storage.objects
    union all select 'storage.buckets', count(*)::int from storage.buckets
    union all select 'public.profiles', count(*)::int from public.profiles
    union all select 'public.resumes', count(*)::int from public.resumes
    union all select 'public.ai_matches', count(*)::int from public.ai_matches
    union all select 'public.applications', count(*)::int from public.applications
    union all select 'public.company_logos', count(*)::int from public.company_logos
    union all select 'public.liorvix_migration_history', count(*)::int from public.liorvix_migration_history
    order by 1`, (rows) => Object.fromEntries(rows.map((r) => [String(r.k), Number(r.v)])));

  await probe('authIdentitiesByProvider', `select provider, count(*)::int as n from auth.identities group by 1 order by 1`,
    (rows) => Object.fromEntries(rows.map((r) => [String(r.provider), Number(r.n)])));
  await probe('authMaxSchemaMigration', `select max(version::text) from auth.schema_migrations`);
  await probe('authSchemaMigrationCount', `select count(*) from auth.schema_migrations`);
  await probe('migrationHistoryMax', `select max(applied_at)::text from public.liorvix_migration_history`);

  await probe('jobsActive', `select count(*) filter (where is_active) as active, count(*) filter (where not is_active) as closed from public.jobs`,
    (rows) => ({ active: Number(rows[0].active), closed: Number(rows[0].closed) }));
  await probe('storageByBucket', `
    select bucket_id, count(*)::int as objects, coalesce(sum((metadata->>'size')::bigint),0)::bigint as bytes
    from storage.objects group by 1 order by 1`,
    (rows) => rows.map((r) => ({ bucket: r.bucket_id, objects: Number(r.objects), bytes: String(r.bytes) })));
  await probe('storageBucketConfig', `
    select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id`,
    (rows) => rows.map((r) => ({ id: r.id, public: r.public, fileSizeLimit: r.file_size_limit, allowedMimeTypes: r.allowed_mime_types })));

  await probe('oldDomainRefs', `
    select 'company_logos.logo_url' as k, count(*)::int as v from public.company_logos where logo_url like '%weqvdtdjdzmqflhwobec.supabase.co%'
    union all select 'profiles.avatar_url', count(*)::int from public.profiles where avatar_url like '%weqvdtdjdzmqflhwobec.supabase.co%'
    order by 1`, (rows) => Object.fromEntries(rows.map((r) => [String(r.k), Number(r.v)])));

  await probe('extensions', `select extname || ' ' || extversion as e from pg_extension order by 1`,
    (rows) => rows.map((r) => String(r.e)));
  await probe('schemas', `select nspname from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema' order by 1`,
    (rows) => rows.map((r) => String(r.nspname)));

  await client.end();

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outPath), JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(`snapshot written: ${path.resolve(outPath)}`);

  const failed = Object.entries(items).filter(([, v]) => v && typeof v === 'object' && 'error' in (v as object));
  if (failed.length) console.log('failed probes:', failed.map(([k]) => k).join(', '));

  if (comparePath) {
    const before = JSON.parse(fs.readFileSync(path.resolve(comparePath), 'utf8')) as Snapshot;
    compare(before.items as Record<string, unknown>, items);
  }
}

function compare(before: Record<string, unknown>, after: Record<string, unknown>) {
  const flat = (obj: Record<string, unknown>) => {
    const out = new Map<string, string>();
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) out.set(`${k}.${k2}`, JSON.stringify(v2));
      } else {
        out.set(k, JSON.stringify(v));
      }
    }
    return out;
  };
  const b = flat(before);
  const a = flat(after);
  const keys = [...new Set([...b.keys(), ...a.keys()])].sort();
  const diffs = keys.filter((k) => b.get(k) !== a.get(k));
  if (!diffs.length) return console.log('compare: no differences');
  console.log(`compare: ${diffs.length} difference(s)`);
  for (const k of diffs.slice(0, 200)) {
    console.log(`  ${k}: ${b.get(k) ?? '<missing>'} -> ${a.get(k) ?? '<missing>'}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});