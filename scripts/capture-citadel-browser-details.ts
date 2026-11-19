import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { config as loadDotenv } from 'dotenv';

import {
  citadelLocationFromUrl,
  citadelSlugTitle,
  citadelSlugWithoutGqs,
  isCitadelExcludedSlug,
  isDisplayableCitadelBody,
  normalizeCitadelCareerUrl,
  parseCitadelDetailHtml,
} from '@/lib/citadel-official';
import { isTargetRegion } from '@/lib/job-region-scope';
import { getSupabaseClient } from '@/storage/database/supabase-client';

type Candidate = {
  job_url: string;
  title: string | null;
  action: 'update_body' | 'create_missing';
};

type CaptureRow = {
  job_url: string;
  title: string;
  description: string;
  location: string | null;
  captured_at: string;
};

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function profileDir(): string {
  return process.env.CITADEL_BROWSER_PROFILE_DIR
    || path.join(os.homedir(), 'AppData', 'Local', 'liorvix', 'citadel-chrome-profile');
}

function outputPath(): string {
  return argument('output') || path.join('output', 'citadel-browser-details-latest.json');
}

function browserChannel(): 'chrome' | 'msedge' {
  const chrome = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const edge = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  if (chrome.some((item) => existsSync(item))) return 'chrome';
  if (edge.some((item) => existsSync(item))) return 'msedge';
  throw new Error('本机没有 Google Chrome 或 Microsoft Edge，无法采集 Citadel 官方详情');
}

async function loadSiteJobs(): Promise<Array<{
  job_url: string | null;
  source_url: string | null;
  title: string | null;
  description: string | null;
  is_active: boolean | null;
  is_closed: boolean | null;
}>> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('jobs')
    .select('job_url,source_url,title,description,is_active,is_closed')
    .eq('company', 'Citadel');
  if (error) throw new Error(`读取 Citadel 岗位失败: ${error.message}`);
  return data || [];
}

async function loadSitemapUrls(): Promise<string[]> {
  const response = await fetch('https://www.citadel.com/career-sitemap.xml', { cache: 'no-store' });
  if (!response.ok) throw new Error(`官方 sitemap HTTP ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => normalizeCitadelCareerUrl(match[1].trim()))
    .filter((url): url is string => Boolean(url));
}

async function listCandidates(): Promise<Candidate[]> {
  const rows = await loadSiteJobs();
  const activeUrls = new Set<string>();
  const activeSlugs = new Set<string>();
  const missing: Candidate[] = [];
  for (const row of rows) {
    const url = normalizeCitadelCareerUrl(row.job_url) || normalizeCitadelCareerUrl(row.source_url);
    if (!url) continue;
    if (row.is_active === false || row.is_closed === true) continue;
    activeUrls.add(url);
    const slug = citadelSlugWithoutGqs(url);
    if (slug) activeSlugs.add(slug);
    if (!isDisplayableCitadelBody(row.description)) {
      missing.push({ job_url: url, title: row.title, action: 'update_body' });
    }
  }
  const sitemap = await loadSitemapUrls();
  for (const url of sitemap) {
    if (activeUrls.has(url) || isCitadelExcludedSlug(url)) continue;
    const slug = citadelSlugWithoutGqs(url);
    if (slug && activeSlugs.has(slug)) continue;
    missing.push({ job_url: url, title: citadelSlugTitle(url), action: 'create_missing' });
  }
  return missing;
}

async function capturePage(
  context: { newPage: () => Promise<import('playwright-core').Page> },
  url: string,
  headed: boolean,
): Promise<CaptureRow> {
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + (headed ? 180_000 : 20_000);
    let parsed = parseCitadelDetailHtml(await page.content(), await page.title());
    while (parsed.blocked && Date.now() < deadline) {
      if (headed && parsed.blockReason === 'cloudflare_challenge') {
        console.error(`等待浏览器完成验证: ${url}`);
      }
      await wait(headed ? 3000 : 1500);
      parsed = parseCitadelDetailHtml(await page.content(), await page.title());
      if (parsed.description) break;
    }
    if (!parsed.description) {
      throw new Error(parsed.blockReason || 'missing_job_body');
    }
    const location = parsed.location || citadelLocationFromUrl(url);
    return {
      job_url: url,
      title: parsed.title || citadelSlugTitle(url),
      description: parsed.description,
      location,
      captured_at: new Date().toISOString(),
    };
  } finally {
    await page.close();
  }
}

function runImporter(input: string, write: boolean, createMissing: boolean): Promise<void> {
  const args = ['exec', 'tsx', 'scripts/import-citadel-browser-details.ts', `--input=${input}`];
  if (createMissing) args.push('--create-missing');
  if (write) args.push('--write');
  return new Promise((resolve, reject) => {
    const child = spawn('corepack', ['pnpm', ...args], {
      stdio: 'inherit',
      env: process.env,
      shell: true,
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`导入脚本退出码 ${code}`));
    });
  });
}

async function main(): Promise<void> {
  loadDotenv({ path: process.env.DOTENV_CONFIG_PATH || process.env.ENV_FILE || '.env.production.local' });
  const write = process.argv.includes('--write');
  const headed = !process.argv.includes('--headless');
  const createMissing = !process.argv.includes('--no-create');
  const limit = Math.max(1, Math.min(Number(argument('limit') || 12) || 12, 30));
  if (write && process.env.CITADEL_BROWSER_DETAIL_WRITE_ENABLED !== 'true') {
    throw new Error('写入默认关闭；请设置 CITADEL_BROWSER_DETAIL_WRITE_ENABLED=true 再加 --write');
  }

  const candidates = (await listCandidates()).slice(0, limit);
  const result = {
    generated_at: new Date().toISOString(),
    mode: write ? 'write' : 'dry_run',
    headed,
    candidate_count: candidates.length,
    jobs: [] as CaptureRow[],
    failed: [] as Array<{ job_url: string; reason: string }>,
  };
  if (candidates.length === 0) {
    const out = outputPath();
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify({ ...result, jobs: [] }, null, 2));
    console.log(JSON.stringify({ ...result, output: out, message: '没有需要补正文的 Citadel 岗位' }, null, 2));
    return;
  }

  const { chromium } = await import('playwright-core');
  const dir = profileDir();
  await mkdir(dir, { recursive: true });
  const context = await chromium.launchPersistentContext(dir, {
    channel: browserChannel(),
    headless: !headed,
    locale: 'en-US',
    viewport: { width: 1366, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  let consecutiveBlocks = 0;
  try {
    for (const [index, candidate] of candidates.entries()) {
      try {
        const captured = await capturePage(context, candidate.job_url, headed);
        if (candidate.action === 'create_missing' && captured.location && !isTargetRegion(captured.location, null)) {
          result.failed.push({ job_url: candidate.job_url, reason: '官方地点不在目标地区' });
          consecutiveBlocks = 0;
          continue;
        }
        result.jobs.push(captured);
        consecutiveBlocks = 0;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        result.failed.push({ job_url: candidate.job_url, reason });
        consecutiveBlocks += /cloudflare|challenge|403/i.test(reason) ? 1 : 0;
        if (consecutiveBlocks >= 2) {
          result.failed.push({ job_url: '(stopped)', reason: '连续两次遇到验证页，已停止以免空转' });
          break;
        }
      }
      if (index < candidates.length - 1) await wait(8000 + Math.floor(Math.random() * 4000));
    }
  } finally {
    await context.close();
  }

  const out = outputPath();
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ generated_at: result.generated_at, jobs: result.jobs }, null, 2));
  console.log(JSON.stringify({ ...result, output: out }, null, 2));
  if (result.jobs.length > 0 && (write || process.argv.includes('--import'))) {
    await runImporter(out, write, createMissing);
  }
  if (result.jobs.length === 0 && result.failed.length > 0) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
