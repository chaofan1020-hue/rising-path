import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local', quiet: true });

const MIGRATION_TABLE = 'public.liorvix_migration_history';
const MIGRATION_PATTERN = /^(\d{4})_(.+)\.sql$/u;

type Options = {
  from: number;
  to: number | null;
  check: boolean;
  dryRun: boolean;
  baseline: boolean;
};

function getQueryTimeoutMs(): number {
  const rawValue = process.env.DB_MIGRATION_QUERY_TIMEOUT_MS?.trim();
  if (!rawValue) return 120_000;
  const timeoutMs = Number(rawValue);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 900_000) {
    throw new Error('DB_MIGRATION_QUERY_TIMEOUT_MS 必须是 5000 到 900000 之间的整数（毫秒）');
  }
  return timeoutMs;
}

function parseOptions(): Options {
  const args = process.argv.slice(2);
  const value = (name: string) => args.find((arg) => arg.startsWith(`${name}=`))?.split('=', 2)[1];
  const from = Number(value('--from') || '0');
  const toValue = value('--to');
  const to = toValue ? Number(toValue) : null;
  if (!Number.isInteger(from) || from < 0 || (to !== null && (!Number.isInteger(to) || to < from))) {
    throw new Error('迁移范围无效，请使用 --from=0017 [--to=0034]');
  }
  return {
    from,
    to,
    check: args.includes('--check'),
    dryRun: args.includes('--dry-run'),
    baseline: args.includes('--baseline'),
  };
}

function migrationNumber(file: string): number {
  const match = MIGRATION_PATTERN.exec(file);
  if (!match) throw new Error(`无效迁移文件名：${file}`);
  return Number(match[1]);
}

async function getMigrationFiles(options: Options): Promise<string[]> {
  const directory = path.join(process.cwd(), 'supabase', 'migrations');
  const files = (await fs.readdir(directory))
    .filter((file) => MIGRATION_PATTERN.test(file))
    .filter((file) => migrationNumber(file) >= options.from)
    .filter((file) => options.to === null || migrationNumber(file) <= options.to)
    .sort((a, b) => a.localeCompare(b));
  if (files.length === 0) throw new Error('没有匹配的迁移文件');
  return files;
}

async function verifyAdminSchema(client: Client): Promise<void> {
  const requiredTables = ['ai_usage_events', 'ai_model_prices', 'admin_audit_logs', 'admin_roles'];
  const requiredFunctions = [
    'get_admin_analytics',
    'get_ai_usage_student_summary_v4',
    'get_admin_prefill_quality',
    'get_admin_service_health',
    'get_admin_student_directory',
  ];
  const tableResult = await client.query<{ object_name: string; present: boolean }>(
    `select object_name, to_regclass('public.' || object_name) is not null as present
     from unnest($1::text[]) as object_name`,
    [requiredTables],
  );
  const functionResult = await client.query<{ routine_name: string }>(
    `select routine_name from information_schema.routines
     where routine_schema = 'public' and routine_name = any($1::text[])`,
    [requiredFunctions],
  );
  const missingTables = tableResult.rows.filter((row) => !row.present).map((row) => row.object_name);
  const presentFunctions = new Set(functionResult.rows.map((row) => row.routine_name));
  const missingFunctions = requiredFunctions.filter((name) => !presentFunctions.has(name));
  if (missingTables.length || missingFunctions.length) {
    throw new Error(`结构验证失败：缺少表 ${missingTables.join('、') || '无'}；缺少函数 ${missingFunctions.join('、') || '无'}`);
  }
  console.log('结构验证通过：关键表和函数均已存在。');
}

function redactConnection(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}`;
  } catch {
    return '<invalid connection string>';
  }
}

async function main() {
  const options = parseOptions();
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error('缺少 SUPABASE_DB_URL。它必须是 Supabase Dashboard 的 PostgreSQL connection string，不能只填 Supabase URL 或 anon key。');
  }

  const files = await getMigrationFiles(options);
  console.log(`数据库：${redactConnection(connectionString)}`);
  console.log(`迁移范围：${files[0]} -> ${files[files.length - 1]}，共 ${files.length} 个文件`);

  if (options.dryRun) {
    files.forEach((file) => console.log(`待处理：${file}`));
    return;
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    query_timeout: getQueryTimeoutMs(),
  });

  try {
    await client.connect();
    await client.query('select 1');
    await client.query(`
      create table if not exists ${MIGRATION_TABLE} (
        migration_key text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const appliedResult = await client.query<{ migration_key: string }>(
      `select migration_key from ${MIGRATION_TABLE} where migration_key = any($1::text[])`,
      [files],
    );
    const applied = new Set(appliedResult.rows.map((row) => row.migration_key));
    const pending = files.filter((file) => !applied.has(file));

    if (options.check) {
      await verifyAdminSchema(client);
      console.log(`已登记：${files.length - pending.length}，待执行：${pending.length}`);
      pending.forEach((file) => console.log(`待执行：${file}`));
      return;
    }

    if (options.baseline) {
      await verifyAdminSchema(client);
      for (const file of pending) {
        await client.query(`insert into ${MIGRATION_TABLE} (migration_key) values ($1) on conflict do nothing`, [file]);
      }
      console.log(`已登记基线：${pending.length} 个文件。基线模式不会执行 SQL。`);
      return;
    }

    for (const file of pending) {
      console.log(`执行：${file}`);
      const sql = await fs.readFile(path.join(process.cwd(), 'supabase', 'migrations', file), 'utf8');
      await client.query(sql);
      await client.query(`insert into ${MIGRATION_TABLE} (migration_key) values ($1) on conflict do nothing`, [file]);
      console.log(`完成：${file}`);
    }
    await verifyAdminSchema(client);
    console.log(pending.length === 0 ? '数据库已是最新，没有需要执行的迁移。' : `迁移完成：${pending.length} 个文件。`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '迁移失败');
  process.exitCode = 1;
});
