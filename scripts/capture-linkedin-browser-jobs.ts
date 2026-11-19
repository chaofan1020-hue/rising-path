import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  LINKEDIN_SEARCH_URL,
  assertLinkedInFeedComplete,
  isLinkedInHiringCompany,
  isUsableLinkedInDescription,
  linkedInJobCardsUrl,
  linkedInJobDescriptionUrl,
  linkedInJobIdFromUrl,
  normalizeLinkedInJobUrl,
  parseLinkedInDetailHtml,
  parseLinkedInJobCardsPayload,
  parseLinkedInJobDescriptionPayload,
  parseLinkedInReportedTotal,
  type LinkedInCapturedJob,
  type LinkedInListCard,
} from '@/lib/linkedin-official';

type CaptureFile = {
  generated_at: string;
  search_url: string;
  reported_total: number | null;
  list_complete: boolean;
  jobs: LinkedInCapturedJob[];
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
  return process.env.LINKEDIN_BROWSER_PROFILE_DIR
    || path.join(os.homedir(), 'AppData', 'Local', 'liorvix', 'linkedin-edge-profile');
}

function outputPath(): string {
  return argument('output') || path.join('output', 'linkedin-browser-jobs-latest.json');
}

function browserChannel(): 'chrome' | 'msedge' {
  const requested = (process.env.LINKEDIN_BROWSER_CHANNEL || 'msedge').toLowerCase();
  const chrome = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const edge = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  if (requested === 'chrome' && chrome.some((item) => existsSync(item))) return 'chrome';
  if (edge.some((item) => existsSync(item))) return 'msedge';
  if (chrome.some((item) => existsSync(item))) return 'chrome';
  throw new Error('本机没有 Microsoft Edge 或 Google Chrome，无法采集 LinkedIn 官方岗位');
}

async function loadPrevious(file: string): Promise<Map<string, LinkedInCapturedJob>> {
  if (!existsSync(file)) return new Map();
  try {
    const payload = JSON.parse(await readFile(file, 'utf8')) as CaptureFile;
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    return new Map(jobs.filter((job) => job?.id && isUsableLinkedInDescription(job.description)).map((job) => [job.id, job]));
  } catch {
    return new Map();
  }
}

function mergeCards(target: Map<string, LinkedInListCard>, cards: LinkedInListCard[]): number {
  let added = 0;
  for (const card of cards) {
    if (target.has(card.id)) continue;
    target.set(card.id, card);
    added += 1;
  }
  return added;
}

async function csrfToken(context: import('playwright-core').BrowserContext): Promise<string> {
  const cookies = await context.cookies('https://www.linkedin.com');
  return (cookies.find((item) => item.name === 'JSESSIONID')?.value || '').replace(/"/g, '');
}

async function voyagerGet(
  page: import('playwright-core').Page,
  url: string,
  csrf: string,
): Promise<{ status: number; json: unknown }> {
  const result = await page.evaluate(async ({ url: target, csrfToken: token }) => {
    const response = await fetch(target, {
      credentials: 'include',
      headers: {
        accept: 'application/vnd.linkedin.normalized+json+2.1',
        'csrf-token': token,
        'x-restli-protocol-version': '2.0.0',
      },
    });
    return { status: response.status, text: await response.text() };
  }, { url, csrfToken: csrf });
  let json: unknown = null;
  try {
    json = JSON.parse(result.text);
  } catch {
    json = null;
  }
  return { status: result.status, json };
}

async function safeGoto(
  page: import('playwright-core').Page,
  url: string,
  timeoutMs: number,
): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'commit', timeout: timeoutMs });
  } catch (error) {
    console.error(JSON.stringify({
      goto: url,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function waitForOfficialList(
  page: import('playwright-core').Page,
  context: import('playwright-core').BrowserContext,
  headed: boolean,
): Promise<{ reportedTotal: number | null; csrf: string }> {
  await safeGoto(page, LINKEDIN_SEARCH_URL, 45_000);
  const deadline = Date.now() + (headed ? 120_000 : 45_000);
  while (Date.now() < deadline) {
    const csrf = await csrfToken(context);
    let title = '';
    let cardCount = 0;
    try {
      title = await page.title();
      cardCount = await page.locator('[data-job-id]').count();
    } catch {
      title = '';
      cardCount = 0;
    }
    let reportedTotal = parseLinkedInReportedTotal(title);
    if (csrf && cardCount > 0) {
      const first = await voyagerGet(page, linkedInJobCardsUrl(0), csrf);
      const parsed = parseLinkedInJobCardsPayload(first.json);
      reportedTotal = parsed.total || reportedTotal;
      console.error(JSON.stringify({
        title: title.slice(0, 80),
        page_cards: cardCount,
        api_status: first.status,
        api_cards: parsed.cards.length,
        reported_total: reportedTotal,
      }));
      if (first.status === 200 && parsed.cards.length > 0) {
        return { reportedTotal, csrf };
      }
    } else {
      console.error(JSON.stringify({
        title: title.slice(0, 80),
        page_cards: cardCount,
        reported_total: reportedTotal,
      }));
    }
    if (headed) {
      console.error('请在打开的 Edge 里确认 LinkedIn 已登录，并等到公司岗位列表出现。');
    }
    await wait(headed ? 3000 : 1500);
  }
  throw new Error('官方岗位列表未出现；可能仍在登录墙或验证页');
}

async function collectList(
  page: import('playwright-core').Page,
  csrf: string,
  limit: number | null,
): Promise<{ cards: LinkedInListCard[]; listComplete: boolean; reportedTotal: number | null }> {
  const cards = new Map<string, LinkedInListCard>();
  let reportedTotal: number | null = null;
  let emptyPages = 0;
  let listComplete = false;
  for (let start = 0; start <= 2000; start += 25) {
    if (limit && cards.size >= limit) break;
    let parsed = { total: null as number | null, cards: [] as LinkedInListCard[] };
    let status = 0;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const fetched = await voyagerGet(page, linkedInJobCardsUrl(start), csrf);
      status = fetched.status;
      parsed = parseLinkedInJobCardsPayload(fetched.json);
      if (status === 429 || status === 451 || status >= 500) {
        await wait(4000 + attempt * 3000);
        continue;
      }
      break;
    }
    if (parsed.total) reportedTotal = parsed.total;
    const added = mergeCards(cards, parsed.cards);
    console.error(JSON.stringify({
      list_page: start,
      status,
      page_cards: parsed.cards.length,
      new_cards: added,
      total: cards.size,
      reported_total: reportedTotal,
    }));
    if (status !== 200 || parsed.cards.length === 0 || added === 0) {
      emptyPages += 1;
      if (emptyPages >= 2) {
        listComplete = cards.size > 0;
        break;
      }
    } else {
      emptyPages = 0;
    }
    if (reportedTotal && cards.size >= reportedTotal) {
      listComplete = true;
      break;
    }
    await wait(700 + Math.floor(Math.random() * 600));
  }
  const selected = [...cards.values()];
  if (limit) return { cards: selected.slice(0, limit), listComplete: false, reportedTotal };
  return { cards: selected, listComplete, reportedTotal };
}

async function captureDetail(
  page: import('playwright-core').Page,
  csrf: string,
  card: LinkedInListCard,
  previous: LinkedInCapturedJob | undefined,
  capturedAt: string,
): Promise<LinkedInCapturedJob> {
  if (previous && isUsableLinkedInDescription(previous.description)) {
    return {
      ...previous,
      title: card.title || previous.title,
      url: card.url || previous.url,
      location: card.location || previous.location,
      captured_at: previous.captured_at,
    };
  }
  let parsed = parseLinkedInJobDescriptionPayload(null);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fetched = await voyagerGet(page, linkedInJobDescriptionUrl(card.id), csrf);
    parsed = parseLinkedInJobDescriptionPayload(fetched.json);
    if (isUsableLinkedInDescription(parsed.description)) break;
    if (fetched.status === 429 || fetched.status === 451) await wait(3000 + attempt * 2000);
  }
  if (!isUsableLinkedInDescription(parsed.description)) {
    const viewUrl = `https://www.linkedin.com/jobs/view/${card.id}`;
    await page.goto(viewUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
    parsed = parseLinkedInDetailHtml(await page.content().catch(() => ''), await page.title().catch(() => ''));
  }
  const description = parsed.description || '';
  if (!isUsableLinkedInDescription(description)) {
    throw new Error(parsed.blockReason || 'missing_job_body');
  }
  const company = parsed.company || card.company;
  if (company && !isLinkedInHiringCompany(company)) {
    throw new Error(`hiring_company:${company}`);
  }
  return {
    id: parsed.id || card.id,
    title: parsed.title || card.title,
    url: normalizeLinkedInJobUrl(card.url) || `https://www.linkedin.com/jobs/view/${card.id}`,
    location: parsed.location || card.location,
    department: parsed.department,
    description,
    company: company || 'LinkedIn',
    employment_type: parsed.employmentType,
    date_posted: parsed.datePosted,
    captured_at: capturedAt,
  };
}

function runImporter(input: string, write: boolean): Promise<void> {
  const args = ['exec', 'tsx', 'scripts/import-linkedin-browser-jobs.ts', `--input=${input}`];
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
  const write = process.argv.includes('--write');
  const headed = !process.argv.includes('--headless');
  const limitValue = argument('limit');
  const limit = limitValue ? Math.max(1, Math.min(Number(limitValue) || 0, 50)) : null;
  if (write && process.env.LINKEDIN_BROWSER_JOBS_WRITE_ENABLED !== 'true') {
    throw new Error('写入默认关闭；请设置 LINKEDIN_BROWSER_JOBS_WRITE_ENABLED=true 再加 --write');
  }

  const out = outputPath();
  const previous = await loadPrevious(out);
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
  const result = {
    generated_at: new Date().toISOString(),
    search_url: LINKEDIN_SEARCH_URL,
    reported_total: null as number | null,
    list_complete: false,
    jobs: [] as LinkedInCapturedJob[],
    failed: [] as Array<{ id: string; reason: string }>,
  };
  try {
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(120_000);
    page.setDefaultNavigationTimeout(120_000);
    const listPage = await waitForOfficialList(page, context, headed);
    result.reported_total = listPage.reportedTotal;
    const pageTitle = await page.title();
    if (/united states/i.test(pageTitle) && !/worldwide/i.test(pageTitle) && (result.reported_total || 0) < 250) {
      throw new Error(`官方页仍是美国子集：${pageTitle}`);
    }
    const collected = await collectList(page, listPage.csrf, limit);
    result.reported_total = collected.reportedTotal || result.reported_total;
    result.list_complete = collected.listComplete && !limit;
    const cards = collected.cards;
    console.error(JSON.stringify({
      reported_total: result.reported_total,
      list_cards: cards.length,
      list_complete: result.list_complete,
      previous_with_body: previous.size,
    }));
    for (const [index, card] of cards.entries()) {
      try {
        const job = await captureDetail(page, listPage.csrf, card, previous.get(card.id), result.generated_at);
        if (linkedInJobIdFromUrl(job.url) !== job.id) {
          throw new Error('url_id_mismatch');
        }
        result.jobs.push(job);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        result.failed.push({ id: card.id, reason });
        if (result.failed.filter((item) => item.reason.includes('challenge')).length >= 3) {
          result.failed.push({ id: '(stopped)', reason: '连续遇到验证页，已停止以免空转' });
          break;
        }
      }
      if (index < cards.length - 1 && !previous.get(card.id)) {
        await wait(900 + Math.floor(Math.random() * 700));
      }
    }
  } finally {
    await context.close();
  }

  const unique = new Map(result.jobs.map((job) => [job.id, job]));
  const jobs = [...unique.values()].map((job) => ({
    ...job,
    source_reported_count: result.reported_total ?? unique.size,
    source_expected_count: unique.size,
    source_complete: result.list_complete,
    source_count_basis: result.list_complete ? 'complete_official_list' : 'partial_browser_capture',
  }));
  if (write) {
    assertLinkedInFeedComplete({
      jobs,
      reportedTotal: result.reported_total,
      previousCount: previous.size || null,
      listComplete: result.list_complete,
      allowPartial: Boolean(limit),
    });
  }
  await mkdir(path.dirname(out), { recursive: true });
  const payload: CaptureFile = {
    generated_at: result.generated_at,
    search_url: result.search_url,
    reported_total: result.reported_total,
    list_complete: result.list_complete,
    jobs,
  };
  await writeFile(out, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    output: out,
    reported_total: result.reported_total,
    list_complete: result.list_complete,
    captured: jobs.length,
    failed: result.failed,
    desc_ge_300: jobs.filter((job) => job.description.length >= 300).length,
  }, null, 2));
  if (jobs.length > 0 && (write || process.argv.includes('--import'))) {
    await runImporter(out, write);
  }
  if (jobs.length === 0) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
