#!/usr/bin/env node
/**
 * 改写数据库里指向旧 Supabase 域名的绝对 URL（计划 §7 第 4 步，脚本化）。
 *
 *   # 只看（对生产安全）
 *   OLD_BASE=https://weqvdtdjdzmqflhwobec.supabase.co \
 *   NEW_BASE=https://supabase.liorvix.com \
 *     node scripts/migrate/rewrite-storage-urls.mjs
 *
 *   # 真写（演练/切换窗口内）
 *   ... --apply
 *
 * 覆盖范围：已实测 public 下 31 个"像 URL/路径"的文本列里，只有这两列存在旧域名：
 *   company_logos.logo_url   (42 行)
 *   profiles.avatar_url      (1 行)
 * 脚本每次都会重新扫描这两列，不假设行数不变。
 *
 * 幂等：替换是 `replace()`，重复跑不会二次改写；`--apply` 前后都打印计数。
 */
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || '.env.production.local', quiet: true });

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const OLD_BASE = (process.env.OLD_BASE || '').replace(/\/+$/u, '');
const NEW_BASE = (process.env.NEW_BASE || '').replace(/\/+$/u, '');

if (!OLD_BASE || !NEW_BASE) {
  console.error('OLD_BASE and NEW_BASE are required (hosts only, no trailing slash)');
  process.exit(2);
}
if (!/^https?:\/\//u.test(OLD_BASE) || !/^https?:\/\//u.test(NEW_BASE)) {
  console.error('OLD_BASE / NEW_BASE must start with http(s)://');
  process.exit(2);
}
if (OLD_BASE === NEW_BASE) {
  console.error('OLD_BASE and NEW_BASE are identical');
  process.exit(2);
}

const TARGETS = [
  { table: 'company_logos', column: 'logo_url' },
  { table: 'profiles', column: 'avatar_url' },
];

const dbUrl = process.env.SUPABASE_DB_URL || '';
const loopback = /(?:^|@)(?:127\.0\.0\.1|localhost)(?::|\/)/u.test(dbUrl);
const client = new Client({
  connectionString: dbUrl,
  // 自托管栈在本机回环上不开 TLS；连 Cloud / 远程仍强制 TLS。
  ssl: loopback ? false : { rejectUnauthorized: false },
});

await client.connect();
console.log(`old base: ${OLD_BASE}`);
console.log(`new base: ${NEW_BASE}`);
console.log(`mode:     ${APPLY ? 'apply' : 'dry-run'}\n`);

let totalBefore = 0;
for (const { table, column } of TARGETS) {
  const { rows } = await client.query(
    `select count(*)::int as hits from public."${table}" where "${column}" like $1`,
    [`%${OLD_BASE}%`],
  );
  const before = rows[0].hits;
  totalBefore += before;
  console.log(`${table}.${column}: ${before} row(s) point at the old base`);
  if (!APPLY || before === 0) continue;

  const update = await client.query(
    `update public."${table}"
        set "${column}" = replace("${column}", $1, $2)
      where "${column}" like $3`,
    [OLD_BASE, NEW_BASE, `%${OLD_BASE}%`],
  );
  const after = await client.query(
    `select count(*)::int as hits from public."${table}" where "${column}" like $1`,
    [`%${OLD_BASE}%`],
  );
  console.log(`  updated ${update.rowCount}, remaining ${after.rows[0].hits}`);
}

if (!APPLY) {
  console.log(`\ndry-run: would rewrite ${totalBefore} row(s). Re-run with --apply to write.`);
} else if (totalBefore === 0) {
  console.log('\nnothing to rewrite (already migrated or never stored); re-run is safe');
}

await client.end();