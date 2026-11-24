#!/usr/bin/env node
/**
 * 文档与产物的静态体检（提交前 / CI 可跑，零依赖）。
 *
 *   node scripts/migrate/check-artifacts.mjs
 *
 * 做三件事：
 *   1. docs/ 下所有 Markdown 里的相对链接都必须能解析（避免交付出去一堆 404）；
 *   2. deploy/ 与 scripts/migrate/ 下的文本文件必须是 LF（仓库 core.autocrlf=false、core.eol=lf，
 *      CRLF 会产生整文件 diff）；
 *   3. docker-compose.yml 里引用的环境变量必须都在 .env.example 里声明（否则 `docker compose up`
 *      直接报 missing variable）。
 *
 * 任一失败 → 退出码 1。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const problems = [];
const note = (line) => problems.push(line);

// ---------- 1. Markdown 相对链接 ----------
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (extname(entry.name) === '.md') out.push(full);
  }
  return out;
}

const docsRoot = resolve('docs');
let linkCount = 0;
for (const file of walk(docsRoot)) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/gu)) {
    const target = match[1].split('#')[0].trim();
    if (!target || /^(https?:|mailto:|data:)/iu.test(target)) continue;
    linkCount += 1;
    const resolved = resolve(file, '..', target);
    if (!existsSync(resolved)) note(`broken link: ${file.replace(process.cwd(), '.')} -> ${target}`);
  }
}

// ---------- 2. LF 行尾 ----------
const lfRoots = ['deploy', 'scripts/migrate'];
const textExtensions = new Set(['.yml', '.yaml', '.md', '.sh', '.mjs', '.js', '.ts', '.txt', '.conf', '.service', '.example']);
let lfCount = 0;
for (const root of lfRoots) {
  const dir = resolve(root);
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (!statSync(full).isFile()) continue;
    const name = entry.name;
    const ext = name.startsWith('.') ? name.replace(/^[^.]+/u, '') : extname(name);
    if (!name.startsWith('.') && !textExtensions.has(ext) && !name.endsWith('.sh')) continue;
    const text = readFileSync(full, 'utf8');
    lfCount += 1;
    if (text.includes('\r\n')) note(`CRLF line endings: ${full.replace(process.cwd(), '.')} (${text.split('\r\n').length - 1} lines)`);
  }
}

// ---------- 3. compose 变量 vs .env.example ----------
const composePath = resolve('deploy/supabase/docker-compose.yml');
const envExamplePath = resolve('deploy/supabase/.env.example');
if (existsSync(composePath) && existsSync(envExamplePath)) {
  const compose = readFileSync(composePath, 'utf8');
  const declared = new Set(
    readFileSync(envExamplePath, 'utf8')
      .split('\n')
      .map((line) => line.match(/^#?\s*([A-Z0-9_]+)=/u)?.[1])
      .filter(Boolean),
  );
  const referenced = new Set([...compose.matchAll(/\$\{([A-Z0-9_]+)[^}]*\}/gu)].map((m) => m[1]));
  for (const name of referenced) {
    if (!declared.has(name)) note(`compose references ${name} but .env.example does not declare it`);
  }
  const unused = [...declared].filter((name) => !referenced.has(name));
  console.log(`compose vars: ${referenced.size} referenced / ${declared.size} declared${unused.length ? `, unused: ${unused.join(', ')}` : ''}`);
}

console.log(`markdown: ${linkCount} relative links checked`);
console.log(`text files: ${lfCount} LF-checked`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const line of problems) console.error(`  - ${line}`);
  process.exit(1);
}
console.log('artifact checks passed');