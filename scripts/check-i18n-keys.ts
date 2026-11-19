/**
 * 文案完整性检查：页面里 t('some.key') 用到的每个 key，在三个语种里都必须存在。
 *
 * 为什么需要它：`t()` 在缺 key 时会直接返回 key 名（"intro.body"），
 * 页面不会报错也不会白屏，只是把 key 当文案显示出来——线上就发生过一次
 * （部署时 i18n 文件被旧版本覆盖，信封正文变成三行 key）。
 *
 * 运行：pnpm check:i18n
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const I18N_FILE = path.join(ROOT, 'src', 'lib', 'language-context.tsx');
const LOCALES = ['zh-CN', 'zh-TW', 'en'] as const;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'tmp', 'output', 'dist', 'extension', 'agent']);

interface LocaleBlock {
  locale: string;
  start: number;
  end: number;
}

function localeBlocks(source: string): LocaleBlock[] {
  const markers = [
    { locale: 'zh-CN', pattern: /^\s*['"]?zh-CN['"]?\s*:\s*\{/m },
    { locale: 'zh-TW', pattern: /^\s*['"]?zh-TW['"]?\s*:\s*\{/m },
    { locale: 'en', pattern: /^\s*['"]?en['"]?\s*:\s*\{/m },
  ];
  const blocks: LocaleBlock[] = [];
  for (const marker of markers) {
    const match = marker.pattern.exec(source);
    if (!match) throw new Error(`找不到 ${marker.locale} 语种块`);
    blocks.push({ locale: marker.locale, start: match.index, end: source.length });
  }
  blocks.sort((a, b) => a.start - b.start);
  for (let i = 0; i < blocks.length - 1; i += 1) blocks[i].end = blocks[i + 1].start;
  return blocks;
}

function keysIn(block: string): Set<string> {
  const keys = new Set<string>();
  for (const match of block.matchAll(/^\s*"([A-Za-z0-9_.-]+)"\s*:/gm)) keys.add(match[1]);
  return keys;
}

async function walk(dir: string, files: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), files);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

async function main() {
  const source = await readFile(I18N_FILE, 'utf8');
  const dictionary = new Map<string, Set<string>>();
  for (const block of localeBlocks(source)) {
    dictionary.set(block.locale, keysIn(source.slice(block.start, block.end)));
  }

  const files = (await walk(path.join(ROOT, 'src'))).filter((file) => file !== I18N_FILE);
  const used = new Map<string, Set<string>>(); // key -> 使用它的文件
  for (const file of files) {
    const info = await stat(file);
    if (info.size > 800_000) continue;
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/\bt\(\s*['"]([A-Za-z0-9_.-]+)['"]/g)) {
      const key = match[1];
      if (!key.includes('.')) continue;
      const set = used.get(key) || new Set<string>();
      set.add(path.relative(ROOT, file));
      used.set(key, set);
    }
  }

  const problems: Array<{ key: string; missingIn: string[]; files: string[] }> = [];
  for (const [key, filesUsingKey] of used) {
    const missingIn = LOCALES.filter((locale) => !dictionary.get(locale)?.has(key));
    if (missingIn.length) problems.push({ key, missingIn, files: [...filesUsingKey] });
  }

  console.log(`扫描 ${files.length} 个源文件，发现 ${used.size} 个文案 key`);
  for (const locale of LOCALES) {
    console.log(`  ${locale}: ${dictionary.get(locale)?.size || 0} 条文案`);
  }

  if (problems.length === 0) {
    console.log('✅ 所有 t() key 在三个语种里都齐全');
    return;
  }

  console.log(`\n❌ ${problems.length} 个 key 缺失（页面会把 key 名直接显示出来）：`);
  for (const problem of problems.sort((a, b) => a.key.localeCompare(b.key))) {
    console.log(`  ${problem.key}  → 缺 ${problem.missingIn.join(', ')}  用于 ${problem.files.join(', ')}`);
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
